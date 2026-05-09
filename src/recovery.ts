import * as crypto from "node:crypto";
import type { ErrorCategory, ErrorSeverity, ErrorContext, ErrorRecoveryStrategy, ErrorRecord, RecoveryAction } from "./types.js";

// ---------------------------------------------------------------------------
// Retry Utility — Generic retry wrapper with exponential backoff
// ---------------------------------------------------------------------------

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay in ms (default: 30000) */
  maxDelayMs?: number;
  /** Jitter factor (0-1) added to each delay to avoid thundering herds (default: 0.2) */
  jitterFactor?: number;
  /** Optional predicate to determine whether a specific error should trigger a retry */
  shouldRetry?: (error: unknown) => boolean;
  /** Optional label for logging */
  operationName?: string;
}

/**
 * Calculate exponential backoff delay with optional jitter.
 */
function backoffDelay(attempt: number, baseMs: number, maxMs: number, jitterFactor: number): number {
  const delay = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  const jitter = jitterFactor > 0 ? delay * jitterFactor * (Math.random() * 2 - 1) : 0;
  return Math.round(Math.max(0, delay + jitter));
}

/**
 * Wrap an async operation with automatic retries using exponential backoff.
 *
 * @param fn - The async function to retry
 * @param options - Retry configuration
 * @returns The result of the function, or throws after exhausting retries
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    jitterFactor = 0.2,
    shouldRetry: shouldRetryFn,
    operationName,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // If we've exhausted retries, propagate the error
      if (attempt >= maxRetries) {
        break;
      }

      // If a custom predicate says we should NOT retry, propagate immediately
      if (shouldRetryFn && !shouldRetryFn(error)) {
        break;
      }

      const delay = backoffDelay(attempt, baseDelayMs, maxDelayMs, jitterFactor);
      const label = operationName ? `[${operationName}]` : "";

      if (typeof process !== "undefined" && process.stderr) {
        process.stderr.write(
          `${label} Attempt ${attempt + 1}/${maxRetries} failed, retrying in ${delay}ms...\n`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Synchronous variant of withRetry. Wraps a sync function with retry logic.
 */
export function withRetrySync<T>(
  fn: () => T,
  options: RetryOptions = {},
): T {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    jitterFactor = 0.2,
    shouldRetry: shouldRetryFn,
    operationName,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return fn();
    } catch (error) {
      lastError = error;

      if (attempt >= maxRetries) break;
      if (shouldRetryFn && !shouldRetryFn(error)) break;

      const delay = backoffDelay(attempt, baseDelayMs, maxDelayMs, jitterFactor);
      const label = operationName ? `[${operationName}]` : "";

      if (typeof process !== "undefined" && process.stderr) {
        process.stderr.write(
          `${label} Attempt ${attempt + 1}/${maxRetries} failed, retrying in ${delay}ms...\n`,
        );
      }

      // Synchronous sleep using Atomics + SharedArrayBuffer — fallback to busy-wait
      const deadline = Date.now() + delay;
      while (Date.now() < deadline) {
        // Busy-wait only as last resort — prefer the async variant
      }
    }
  }

  throw lastError;
}

/**
 * Default retry predicate: retry on transient/system/network errors, not on permanent or user errors.
 * Works with Error instances or plain objects containing a `message` property.
 */
export function defaultShouldRetry(error: unknown): boolean {
  if (!error) return false;
  // Extract message from Error instances, plain objects with .message, or String() fallback
  const message = error instanceof Error
    ? error.message.toLowerCase()
    : typeof (error as Record<string, unknown>)?.message === "string"
      ? String((error as Record<string, unknown>).message).toLowerCase()
      : String(error).toLowerCase();

  // Non-retryable patterns — permanent/user errors
  if (message.includes("syntax") || message.includes("parse error") || message.includes("invalid input")) {
    return false;
  }
  if (message.includes("permission denied") || message.includes("eacces") || message.includes("eperm")) {
    return false;
  }
  if (message.includes("validation") && message.includes("failed")) {
    return false;
  }

  // Retryable patterns
  if (message.includes("timeout") || message.includes("timed out")) return true;
  if (message.includes("econnrefused") || message.includes("econnreset") || message.includes("enotfound")) return true;
  if (message.includes("eagain") || message.includes("ebusy") || message.includes("elock")) return true;
  if (message.includes("temporary") || message.includes("transient") || message.includes("retry")) return true;
  if (message.includes("lock") && message.includes("busy")) return true;
  if (message.includes("resource temporarily")) return true;
  if (message.includes("enomem") || message.includes("cannot allocate")) return true;
  if (message.includes("stale") && message.includes("lock")) return true;

  // By default, don't retry unknown errors
  return false;
}

