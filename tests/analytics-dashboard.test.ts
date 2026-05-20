import { describe, it, expect, beforeEach } from 'vitest';
import { AnalyticsDashboard, createAnalyticsDashboard } from '../src/ui/analytics-dashboard.js';
import type { MissionState, Feature, Milestone } from '../src/core/types.js';

// Helper to create test features
function createFeature(id: string, status: string = 'pending', tokensUsed: number = 0): Feature {
  return {
    id,
    milestoneId: 'M01',
    title: `Feature ${id}`,
    description: `Description for ${id}`,
    priority: 2,
    dependsOn: [],
    acceptance: [],
    status: status as any,
    sessions: [],
    toolCallCount: 10,
    tokensUsed,
    completedAt: status === 'done' ? Date.now() : undefined,
    startedAt: status !== 'pending' ? Date.now() - 3600000 : undefined,
    notes: undefined,
  };
}

// Helper to create test mission
function createMission(features: Feature[]): MissionState {
  return {
    schemaVersion: 3,
    id: 'test-mission',
    title: 'Test Mission',
    goal: 'Test goal',
    status: 'active',
    milestones: [{
      id: 'M01',
      title: 'Milestone 1',
      description: 'Test milestone',
      status: 'active',
      features,
    }],
    activeMilestoneId: 'M01',
    activeFeatureId: features.find(f => f.status === 'active')?.id,
    tokensUsed: 50000,
    lastContextTokens: 50000,
    validationToken: 'test-validation-token',
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now(),
    autopilot: {
      enabled: false,
      mode: 'manual',
      iteration: 0,
      maxIterations: 25,
      consecutiveFailures: 0,
      maxConsecutiveFailures: 3,
      noProgressTurns: 0,
      maxNoProgressTurns: 3,
      maxContextPercent: 85,
      startedAt: new Date().toISOString(),
      continueAcrossFeatures: true,
      requireEvidenceForDone: true,
      lastStopReason: undefined,
      lastStopMessage: undefined,
    },
  };
}

