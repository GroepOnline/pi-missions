import * as crypto from "node:crypto";
import type { ErrorCategory, ErrorSeverity, ErrorContext, ErrorRecoveryStrategy, ErrorRecord, RecoveryAction } from "./types.js";

// ---------------------------------------------------------------------------
// Error Recovery Engine
// ---------------------------------------------------------------------------

/**
 * Error recovery engine that categorizes errors and applies recovery strategies
 */
export class ErrorRecoveryEngine {
  private errorRecords: Map<string, ErrorRecord> = new Map();
  private activeRetries: Map<string, { count: number; lastAttempt: number }> = new Map();
  
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
   * Handle an error and determine the recovery action
   */
  handleError(context: ErrorContext): { action: RecoveryAction; shouldRetry: boolean; retryAfter?: number; record: ErrorRecord } {
    const category = this.categorizeError(context);
    const severity = this.determineSeverity(category, context);
    const strategy = this.strategies.get(category) || this.strategies.get("unknown")!;

    // Check if we've already retried this error
    const errorKey = this.getErrorKey(context);
    const retryState = this.activeRetries.get(errorKey);
    const retryCount = retryState?.count || 0;

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

    return { action, shouldRetry, retryAfter, record };
  }

  /**
   * Mark an error as resolved
   */
  markResolved(recordId: string): void {
    const record = this.errorRecords.get(recordId);
    if (record) {
      record.resolved = true;
      
      // Clear retry state if resolved
      const errorKey = this.getErrorKey(record.context);
      this.activeRetries.delete(errorKey);
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
    const toDelete = Array.from(this.errorRecords.entries())
      .filter(([_, r]) => r.context.featureId === featureId)
      .map(([id, _]) => id);
    
    toDelete.forEach(id => this.errorRecords.delete(id));
  }

  /**
   * Get error statistics
   */
  getStats(): { total: number; resolved: number; byCategory: Record<ErrorCategory, number>; bySeverity: Record<ErrorSeverity, number> } {
    const records = Array.from(this.errorRecords.values());
    const byCategory: Record<ErrorCategory, number> = {} as any;
    const bySeverity: Record<ErrorSeverity, number> = {} as any;

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
