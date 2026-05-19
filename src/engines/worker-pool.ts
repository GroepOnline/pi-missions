/**
 * Worker Pool Manager
 * 
 * Manages multiple concurrent workers for parallel feature execution.
 * Handles dependency scheduling, resource monitoring, and load balancing.
 */

import { EventEmitter } from 'node:events';
import type { Feature, MissionState } from '../core/types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface WorkerConfig {
  featureId: string;
  customPrompt?: string;
  model?: string;
  timeoutMs?: number;
}

export interface WorkerInstance {
  id: string;
  featureId: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'timeout';
  startedAt: number;
  completedAt?: number;
  result?: WorkerResult;
  error?: string;
}

export interface WorkerResult {
  featureId: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  killed: boolean;
}

export interface PoolConfig {
  maxWorkers: number; // Default: 3
  maxConcurrentFeatures: number; // Default: 5
  timeoutMs: number; // Default: 600000 (10 min)
  retryAttempts: number; // Default: 2
  retryDelayMs: number; // Default: 5000
}

export interface PoolStatus {
  totalWorkers: number;
  activeWorkers: number;
  idleWorkers: number;
  completedWorkers: number;
  failedWorkers: number;
  queuedFeatures: string[];
  runningFeatures: string[];
  completedFeatures: string[];
  failedFeatures: string[];
}

export interface DependencyGraph {
  nodes: Map<string, { feature: Feature; dependencies: string[] }>;
  getReadyFeatures(): Feature[];
  markComplete(featureId: string): void;
  markFailed(featureId: string): void;
  isComplete(): boolean;
  getCriticalPath(): string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Dependency Graph
// ═══════════════════════════════════════════════════════════════════════════

export class FeatureDependencyGraph implements DependencyGraph {
  nodes = new Map<string, { feature: Feature; dependencies: string[] }>();
  private completed = new Set<string>();
  private failed = new Set<string>();
  
  constructor(features: Feature[]) {
    for (const feature of features) {
      const deps = Array.isArray(feature.dependsOn) 
        ? feature.dependsOn 
        : JSON.parse(feature.dependsOn || '[]');
      
      this.nodes.set(feature.id, { feature, dependencies: deps });
    }
  }
  
  getReadyFeatures(): Feature[] {
    const ready: Feature[] = [];
    
    for (const [id, { feature, dependencies }] of this.nodes) {
      // Skip already processed features
      if (this.completed.has(id) || this.failed.has(id)) continue;
      
      // Check if all dependencies are satisfied
      const allDepsSatisfied = dependencies.every(dep => 
        this.completed.has(dep) || this.failed.has(dep)
      );
      
      if (allDepsSatisfied && feature.status !== 'done' && feature.status !== 'failed') {
        ready.push(feature);
      }
    }
    
    return ready;
  }
  
  markComplete(featureId: string): void {
    this.completed.add(featureId);
  }
  
  markFailed(featureId: string): void {
    this.failed.add(featureId);
  }
  
  isComplete(): boolean {
    for (const [id] of this.nodes) {
      if (!this.completed.has(id) && !this.failed.has(id)) {
        return false;
      }
    }
    return true;
  }
  
  getCriticalPath(): string[] {
    // Find the longest path through the dependency graph
    const visited = new Set<string>();
    const path: string[] = [];
    
    const dfs = (nodeId: string, currentPath: string[]) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      
      const node = this.nodes.get(nodeId);
      if (!node) return;
      
      currentPath.push(nodeId);
      
      // Find features that depend on this one
      for (const [id, { dependencies }] of this.nodes) {
        if (dependencies.includes(nodeId)) {
          dfs(id, [...currentPath]);
        }
      }
      
      // Update path if this is longer
      if (currentPath.length > path.length) {
        path.length = 0;
        path.push(...currentPath);
      }
    };
    
    // Start from features with no dependencies
    for (const [id, { dependencies }] of this.nodes) {
      if (dependencies.length === 0) {
        dfs(id, []);
      }
    }
    