/**
 * Create a RetryOptions preset for common operation categories.
 */
export const RetryPresets = {
  /** For file I/O operations — retry transient errors with moderate backoff */
  fileIO: {
    maxRetries: 3,
    baseDelayMs: 500,
    maxDelayMs: 10000,
    jitterFactor: 0.1,
    shouldRetry: defaultShouldRetry,
  } satisfies RetryOptions,

  /** For network operations — retry more aggressively */
  network: {
    maxRetries: 5,
    baseDelayMs: 2000,
    maxDelayMs: 60000,
    jitterFactor: 0.2,
    shouldRetry: defaultShouldRetry,
  } satisfies RetryOptions,

  /** For lock acquisition — retry with short delays */
  lock: {
    maxRetries: 10,
    baseDelayMs: 100,
    maxDelayMs: 5000,
    jitterFactor: 0.05,
    shouldRetry: defaultShouldRetry,
  } satisfies RetryOptions,

  /** For critical operations — give up quickly and report */
  critical: {
    maxRetries: 1,
    baseDelayMs: 100,
    maxDelayMs: 2000,
    jitterFactor: 0,
    shouldRetry: defaultShouldRetry,
  } satisfies RetryOptions,

  /** For state persistence — aggressive retry to prevent data loss */
  persistence: {
    maxRetries: 5,
    baseDelayMs: 200,
    maxDelayMs: 5000,
    jitterFactor: 0.1,
    shouldRetry: defaultShouldRetry,
  } satisfies RetryOptions,
} as const;

// ---------------------------------------------------------------------------
// Graceful Degradation Utilities
// ---------------------------------------------------------------------------

/**
 * A fallback that can provide a degraded result when the primary operation fails.
 */
export interface DegradedResult<T> {
  ok: boolean;
  value: T | undefined;
  degraded: boolean;
  error?: unknown;
}

/**
 * Execute a primary operation with a fallback for graceful degradation.
 * If the primary succeeds, returns `{ ok: true, value, degraded: false }`.
 * If the primary fails AND the fallback succeeds, returns `{ ok: true, value, degraded: true }`.
 * If both fail, returns `{ ok: false, value: undefined, degraded: true, error }`.
 */
export async function withDegradation<T>(
  primary: () => Promise<T>,
  fallback: (error: unknown) => Promise<T>,
): Promise<DegradedResult<T>> {
  try {
    const value = await primary();
    return { ok: true, value, degraded: false };
  } catch (primaryError) {
    try {
      const value = await fallback(primaryError);
      return { ok: true, value, degraded: true, error: primaryError };
    } catch (fallbackError) {
      return { ok: false, value: undefined, degraded: true, error: fallbackError };
    }
  }
}

/**
 * Synchronous variant of withDegradation.
 */
export function withDegradationSync<T>(
  primary: () => T,
  fallback: (error: unknown) => T,
): DegradedResult<T> {
  try {
    const value = primary();
    return { ok: true, value, degraded: false };
  } catch (primaryError) {
    try {
      const value = fallback(primaryError);
      return { ok: true, value, degraded: true, error: primaryError };
    } catch (fallbackError) {
      return { ok: false, value: undefined, degraded: true, error: fallbackError };
    }
  }
}

/**
 * Wraps an async function so that it returns a DegradedResult instead of throwing.
 * The degraded flag is set when the fallback was used.
 */
export function guardWithDegradation<T>(
  fn: () => Promise<T>,
  fallback: (error: unknown) => Promise<T>,
): Promise<DegradedResult<T>> {
  return withDegradation(fn, fallback);
}

