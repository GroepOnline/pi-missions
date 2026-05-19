import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { 
  getDatabase, closeDatabase, getRepositories,
  MissionRepository, FeatureRepository, HistoryRepository,
  LearningRepository, PatternRepository, TemplateRepository,
  MetricRepository, PredictionRepository
} from '../src/database/index.js';
import type { Database } from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let db: Database;
let repos: ReturnType<typeof getRepositories>;
const testDbDir = path.join(os.tmpdir(), 'pi-missions-test-db');

beforeAll(() => {
  // Use temp directory for test database
  process.env.PI_MISSIONS_DB_PATH = path.join(testDbDir, 'test.db');
  db = getDatabase();
  repos = getRepositories();
});

afterAll(() => {
  closeDatabase();
  // Cleanup test database
  if (fs.existsSync(testDbDir)) {
    fs.rmSync(testDbDir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  // Clear tables before each test
  db.exec('DELETE FROM predictions');
  db.exec('DELETE FROM metrics');
  db.exec('DELETE FROM sessions');
  db.exec('DELETE FROM history');
  db.exec('DELETE FROM acceptance_criteria');
  db.exec('DELETE FROM features');
  db.exec('DELETE FROM milestones');
  db.exec('DELETE FROM missions');
  db.exec('DELETE FROM learnings');
  db.exec('DELETE FROM patterns');
});

describe('Database Initialization', () => {
  it('should create database file', () => {
    expect(db).toBeDefined();
  });
  
  it('should have all tables', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as any[];
    const tableNames = tables.map(t => t.name);
    
    expect(tableNames).toContain('missions');
    expect(tableNames).toContain('milestones');
    expect(tableNames).toContain('features');
    expect(tableNames).toContain('history');
    expect(tableNames).toContain('learnings');
    expect(tableNames).toContain('patterns');
    expect(tableNames).toContain('templates');
    expect(tableNames).toContain('sessions');
    expect(tableNames).toContain('metrics');
    expect(tableNames).toContain('predictions');
  });
  
  it('should have default templates', () => {
    const templates = repos.templates.findAll();
    expect(templates.length).toBeGreaterThanOrEqual(3);
    
    const refactor = repos.templates.findById('refactor');
    expect(refactor).toBeDefined();
    expect(refactor!.name).toBe('Code Refactoring');
  });
});

describe('MissionRepository', () => {
  it('should create a mission', () => {
    const mission = repos.missions.create({
      id: 'test-mission-1',
      title: 'Test Mission',
      goal: 'Test goal',
      status: 'active',
      completed_at: null,
      total_tokens: 0,
      total_features: 5,
      features_completed: 0,
      features_failed: 0,
      success_rate: 0,
      tags: '[]',
      metadata: '{}'
    });
    
    expect(mission).toBeDefined();
    expect(mission.id).toBe('test-mission-1');
    expect(mission.title).toBe('Test Mission');
    expect(mission.status).toBe('active');
  });
  
  it('should find mission by id', () => {
    repos.missions.create({
      id: 'test-mission-2',
      title: 'Test Mission 2',
      goal: null,
      status: 'planning',
      completed_at: null,
      total_tokens: 0,
      total_features: 0,
      features_completed: 0,
      features_failed: 0,
      success_rate: 0,
      tags: '[]',
      metadata: '{}'
    });
    
    const found = repos.missions.findById('test-mission-2');
    expect(found).toBeDefined();
    expect(found!.title).toBe('Test Mission 2');
  });
  
  it('should find all missions', () => {
    repos.missions.create({
      id: 'mission-a',
      title: 'Mission A',
      goal: null,
      status: 'active',
      completed_at: null,
      total_tokens: 0,
      total_features: 0,
      features_completed: 0,
      features_failed: 0,
      success_rate: 0,
      tags: '[]',
      metadata: '{}'
    });
    
    repos.missions.create({
      id: 'mission-b',
      title: 'Mission B',
      goal: null,
      status: 'complete',
      completed_at: null,
      total_tokens: 0,
      total_features: 0,
      features_completed: 0,
      features_failed: 0,
      success_rate: 0,
      tags: '[]',
      metadata: '{}'
    });
    
    const all = repos.missions.findAll();
    expect(all.length).toBe(2);
  });
  
  it('should find missions by status', () => {
    repos.missions.create({
      id: 'active-1',
      title: 'Active 1',
      goal: null,
      status: 'active',
      completed_at: null,
      total_tokens: 0,
      total_features: 0,
      features_completed: 0,
      features_failed: 0,
      success_rate: 0,
      tags: '[]',
      metadata: '{}'
    });
    
    repos.missions.create({
      id: 'complete-1',
      title: 'Complete 1',
      goal: null,
      status: 'complete',
      completed_at: null,
      total_tokens: 0,
      total_features: 0,
      features_completed: 0,
      features_failed: 0,
      success_rate: 0,
      tags: '[]',
      metadata: '{}'
    });
    
    const active = repos.missions.findByStatus('active');
    expect(active.length).toBe(1);
    expect(active[0].id).toBe('active-1');
  });
  
  it('should update mission', () => {
    repos.missions.create({
      id: 'update-test',
      title: 'Original Title',
      goal: null,
      status: 'active',
      completed_at: null,
      total_tokens: 0,
      total_features: 0,
      features_completed: 0,
      features_failed: 0,
      success_rate: 0,
      tags: '[]',
      metadata: '{}'
    });
    
    const updated = repos.missions.update('update-test', {
      title: 'Updated Title',
      status: 'complete',
      features_completed: 5
    });
    
    expect(updated).toBeDefined();
    expect(updated!.title).toBe('Updated Title');
    expect(updated!.status).toBe('complete');
    expect(updated!.features_completed).toBe(5);
  });
  
  it('should delete mission', () => {
    repos.missions.create({
      id: 'delete-test',
      title: 'To Delete',
      goal: null,
      status: 'active',
      completed_at: null,
      total_tokens: 0,
      total_features: 0,
      features_completed: 0,
      features_failed: 0,
      success_rate: 0,
      tags: '[]',
      metadata: '{}'
    });
    
    const deleted = repos.missions.delete('delete-test');
    expect(deleted).toBe(true);
    
    const found = repos.missions.findById('delete-test');
    expect(found).toBeUndefined();
  });
});

describe('FeatureRepository', () => {
  beforeEach(() => {
    // Create a test mission
    repos.missions.create({
      id: 'feature-test-mission',
      title: 'Feature Test Mission',
      goal: null,
      status: 'active',
      completed_at: null,
      total_tokens: 0,
      total_features: 0,
      features_completed: 0,
      features_failed: 0,
      success_rate: 0,
      tags: '[]',
      metadata: '{}'
    });
    
    // Create a milestone
    db.prepare('INSERT INTO milestones (id, mission_id, title, status) VALUES (?, ?, ?, ?)')
      .run('M01', 'feature-test-mission', 'Test Milestone', 'active');
  });
  
  it('should create a feature', () => {
    const feature = repos.features.create({
      id: 'F001',
      milestone_id: 'M01',
      mission_id: 'feature-test-mission',
      title: 'Test Feature',
      description: 'A test feature',
      priority: 1,
      status: 'pending',
      depends_on: '[]',
      acceptance_criteria: '[]',
      sessions: '[]',
      tool_call_count: 0,
      tokens_used: 0,
      error_count: 0,
      blockers: '[]',
      notes: null,
      started_at: null,
      completed_at: null,
      evidence: null
    });
    
    expect(feature).toBeDefined();
    expect(feature.id).toBe('F001');
    expect(feature.title).toBe('Test Feature');
  });
  
  it('should find features by mission', () => {
    repos.features.create({
      id: 'F001',
      milestone_id: 'M01',
      mission_id: 'feature-test-mission',
      title: 'Feature 1',
      description: null,
      priority: 1,
      status: 'pending',
      depends_on: '[]',
      acceptance_criteria: '[]',
      sessions: '[]',
      tool_call_count: 0,
      tokens_used: 0,
      error_count: 0,
      blockers: '[]',
      notes: null,
      started_at: null,
      completed_at: null,
      evidence: null
    });
    
    repos.features.create({
      id: 'F002',
      milestone_id: 'M01',
      mission_id: 'feature-test-mission',
      title: 'Feature 2',
      description: null,
      priority: 2,
      status: 'active',
      depends_on: '[]',
      acceptance_criteria: '[]',
      sessions: '[]',
      tool_call_count: 0,
      tokens_used: 0,
      error_count: 0,
      blockers: '[]',
      notes: null,
      started_at: null,
      completed_at: null,
      evidence: null
    });
    
    const features = repos.features.findByMission('feature-test-mission');
    expect(features.length).toBe(2);
  });
  
  it('should find features by status', () => {
    repos.features.create({
      id: 'F001',
      milestone_id: 'M01',
      mission_id: 'feature-test-mission',
      title: 'Pending Feature',
      description: null,
      priority: 1,
      status: 'pending',
      depends_on: '[]',
      acceptance_criteria: '[]',
      sessions: '[]',
      tool_call_count: 0,
      tokens_used: 0,
      error_count: 0,
      blockers: '[]',
      notes: null,
      started_at: null,
      completed_at: null,
      evidence: null
    });
    
    repos.features.create({
      id: 'F002',
      milestone_id: 'M01',
      mission_id: 'feature-test-mission',
      title: 'Done Feature',
      description: null,
      priority: 2,
      status: 'done',
      depends_on: '[]',
      acceptance_criteria: '[]',
      sessions: '[]',
      tool_call_count: 0,
      tokens_used: 0,
      error_count: 0,
      blockers: '[]',
      notes: null,
      started_at: null,
      completed_at: null,
      evidence: null
    });
    
    const done = repos.features.findByStatus('feature-test-mission', 'done');
    expect(done.length).toBe(1);
    expect(done[0].id).toBe('F002');
  });
  
  it('should update feature', () => {
    repos.features.create({
      id: 'F001',
      milestone_id: 'M01',
      mission_id: 'feature-test-mission',
      title: 'Original',
      description: null,
      priority: 1,
      status: 'pending',
      depends_on: '[]',
      acceptance_criteria: '[]',
      sessions: '[]',
      tool_call_count: 0,
      tokens_used: 0,
      error_count: 0,
      blockers: '[]',
      notes: null,
      started_at: null,
      completed_at: null,
      evidence: null
    });
    
    const updated = repos.features.update('F001', 'feature-test-mission', {
      status: 'active',
      started_at: Date.now(),
      tool_call_count: 5
    });
    
    expect(updated).toBeDefined();
    expect(updated!.status).toBe('active');
    expect(updated!.tool_call_count).toBe(5);
  });
});

describe('HistoryRepository', () => {
  beforeEach(() => {
    repos.missions.create({
      id: 'history-test-mission',
      title: 'History Test',
      goal: null,
      status: 'active',
      completed_at: null,
      total_tokens: 0,
      total_features: 0,
      features_completed: 0,
      features_failed: 0,
      success_rate: 0,
      tags: '[]',
      metadata: '{}'
    });
  });
  
  it('should append history entry', () => {
    const entry = repos.history.append({
      mission_id: 'history-test-mission',
      feature_id: 'F001',
      event: 'feature_started',
      note: 'Started working on feature',
      details: '{"key": "value"}',
      session_id: 'session-1'
    });
    
    expect(entry).toBeDefined();
    expect(entry.event).toBe('feature_started');
    expect(entry.mission_id).toBe('history-test-mission');
  });
  
  it('should find history by mission', () => {
    repos.history.append({
      mission_id: 'history-test-mission',
      feature_id: null,
      event: 'mission_created',
      note: 'Mission created',
      details: '{}',
      session_id: null
    });
    
    repos.history.append({
      mission_id: 'history-test-mission',
      feature_id: 'F001',
      event: 'feature_done',
      note: 'Feature completed',
      details: '{}',
      session_id: null
    });
    
    const history = repos.history.findByMission('history-test-mission');
    expect(history.length).toBe(2);
  });
  
  it('should search history', () => {
    repos.history.append({
      mission_id: 'history-test-mission',
      feature_id: null,
      event: 'error',
      note: 'Authentication failed',
      details: '{}',
      session_id: null
    });
    
    repos.history.append({
      mission_id: 'history-test-mission',
      feature_id: null,
      event: 'success',
      note: 'All tests passed',
      details: '{}',
      session_id: null
    });
    
    const results = repos.history.search('authentication');
    expect(results.length).toBe(1);
    expect(results[0].note).toContain('Authentication');
  });
});

describe('LearningRepository', () => {
  it('should create learning', () => {
    const learning = repos.learnings.create({
      mission_id: null,
      feature_id: null,
      type: 'success_pattern',
      category: 'testing',
      insight: 'Writing tests first leads to better code',
      confidence: 0.8,
      applicable_to: '["tdd","testing"]',
      context: '{"example": "value"}'
    });
    
    expect(learning).toBeDefined();
    expect(learning.type).toBe('success_pattern');
    expect(learning.insight).toContain('tests');
  });
  
  it('should find learnings by type', () => {
    repos.learnings.create({
      mission_id: null,
      feature_id: null,
      type: 'failure_pattern',
      category: null,
      insight: 'Skipping tests leads to bugs',
      confidence: 0.9,
      applicable_to: '[]',
      context: '{}'
    });
    
    repos.learnings.create({
      mission_id: null,
      feature_id: null,
      type: 'success_pattern',
      category: null,
      insight: 'Code review catches issues',
      confidence: 0.7,
      applicable_to: '[]',
      context: '{}'
    });
    
    const failures = repos.learnings.findByType('failure_pattern');
    expect(failures.length).toBe(1);
    expect(failures[0].insight).toContain('Skipping tests');
  });
  
  it('should record usage', () => {
    const learning = repos.learnings.create({
      mission_id: null,
      feature_id: null,
      type: 'insight',
      category: null,
      insight: 'Test insight',
      confidence: 0.5,
      applicable_to: '[]',
      context: '{}'
    });
    
    repos.learnings.recordUsage(String(learning.id), true);
    
    const updated = db.prepare('SELECT * FROM learnings WHERE id = ?').get(learning.id) as any;
    expect(updated.used_count).toBe(1);
    expect(updated.success_count).toBe(1);
  });
});

describe('PatternRepository', () => {
  it('should create pattern', () => {
    const pattern = repos.patterns.create({
      pattern_type: 'tool_sequence',
      name: 'Test-First Development',
      description: 'Write tests before implementation',
      pattern_data: '{"steps": ["write test", "implement", "refactor"]}',
      success_count: 10,
      failure_count: 2,
      success_rate: 0.83,
      avg_duration_ms: 3600000,
      avg_tokens: 50000,
      example_missions: '["m1", "m2"]',
      tags: '["tdd","testing"]'
    });
    
    expect(pattern).toBeDefined();
    expect(pattern.name).toBe('Test-First Development');
  });
  
  it('should find patterns by type', () => {
    repos.patterns.create({
      pattern_type: 'error_solution',
      name: 'Fix TypeScript Error',
      description: 'Solution for common TS errors',
      pattern_data: '{"error": "TS2345"}',
      success_count: 5,
      failure_count: 1,
      success_rate: 0.83,
      avg_duration_ms: null,
      avg_tokens: null,
      example_missions: '[]',
      tags: '["typescript"]'
    });
    
    const patterns = repos.patterns.findByType('error_solution');
    expect(patterns.length).toBe(1);
  });
  
  it('should record outcome', () => {
    const pattern = repos.patterns.create({
      pattern_type: 'workflow',
      name: 'Test Pattern',
      description: 'Test',
      pattern_data: '{}',
      success_count: 5,
      failure_count: 2,
      success_rate: 0.71,
      avg_duration_ms: null,
      avg_tokens: null,
      example_missions: '[]',
      tags: '[]'
    });
    
    repos.patterns.recordOutcome(String(pattern.id), true);
    
    const updated = db.prepare('SELECT * FROM patterns WHERE id = ?').get(pattern.id) as any;
    expect(updated.success_count).toBe(6);
  });
});

describe('TemplateRepository', () => {
  it('should find template by id', () => {
    const template = repos.templates.findById('refactor');
    expect(template).toBeDefined();
    expect(template!.name).toBe('Code Refactoring');
  });
  
  it('should find all templates', () => {
    const templates = repos.templates.findAll();
    expect(templates.length).toBeGreaterThanOrEqual(3);
  });
  
  it('should increment usage', () => {
    repos.templates.incrementUsage('refactor');
    repos.templates.incrementUsage('refactor');
    
    const template = repos.templates.findById('refactor');
    expect(template!.usage_count).toBe(2);
  });
  
  it('should rate template', () => {
    repos.templates.rate('refactor', 5);
    repos.templates.rate('refactor', 4);
    
    const template = repos.templates.findById('refactor');
    expect(template!.rating_count).toBe(2);
    expect(template!.rating).toBeGreaterThanOrEqual(4);
  });
});

describe('MetricRepository', () => {
  it('should record metric', () => {
    const metric = repos.metrics.record({
      metric_type: 'performance',
      metric_name: 'feature_duration',
      value: 3600000,
      unit: 'ms',
      tags: '{"feature": "F001"}',
      period_start: null,
      period_end: null
    });
    
    expect(metric).toBeDefined();
    expect(metric.value).toBe(3600000);
  });
  
  it('should find metrics by type', () => {
    repos.metrics.record({
      metric_type: 'tokens',
      metric_name: 'usage',
      value: 1000,
      unit: 'tokens',
      tags: '{}',
      period_start: null,
      period_end: null
    });
    
    repos.metrics.record({
      metric_type: 'tokens',
      metric_name: 'usage',
      value: 2000,
      unit: 'tokens',
      tags: '{}',
      period_start: null,
      period_end: null
    });
    
    repos.metrics.record({
      metric_type: 'performance',
      metric_name: 'speed',
      value: 100,
      unit: 'ms',
      tags: '{}',
      period_start: null,
      period_end: null
    });
    
    const tokenMetrics = repos.metrics.findByType('tokens');
    expect(tokenMetrics.length).toBe(2);
  });
  
  it('should get aggregated metrics', () => {
    repos.metrics.record({
      metric_type: 'test',
      metric_name: 'aggregation',
      value: 10,
      unit: null,
      tags: '{}',
      period_start: null,
      period_end: null
    });
    
    repos.metrics.record({
      metric_type: 'test',
      metric_name: 'aggregation',
      value: 20,
      unit: null,
      tags: '{}',
      period_start: null,
      period_end: null
    });
    
    repos.metrics.record({
      metric_type: 'test',
      metric_name: 'aggregation',
      value: 30,
      unit: null,
      tags: '{}',
      period_start: null,
      period_end: null
    });
    
    const agg = repos.metrics.getAggregated('test', 'aggregation', 60000);
    expect(agg.avg).toBe(20);
    expect(agg.min).toBe(10);
    expect(agg.max).toBe(30);
    expect(agg.count).toBe(3);
  });
});

describe('PredictionRepository', () => {
  it('should create prediction', () => {
    const prediction = repos.predictions.create({
      mission_id: null,
      feature_id: null,
      prediction_type: 'success_probability',
      predicted_value: 0.85,
      confidence: 0.7,
      model_version: 'v1'
    });
    
    expect(prediction).toBeDefined();
    expect(prediction.predicted_value).toBe(0.85);
  });
  
  it('should validate prediction', () => {
    const prediction = repos.predictions.create({
      mission_id: null,
      feature_id: null,
      prediction_type: 'duration_estimate',
      predicted_value: 3600000,
      confidence: 0.6,
      model_version: null
    });
    
    repos.predictions.validate(String(prediction.id), 3500000);
    
    const updated = db.prepare('SELECT * FROM predictions WHERE id = ?').get(prediction.id) as any;
    expect(updated.actual_value).toBe(3500000);
    expect(updated.accuracy).toBeGreaterThan(0.9);
  });
  
  it('should get accuracy', () => {
    repos.predictions.create({
      mission_id: null,
      feature_id: null,
      prediction_type: 'token_estimate',
      predicted_value: 100,
      confidence: 0.5,
      model_version: null
    });
    
    const accuracy = repos.predictions.getAccuracy('token_estimate');
    expect(accuracy).toBe(0); // Not validated yet
  });
});

describe('Views', () => {
  it('should query mission_summary view', () => {
    repos.missions.create({
      id: 'view-test',
      title: 'View Test',
      goal: null,
      status: 'active',
      completed_at: null,
      total_tokens: 1000,
      total_features: 10,
      features_completed: 5,
      features_failed: 1,
      success_rate: 0.5,
      tags: '[]',
      metadata: '{}'
    });
    
    const summary = db.prepare('SELECT * FROM mission_summary WHERE id = ?').get('view-test') as any;
    expect(summary).toBeDefined();
    expect(summary.progress_percent).toBe(50);
  });
});