    return path;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Worker Pool
// ═══════════════════════════════════════════════════════════════════════════

export class WorkerPool extends EventEmitter {
  private config: PoolConfig;
  private workers = new Map<string, WorkerInstance>();
  private queue: WorkerConfig[] = [];
  private mission: MissionState | null = null;
  private dependencyGraph: FeatureDependencyGraph | null = null;
  private schedulerInterval: NodeJS.Timeout | null = null;
  
  constructor(config: Partial<PoolConfig> = {}) {
    super();
    this.config = {
      maxWorkers: config.maxWorkers ?? 3,
      maxConcurrentFeatures: config.maxConcurrentFeatures ?? 5,
      timeoutMs: config.timeoutMs ?? 600000,
      retryAttempts: config.retryAttempts ?? 2,
      retryDelayMs: config.retryDelayMs ?? 5000,
    };
  }
  
  /**
   * Initialize pool with a mission
   */
  initialize(mission: MissionState): void {
    this.mission = mission;
    this.workers.clear();
    this.queue = [];
    
    // Build dependency graph
    const features = mission.milestones.flatMap(m => m.features);
    this.dependencyGraph = new FeatureDependencyGraph(features);
    
    // Start scheduler
    this.startScheduler();
    
    this.emit('initialized', { missionId: mission.id, featureCount: features.length });
  }
  
  /**
   * Add features to the execution queue
   */
  enqueue(configs: WorkerConfig[]): void {
    this.queue.push(...configs);
    this.emit('enqueued', { count: configs.length });
    
    // Try to start workers immediately
    this.scheduleNext();
  }
  
  /**
   * Start executing a specific feature
   */
  async executeFeature(config: WorkerConfig): Promise<WorkerInstance> {
    // Check if already running
    const existing = Array.from(this.workers.values())
      .find(w => w.featureId === config.featureId && w.status === 'running');
    
    if (existing) {
      throw new Error(`Feature ${config.featureId} is already being executed`);
    }
    
    // Create worker instance
    const worker: WorkerInstance = {
      id: `worker-${config.featureId}-${Date.now()}`,
      featureId: config.featureId,
      status: 'running',
      startedAt: Date.now(),
    };
    
    this.workers.set(worker.id, worker);
    this.emit('workerStarted', { workerId: worker.id, featureId: config.featureId });
    
    // Execute in background
    this.executeWorker(worker, config).catch(err => {
      worker.status = 'failed';
      worker.error = err.message;
      worker.completedAt = Date.now();
      this.emit('workerFailed', { workerId: worker.id, error: err.message });
    });
    
    return worker;
  }
  
  /**
   * Get pool status
   */
  getStatus(): PoolStatus {
    const workers = Array.from(this.workers.values());
    
    return {
      totalWorkers: workers.length,
      activeWorkers: workers.filter(w => w.status === 'running').length,
      idleWorkers: this.config.maxWorkers - workers.filter(w => w.status === 'running').length,
      completedWorkers: workers.filter(w => w.status === 'completed').length,
      failedWorkers: workers.filter(w => w.status === 'failed').length,
      queuedFeatures: this.queue.map(c => c.featureId),
      runningFeatures: workers.filter(w => w.status === 'running').map(w => w.featureId),
      completedFeatures: workers.filter(w => w.status === 'completed').map(w => w.featureId),
      failedFeatures: workers.filter(w => w.status === 'failed').map(w => w.featureId),
    };
  }
  
  /**
   * Get worker by ID
   */
  getWorker(workerId: string): WorkerInstance | undefined {
    return this.workers.get(workerId);
  }
  
  /**
   * Get worker for feature
   */
  getWorkerForFeature(featureId: string): WorkerInstance | undefined {
    return Array.from(this.workers.values())
      .find(w => w.featureId === featureId);
  }
  
  /**
   * Kill a running worker
   */
  killWorker(workerId: string): boolean {
    const worker = this.workers.get(workerId);
    if (!worker || worker.status !== 'running') return false;
    
    worker.status = 'failed';
    worker.error = 'Killed by user';
    worker.completedAt = Date.now();
    
    this.emit('workerKilled', { workerId });
    return true;
  }
  
  /**
   * Kill all running workers
   */
  killAll(): number {
    let killed = 0;
    
    for (const [id, worker] of this.workers) {
      if (worker.status === 'running') {
        worker.status = 'failed';
        worker.error = 'Killed by user';
        worker.completedAt = Date.now();
        killed++;
      }
    }
    
    if (killed > 0) {
      this.emit('allWorkersKilled', { count: killed });
    }
    
    return killed;
  }
  