// ---------------------------------------------------------------------------
// Error Recovery Engine
// ---------------------------------------------------------------------------

/**
 * Alert callback signature for error events.
 * Called when errors cross severity or count thresholds.
 */
export type ErrorAlertCallback = (alert: {
  type: "error_critical" | "error_threshold" | "recovery_failed" | "retry_exhausted";
  record: ErrorRecord;
  stats?: { total: number; critical: number; recent: number };
  message: string;
}) => void;

/** Union of valid alert type values */
export type ErrorAlertType = "error_critical" | "error_threshold" | "recovery_failed" | "retry_exhausted";

/**
 * Error recovery engine that categorizes errors and applies recovery strategies.
 * Supports alerting via callbacks, automatic recovery actions, and per-category strategies.
 */
export class ErrorRecoveryEngine {
  private errorRecords: Map<string, ErrorRecord> = new Map();
  private activeRetries: Map<string, { count: number; lastAttempt: number }> = new Map();
  private alertCallbacks: Set<ErrorAlertCallback> = new Set();
  
  /** Thresholds that trigger alert callbacks */
  private alertThresholds = {
    criticalErrors: 1,         // Alert on first critical error
    consecutiveFailures: 3,    // Alert on 3+ consecutive failures for same operation
    totalErrorsBeforeAlert: 5, // Alert when total errors exceeds this
    windowMs: 60000,           // Time window for "recent" errors in ms
  };

  /** Tracks consecutive failures per operation key for threshold alerting */
  private consecutiveFailures: Map<string, number> = new Map();
  
  // Default recovery strategies per error category
  private strategies: Map<ErrorCategory, ErrorRecoveryStrategy> = new Map([
    ["transient", { category: "transient", maxRetries: 3, backoffMs: 1000, fallbackAction: "retry" }],
    ["network", { category: "network", maxRetries: 5, backoffMs: 2000, fallbackAction: "retry" }],
    ["permission", { category: "permission", maxRetries: 0, backoffMs: 0, fallbackAction: "ask_user" }],
    ["permanent", { category: "permanent", maxRetries: 0, backoffMs: 0, fallbackAction: "block" }],
    ["user", { category: "user", maxRetries: 0, backoffMs: 0, fallbackAction: "ask_user" }],
    ["system", { category: "system", maxRetries: 2, backoffMs: 5000, fallbackAction: "degrade" }],
    ["unknown", { category: "unknown", maxRetries: 1, backoffMs: 1000, fallbackAction: "skip" }],
  ]);

  /**
   * Register an alert callback that fires when error thresholds are crossed.
   */
  onAlert(callback: ErrorAlertCallback): () => void {
    this.alertCallbacks.add(callback);
    return () => this.alertCallbacks.delete(callback);
  }

  /**
   * Set alert thresholds for automatic notifications.
   */
  setAlertThresholds(thresholds: Partial<typeof this.alertThresholds>): void {
    Object.assign(this.alertThresholds, thresholds);
  }

  private fireAlert(type: ErrorAlertType, record: ErrorRecord, message: string): void {
    const now = Date.now();
    const recentRecords = Array.from(this.errorRecords.values()).filter(
      (r) => now - r.timestamp < this.alertThresholds.windowMs,
    );
    const criticalCount = recentRecords.filter((r) => r.severity === "critical").length;
    const stats = {
      total: this.errorRecords.size,
      critical: criticalCount,
      recent: recentRecords.length,
    };
    for (const cb of this.alertCallbacks) {
      try {
        cb({ type, record, stats, message });
      } catch {
        // Alert callbacks must not throw — swallow errors silently
      }
    }
  }

  private getOperationKey(context: ErrorContext): string {
    return `${context.toolName ?? "unknown"}:${context.featureId ?? "global"}`;
  }

