import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { CLI, createCLI } from '../src/cli/index.js';
import { getDatabase, closeDatabase, getRepositories } from '../src/database/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let cli: CLI;
let db: any;
const testDbDir = path.join(os.tmpdir(), 'pi-missions-cli-test');

beforeAll(() => {
  process.env.PI_MISSIONS_DB_PATH = path.join(testDbDir, 'test.db');
  cli = createCLI();
});

afterAll(() => {
  closeDatabase();
  if (fs.existsSync(testDbDir)) fs.rmSync(testDbDir, { recursive: true, force: true });
});

beforeEach(() => {
  db = getDatabase();
  db.exec('DELETE FROM missions');
});

describe('CLI', () => {
  it('should show help', async () => {
    const output = await cli.execute(['--help']);
    expect(output).toContain('Pi Missions CLI');
    expect(output).toContain('list');
    expect(output).toContain('status');
  });
  
  it('should list missions', async () => {
    const repos = getRepositories();
    repos.missions.create({ id: 'm1', title: 'Test Mission', goal: null, status: 'active', completed_at: null, total_tokens: 0, total_features: 0, features_completed: 0, features_failed: 0, success_rate: 0, tags: '[]', metadata: '{}' });
    
    const output = await cli.execute(['list']);
    expect(output).toContain('m1');
    expect(output).toContain('Test Mission');
  });
  
  it('should show mission status', async () => {
    const repos = getRepositories();
    repos.missions.create({ id: 'm2', title: 'Status Test', goal: 'Test goal', status: 'active', completed_at: null, total_tokens: 1000, total_features: 5, features_completed: 2, features_failed: 0, success_rate: 0.4, tags: '[]', metadata: '{}' });
    
    const output = await cli.execute(['status', 'm2']);
    expect(output).toContain('Status Test');
    expect(output).toContain('active');
  });
  
  it('should show analytics', async () => {
    const repos = getRepositories();
    repos.missions.create({ id: 'm3', title: 'Analytics Test', goal: null, status: 'complete', completed_at: Date.now(), total_tokens: 5000, total_features: 3, features_completed: 3, features_failed: 0, success_rate: 1.0, tags: '[]', metadata: '{}' });
    
    const output = await cli.execute(['analytics']);
    expect(output).toContain('Analytics');
    expect(output).toContain('Total:');
  });
  
  it('should list templates', async () => {
    const output = await cli.execute(['templates']);
    expect(output).toContain('refactor');
    expect(output).toContain('Code Refactoring');
  });
  
  it('should run doctor', async () => {
    const output = await cli.execute(['doctor']);
    expect(output).toContain('Database: OK');
  });
  
  it('should handle unknown command', async () => {
    const output = await cli.execute(['unknown']);
    expect(output).toContain('Unknown command');
  });
  
  it('should create CLI instance', () => {
    const c = createCLI();
    expect(c).toBeDefined();
  });
});