  /**
   * Get dependency graph
   */
  getDependencyGraph(): FeatureDependencyGraph | null {
    return this.dependencyGraph;
  }
  
  /**
   * Get ready features (all dependencies satisfied)
   */
  getReadyFeatures(): Feature[] {
    return this.dependencyGraph?.getReadyFeatures() || [];
  }
  
  /**
   * Get critical path
   */
  getCriticalPath(): string[] {
    return this.dependencyGraph?.getCriticalPath() || [];
  }
  
  /**
   * Shutdown pool
   */
  shutdown(): void {
    this.killAll();
    
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
    
    this.emit('shutdown');
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // Private methods
  // ═══════════════════════════════════════════════════════════════════════════
  
  private startScheduler(): void {
    // Schedule next features every 5 seconds
    this.schedulerInterval = setInterval(() => {
      this.scheduleNext();
    }, 5000);
  }
  
  private scheduleNext(): void {
    const activeWorkers = Array.from(this.workers.values())
      .filter(w => w.status === 'running').length;
    
    // Check if we can start more workers
    if (activeWorkers >= this.config.maxWorkers) return;
    
    // Get ready features from dependency graph
    const readyFeatures = this.getReadyFeatures();
    
    // Filter out already running features
    const runningFeatureIds = new Set(
      Array.from(this.workers.values())
        .filter(w => w.status === 'running')
        .map(w => w.featureId)
    );
    
    const availableFeatures = readyFeatures.filter(f => 
      !runningFeatureIds.has(f.id)
    );
    
    // Start workers for available features
    const slotsAvailable = this.config.maxWorkers - activeWorkers;
    const featuresToStart = availableFeatures.slice(0, slotsAvailable);
    
    for (const feature of featuresToStart) {
      // Check if already in queue
      const inQueue = this.queue.some(c => c.featureId === feature.id);
      if (!inQueue) {
        this.queue.push({ featureId: feature.id });
      }
    }
    
    // Start workers from queue
    while (this.queue.length > 0 && activeWorkers < this.config.maxWorkers) {
      const config = this.queue.shift()!;
      
      // Skip if already running
      if (runningFeatureIds.has(config.featureId)) continue;
      
      this.executeFeature(config).catch(err => {
        this.emit('error', { error: err.message });
      });
    }
  }
  
  private async executeWorker(worker: WorkerInstance, config: WorkerConfig): Promise<void> {
    // Simulate worker execution
    // In real implementation, this would spawn a child process
    const duration = Math.random() * 30000 + 10000; // 10-40 seconds
    
    await new Promise(resolve => setTimeout(resolve, duration));
    
    // Simulate success/failure (90% success rate)
    const success = Math.random() > 0.1;
    
    worker.completedAt = Date.now();
    worker.result = {
      featureId: config.featureId,
      exitCode: success ? 0 : 1,
      signal: null,
      stdout: success ? 'Feature completed successfully' : 'Feature failed',
      stderr: success ? '' : 'Error occurred',
      durationMs: duration,
      killed: false,
    };
    
    worker.status = success ? 'completed' : 'failed';
    
    if (!success) {
      worker.error = 'Feature execution failed';
    }
    
    // Update dependency graph
    if (this.dependencyGraph) {
      if (success) {
        this.dependencyGraph.markComplete(config.featureId);
      } else {
        this.dependencyGraph.markFailed(config.featureId);
      }
    }
    
    this.emit('workerCompleted', {
      workerId: worker.id,
      featureId: config.featureId,
      success,
      durationMs: duration,
    });
    
    // Schedule next features
    this.scheduleNext();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Singleton instance
// ═══════════════════════════════════════════════════════════════════════════

let pool: WorkerPool | null = null;

export function getWorkerPool(config?: Partial<PoolConfig>): WorkerPool {
  if (!pool) {
    pool = new WorkerPool(config);
  }
  return pool;
}

export function resetWorkerPool(): void {
  if (pool) {
    pool.shutdown();
    pool = null;
  }
}
