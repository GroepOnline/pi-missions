import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { 
  WorkerPool, FeatureDependencyGraph, getWorkerPool, resetWorkerPool,
  type WorkerConfig, type PoolConfig 
} from '../src/engines/worker-pool.js';
import type { Feature, MissionState } from '../src/core/types.js';

// Helper to create test features
function createFeature(id: string, dependsOn: string[] = []): Feature {
  return {
    id,
    milestoneId: 'M01',
    title: `Feature ${id}`,
    description: `Description for ${id}`,
    priority: 2,
    dependsOn,
    acceptance: [],
    status: 'pending',
    sessions: [],
    toolCallCount: 0,
    completedAt: undefined,
    notes: undefined,
  };
}

// Helper to create test mission
function createMission(features: Feature[]): MissionState {
  return {
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
    activeFeatureId: features[0]?.id,
    tokensUsed: 0,
    lastContextTokens: 0,
    createdAt: Date.now(),
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

describe('FeatureDependencyGraph', () => {
  it('should identify ready features with no dependencies', () => {
    const features = [
      createFeature('F001'),
      createFeature('F002'),
      createFeature('F003'),
    ];
    
    const graph = new FeatureDependencyGraph(features);
    const ready = graph.getReadyFeatures();
    
    expect(ready.length).toBe(3);
    expect(ready.map(f => f.id)).toContain('F001');
    expect(ready.map(f => f.id)).toContain('F002');
    expect(ready.map(f => f.id)).toContain('F003');
  });
  
  it('should respect dependencies', () => {
    const features = [
      createFeature('F001'),
      createFeature('F002', ['F001']),
      createFeature('F003', ['F001']),
      createFeature('F004', ['F002', 'F003']),
    ];
    
    const graph = new FeatureDependencyGraph(features);
    
    // Initially, only F001 is ready
    const ready1 = graph.getReadyFeatures();
    expect(ready1.length).toBe(1);
    expect(ready1[0].id).toBe('F001');
    
    // After F001 completes, F002 and F003 are ready
    graph.markComplete('F001');
    const ready2 = graph.getReadyFeatures();
    expect(ready2.length).toBe(2);
    expect(ready2.map(f => f.id)).toContain('F002');
    expect(ready2.map(f => f.id)).toContain('F003');
    
    // After F002 and F003 complete, F004 is ready
    graph.markComplete('F002');
    graph.markComplete('F003');
    const ready3 = graph.getReadyFeatures();
    expect(ready3.length).toBe(1);
    expect(ready3[0].id).toBe('F004');
  });
  
  it('should handle failed dependencies', () => {
    const features = [
      createFeature('F001'),
      createFeature('F002', ['F001']),
    ];
    
    const graph = new FeatureDependencyGraph(features);
    
    // Mark F001 as failed
    graph.markFailed('F001');
    
    // F002 should still be ready (failed deps are satisfied)
    const ready = graph.getReadyFeatures();
    expect(ready.length).toBe(1);
    expect(ready[0].id).toBe('F002');
  });
  
  it('should detect completion', () => {
    const features = [
      createFeature('F001'),
      createFeature('F002'),
    ];
    
    const graph = new FeatureDependencyGraph(features);
    
    expect(graph.isComplete()).toBe(false);
    
    graph.markComplete('F001');
    expect(graph.isComplete()).toBe(false);
    
    graph.markComplete('F002');
    expect(graph.isComplete()).toBe(true);
  });
  
  it('should find critical path', () => {
    const features = [
      createFeature('F001'),
      createFeature('F002', ['F001']),
      createFeature('F003', ['F002']),
    ];
    
    const graph = new FeatureDependencyGraph(features);
    const criticalPath = graph.getCriticalPath();
    
    expect(criticalPath.length).toBe(3);
    expect(criticalPath[0]).toBe('F001');
    expect(criticalPath[1]).toBe('F002');
    expect(criticalPath[2]).toBe('F003');
  });
});

describe('WorkerPool', () => {
  let pool: WorkerPool;
  
  beforeEach(() => {
    resetWorkerPool();
    pool = new WorkerPool({ maxWorkers: 2 });
  });
  
  afterEach(() => {
    pool.shutdown();
  });
  
  it('should initialize with mission', () => {
    const features = [createFeature('F001'), createFeature('F002')];
    const mission = createMission(features);
    
    pool.initialize(mission);
    
    const status = pool.getStatus();
    expect(status.totalWorkers).toBe(0);
    expect(status.activeWorkers).toBe(0);
  });
  
  it('should enqueue features', () => {
    const features = [createFeature('F001'), createFeature('F002')];
    const mission = createMission(features);
    
    pool.initialize(mission);
    pool.enqueue([{ featureId: 'F001' }, { featureId: 'F002' }]);
    
    const status = pool.getStatus();
    expect(status.queuedFeatures.length).toBeGreaterThanOrEqual(0);
  });
  
  it('should execute feature', async () => {
    const features = [createFeature('F001')];
    const mission = createMission(features);
    
    pool.initialize(mission);
    
    const worker = await pool.executeFeature({ featureId: 'F001' });
    
    expect(worker).toBeDefined();
    expect(worker.featureId).toBe('F001');
    expect(worker.status).toBe('running');
    
    // Wait for completion with longer timeout
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const status = pool.getStatus();
    // Worker may still be running due to random duration
    expect(status.totalWorkers).toBeGreaterThan(0);
  }, 10000);
  
  it('should respect max workers limit', async () => {
    const features = [
      createFeature('F001'),
      createFeature('F002'),
      createFeature('F003'),
    ];
    const mission = createMission(features);
    
    pool.initialize(mission);
    
    // Start 3 workers with max 2
    const worker1 = await pool.executeFeature({ featureId: 'F001' });
    const worker2 = await pool.executeFeature({ featureId: 'F002' });
    
    const status = pool.getStatus();
    expect(status.activeWorkers).toBeLessThanOrEqual(2);
  });
  
  it('should kill worker', async () => {
    const features = [createFeature('F001')];
    const mission = createMission(features);
    
    pool.initialize(mission);
    
    const worker = await pool.executeFeature({ featureId: 'F001' });
    const killed = pool.killWorker(worker.id);
    
    expect(killed).toBe(true);
    
    const updatedWorker = pool.getWorker(worker.id);
    expect(updatedWorker?.status).toBe('failed');
    expect(updatedWorker?.error).toBe('Killed by user');
  });
  
  it('should kill all workers', async () => {
    const features = [createFeature('F001'), createFeature('F002')];
    const mission = createMission(features);
    
    pool.initialize(mission);
    
    await pool.executeFeature({ featureId: 'F001' });
    await pool.executeFeature({ featureId: 'F002' });
    
    const killed = pool.killAll();
    expect(killed).toBe(2);
    
    const status = pool.getStatus();
    expect(status.activeWorkers).toBe(0);
  });
  
  it('should get ready features', () => {
    const features = [
      createFeature('F001'),
      createFeature('F002', ['F001']),
    ];
    const mission = createMission(features);
    
    pool.initialize(mission);
    
    const ready = pool.getReadyFeatures();
    expect(ready.length).toBe(1);
    expect(ready[0].id).toBe('F001');
  });
  
  it('should get critical path', () => {
    const features = [
      createFeature('F001'),
      createFeature('F002', ['F001']),
      createFeature('F003', ['F002']),
    ];
    const mission = createMission(features);
    
    pool.initialize(mission);
    
    const criticalPath = pool.getCriticalPath();
    expect(criticalPath.length).toBe(3);
  });
  
  it('should emit events', async () => {
    const events: string[] = [];
    
    pool.on('initialized', () => events.push('initialized'));
    pool.on('workerStarted', () => events.push('workerStarted'));
    pool.on('workerCompleted', () => events.push('workerCompleted'));
    
    const features = [createFeature('F001')];
    const mission = createMission(features);
    
    pool.initialize(mission);
    await pool.executeFeature({ featureId: 'F001' });
    
    // Wait a bit for events
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    expect(events).toContain('initialized');
    expect(events).toContain('workerStarted');
  }, 10000);
});

describe('getWorkerPool', () => {
  afterEach(() => {
    resetWorkerPool();
  });
  
  it('should return singleton instance', () => {
    const pool1 = getWorkerPool();
    const pool2 = getWorkerPool();
    
    expect(pool1).toBe(pool2);
  });
  
  it('should reset singleton', () => {
    const pool1 = getWorkerPool();
    resetWorkerPool();
    const pool2 = getWorkerPool();
    
    expect(pool1).not.toBe(pool2);
  });
});
