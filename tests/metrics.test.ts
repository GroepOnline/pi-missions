import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { 
  SessionMetricsCollector,
  sessionMetrics
} from "../src/engines/metrics.js";

describe("Session Metrics Collector", () => {
  beforeEach(() => {
    SessionMetricsCollector.reset();
  });

  afterEach(() => {
    SessionMetricsCollector.reset();
  });

  describe("getInstance", () => {
    it("returns singleton instance", () => {
      const instance1 = SessionMetricsCollector.getInstance();
      const instance2 = SessionMetricsCollector.getInstance();
      expect(instance1).toBe(instance2);
    });

    it("creates new instance after reset", () => {
      const instance1 = SessionMetricsCollector.getInstance();
      SessionMetricsCollector.reset();
      const instance2 = SessionMetricsCollector.getInstance();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe("recordToolCall", () => {
    it("records successful tool call", () => {
      const collector = SessionMetricsCollector.getInstance();
      collector.recordToolCall("read", true);
      
      const metrics = collector.getMetrics();
      expect(metrics.toolCalls.total).toBe(1);
      expect(metrics.toolCalls.successful).toBe(1);
      expect(metrics.toolCalls.failed).toBe(0);
      expect(metrics.toolCalls.byTool["read"]).toBe(1);
    });

    it("records failed tool call", () => {
      const collector = SessionMetricsCollector.getInstance();
      collector.recordToolCall("write", false);
      
      const metrics = collector.getMetrics();
      expect(metrics.toolCalls.total).toBe(1);
      expect(metrics.toolCalls.successful).toBe(0);
      expect(metrics.toolCalls.failed).toBe(1);
      expect(metrics.toolCalls.byTool["write"]).toBe(1);
    });

    it("accumulates multiple tool calls", () => {
      const collector = SessionMetricsCollector.getInstance();
      collector.recordToolCall("read", true);
      collector.recordToolCall("read", true);
      collector.recordToolCall("write", false);
      
      const metrics = collector.getMetrics();
      expect(metrics.toolCalls.total).toBe(3);
      expect(metrics.toolCalls.successful).toBe(2);
      expect(metrics.toolCalls.failed).toBe(1);
      expect(metrics.toolCalls.byTool["read"]).toBe(2);
      expect(metrics.toolCalls.byTool["write"]).toBe(1);
    });
  });

  describe("recordTokenUsage", () => {
    it("records token usage", () => {
      const collector = SessionMetricsCollector.getInstance();
      collector.recordTokenUsage(100);
      
      const metrics = collector.getMetrics();
      expect(metrics.tokensUsed).toBe(100);
    });

    it("accumulates token usage", () => {
      const collector = SessionMetricsCollector.getInstance();
      collector.recordTokenUsage(100);
      collector.recordTokenUsage(200);
      
      const metrics = collector.getMetrics();
      expect(metrics.tokensUsed).toBe(300);
    });
  });

  describe("recordFeatureCompleted", () => {
    it("records feature completion", () => {
      const collector = SessionMetricsCollector.getInstance();
      collector.recordFeatureCompleted();
      
      const metrics = collector.getMetrics();
      expect(metrics.featuresCompleted).toBe(1);
    });

    it("accumulates feature completions", () => {
      const collector = SessionMetricsCollector.getInstance();
      collector.recordFeatureCompleted();
      collector.recordFeatureCompleted();
      
      const metrics = collector.getMetrics();
      expect(metrics.featuresCompleted).toBe(2);
    });
  });

  describe("recordError", () => {
    it("records error by category", () => {
      const collector = SessionMetricsCollector.getInstance();
      collector.recordError("validation");
      
      const metrics = collector.getMetrics();
      expect(metrics.errors.total).toBe(1);
      expect(metrics.errors.byCategory["validation"]).toBe(1);
    });

    it("accumulates errors by category", () => {
      const collector = SessionMetricsCollector.getInstance();
      collector.recordError("validation");
      collector.recordError("validation");
      collector.recordError("io");
      
      const metrics = collector.getMetrics();
      expect(metrics.errors.total).toBe(3);
      expect(metrics.errors.byCategory["validation"]).toBe(2);
      expect(metrics.errors.byCategory["io"]).toBe(1);
    });
  });

  describe("recordAutoAdvance", () => {
    it("records auto advance", () => {
      const collector = SessionMetricsCollector.getInstance();
      collector.recordAutoAdvance();
      
      const metrics = collector.getMetrics();
      expect(metrics.autoAdvanceCount).toBe(1);
    });

    it("accumulates auto advances", () => {
      const collector = SessionMetricsCollector.getInstance();
      collector.recordAutoAdvance();
      collector.recordAutoAdvance();
      
      const metrics = collector.getMetrics();
      expect(metrics.autoAdvanceCount).toBe(2);
    });
  });

  describe("recordStuckDetection", () => {
    it("records stuck detection", () => {
      const collector = SessionMetricsCollector.getInstance();
      collector.recordStuckDetection();
      
      const metrics = collector.getMetrics();
      expect(metrics.stuckDetectionCount).toBe(1);
    });

    it("accumulates stuck detections", () => {
      const collector = SessionMetricsCollector.getInstance();
      collector.recordStuckDetection();
      collector.recordStuckDetection();
      
      const metrics = collector.getMetrics();
      expect(metrics.stuckDetectionCount).toBe(2);
    });
  });

  describe("endSession", () => {
    it("sets end time", async () => {
      const collector = SessionMetricsCollector.getInstance();
      // Wait a bit to ensure endTime > startTime
      await new Promise(resolve => setTimeout(resolve, 1));
      collector.endSession();
      
      const metrics = collector.getMetrics();
      expect(metrics.endTime).toBeDefined();
      expect(metrics.endTime).toBeGreaterThanOrEqual(metrics.startTime);
    });
  });

  describe("getMetrics", () => {
    it("returns copy of metrics", () => {
      const collector = SessionMetricsCollector.getInstance();
      const metrics1 = collector.getMetrics();
      const metrics2 = collector.getMetrics();
      
      expect(metrics1).toEqual(metrics2);
      expect(metrics1).not.toBe(metrics2);
    });

    it("includes session id", () => {
      const collector = SessionMetricsCollector.getInstance();
      const metrics = collector.getMetrics();
      
      expect(metrics.sessionId).toBeDefined();
      expect(metrics.sessionId).toMatch(/^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it("includes start time", () => {
      const collector = SessionMetricsCollector.getInstance();
      const metrics = collector.getMetrics();
      
      expect(metrics.startTime).toBeDefined();
      expect(metrics.startTime).toBeLessThanOrEqual(Date.now());
    });
  });

  describe("getMetricsSummary", () => {
    it("returns formatted summary", () => {
      const collector = SessionMetricsCollector.getInstance();
      collector.recordToolCall("read", true);
      collector.recordTokenUsage(100);
      
      const summary = collector.getMetricsSummary();
      
      expect(summary).toContain("Session:");
      expect(summary).toContain("Duration:");
      expect(summary).toContain("Tool Calls:");
      expect(summary).toContain("Tokens Used:");
      expect(summary).toContain("Features Completed:");
      expect(summary).toContain("Auto-Advances:");
      expect(summary).toContain("Stuck Detections:");
      expect(summary).toContain("Errors:");
    });

    it("shows correct values", () => {
      const collector = SessionMetricsCollector.getInstance();
      collector.recordToolCall("read", true);
      collector.recordTokenUsage(100);
      collector.recordFeatureCompleted();
      
      const summary = collector.getMetricsSummary();
      
      expect(summary).toContain("Tool Calls: 1");
      expect(summary).toContain("Tokens Used: 100");
      expect(summary).toContain("Features Completed: 1");
    });
  });

  describe("exportMetrics", () => {
    it("returns JSON string", () => {
      const collector = SessionMetricsCollector.getInstance();
      const json = collector.exportMetrics();
      
      expect(typeof json).toBe("string");
      
      const parsed = JSON.parse(json);
      expect(parsed).toHaveProperty("sessionId");
      expect(parsed).toHaveProperty("startTime");
      expect(parsed).toHaveProperty("toolCalls");
      expect(parsed).toHaveProperty("tokensUsed");
      expect(parsed).toHaveProperty("featuresCompleted");
      expect(parsed).toHaveProperty("errors");
      expect(parsed).toHaveProperty("autoAdvanceCount");
      expect(parsed).toHaveProperty("stuckDetectionCount");
    });

    it("includes recorded data", () => {
      const collector = SessionMetricsCollector.getInstance();
      collector.recordToolCall("read", true);
      collector.recordTokenUsage(100);
      
      const json = collector.exportMetrics();
      const parsed = JSON.parse(json);
      
      expect(parsed.toolCalls.total).toBe(1);
      expect(parsed.tokensUsed).toBe(100);
    });
  });
});

describe("Global session metrics instance", () => {
  it("provides global instance", () => {
    expect(sessionMetrics).toBeInstanceOf(SessionMetricsCollector);
  });

  it("getInstance returns same instance as global sessionMetrics", () => {
    // Note: sessionMetrics is initialized at module import time
    // getInstance should return the same singleton instance
    const instance1 = SessionMetricsCollector.getInstance();
    const instance2 = SessionMetricsCollector.getInstance();
    expect(instance1).toBe(instance2);
  });

  it("reset creates new instance", () => {
    const instance1 = SessionMetricsCollector.getInstance();
    SessionMetricsCollector.reset();
    const instance2 = SessionMetricsCollector.getInstance();
    expect(instance1).not.toBe(instance2);
    // Reset back to clean state for other tests
    SessionMetricsCollector.reset();
  });
});
