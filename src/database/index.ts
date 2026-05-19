/**
 * Pi Missions Database Module
 * 
 * SQLite database for persistent mission storage, pattern recognition,
 * and learning system.
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

// ═══════════════════════════════════════════════════════════════════════════
// Database singleton
// ═══════════════════════════════════════════════════════════════════════════

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    const dbPath = getDatabasePath();
    
    // If dbPath is a directory, use it; otherwise use its parent
    let dbDir: string;
    let dbFile: string;
    
    if (dbPath.endsWith('.db')) {
      dbDir = join(dbPath, '..');
      dbFile = dbPath;
    } else {
      dbDir = dbPath;
      dbFile = join(dbPath, 'pi-missions.db');
    }
    
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }
    
    db = new Database(dbFile);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    
    // Initialize schema
    initializeSchema(db);
  }
  
  return db;
}

export function getDatabasePath(): string {
  return process.env.PI_MISSIONS_DB_PATH || join(homedir(), '.pi', 'missions', 'database');
}

function initializeSchema(db: Database.Database): void {
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  
  // Remove single-line comments (-- ...)
  let cleanSchema = schema.replace(/--.*$/gm, '');
  
  // Remove multi-line comments (* ... *)
  cleanSchema = cleanSchema.replace(/\/\*[\s\S]*?\*\//g, '');
  
  // Split by semicolons and execute each statement
  const statements = cleanSchema
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  
  for (const stmt of statements) {
    try {
      db.exec(stmt + ';');
    } catch (err) {
      // Ignore "already exists" errors
      if (!(err instanceof Error && err.message.includes('already exists'))) {
        console.error(`Error executing schema statement: ${err}`);
      }
    }
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Repository interfaces
// ═══════════════════════════════════════════════════════════════════════════

export interface MissionRow {
  id: string;
  title: string;
  goal: string | null;
  status: string;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  total_tokens: number;
  total_features: number;
  features_completed: number;
  features_failed: number;
  success_rate: number;
  tags: string; // JSON
  metadata: string; // JSON
}

export interface MilestoneRow {
  id: string;
  mission_id: string;
  title: string;
  description: string | null;
  status: string;
  sort_order: number;
  created_at: number;
  completed_at: number | null;
}

export interface FeatureRow {
  id: string;
  milestone_id: string;
  mission_id: string;
  title: string;
  description: string | null;
  priority: number;
  status: string;
  depends_on: string; // JSON
  acceptance_criteria: string; // JSON
  sessions: string; // JSON
  tool_call_count: number;
  tokens_used: number;
  error_count: number;
  blockers: string; // JSON
  notes: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  evidence: string | null;
}

export interface HistoryRow {
  id: number;
  mission_id: string;
  feature_id: string | null;
  event: string;
  note: string | null;
  details: string; // JSON
  timestamp: number;
  session_id: string | null;
}

export interface LearningRow {
  id: number;
  mission_id: string | null;
  feature_id: string | null;
  type: string;
  category: string | null;
  insight: string;
  confidence: number;
  applicable_to: string; // JSON
  context: string; // JSON
  created_at: number;
  used_count: number;
  success_count: number;
}

export interface PatternRow {
  id: number;
  pattern_type: string;
  name: string;
  description: string;
  pattern_data: string; // JSON
  success_count: number;
  failure_count: number;
  success_rate: number;
  avg_duration_ms: number | null;
  avg_tokens: number | null;
  example_missions: string; // JSON
  tags: string; // JSON
  created_at: number;
  updated_at: number;
}

export interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  author: string | null;
  version: string;
  content: string; // JSON
  tags: string; // JSON
  difficulty: string;
  estimated_time_hours: number | null;
  estimated_tokens: number | null;
  usage_count: number;
  rating: number;
  rating_count: number;
  created_at: number;
  updated_at: number;
  is_builtin: number;
}

export interface SessionRow {
  id: string;
  mission_id: string | null;
  feature_id: string | null;
  started_at: number;
  ended_at: number | null;
  tokens_used: number;
  tool_calls: number;
  errors: number;
  status: string;
}

export interface MetricRow {
  id: number;
  metric_type: string;
  metric_name: string;
  value: number;
  unit: string | null;
  tags: string; // JSON
  recorded_at: number;
  period_start: number | null;
  period_end: number | null;
}

export interface PredictionRow {
  id: number;
  mission_id: string | null;
  feature_id: string | null;
  prediction_type: string;
  predicted_value: number;
  actual_value: number | null;
  confidence: number;
  accuracy: number | null;
  model_version: string | null;
  created_at: number;
  validated_at: number | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Repository classes
// ═══════════════════════════════════════════════════════════════════════════

export class MissionRepository {
  private db: Database.Database;
  
  constructor(db: Database.Database) {
    this.db = db;
  }
  
  create(mission: Omit<MissionRow, 'created_at' | 'updated_at'>): MissionRow {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO missions (id, title, goal, status, created_at, updated_at, completed_at, 
                           total_tokens, total_features, features_completed, features_failed, 
                           success_rate, tags, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      mission.id, mission.title, mission.goal, mission.status,
      now, now, mission.completed_at,
      mission.total_tokens, mission.total_features, mission.features_completed,
      mission.features_failed, mission.success_rate, mission.tags, mission.metadata
    );
    
    return this.findById(mission.id)!;
  }
  
  findById(id: string): MissionRow | undefined {
    return this.db.prepare('SELECT * FROM missions WHERE id = ?').get(id) as MissionRow | undefined;
  }
  
  findAll(limit = 100, offset = 0): MissionRow[] {
    return this.db.prepare('SELECT * FROM missions ORDER BY updated_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as MissionRow[];
  }
  
  findByStatus(status: string): MissionRow[] {
    return this.db.prepare('SELECT * FROM missions WHERE status = ? ORDER BY updated_at DESC')
      .all(status) as MissionRow[];
  }
  
  update(id: string, updates: Partial<MissionRow>): MissionRow | undefined {
    const fields = Object.keys(updates).filter(k => k !== 'id' && k !== 'created_at');
    if (fields.length === 0) return this.findById(id);
    
    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => (updates as any)[f]);
    
    this.db.prepare(`UPDATE missions SET ${setClause}, updated_at = ? WHERE id = ?`)
      .run(...values, Date.now(), id);
    
    return this.findById(id);
  }
  
  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM missions WHERE id = ?').run(id);
    return result.changes > 0;
  }
  
  count(): number {
    return (this.db.prepare('SELECT COUNT(*) as count FROM missions').get() as any).count;
  }
}

export class FeatureRepository {
  private db: Database.Database;
  
  constructor(db: Database.Database) {
    this.db = db;
  }
  
  create(feature: Omit<FeatureRow, 'created_at'>): FeatureRow {
    const stmt = this.db.prepare(`
      INSERT INTO features (id, milestone_id, mission_id, title, description, priority, status,
                           depends_on, acceptance_criteria, sessions, tool_call_count, tokens_used,
                           error_count, blockers, notes, created_at, started_at, completed_at, evidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      feature.id, feature.milestone_id, feature.mission_id, feature.title, feature.description,
      feature.priority, feature.status, feature.depends_on, feature.acceptance_criteria,
      feature.sessions, feature.tool_call_count, feature.tokens_used, feature.error_count,
      feature.blockers, feature.notes, Date.now(), feature.started_at, feature.completed_at,
      feature.evidence
    );
    
    return this.findById(feature.id, feature.mission_id)!;
  }
  
  findById(id: string, missionId: string): FeatureRow | undefined {
    return this.db.prepare('SELECT * FROM features WHERE id = ? AND mission_id = ?')
      .get(id, missionId) as FeatureRow | undefined;
  }
  
  findByMission(missionId: string): FeatureRow[] {
    return this.db.prepare('SELECT * FROM features WHERE mission_id = ? ORDER BY created_at')
      .all(missionId) as FeatureRow[];
  }
  
  findByStatus(missionId: string, status: string): FeatureRow[] {
    return this.db.prepare('SELECT * FROM features WHERE mission_id = ? AND status = ?')
      .all(missionId, status) as FeatureRow[];
  }
  
  update(id: string, missionId: string, updates: Partial<FeatureRow>): FeatureRow | undefined {
    const fields = Object.keys(updates).filter(k => k !== 'id' && k !== 'mission_id' && k !== 'created_at');
    if (fields.length === 0) return this.findById(id, missionId);
    
    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => (updates as any)[f]);
    
    this.db.prepare(`UPDATE features SET ${setClause} WHERE id = ? AND mission_id = ?`)
      .run(...values, id, missionId);
    
    return this.findById(id, missionId);
  }
  
  delete(id: string, missionId: string): boolean {
    const result = this.db.prepare('DELETE FROM features WHERE id = ? AND mission_id = ?')
      .run(id, missionId);
    return result.changes > 0;
  }
}

export class HistoryRepository {
  private db: Database.Database;
  
  constructor(db: Database.Database) {
    this.db = db;
  }
  
  append(entry: Omit<HistoryRow, 'id' | 'timestamp'>): HistoryRow {
    const stmt = this.db.prepare(`
      INSERT INTO history (mission_id, feature_id, event, note, details, timestamp, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      entry.mission_id, entry.feature_id, entry.event, entry.note,
      entry.details, Date.now(), entry.session_id
    );
    
    return this.db.prepare('SELECT * FROM history WHERE id = ?')
      .get(result.lastInsertRowid) as HistoryRow;
  }
  
  findByMission(missionId: string, limit = 100): HistoryRow[] {
    return this.db.prepare('SELECT * FROM history WHERE mission_id = ? ORDER BY timestamp DESC LIMIT ?')
      .all(missionId, limit) as HistoryRow[];
  }
  
  findByFeature(featureId: string, limit = 50): HistoryRow[] {
    return this.db.prepare('SELECT * FROM history WHERE feature_id = ? ORDER BY timestamp DESC LIMIT ?')
      .all(featureId, limit) as HistoryRow[];
  }
  
  findByEvent(event: string, limit = 50): HistoryRow[] {
    return this.db.prepare('SELECT * FROM history WHERE event = ? ORDER BY timestamp DESC LIMIT ?')
      .all(event, limit) as HistoryRow[];
  }
  
  search(query: string, limit = 50): HistoryRow[] {
    return this.db.prepare(`
      SELECT * FROM history 
      WHERE note LIKE ? OR event LIKE ? 
      ORDER BY timestamp DESC LIMIT ?
    `).all(`%${query}%`, `%${query}%`, limit) as HistoryRow[];
  }
}

export class LearningRepository {
  private db: Database.Database;
  
  constructor(db: Database.Database) {
    this.db = db;
  }
  
  create(learning: Omit<LearningRow, 'id' | 'created_at' | 'used_count' | 'success_count'>): LearningRow {
    const stmt = this.db.prepare(`
      INSERT INTO learnings (mission_id, feature_id, type, category, insight, confidence, applicable_to, context)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      learning.mission_id, learning.feature_id, learning.type, learning.category,
      learning.insight, learning.confidence, learning.applicable_to, learning.context
    );
    
    return this.db.prepare('SELECT * FROM learnings WHERE id = ?')
      .get(result.lastInsertRowid) as LearningRow;
  }
  
  findByType(type: string, limit = 50): LearningRow[] {
    return this.db.prepare('SELECT * FROM learnings WHERE type = ? ORDER BY confidence DESC LIMIT ?')
      .all(type, limit) as LearningRow[];
  }
  
  findByCategory(category: string, limit = 50): LearningRow[] {
    return this.db.prepare('SELECT * FROM learnings WHERE category = ? ORDER BY confidence DESC LIMIT ?')
      .all(category, limit) as LearningRow[];
  }
  
  findRelevant(tags: string[], limit = 10): LearningRow[] {
    // Simple tag matching - could be improved with FTS
    const placeholders = tags.map(() => '?').join(',');
    return this.db.prepare(`
      SELECT * FROM learnings 
      WHERE applicable_to IN (${placeholders})
      ORDER BY confidence DESC, used_count DESC
      LIMIT ?
    `).all(...tags, limit) as LearningRow[];
  }
  
  recordUsage(id: string, success: boolean): void {
    if (success) {
      this.db.prepare('UPDATE learnings SET used_count = used_count + 1, success_count = success_count + 1 WHERE id = ?')
        .run(id);
    } else {
      this.db.prepare('UPDATE learnings SET used_count = used_count + 1 WHERE id = ?')
        .run(id);
    }
  }
}

export class PatternRepository {
  private db: Database.Database;
  
  constructor(db: Database.Database) {
    this.db = db;
  }
  
  create(pattern: Omit<PatternRow, 'id' | 'created_at' | 'updated_at'>): PatternRow {
    const stmt = this.db.prepare(`
      INSERT INTO patterns (pattern_type, name, description, pattern_data, success_count, failure_count,
                           success_rate, avg_duration_ms, avg_tokens, example_missions, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      pattern.pattern_type, pattern.name, pattern.description, pattern.pattern_data,
      pattern.success_count, pattern.failure_count, pattern.success_rate,
      pattern.avg_duration_ms, pattern.avg_tokens, pattern.example_missions, pattern.tags
    );
    
    return this.db.prepare('SELECT * FROM patterns WHERE id = ?')
      .get(result.lastInsertRowid) as PatternRow;
  }
  
  findByType(type: string, limit = 20): PatternRow[] {
    return this.db.prepare('SELECT * FROM patterns WHERE pattern_type = ? ORDER BY success_rate DESC LIMIT ?')
      .all(type, limit) as PatternRow[];
  }
  
  findSuccessful(limit = 20): PatternRow[] {
    return this.db.prepare('SELECT * FROM patterns WHERE success_rate > 0.7 ORDER BY success_rate DESC LIMIT ?')
      .all(limit) as PatternRow[];
  }
  
  recordOutcome(id: string, success: boolean): void {
    if (success) {
      this.db.prepare(`
        UPDATE patterns 
        SET success_count = success_count + 1,
            success_rate = CAST(success_count + 1 AS REAL) / (success_count + failure_count + 1),
            updated_at = ?
        WHERE id = ?
      `).run(Date.now(), id);
    } else {
      this.db.prepare(`
        UPDATE patterns 
        SET failure_count = failure_count + 1,
            success_rate = CAST(success_count AS REAL) / (success_count + failure_count + 1),
            updated_at = ?
        WHERE id = ?
      `).run(Date.now(), id);
    }
  }
}

export class TemplateRepository {
  private db: Database.Database;
  
  constructor(db: Database.Database) {
    this.db = db;
  }
  
  findById(id: string): TemplateRow | undefined {
    return this.db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as TemplateRow | undefined;
  }
  
  findAll(limit = 50): TemplateRow[] {
    return this.db.prepare('SELECT * FROM templates ORDER BY rating DESC, usage_count DESC LIMIT ?')
      .all(limit) as TemplateRow[];
  }
  
  findByTags(tags: string[]): TemplateRow[] {
    const placeholders = tags.map(() => '?').join(',');
    return this.db.prepare(`
      SELECT * FROM templates 
      WHERE tags IN (${placeholders})
      ORDER BY rating DESC
    `).all(...tags) as TemplateRow[];
  }
  
  create(template: Omit<TemplateRow, 'created_at' | 'updated_at' | 'usage_count' | 'rating' | 'rating_count'>): TemplateRow {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO templates (id, name, description, author, version, content, tags, difficulty,
                            estimated_time_hours, estimated_tokens, usage_count, rating, rating_count,
                            created_at, updated_at, is_builtin)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)
    `);
    
    stmt.run(
      template.id, template.name, template.description, template.author, template.version,
      template.content, template.tags, template.difficulty, template.estimated_time_hours,
      template.estimated_tokens, now, now, template.is_builtin
    );
    
    return this.findById(template.id)!;
  }
  
  incrementUsage(id: string): void {
    this.db.prepare('UPDATE templates SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?')
      .run(Date.now(), id);
  }
  
  rate(id: string, rating: number): void {
    this.db.prepare(`
      UPDATE templates 
      SET rating = (rating * rating_count + ?) / (rating_count + 1),
          rating_count = rating_count + 1,
          updated_at = ?
      WHERE id = ?
    `).run(rating, Date.now(), id);
  }
}

export class MetricRepository {
  private db: Database.Database;
  
  constructor(db: Database.Database) {
    this.db = db;
  }
  
  record(metric: Omit<MetricRow, 'id' | 'recorded_at'>): MetricRow {
    const stmt = this.db.prepare(`
      INSERT INTO metrics (metric_type, metric_name, value, unit, tags, recorded_at, period_start, period_end)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      metric.metric_type, metric.metric_name, metric.value, metric.unit,
      metric.tags, Date.now(), metric.period_start, metric.period_end
    );
    
    return this.db.prepare('SELECT * FROM metrics WHERE id = ?')
      .get(result.lastInsertRowid) as MetricRow;
  }
  
  findByType(type: string, name?: string, limit = 100): MetricRow[] {
    if (name) {
      return this.db.prepare('SELECT * FROM metrics WHERE metric_type = ? AND metric_name = ? ORDER BY recorded_at DESC LIMIT ?')
        .all(type, name, limit) as MetricRow[];
    }
    return this.db.prepare('SELECT * FROM metrics WHERE metric_type = ? ORDER BY recorded_at DESC LIMIT ?')
      .all(type, limit) as MetricRow[];
  }
  
  getAggregated(type: string, name: string, periodMs: number): { avg: number; min: number; max: number; count: number } {
    const since = Date.now() - periodMs;
    const row = this.db.prepare(`
      SELECT 
        AVG(value) as avg,
        MIN(value) as min,
        MAX(value) as max,
        COUNT(*) as count
      FROM metrics 
      WHERE metric_type = ? AND metric_name = ? AND recorded_at > ?
    `).get(type, name, since) as any;
    
    return {
      avg: row?.avg ?? 0,
      min: row?.min ?? 0,
      max: row?.max ?? 0,
      count: row?.count ?? 0,
    };
  }
}

export class PredictionRepository {
  private db: Database.Database;
  
  constructor(db: Database.Database) {
    this.db = db;
  }
  
  create(prediction: Omit<PredictionRow, 'id' | 'created_at' | 'validated_at' | 'accuracy'>): PredictionRow {
    const stmt = this.db.prepare(`
      INSERT INTO predictions (mission_id, feature_id, prediction_type, predicted_value, confidence, model_version)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      prediction.mission_id, prediction.feature_id, prediction.prediction_type,
      prediction.predicted_value, prediction.confidence, prediction.model_version
    );
    
    return this.db.prepare('SELECT * FROM predictions WHERE id = ?')
      .get(result.lastInsertRowid) as PredictionRow;
  }
  
  validate(id: string, actualValue: number): void {
    const prediction = this.db.prepare('SELECT * FROM predictions WHERE id = ?').get(id) as PredictionRow;
    if (!prediction) return;
    
    const accuracy = 1 - Math.abs(prediction.predicted_value - actualValue) / Math.max(prediction.predicted_value, actualValue);
    
    this.db.prepare(`
      UPDATE predictions 
      SET actual_value = ?, accuracy = ?, validated_at = ?
      WHERE id = ?
    `).run(actualValue, accuracy, Date.now(), id);
  }
  
  findByType(type: string, limit = 50): PredictionRow[] {
    return this.db.prepare('SELECT * FROM predictions WHERE prediction_type = ? ORDER BY created_at DESC LIMIT ?')
      .all(type, limit) as PredictionRow[];
  }
  
  getAccuracy(type: string): number {
    const row = this.db.prepare(`
      SELECT AVG(accuracy) as avg_accuracy 
      FROM predictions 
      WHERE prediction_type = ? AND accuracy IS NOT NULL
    `).get(type) as any;
    
    return row?.avg_accuracy ?? 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Convenience function to get all repositories
// ═══════════════════════════════════════════════════════════════════════════

export function getRepositories() {
  const db = getDatabase();
  return {
    missions: new MissionRepository(db),
    features: new FeatureRepository(db),
    history: new HistoryRepository(db),
    learnings: new LearningRepository(db),
    patterns: new PatternRepository(db),
    templates: new TemplateRepository(db),
    metrics: new MetricRepository(db),
    predictions: new PredictionRepository(db),
  };
}