  /**
   * Categorize an error based on its context and message
   */
  categorizeError(context: ErrorContext): ErrorCategory {
    const msg = context.errorMessage.toLowerCase();
    const type = context.errorType.toLowerCase();

    // Network errors
    if (msg.includes("network") || msg.includes("connection") || msg.includes("timeout") ||
        msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("etimedout")) {
      return "network";
    }

    // Permission errors
    if (msg.includes("permission") || msg.includes("access denied") || msg.includes("eacces") ||
        msg.includes("eperm") || type.includes("permission")) {
      return "permission";
    }

    // User errors (input validation, etc.)
    if (msg.includes("invalid input") || msg.includes("validation") || msg.includes("user") ||
        type.includes("validation") || type.includes("user")) {
      return "user";
    }

    // Transient errors (temporary failures)
    if (msg.includes("temporary") || msg.includes("retry") || msg.includes("busy") ||
        msg.includes("locked") || msg.includes("eagain") || msg.includes("ebusy")) {
      return "transient";
    }

    // System errors (resource limits, etc.)
    if (msg.includes("memory") || msg.includes("disk") || msg.includes("space") ||
        msg.includes("enoent") && msg.includes("file") || type.includes("system")) {
      return "system";
    }

    // Permanent errors (syntax, logic, etc.)
    if (msg.includes("syntax") || msg.includes("parse") || msg.includes("logic") ||
        type.includes("syntax") || type.includes("parse")) {
      return "permanent";
    }

    return "unknown";
  }

  /**
   * Determine error severity based on category and context
   */
  determineSeverity(category: ErrorCategory, context: ErrorContext): ErrorSeverity {
    // Critical errors that block progress
    if (category === "permanent" || category === "permission") {
      return "critical";
    }

    // High severity for system errors
    if (category === "system") {
      return "high";
    }

    // Medium for network and unknown
    if (category === "network" || category === "unknown") {
      return "medium";
    }

    // Low for transient and user errors
    return "low";
  }

  /**
   * Handle an error and determine the recovery action.
   * Fires alert callbacks when severity or count thresholds are crossed.
   */
  handleError(context: ErrorContext): { action: RecoveryAction; shouldRetry: boolean; retryAfter?: number; record: ErrorRecord } {
    const category = this.categorizeError(context);
    const severity = this.determineSeverity(category, context);
    const strategy = this.strategies.get(category) || this.strategies.get("unknown")!;

    // Check if we've already retried this error
    const errorKey = this.getErrorKey(context);
    const retryState = this.activeRetries.get(errorKey);
    const retryCount = retryState?.count || 0;

    // Track consecutive failures per operation
    const opKey = this.getOperationKey(context);
    const consecutive = (this.consecutiveFailures.get(opKey) ?? 0) + 1;
    this.consecutiveFailures.set(opKey, consecutive);

    // Create error record
    const record: ErrorRecord = {
      id: crypto.randomUUID(),
      context,
      category,
      severity,
      retryCount,
      actionTaken: "skip" as RecoveryAction,
      resolved: false,
      timestamp: Date.now(),
    };

    // Determine action based on retry count and strategy
    let action: RecoveryAction;
    let shouldRetry = false;
    let retryAfter: number | undefined;

    if (retryCount < strategy.maxRetries) {
      action = strategy.fallbackAction || "retry";
      shouldRetry = action === "retry";
      
      if (shouldRetry) {
        // Calculate exponential backoff
        retryAfter = strategy.backoffMs * Math.pow(2, retryCount);
        this.activeRetries.set(errorKey, {
          count: retryCount + 1,
          lastAttempt: Date.now(),
        });
      }
    } else {
      // Max retries reached, use fallback
      action = strategy.fallbackAction || "skip";
      shouldRetry = false;
    }

    record.actionTaken = action;
    this.errorRecords.set(record.id, record);

    // Fire alerts based on thresholds
    if (severity === "critical") {
      this.fireAlert("error_critical", record, `Critical error: ${context.errorMessage}`);
    }
    if (consecutive >= this.alertThresholds.consecutiveFailures) {
      this.fireAlert("error_threshold", record,
        `${consecutive} consecutive failures for ${opKey}: ${context.errorMessage}`);
    }
    if (action === "skip" || action === "block") {
      this.fireAlert("recovery_failed", record,
        `Recovery failed for ${opKey}, action: ${action}. ${context.errorMessage}`);
    }
    if (retryCount >= strategy.maxRetries && !shouldRetry) {
      this.fireAlert("retry_exhausted", record,
        `Retries exhausted for ${opKey} after ${retryCount} attempts. Last error: ${context.errorMessage}`);
    }

    return { action, shouldRetry, retryAfter, record };
  }

