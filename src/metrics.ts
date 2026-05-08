import type { SessionMetrics } from "./types.js";

/**
 * Session metrics collector for terminal/pi session tracking
 */
export class SessionMetricsCollector {
  private metrics: SessionMetrics;
  private static instance: SessionMetricsCollector | null = null;

  private constructor() {
    this.metrics = {
      sessionId: this.generateSessionId(),
      startTime: Date.now(),
      toolCalls: {
        total: 0,
        byTool: {},
        successful: 0,
        failed: 0,
      },
      tokensUsed: 0,
      featuresCompleted: 0,
      errors: {
        total: 0,
        byCategory: {},
      },
      autoAdvanceCount: 0,
      stuckDetectionCount: 0,
    };
  }

  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  static getInstance(): SessionMetricsCollector {
    if (!SessionMetricsCollector.instance) {
      SessionMetricsCollector.instance = new SessionMetricsCollector();
    }
    return SessionMetricsCollector.instance;
  }

  static reset(): void {
    SessionMetricsCollector.instance = null;
  }

  recordToolCall(toolName: string, success: boolean): void {
    this.metrics.toolCalls.total++;
    this.metrics.toolCalls.byTool[toolName] = (this.metrics.toolCalls.byTool[toolName] || 0) + 1;
    if (success) {
      this.metrics.toolCalls.successful++;
    } else {
      this.metrics.toolCalls.failed++;
    }
  }

  recordTokenUsage(tokens: number): void {
    this.metrics.tokensUsed += tokens;
  }

  recordFeatureCompleted(): void {
    this.metrics.featuresCompleted++;
  }

  recordError(category: string): void {
    this.metrics.errors.total++;
    this.metrics.errors.byCategory[category] = (this.metrics.errors.byCategory[category] || 0) + 1;
  }

  recordAutoAdvance(): void {
    this.metrics.autoAdvanceCount++;
  }

  recordStuckDetection(): void {
    this.metrics.stuckDetectionCount++;
  }

  endSession(): void {
    this.metrics.endTime = Date.now();
  }

  getMetrics(): SessionMetrics {
    return { ...this.metrics };
  }

  getMetricsSummary(): string {
    const duration = this.metrics.endTime ? (this.metrics.endTime - this.metrics.startTime) / 1000 : (Date.now() - this.metrics.startTime) / 1000;
    const successRate = this.metrics.toolCalls.total > 0 
      ? ((this.metrics.toolCalls.successful / this.metrics.toolCalls.total) * 100).toFixed(1) 
      : "0";

    return [
      `Session: ${this.metrics.sessionId}`,
      `Duration: ${duration.toFixed(1)}s`,
      `Tool Calls: ${this.metrics.toolCalls.total} (${successRate}% success)`,
      `Tokens Used: ${this.metrics.tokensUsed}`,
      `Features Completed: ${this.metrics.featuresCompleted}`,
      `Auto-Advances: ${this.metrics.autoAdvanceCount}`,
      `Stuck Detections: ${this.metrics.stuckDetectionCount}`,
      `Errors: ${this.metrics.errors.total}`,
    ].join(" | ");
  }

  exportMetrics(): string {
    return JSON.stringify(this.metrics, null, 2);
  }
}

// Global instance
export const sessionMetrics = SessionMetricsCollector.getInstance();
