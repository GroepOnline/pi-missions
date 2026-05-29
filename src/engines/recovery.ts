import * as crypto from "node:crypto";
import type {
  ErrorCategory, ErrorSeverity, ErrorContext,
  ErrorRecoveryStrategy, ErrorRecord, RecoveryAction, RetryOptions, DegradedResult,
} from "../core/types.js";

// ═══════════════════════════════════════════════════════════════════════════
// Retry Utility — exponential backoff with jitter
// ═══════════════════════════════════════════════════════════════════════════

function backoffDelay(attempt: number, baseMs: number, maxMs: number, jitter: number): number {
  const delay = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  const j = jitter > 0 ? delay * jitter * (Math.random() * 2 - 1) : 0;
  return Math.round(Math.max(0, delay + j));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 1000, maxDelayMs = 30000, jitterFactor = 0.2, shouldRetry, operationName } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries) break;
      if (shouldRetry && !shouldRetry(error)) break;
      const delay = backoffDelay(attempt, baseDelayMs, maxDelayMs, jitterFactor);
      const label = operationName ? `[${operationName}]` : "";
      if (typeof process !== "undefined" && process.stderr) {
        process.stderr.write(`${label} Attempt ${attempt + 1}/${maxRetries} failed, retrying in ${delay}ms...\n`);
      }
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

export function withRetrySync<T>(fn: () => T, opts: RetryOptions = {}): T {
  const { maxRetries = 3, baseDelayMs = 1000, maxDelayMs = 30000, jitterFactor = 0.2, shouldRetry } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try { return fn(); } catch (error) {
      lastError = error;
      if (attempt >= maxRetries) break;
      if (shouldRetry && !shouldRetry(error)) break;
      const delayMs = backoffDelay(attempt, baseDelayMs, maxDelayMs, jitterFactor);
      // Use Atomics.wait for CPU-friendly blocking sleep
      const sab = new SharedArrayBuffer(4);
      const int32 = new Int32Array(sab);
      Atomics.wait(int32, 0, 0, delayMs);
    }
  }
  throw lastError;
}

export function defaultShouldRetry(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error
    ? error.message.toLowerCase()
    : typeof (error as Record<string, unknown>)?.message === "string"
      ? String((error as Record<string, unknown>).message).toLowerCase()
      : String(error).toLowerCase();
  // Non-retryable
  if (message.includes("syntax") || message.includes("parse error") || message.includes("invalid input")) return false;
  if (message.includes("permission denied") || message.includes("eacces") || message.includes("eperm")) return false;
  if (message.includes("validation") && message.includes("failed")) return false;
  // Retryable
  if (message.includes("timeout") || message.includes("timed out")) return true;
  if (message.includes("econnrefused") || message.includes("econnreset") || message.includes("enotfound")) return true;
  if (message.includes("eagain") || message.includes("ebusy") || message.includes("elock")) return true;
  if (message.includes("temporary") || message.includes("transient") || message.includes("retry")) return true;
  if (message.includes("lock") && message.includes("busy")) return true;
  if (message.includes("resource temporarily")) return true;
  if (message.includes("enomem") || message.includes("cannot allocate")) return true;
  if (message.includes("stale") && message.includes("lock")) return true;
  return false;
}

export const RetryPresets = {
  fileIO: { maxRetries: 3, baseDelayMs: 500, maxDelayMs: 10000, jitterFactor: 0.1, shouldRetry: defaultShouldRetry },
  network: { maxRetries: 5, baseDelayMs: 2000, maxDelayMs: 60000, jitterFactor: 0.2, shouldRetry: defaultShouldRetry },
  lock: { maxRetries: 10, baseDelayMs: 100, maxDelayMs: 5000, jitterFactor: 0.05, shouldRetry: defaultShouldRetry },
  critical: { maxRetries: 1, baseDelayMs: 100, maxDelayMs: 2000, jitterFactor: 0, shouldRetry: defaultShouldRetry },
  persistence: { maxRetries: 5, baseDelayMs: 200, maxDelayMs: 5000, jitterFactor: 0.1, shouldRetry: defaultShouldRetry },
} as const satisfies Record<string, RetryOptions>;

// ═══════════════════════════════════════════════════════════════════════════
// Graceful degradation
// ═══════════════════════════════════════════════════════════════════════════

export async function withDegradation<T>(
  primary: () => Promise<T>,
  fallback: (error: unknown) => Promise<T>,
): Promise<DegradedResult<T>> {
  try {
    return { ok: true, value: await primary(), degraded: false };
  } catch (e) {
    try {
      return { ok: true, value: await fallback(e), degraded: true, error: e };
    } catch (fb) {
      return { ok: false, value: undefined, degraded: true, error: fb };
    }
  }
}

