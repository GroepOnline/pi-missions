import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getPatternRecognitionEngine, PatternRecognitionEngine } from '../src/engines/pattern-recognition.js';
import { getDatabase, closeDatabase, getRepositories } from '../src/database/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let engine: PatternRecognitionEngine;
const testDbDir = path.join(os.tmpdir(), 'pi-missions-pattern-test');

beforeAll(() => {
  process.env.PI_MISSIONS_DB_PATH = path.join(testDbDir, 'test.db');
  engine = getPatternRecognitionEngine();
});

afterAll(() => {
  closeDatabase();
  if (fs.existsSync(testDbDir)) {
    fs.rmSync(testDbDir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  const db = getDatabase();
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

describe('PatternRecognitionEngine', () => {
  describe('analyzeMissionHistory', () => {
    it('should return empty analysis for no history', async () => {
      const analysis = await engine.analyzeMissionHistory();
      expect(analysis.patterns).toEqual([]);
      expect(analysis.insights).toEqual([]);
      expect(analysis.recommendations).toEqual([]);
    });
    
    it('should detect tool sequence patterns', async () => {
      const repos = getRepositories();
      
      // Create a mission with successful features
      repos.missions.create({
        id: 'test-mission-1',
        title: 'Test Mission',
        goal: 'Test goal',
        status: 'complete',
        completed_at: Date.now(),
        total_tokens: 1000,
        total_features: 3,
        features_completed: 3,
        features_failed: 0,
        success_rate: 1.0,
        tags: '[]',
        metadata: '{}'
      });
      
      // Add history entries
      repos.history.append({
        mission_id: 'test-mission-1',
        feature_id: 'F001',
        event: 'feature_done',
        note: 'Feature 1 completed',
        details: '{}',
        session_id: null
      });
      
      repos.history.append({
        mission_id: 'test-mission-1',
        feature_id: 'F002',
        event: 'feature_done',
        note: 'Feature 2 completed',
        details: '{}',
        session_id: null
      });
      
      repos.history.append({
        mission_id: 'test-mission-1',
        feature_id: 'F003',
        event: 'feature_done',
        note: 'Feature 3 completed',
        details: '{}',
        session_id: null
      });
      
      const analysis = await engine.analyzeMissionHistory('test-mission-1');
      
      expect(analysis.patterns.length).toBeGreaterThan(0);
      expect(analysis.patterns.some(p => p.type === 'tool_sequence')).toBe(true);
    });
    
    it('should detect error patterns', async () => {
      const repos = getRepositories();
      
      repos.missions.create({
        id: 'error-mission',
        title: 'Error Mission',
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
      
      // Add error history
      for (let i = 0; i < 3; i++) {
        repos.history.append({
          mission_id: 'error-mission',
          feature_id: `F00${i}`,
          event: 'error_detected',
          note: `Error ${i}`,
          details: JSON.stringify({ category: 'tool_failure', severity: 'high' }),
          session_id: null
        });
      }
      
      const analysis = await engine.analyzeMissionHistory('error-mission');
      
      expect(analysis.patterns.some(p => p.type === 'error_solution')).toBe(true);
      expect(analysis.insights.some(i => i.type === 'failure_factor')).toBe(true);
    });
  });
  
  describe('analyzeFeatureMetrics', () => {
    it('should identify slow features', () => {
      const features = [
        { featureId: 'F001', title: 'Fast Feature', status: 'done', toolCalls: 5, tokensUsed: 1000, durationMs: 60000, errorCount: 0, blockers: [] },
        { featureId: 'F002', title: 'Slow Feature', status: 'done', toolCalls: 20, tokensUsed: 5000, durationMs: 300000, errorCount: 0, blockers: [] },
        { featureId: 'F003', title: 'Normal Feature', status: 'done', toolCalls: 10, tokensUsed: 2000, durationMs: 120000, errorCount: 0, blockers: [] },
      ];
      
      const result = engine.analyzeFeatureMetrics(features);
      
      expect(result.slowFeatures.length).toBeGreaterThan(0);
      expect(result.slowFeatures[0].featureId).toBe('F002');
    });
    
    it('should identify token-heavy features', () => {
      const features = [
        { featureId: 'F001', title: 'Efficient', status: 'done', toolCalls: 5, tokensUsed: 1000, durationMs: 60000, errorCount: 0, blockers: [] },
        { featureId: 'F002', title: 'Token Heavy', status: 'done', toolCalls: 20, tokensUsed: 10000, durationMs: 120000, errorCount: 0, blockers: [] },
        { featureId: 'F003', title: 'Normal', status: 'done', toolCalls: 10, tokensUsed: 2000, durationMs: 60000, errorCount: 0, blockers: [] },
      ];
      
      const result = engine.analyzeFeatureMetrics(features);
      
      expect(result.tokenHeavyFeatures.length).toBeGreaterThan(0);
      expect(result.tokenHeavyFeatures[0].featureId).toBe('F002');
    });
    
    it('should identify error-prone features', () => {
      const features = [
        { featureId: 'F001', title: 'Stable', status: 'done', toolCalls: 5, tokensUsed: 1000, durationMs: 60000, errorCount: 0, blockers: [] },
        { featureId: 'F002', title: 'Buggy', status: 'done', toolCalls: 20, tokensUsed: 5000, durationMs: 120000, errorCount: 5, blockers: [] },
        { featureId: 'F003', title: 'Normal', status: 'done', toolCalls: 10, tokensUsed: 2000, durationMs: 60000, errorCount: 1, blockers: [] },
      ];
      
      const result = engine.analyzeFeatureMetrics(features);
      
      expect(result.errorProneFeatures.length).toBeGreaterThan(0);
      expect(result.errorProneFeatures[0].featureId).toBe('F002');
    });
  });
  
  describe('predictSuccessProbability', () => {
    it('should return probability between 0 and 1', () => {
      const features = [
        { title: 'Feature 1', priority: 1 },
        { title: 'Feature 2', priority: 2 },
      ];
      
      const probability = engine.predictSuccessProbability(features);
      
      expect(probability).toBeGreaterThan(0);
      expect(probability).toBeLessThan(1);
    });
    
    it('should return lower probability for many features', () => {
      const fewFeatures = Array.from({ length: 3 }, (_, i) => ({
        title: `Feature ${i}`,
        priority: 2,
      }));
      
      const manyFeatures = Array.from({ length: 25 }, (_, i) => ({
        title: `Feature ${i}`,
        priority: 2,
      }));
      
      const fewProb = engine.predictSuccessProbability(fewFeatures);
      const manyProb = engine.predictSuccessProbability(manyFeatures);
      
      expect(manyProb).toBeLessThan(fewProb);
    });
  });
  
  describe('estimateFeatureDuration', () => {
    it('should return estimate with confidence', () => {
      const result = engine.estimateFeatureDuration('Implement authentication');
      
      expect(result.estimateMs).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });
  
  describe('findSimilarMissions', () => {
    it('should find missions with matching keywords', () => {
      const repos = getRepositories();
      
      repos.missions.create({
        id: 'auth-mission',
        title: 'Implement authentication system',
        goal: 'Add JWT auth to API',
        status: 'complete',
        completed_at: Date.now(),
        total_tokens: 50000,
        total_features: 5,
        features_completed: 5,
        features_failed: 0,
        success_rate: 1.0,
        tags: '["auth","api"]',
        metadata: '{}'
      });
      
      repos.missions.create({
        id: 'ui-mission',
        title: 'Build dashboard UI',
        goal: 'Create React dashboard',
        status: 'complete',
        completed_at: Date.now(),
        total_tokens: 30000,
        total_features: 3,
        features_completed: 3,
        features_failed: 0,
        success_rate: 1.0,
        tags: '["ui","react"]',
        metadata: '{}'
      });
      
      const similar = engine.findSimilarMissions('Add authentication to my app');
      
      expect(similar.length).toBeGreaterThan(0);
      expect(similar[0].missionId).toBe('auth-mission');
    });
  });
});
