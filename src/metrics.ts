// Backward-compat shim: wraps v2 static SessionMetricsCollector as old-style instance-based API
// The v2 engines/metrics.ts uses static methods; old code called getInstance().method()

import {
  SessionMetricsCollector as EngineSMC,
} from "./engines/metrics.js";

export class SessionMetricsCollector {
  static getInstance(): SessionMetricsCollector {
    if (!this._instance) this._instance = new SessionMetricsCollector();
    return this._instance;
  }
  private static _instance: SessionMetricsCollector;

  static reset(): void {
    this._instance = undefined as unknown as SessionMetricsCollector;
    EngineSMC.reset();
  }

  recordToolCall(tool: string, success: boolean): void {
    EngineSMC.recordToolCall(tool, success);
  }
  recordError(category: string): void {
    EngineSMC.recordError(category);
  }
  recordFeatureCompleted(): void {
    EngineSMC.recordFeatureCompleted();
  }
  recordAutoAdvance(): void {
    EngineSMC.recordAutoAdvance();
  }
  recordStuckDetection(): void {
    EngineSMC.recordStuckDetection();
  }
  recordTokenUsage(tokens: number): void {
    EngineSMC.addTokens(tokens);
  }
  endSession(): void {
    EngineSMC.endSession();
  }
  getMetrics() {
    return EngineSMC.getMetrics();
  }
  getMetricsSummary(): string {
    return EngineSMC.getMetricsSummary();
  }
  exportMetrics(): string {
    return JSON.stringify(EngineSMC.getMetrics());
  }
}

export const sessionMetrics = SessionMetricsCollector.getInstance();