  /**
   * Mark an error as resolved.
   * Also clears the consecutive failure counter for that operation.
   */
  markResolved(recordId: string): void {
    const record = this.errorRecords.get(recordId);
    if (record) {
      record.resolved = true;
      
      // Clear retry state if resolved
      const errorKey = this.getErrorKey(record.context);
      this.activeRetries.delete(errorKey);
      
      // Clear consecutive failure counter for this operation
      const opKey = this.getOperationKey(record.context);
      this.consecutiveFailures.delete(opKey);
    }
  }

  /**
   * Clear consecutive failure counters for a specific operation or all operations.
   * Call this after a successful retry to reset the threshold counter.
   */
  clearConsecutiveFailures(toolName?: string, featureId?: string): void {
    if (!toolName && !featureId) {
      this.consecutiveFailures.clear();
      return;
    }
    const filterKey = `${toolName ?? "unknown"}:${featureId ?? "global"}`;
    for (const key of this.consecutiveFailures.keys()) {
      if (key === filterKey || (toolName && key.startsWith(`${toolName}:`)) || (featureId && key.endsWith(`:${featureId}`))) {
        this.consecutiveFailures.delete(key);
      }
    }
  }

  /**
   * Get all error records for a feature
   */
  getErrorsForFeature(featureId: string): ErrorRecord[] {
    return Array.from(this.errorRecords.values()).filter(r => r.context.featureId === featureId);
  }

  /**
   * Get all error records for a mission
   */
  getErrorsForMission(missionId: string): ErrorRecord[] {
    return Array.from(this.errorRecords.values()).filter(r => r.context.missionId === missionId);
  }

  /**
   * Clear error records (e.g., when starting a new feature)
   */
  clearErrors(): void {
    this.errorRecords.clear();
    this.activeRetries.clear();
  }

  /**
   * Clear errors for a specific feature
   */
  clearErrorsForFeature(featureId: string): void {
    const matchingRecords = Array.from(this.errorRecords.entries())
      .filter(([, record]) => record.context.featureId === featureId);
    
    for (const [id, record] of matchingRecords) {
      this.activeRetries.delete(this.getErrorKey(record.context));
      this.errorRecords.delete(id);
    }
  }

  /**
   * Get error statistics
   */
  getStats(): { total: number; resolved: number; byCategory: Record<ErrorCategory, number>; bySeverity: Record<ErrorSeverity, number> } {
    const records = Array.from(this.errorRecords.values());
    const byCategory: Record<ErrorCategory, number> = {
      transient: 0,
      permanent: 0,
      user: 0,
      system: 0,
      network: 0,
      permission: 0,
      unknown: 0,
    };
    const bySeverity: Record<ErrorSeverity, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };

    for (const record of records) {
      byCategory[record.category] = (byCategory[record.category] || 0) + 1;
      bySeverity[record.severity] = (bySeverity[record.severity] || 0) + 1;
    }

    return {
      total: records.length,
      resolved: records.filter(r => r.resolved).length,
      byCategory,
      bySeverity,
    };
  }

  /**
   * Generate a unique key for an error context
   */
  private getErrorKey(context: ErrorContext): string {
    return `${context.toolName || 'unknown'}:${context.errorType}:${context.featureId || 'none'}`;
  }

  /**
   * Set a custom recovery strategy for a category
   */
  setStrategy(category: ErrorCategory, strategy: ErrorRecoveryStrategy): void {
    this.strategies.set(category, strategy);
  }
}

// Global error recovery engine instance
let globalEngine: ErrorRecoveryEngine | null = null;

export function getErrorRecoveryEngine(): ErrorRecoveryEngine {
  if (!globalEngine) {
    globalEngine = new ErrorRecoveryEngine();
  }
  return globalEngine;
}

export function resetErrorRecoveryEngine(): void {
  globalEngine = null;
}
