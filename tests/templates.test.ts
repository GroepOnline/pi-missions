import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TemplateManager, createTemplateManager } from '../src/templates/index.js';
import { getDatabase, closeDatabase } from '../src/database/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let manager: TemplateManager;
let db: any;
const testDbDir = path.join(os.tmpdir(), 'pi-missions-templates-test');

beforeAll(() => {
  process.env.PI_MISSIONS_DB_PATH = path.join(testDbDir, 'test.db');
  manager = createTemplateManager();
});

afterAll(() => {
  closeDatabase();
  if (fs.existsSync(testDbDir)) fs.rmSync(testDbDir, { recursive: true, force: true });
});

beforeEach(() => {
  db = getDatabase();
});

describe('TemplateManager', () => {
  it('should list templates', () => {
    const templates = manager.listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(3);
  });
  
  it('should get template by id', () => {
    const template = manager.getTemplate('refactor');
    expect(template).toBeDefined();
    expect(template!.name).toBe('Code Refactoring');
    expect(template!.tags).toContain('refactoring');
  });
  
  it('should search templates', () => {
    const result = manager.searchTemplates('refactor');
    expect(result.templates.length).toBeGreaterThan(0);
    expect(result.templates[0].name).toContain('Refactor');
  });
  
  it('should install template', () => {
    const template = manager.installTemplate('refactor');
    expect(template).toBeDefined();
  });
  
  it('should rate template', () => {
    const success = manager.rateTemplate('refactor', 5);
    expect(success).toBe(true);
    
    const template = manager.getTemplate('refactor');
    expect(template!.rating).toBeGreaterThan(0);
  });
  
  it('should reject invalid rating', () => {
    const success = manager.rateTemplate('refactor', 6);
    expect(success).toBe(false);
  });
  
  it('should get popular templates', () => {
    manager.installTemplate('refactor');
    manager.installTemplate('refactor');
    manager.installTemplate('add-feature');
    
    const popular = manager.getPopularTemplates();
    expect(popular.length).toBeGreaterThan(0);
  });
  
  it('should get templates by tag', () => {
    const templates = manager.getTemplatesByTag('refactoring');
    expect(templates.length).toBeGreaterThan(0);
    expect(templates[0].tags).toContain('refactoring');
  });
  
  it('should get templates by difficulty', () => {
    const beginner = manager.getTemplatesByDifficulty('beginner');
    expect(beginner.length).toBeGreaterThan(0);
    expect(beginner[0].difficulty).toBe('beginner');
  });
  
  it('should create manager instance', () => {
    const m = createTemplateManager();
    expect(m).toBeDefined();
  });
});