export function withDegradationSync<T>(
  primary: () => T,
  fallback: (error: unknown) => T,
): DegradedResult<T> {
  try {
    return { ok: true, value: primary(), degraded: false };
  } catch (e) {
    try {
      return { ok: true, value: fallback(e), degraded: true, error: e };
    } catch (fb) {
      return { ok: false, value: undefined, degraded: true, error: fb };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Error Recovery Engine
// ═══════════════════════════════════════════════════════════════════════════

export type ErrorAlertType = "error_critical" | "error_threshold" | "recovery_failed" | "retry_exhausted";

export type ErrorAlertCallback = (alert: {
  type: ErrorAlertType;
  record: ErrorRecord;
  stats?: { total: number; critical: number; recent: number };
  message: string;
}) => void;

export class ErrorRecoveryEngine {
  private errorRecords = new Map<string, ErrorRecord>();
  private activeRetries = new Map<string, { count: number; lastAttempt: number }>();
  private alertCallbacks = new Set<ErrorAlertCallback>();
  private consecutiveFailures = new Map<string, number>();
  private alertThresholds = {
    criticalErrors: 1,
    consecutiveFailures: 3,
    totalErrorsBeforeAlert: 5,
    windowMs: 60_000,
  };

  private strategies = new Map<ErrorCategory, ErrorRecoveryStrategy>([
    ["transient", { category: "transient", maxRetries: 3, backoffMs: 1000, fallbackAction: "retry" }],
    ["network", { category: "network", maxRetries: 5, backoffMs: 2000, fallbackAction: "retry" }],
    ["permission", { category: "permission", maxRetries: 0, backoffMs: 0, fallbackAction: "ask_user" }],
    ["permanent", { category: "permanent", maxRetries: 0, backoffMs: 0, fallbackAction: "block" }],
    ["user", { category: "user", maxRetries: 0, backoffMs: 0, fallbackAction: "ask_user" }],
    ["system", { category: "system", maxRetries: 2, backoffMs: 5000, fallbackAction: "degrade" }],
    ["unknown", { category: "unknown", maxRetries: 1, backoffMs: 1000, fallbackAction: "skip" }],
  ]);

  onAlert(cb: ErrorAlertCallback): () => void {
    this.alertCallbacks.add(cb);
    return () => this.alertCallbacks.delete(cb);
  }

  setAlertThresholds(t: Partial<typeof this.alertThresholds>): void {
    Object.assign(this.alertThresholds, t);
  }

  private fireAlert(type: ErrorAlertType, record: ErrorRecord, message: string): void {
    const recent = Array.from(this.errorRecords.values()).filter(
      r => Date.now() - r.timestamp < this.alertThresholds.windowMs,
    );
    const stats = {
      total: this.errorRecords.size,
      critical: recent.filter(r => r.severity === "critical").length,
      recent: recent.length,
    };
    for (const cb of this.alertCallbacks) {
      try { cb({ type, record, stats, message }); } catch { /* silent */ }
    }
  }

  private opKey(ctx: ErrorContext): string {
    return `${ctx.toolName ?? "unknown"}:${ctx.featureId ?? "global"}`;
  }

  categorizeError(ctx: ErrorContext): ErrorCategory {
    const msg = ctx.errorMessage.toLowerCase();
    if (msg.includes("network") || msg.includes("connection") || msg.includes("timeout") ||
        msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("etimedout")) return "network";
    if (msg.includes("permission") || msg.includes("access denied") || msg.includes("eacces") ||
        msg.includes("eperm") || ctx.errorType.toLowerCase().includes("permission")) return "permission";
    if (msg.includes("invalid input") || msg.includes("validation") || msg.includes("user") ||
        ctx.errorType.toLowerCase().includes("validation") || ctx.errorType.toLowerCase().includes("user")) return "user";
    if (msg.includes("temporary") || msg.includes("retry") || msg.includes("busy") ||
        msg.includes("locked") || msg.includes("eagain") || msg.includes("ebusy")) return "transient";
    if (msg.includes("memory") || msg.includes("disk") || msg.includes("space") ||
        ctx.errorType.toLowerCase().includes("system")) return "system";
    if (msg.includes("syntax") || msg.includes("parse") || ctx.errorType.toLowerCase().includes("syntax") ||
        ctx.errorType.toLowerCase().includes("parse")) return "permanent";
    return "unknown";
  }

  determineSeverity(category: ErrorCategory): ErrorSeverity {
    if (category === "permanent" || category === "permission") return "critical";
    if (category === "system") return "high";
    if (category === "network" || category === "unknown") return "medium";
    return "low";
  }

  handleError(ctx: ErrorContext): { action: RecoveryAction; shouldRetry: boolean; retryAfter?: number; record: ErrorRecord } {
    const category = this.categorizeError(ctx);
    const severity = this.determineSeverity(category);
    const strategy = this.strategies.get(category) ?? this.strategies.get("unknown")!;
    const errorKey = `${ctx.toolName ?? "unknown"}:${ctx.errorType}:${ctx.featureId ?? "none"}`;
    const retryState = this.activeRetries.get(errorKey);
    const retryCount = retryState?.count ?? 0;
    const key = this.opKey(ctx);
    const consecutive = (this.consecutiveFailures.get(key) ?? 0) + 1;
    this.consecutiveFailures.set(key, consecutive);

    const record: ErrorRecord = {
      id: crypto.randomUUID(), context: ctx, category, severity,
      retryCount, actionTaken: "skip", resolved: false, timestamp: Date.now(),
    };

    let action: RecoveryAction;
    let shouldRetry = false;
    let retryAfter: number | undefined;
    if (retryCount < strategy.maxRetries) {
      action = strategy.fallbackAction ?? "retry";
      shouldRetry = action === "retry";
      if (shouldRetry) {
        retryAfter = strategy.backoffMs * Math.pow(2, retryCount);
        this.activeRetries.set(errorKey, { count: retryCount + 1, lastAttempt: Date.now() });
      }
    } else {
      action = strategy.fallbackAction ?? "skip";
    }

    record.actionTaken = action;
    this.errorRecords.set(record.id, record);

    if (severity === "critical") this.fireAlert("error_critical", record, `Critical: ${ctx.errorMessage}`);
    if (consecutive >= this.alertThresholds.consecutiveFailures) this.fireAlert("error_threshold", record, `${consecutive} consecutive failures for ${key}`);
    if (action === "skip" || action === "block") this.fireAlert("recovery_failed", record, `Recovery failed: ${action}`);
    if (retryCount >= strategy.maxRetries && !shouldRetry) this.fireAlert("retry_exhausted", record, `Retries exhausted after ${retryCount} for ${key}`);

    return { action, shouldRetry, retryAfter, record };
  }

  markResolved(recordId: string): void {
    const record = this.errorRecords.get(recordId);
    if (record) {
      record.resolved = true;
      this.activeRetries.delete(`${record.context.toolName ?? "unknown"}:${record.context.errorType}:${record.context.featureId ?? "none"}`);
      this.consecutiveFailures.delete(this.opKey(record.context));
    }
  }

  clearConsecutiveFailures(toolName?: string, featureId?: string): void {
    if (!toolName && !featureId) { this.consecutiveFailures.clear(); return; }
    const filter = `${toolName ?? "unknown"}:${featureId ?? "global"}`;
    for (const key of this.consecutiveFailures.keys()) {
      if (key === filter || (toolName && key.startsWith(`${toolName}:`)) || (featureId && key.endsWith(`:${featureId}`))) {
        this.consecutiveFailures.delete(key);
      }
    }
  }

  getErrorsForFeature(featureId: string): ErrorRecord[] {
    return Array.from(this.errorRecords.values()).filter(r => r.context.featureId === featureId);
  }

  getErrorsForMission(missionId: string): ErrorRecord[] {
    return Array.from(this.errorRecords.values()).filter(r => r.context.missionId === missionId);
  }

  clearErrors(): void {
    this.errorRecords.clear();
    this.activeRetries.clear();
  }

  clearErrorsForFeature(featureId: string): void {
    for (const [id, record] of this.errorRecords) {
      if (record.context.featureId === featureId) {
        this.activeRetries.delete(`${record.context.toolName ?? "unknown"}:${record.context.errorType}:${record.context.featureId ?? "none"}`);
        this.errorRecords.delete(id);
      }
    }
  }

  getStats(): { total: number; resolved: number; byCategory: Record<ErrorCategory, number>; bySeverity: Record<ErrorSeverity, number> } {
    const records = Array.from(this.errorRecords.values());
    const byCategory: Record<ErrorCategory, number> = { transient: 0, permanent: 0, user: 0, system: 0, network: 0, permission: 0, unknown: 0 };
    const bySeverity: Record<ErrorSeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const r of records) { byCategory[r.category]++; bySeverity[r.severity]++; }
    return { total: records.length, resolved: records.filter(r => r.resolved).length, byCategory, bySeverity };
  }

  setStrategy(category: ErrorCategory, strategy: ErrorRecoveryStrategy): void {
    this.strategies.set(category, strategy);
  }
}

let globalEngine: ErrorRecoveryEngine | null = null;

export function getErrorRecoveryEngine(): ErrorRecoveryEngine {
  if (!globalEngine) globalEngine = new ErrorRecoveryEngine();
  return globalEngine;
}

export function resetErrorRecoveryEngine(): void {
  globalEngine = null;
}