describe('AnalyticsDashboard', () => {
  let dashboard: AnalyticsDashboard;
  
  beforeEach(() => {
    dashboard = new AnalyticsDashboard();
  });
  
  describe('generateMissionDashboard', () => {
    it('should generate dashboard for active mission', () => {
      const features = [
        createFeature('F001', 'done', 10000),
        createFeature('F002', 'active', 5000),
        createFeature('F003', 'pending', 0),
      ];
      const mission = createMission(features);
      
      const lines = dashboard.generateMissionDashboard(mission);
      
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.some(l => l.includes('Test Mission'))).toBe(true);
      expect(lines.some(l => l.includes('Progress'))).toBe(true);
    });
    
    it('should show milestone details', () => {
      const features = [
        createFeature('F001', 'done'),
        createFeature('F002', 'active'),
        createFeature('F003', 'blocked'),
      ];
      const mission = createMission(features);
      
      const lines = dashboard.generateMissionDashboard(mission);
      
      expect(lines.some(l => l.includes('Milestone Details'))).toBe(true);
      expect(lines.some(l => l.includes('done'))).toBe(true);
    });
    
    it('should show token usage', () => {
      const features = [
        createFeature('F001', 'done', 20000),
        createFeature('F002', 'active', 15000),
      ];
      const mission = createMission(features);
      
      const lines = dashboard.generateMissionDashboard(mission);
      
      expect(lines.some(l => l.includes('Token Usage'))).toBe(true);
      // Check that total tokens are displayed (format may vary)
      expect(lines.some(l => l.includes('Total:') || l.includes('tokens'))).toBe(true);
    });
    
    it('should show recommendations for blocked features', () => {
      const features = [
        createFeature('F001', 'blocked'),
        createFeature('F002', 'active'),
      ];
      const mission = createMission(features);
      
      const lines = dashboard.generateMissionDashboard(mission);
      
      expect(lines.some(l => l.includes('Recommendations'))).toBe(true);
      expect(lines.some(l => l.includes('blocked'))).toBe(true);
    });
  });
  
  describe('generateAnalyticsOverview', () => {
    it('should generate overview with metrics', () => {
      const analytics = {
        totalMissions: 10,
        activeMissions: 3,
        completedMissions: 6,
        failedMissions: 1,
        successRate: 0.6,
        avgDurationMs: 3600000,
        totalTokensUsed: 500000,
        avgTokensPerMission: 50000,
        avgFeaturesPerMission: 5,
        topBlockers: [
          { blocker: 'Dependency error', count: 5 },
          { blocker: 'Test failure', count: 3 },
        ],
        recentActivity: [
          {
            timestamp: Date.now(),
            missionId: 'm1',
            missionTitle: 'Mission 1',
            event: 'feature_done',
            details: 'Feature completed',
          },
        ],
      };
      
      const lines = dashboard.generateAnalyticsOverview(analytics);
      
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.some(l => l.includes('Analytics Overview'))).toBe(true);
      expect(lines.some(l => l.includes('Success Rate'))).toBe(true);
    });
    
    it('should show top blockers', () => {
      const analytics = {
        totalMissions: 5,
        activeMissions: 1,
        completedMissions: 4,
        failedMissions: 0,
        successRate: 0.8,
        avgDurationMs: 1800000,
        totalTokensUsed: 200000,
        avgTokensPerMission: 40000,
        avgFeaturesPerMission: 4,
        topBlockers: [
          { blocker: 'API timeout', count: 10 },
        ],
        recentActivity: [],
      };
      
      const lines = dashboard.generateAnalyticsOverview(analytics);
      
      expect(lines.some(l => l.includes('Top Blockers'))).toBe(true);
      expect(lines.some(l => l.includes('API timeout'))).toBe(true);
    });
  });
  
  describe('generateFeatureStats', () => {
    it('should generate feature statistics', () => {
      const stats = {
        total: 20,
        completed: 15,
        inProgress: 3,
        blocked: 1,
        failed: 1,
        avgDurationMs: 1800000,
        avgToolCalls: 15,
        avgTokens: 25000,
      };
      
      const lines = dashboard.generateFeatureStats(stats);
      
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.some(l => l.includes('Feature Statistics'))).toBe(true);
      expect(lines.some(l => l.includes('Completed: 15'))).toBe(true);
    });
  });
  
  describe('generateProgressBar', () => {
    it('should generate progress bar', () => {
      const bar = dashboard.generateProgressBar(5, 10, 20);
      
      expect(bar).toContain('█');
      expect(bar).toContain('░');
      expect(bar).toContain('50.0%');
    });
    
    it('should handle zero max', () => {
      const bar = dashboard.generateProgressBar(0, 0, 20);
      
      expect(bar).toContain('0.0%');
    });
    
    it('should handle full progress', () => {
      const bar = dashboard.generateProgressBar(10, 10, 20);
      
      expect(bar).toContain('100.0%');
    });
  });
  
  describe('generateTrendChart', () => {
    it('should generate trend chart', () => {
      const data = [
        { period: 'Day 1', value: 100, change: 0, changePercent: 0 },
        { period: 'Day 2', value: 150, change: 50, changePercent: 50 },
        { period: 'Day 3', value: 120, change: -30, changePercent: -20 },
      ];
      
      const lines = dashboard.generateTrendChart(data, 'Token Usage');
      
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.some(l => l.includes('Token Usage Trend'))).toBe(true);
    });
    
    it('should handle empty data', () => {
      const lines = dashboard.generateTrendChart([], 'Empty');
      
      expect(lines.some(l => l.includes('No data available'))).toBe(true);
    });
  });
  
  describe('config options', () => {
    it('should respect compact mode', () => {
      const compactDashboard = new AnalyticsDashboard({ compactMode: true });
      
      const features = [createFeature('F001', 'done')];
      const mission = createMission(features);
      
      const lines = compactDashboard.generateMissionDashboard(mission);
      
      // Compact mode should still work
      expect(lines.length).toBeGreaterThan(0);
    });
    
    it('should disable charts when configured', () => {
      const noChartsDashboard = new AnalyticsDashboard({ showCharts: false });
      
      const features = [createFeature('F001', 'done')];
      const mission = createMission(features);
      
      const lines = noChartsDashboard.generateMissionDashboard(mission);
      
      // Should not have progress charts
      expect(lines.some(l => l.includes('Progress Charts'))).toBe(false);
    });
  });
});

describe('createAnalyticsDashboard', () => {
  it('should create dashboard with default config', () => {
    const dashboard = createAnalyticsDashboard();
    
    expect(dashboard).toBeInstanceOf(AnalyticsDashboard);
  });
  
  it('should create dashboard with custom config', () => {
    const dashboard = createAnalyticsDashboard({
      showCharts: false,
      compactMode: true,
    });
    
    expect(dashboard).toBeInstanceOf(AnalyticsDashboard);
  });
});
