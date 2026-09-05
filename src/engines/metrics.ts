import { randomUUID } from "node:crypto";
import type { SessionMetrics } from "../core/types.js";

// ═══════════════════════════════════════════════════════════════════════════
// Session Metrics Collector
// ═══════════════════════════════════════════════════════════════════════════

export class SessionMetricsCollector {
  private metrics: SessionMetrics;
  private static instance: SessionMetricsCollector | null = null;

  private constructor() {
    this.metrics = this.freshMetrics();
  }

  static reset(): void {
    SessionMetricsCollector.instance = null;
  }

  private static get(): SessionMetricsCollector {
    if (!SessionMetricsCollector.instance) {
      SessionMetricsCollector.instance = new SessionMetricsCollector();
    }
    return SessionMetricsCollector.instance;
  }

  private freshMetrics(): SessionMetrics {
    return {
      sessionId: `session-${randomUUID()}`,
      startTime: Date.now(),
      toolCalls: { total: 0, byTool: {}, successful: 0, failed: 0 },
      tokensUsed: 0,
      featuresCompleted: 0,
      errors: { total: 0, byCategory: {} },
      autoAdvanceCount: 0,
      stuckDetectionCount: 0,
    };
  }

  // ── Public API ────────────────────────────────────────────────────────

  static getInstance(): SessionMetricsCollector {
    if (!SessionMetricsCollector.instance) {
      SessionMetricsCollector.instance = new SessionMetricsCollector();
    }
    return SessionMetricsCollector.instance;
  }

  // Instance methods (delegate to static)
  recordToolCall(tool: string, success: boolean): void {
    SessionMetricsCollector.recordToolCall(tool, success);
  }
  recordTokenUsage(tokens: number): void {
    SessionMetricsCollector.addTokens(tokens);
  }
  recordFeatureCompleted(): void {
    SessionMetricsCollector.recordFeatureCompleted();
  }
  recordError(category: string): void {
    SessionMetricsCollector.recordError(category);
  }
  recordAutoAdvance(): void {
    SessionMetricsCollector.recordAutoAdvance();
  }
  recordStuckDetection(): void {
    SessionMetricsCollector.recordStuckDetection();
  }
  endSession(): void {
    SessionMetricsCollector.endSession();
  }
  reset(): void {
    SessionMetricsCollector.reset();
  }
  getMetrics() {
    return SessionMetricsCollector.getMetrics();
  }
  getMetricsSummary(): string {
    return SessionMetricsCollector.getMetricsSummary();
  }
  exportMetrics(): string {
    return JSON.stringify(SessionMetricsCollector.getMetrics());
  }

  static recordToolCall(tool: string, success: boolean): void {
    const s = SessionMetricsCollector.get();
    s.metrics.toolCalls.total++;
    s.metrics.toolCalls.byTool[tool] = (s.metrics.toolCalls.byTool[tool] ?? 0) + 1;
    if (success) s.metrics.toolCalls.successful++;
    else s.metrics.toolCalls.failed++;
  }

  static recordError(category: string): void {
    const s = SessionMetricsCollector.get();
    s.metrics.errors.total++;
    s.metrics.errors.byCategory[category] = (s.metrics.errors.byCategory[category] ?? 0) + 1;
  }

  static recordFeatureCompleted(): void {
    SessionMetricsCollector.get().metrics.featuresCompleted++;
  }

  static recordAutoAdvance(): void {
    SessionMetricsCollector.get().metrics.autoAdvanceCount++;
  }

  static recordStuckDetection(): void {
    SessionMetricsCollector.get().metrics.stuckDetectionCount++;
  }

  static addTokens(count: number): void {
    SessionMetricsCollector.get().metrics.tokensUsed += count;
  }

  static endSession(): void {
    const s = SessionMetricsCollector.get();
    s.metrics.endTime = Date.now();
  }

  static getMetrics(): SessionMetrics {
    return { ...SessionMetricsCollector.get().metrics };
  }

  static getMetricsSummary(): string {
    const m = SessionMetricsCollector.get().metrics;
    const duration = m.endTime ? (m.endTime - m.startTime) / 1000 : (Date.now() - m.startTime) / 1000;
    const successRate = m.toolCalls.total === 0 ? 100 : (m.toolCalls.successful / m.toolCalls.total) * 100;
    return [
      `Session: ${m.sessionId}`,
      `Duration: ${duration.toFixed(1)}s`,
      `Tool Calls: ${m.toolCalls.total} (${successRate.toFixed(1)}% success)`,
      `Features Completed: ${m.featuresCompleted}`,
      `Auto-Advances: ${m.autoAdvanceCount}`,
      `Stuck Detections: ${m.stuckDetectionCount}`,
      `Errors: ${m.errors.total}`,
      `Tokens Used: ${m.tokensUsed}`,
    ].join("\n");
  }
}

// Shorthand alias — singleton instance (backward compat)
export const sessionMetrics = SessionMetricsCollector.getInstance();
