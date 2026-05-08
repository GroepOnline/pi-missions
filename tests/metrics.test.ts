import { describe, it, expect } from "vitest";
import { 
  MetricsCollector, 
  MissionMetrics, 
  metricsCollector, 
  recordMetrics, 
  getMetricsSummary, 
  getSuccessRate, 
  getAverageTokensPerMission 
} from "../src/metrics.js";

describe("Metrics Collector", () => {
  describe("recordMetrics", () => {
    it("records mission metrics", () => {
      const collector = new MetricsCollector();
      const metrics: MissionMetrics = {
        missionId: "mission-1",
        created: Date.now(),
        totalFeatures: 5,
        featuresDone: 3,
        featuresFailed: 1,
        totalTokensUsed: 1000,
        totalWallClockMs: 5000,
        acceptanceFailures: 2,
        evidenceHashErrors: 0,
      };
      
      collector.recordMetrics(metrics);
      
      expect(collector.getMetrics("mission-1")).toEqual(metrics);
    });

    it("overwrites existing metrics for same mission", () => {
      const collector = new MetricsCollector();
      const metrics1: MissionMetrics = {
        missionId: "mission-1",
        created: Date.now(),
        totalFeatures: 5,
        featuresDone: 3,
        featuresFailed: 1,
        totalTokensUsed: 1000,
        totalWallClockMs: 5000,
        acceptanceFailures: 2,
        evidenceHashErrors: 0,
      };
      
      const metrics2: MissionMetrics = {
        ...metrics1,
        featuresDone: 4,
      };
      
      collector.recordMetrics(metrics1);
      collector.recordMetrics(metrics2);
      
      expect(collector.getMetrics("mission-1")?.featuresDone).toBe(4);
    });
  });

  describe("getMetrics", () => {
    it("returns undefined for non-existent mission", () => {
      const collector = new MetricsCollector();
      expect(collector.getMetrics("non-existent")).toBeUndefined();
    });

    it("returns metrics for existing mission", () => {
      const collector = new MetricsCollector();
      const metrics: MissionMetrics = {
        missionId: "mission-1",
        created: Date.now(),
        totalFeatures: 5,
        featuresDone: 3,
        featuresFailed: 1,
        totalTokensUsed: 1000,
        totalWallClockMs: 5000,
        acceptanceFailures: 2,
        evidenceHashErrors: 0,
      };
      
      collector.recordMetrics(metrics);
      
      const retrieved = collector.getMetrics("mission-1");
      expect(retrieved).toEqual(metrics);
    });
  });

  describe("getAllMetrics", () => {
    it("returns empty array when no metrics recorded", () => {
      const collector = new MetricsCollector();
      expect(collector.getAllMetrics()).toEqual([]);
    });

    it("returns all recorded metrics", () => {
      const collector = new MetricsCollector();
      const metrics1: MissionMetrics = {
        missionId: "mission-1",
        created: Date.now(),
        totalFeatures: 5,
        featuresDone: 3,
        featuresFailed: 1,
        totalTokensUsed: 1000,
        totalWallClockMs: 5000,
        acceptanceFailures: 2,
        evidenceHashErrors: 0,
      };
      
      const metrics2: MissionMetrics = {
        missionId: "mission-2",
        created: Date.now(),
        totalFeatures: 3,
        featuresDone: 2,
        featuresFailed: 0,
        totalTokensUsed: 500,
        totalWallClockMs: 3000,
        acceptanceFailures: 0,
        evidenceHashErrors: 0,
      };
      
      collector.recordMetrics(metrics1);
      collector.recordMetrics(metrics2);
      
      const all = collector.getAllMetrics();
      expect(all).toHaveLength(2);
      expect(all.map(m => m.missionId)).toEqual(["mission-1", "mission-2"]);
    });
  });

  describe("getSummary", () => {
    it("returns zeros when no metrics", () => {
      const collector = new MetricsCollector();
      const summary = collector.getSummary();
      
      expect(summary.totalMissions).toBe(0);
      expect(summary.completedMissions).toBe(0);
      expect(summary.successRate).toBe(0);
    });

    it("calculates summary statistics correctly", () => {
      const collector = new MetricsCollector();
      const now = Date.now();
      
      const metrics1: MissionMetrics = {
        missionId: "mission-1",
        created: now,
        completed: now + 10000,
        totalFeatures: 5,
        featuresDone: 5,
        featuresFailed: 0,
        totalTokensUsed: 1000,
        totalWallClockMs: 5000,
        acceptanceFailures: 0,
        evidenceHashErrors: 0,
      };
      
      const metrics2: MissionMetrics = {
        missionId: "mission-2",
        created: now,
        completed: now + 20000,
        totalFeatures: 3,
        featuresDone: 3,
        featuresFailed: 0,
        totalTokensUsed: 500,
        totalWallClockMs: 3000,
        acceptanceFailures: 0,
        evidenceHashErrors: 0,
      };
      
      const metrics3: MissionMetrics = {
        missionId: "mission-3",
        created: now,
        totalFeatures: 4,
        featuresDone: 2,
        featuresFailed: 1,
        totalTokensUsed: 800,
        totalWallClockMs: 4000,
        acceptanceFailures: 1,
        evidenceHashErrors: 0,
      };
      
      collector.recordMetrics(metrics1);
      collector.recordMetrics(metrics2);
      collector.recordMetrics(metrics3);
      
      const summary = collector.getSummary();
      
      expect(summary.totalMissions).toBe(3);
      expect(summary.completedMissions).toBe(2);
      expect(summary.successRate).toBeCloseTo(2/3, 2);
      expect(summary.averageTokensPerMission).toBeCloseTo((1000 + 500 + 800) / 3, 2);
      expect(summary.averageFeaturesPerMission).toBeCloseTo((5 + 3 + 4) / 3, 2);
      expect(summary.averageCompletionTimeMs).toBeCloseTo((10000 + 20000) / 2, 2);
    });
  });

  describe("clear", () => {
    it("clears all recorded metrics", () => {
      const collector = new MetricsCollector();
      const metrics: MissionMetrics = {
        missionId: "mission-1",
        created: Date.now(),
        totalFeatures: 5,
        featuresDone: 3,
        featuresFailed: 1,
        totalTokensUsed: 1000,
        totalWallClockMs: 5000,
        acceptanceFailures: 2,
        evidenceHashErrors: 0,
      };
      
      collector.recordMetrics(metrics);
      collector.clear();
      
      expect(collector.getAllMetrics()).toEqual([]);
    });
  });

  describe("toJSON", () => {
    it("returns JSON string of all metrics", () => {
      const collector = new MetricsCollector();
      const metrics: MissionMetrics = {
        missionId: "mission-1",
        created: Date.now(),
        totalFeatures: 5,
        featuresDone: 3,
        featuresFailed: 1,
        totalTokensUsed: 1000,
        totalWallClockMs: 5000,
        acceptanceFailures: 2,
        evidenceHashErrors: 0,
      };
      
      collector.recordMetrics(metrics);
      
      const json = collector.toJSON();
      const parsed = JSON.parse(json);
      
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].missionId).toBe("mission-1");
    });
  });
});

