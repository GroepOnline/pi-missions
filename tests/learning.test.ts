import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getLearningEngine, LearningEngine } from '../src/engines/learning.js';
import { getDatabase, closeDatabase, getRepositories } from '../src/database/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let engine: LearningEngine;
let db: any;
const testDbDir = path.join(os.tmpdir(), 'pi-missions-learning-test');

beforeAll(() => {
  process.env.PI_MISSIONS_DB_PATH = path.join(testDbDir, 'test.db');
  engine = getLearningEngine();
});

afterAll(() => {
  closeDatabase();
  if (fs.existsSync(testDbDir)) {
    fs.rmSync(testDbDir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  db = getDatabase();
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

describe('LearningEngine', () => {
  describe('learnFromMission', () => {
    it('should learn from successful mission', async () => {
      const repos = getRepositories();
      
      // Create a successful mission
      repos.missions.create({
        id: 'success-mission',
        title: 'Successful Mission',
        goal: 'Build authentication',
        status: 'complete',
        completed_at: Date.now(),
        total_tokens: 50000,
        total_features: 5,
        features_completed: 5,
        features_failed: 0,
        success_rate: 1.0,
        tags: '["auth"]',
        metadata: '{}'
      });
      
      // Create milestones and features
      db.prepare('INSERT INTO milestones (id, mission_id, title, status) VALUES (?, ?, ?, ?)')
        .run('M01', 'success-mission', 'Planning', 'complete');
      
      for (let i = 1; i <= 5; i++) {
        repos.features.create({
          id: `F00${i}`,
          milestone_id: 'M01',
          mission_id: 'success-mission',
          title: `Feature ${i}`,
          description: null,
          priority: 2,
          status: 'done',
          depends_on: '[]',
          acceptance_criteria: '[]',
          sessions: '[]',
          tool_call_count: 10,
          tokens_used: 10000,
          error_count: 0,
          blockers: '[]',
          notes: null,
          started_at: Date.now() - 3600000,
          completed_at: Date.now(),
          evidence: null
        });
      }
      
      await engine.learnFromMission('success-mission');
      
      const learnings = getRepositories().learnings.findByType('success_pattern');
      expect(learnings.length).toBeGreaterThan(0);
    });
    
    it('should learn from failed mission', async () => {
      const repos = getRepositories();
      
      repos.missions.create({
        id: 'failed-mission',
        title: 'Failed Mission',
        goal: 'Complex feature',
        status: 'active',
        completed_at: null,
        total_tokens: 100000,
        total_features: 10,
        features_completed: 3,
        features_failed: 4,
        success_rate: 0.3,
        tags: '[]',
        metadata: '{}'
      });
      
      db.prepare('INSERT INTO milestones (id, mission_id, title, status) VALUES (?, ?, ?, ?)')
        .run('M01', 'failed-mission', 'Implementation', 'active');
      
      // Create some failed features
      for (let i = 1; i <= 4; i++) {
        repos.features.create({
          id: `F00${i}`,
          milestone_id: 'M01',
          mission_id: 'failed-mission',
          title: `Failed Feature ${i}`,
          description: null,
          priority: 1,
          status: 'failed',
          depends_on: '[]',
          acceptance_criteria: '[]',
          sessions: '[]',
          tool_call_count: 20,
          tokens_used: 15000,
          error_count: 3,
          blockers: '[]',
          notes: 'Failed due to complexity',
          started_at: Date.now() - 7200000,
          completed_at: null,
          evidence: null
        });
      }
      
      await engine.learnFromMission('failed-mission');
      
      const learnings = getRepositories().learnings.findByType('failure_pattern');
      expect(learnings.length).toBeGreaterThan(0);
    });
  });
  
  describe('getRelevantInsights', () => {
    it('should return relevant insights for context', () => {
      const repos = getRepositories();
      
      // Add some learnings
      repos.learnings.create({
        mission_id: null,
        feature_id: null,
        type: 'success_pattern',
        category: 'testing',
        insight: 'Write tests first for better code quality',
        confidence: 0.8,
        applicable_to: '["testing","tdd","quality"]',
        context: '{}'
      });
      
      repos.learnings.create({
        mission_id: null,
        feature_id: null,
        type: 'insight',
        category: 'performance',
        insight: 'Use caching for expensive operations',
        confidence: 0.7,
        applicable_to: '["performance","optimization"]',
        context: '{}'
      });
      
      const insights = engine.getRelevantInsights({
        missionGoal: 'Improve test coverage',
        techStack: ['typescript', 'vitest'],
      });
      
      expect(insights.length).toBeGreaterThan(0);
      expect(insights.some(i => i.insight.includes('tests'))).toBe(true);
    });
    
    it('should sort by relevance and confidence', () => {
      const repos = getRepositories();
      
      repos.learnings.create({
        mission_id: null,
        feature_id: null,
        type: 'insight',
        category: 'testing',
        insight: 'High confidence insight',
        confidence: 0.9,
        applicable_to: '["testing"]',
        context: '{}'
      });
      
      repos.learnings.create({
        mission_id: null,
        feature_id: null,
        type: 'insight',
        category: 'testing',
        insight: 'Low confidence insight',
        confidence: 0.3,
        applicable_to: '["testing"]',
        context: '{}'
      });
      
      const insights = engine.getRelevantInsights({
        missionGoal: 'testing',
      });
      
      expect(insights.length).toBe(2);
      expect(insights[0].confidence).toBeGreaterThan(insights[1].confidence);
    });
  });
  
  describe('getPlanningAdvice', () => {
    it('should provide planning advice', () => {
      const repos = getRepositories();
      
      // Add some historical data
      repos.missions.create({
        id: 'historical-mission',
        title: 'Similar Mission',
        goal: 'Build authentication system',
        status: 'complete',
        completed_at: Date.now(),
        total_tokens: 50000,
        total_features: 5,
        features_completed: 5,
        features_failed: 0,
        success_rate: 1.0,
        tags: '["auth"]',
        metadata: '{}'
      });
      
      const advice = engine.getPlanningAdvice('Build authentication system', 5);
      
      expect(advice.suggestions).toBeDefined();
      expect(advice.warnings).toBeDefined();
      expect(advice.estimatedDuration).toBeDefined();
      expect(advice.successProbability).toBeGreaterThan(0);
      expect(advice.recommendedApproach).toBeDefined();
    });
    
    it('should warn about large feature counts', () => {
      const advice = engine.getPlanningAdvice('Large project', 25);
      
      expect(advice.warnings.length).toBeGreaterThan(0);
      expect(advice.warnings.some(w => w.includes('Large number'))).toBe(true);
    });
  });
  
  describe('getExecutionAdvice', () => {
    it('should provide execution advice', () => {
      const repos = getRepositories();
      
      repos.learnings.create({
        mission_id: null,
        feature_id: null,
        type: 'insight',
        category: 'before_start',
        insight: 'Review existing code before starting',
        confidence: 0.7,
        applicable_to: '["before_start","planning"]',
        context: '{}'
      });
      
      const advice = engine.getExecutionAdvice('Implement API', 'Build REST API');
      
      expect(advice.beforeStart).toBeDefined();
      expect(advice.duringExecution).toBeDefined();
      expect(advice.onBlocker).toBeDefined();
      expect(advice.onFinish).toBeDefined();
    });
  });
  
  describe('recordLearning', () => {
    it('should record a new learning', () => {
      engine.recordLearning({
        type: 'insight',
        category: 'testing',
        insight: 'Always write unit tests',
        confidence: 0.9,
        applicableTo: ['testing', 'quality'],
      });
      
      const learnings = getRepositories().learnings.findByType('insight');
      expect(learnings.length).toBeGreaterThan(0);
      expect(learnings[0].insight).toBe('Always write unit tests');
    });
  });
  
  describe('recordOutcome', () => {
    it('should update learning usage statistics', () => {
      const repos = getRepositories();
      
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
      
      engine.recordOutcome(learning.id, true);
      engine.recordOutcome(learning.id, true);
      engine.recordOutcome(learning.id, false);
      
      const updated = db.prepare('SELECT * FROM learnings WHERE id = ?').get(learning.id) as any;
      expect(updated.used_count).toBe(3);
      expect(updated.success_count).toBe(2);
    });
  });
});