describe("Global metrics collector", () => {
  it("provides global collector instance", () => {
    expect(metricsCollector).toBeInstanceOf(MetricsCollector);
  });

  it("recordMetrics uses global collector", () => {
    const metrics: MissionMetrics = {
      missionId: "test-mission",
      created: Date.now(),
      totalFeatures: 5,
      featuresDone: 3,
      featuresFailed: 1,
      totalTokensUsed: 1000,
      totalWallClockMs: 5000,
      acceptanceFailures: 2,
      evidenceHashErrors: 0,
    };
    
    recordMetrics(metrics);
    
    expect(metricsCollector.getMetrics("test-mission")).toEqual(metrics);
    
    // Clean up
    metricsCollector.clear();
  });

  it("getMetricsSummary uses global collector", () => {
    const summary = getMetricsSummary();
    expect(summary).toHaveProperty("totalMissions");
    expect(summary).toHaveProperty("successRate");
  });

  it("getSuccessRate returns success rate", () => {
    const rate = getSuccessRate();
    expect(typeof rate).toBe("number");
    expect(rate).toBeGreaterThanOrEqual(0);
    expect(rate).toBeLessThanOrEqual(1);
  });

  it("getAverageTokensPerMission returns average tokens", () => {
    const avg = getAverageTokensPerMission();
    expect(typeof avg).toBe("number");
    expect(avg).toBeGreaterThanOrEqual(0);
  });
});
