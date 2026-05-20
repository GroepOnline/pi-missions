#!/usr/bin/env node
import { getRepositories } from '../database/index.js';
import { pathToFileURL } from 'node:url';

export interface CLICommand {
  name: string;
  description: string;
  execute(args: string[]): Promise<string>;
}

export class CLI {
  private commands = new Map<string, CLICommand>();
  
  constructor() {
    this.registerDefaultCommands();
  }
  
  registerCommand(cmd: CLICommand) {
    this.commands.set(cmd.name, cmd);
  }
  
  async execute(args: string[]): Promise<string> {
    const [cmd, ...rest] = args;
    if (!cmd || cmd === '--help' || cmd === '-h') return this.showHelp();
    const command = this.commands.get(cmd);
    if (!command) return `Unknown command: ${cmd}. Use --help for available commands.`;
    return command.execute(rest);
  }
  
  showHelp(): string {
    const lines = ['Pi Missions CLI', 'Usage: pi-missions <command> [options]', '', 'Commands:'];
    for (const [name, cmd] of this.commands) lines.push(`  ${name.padEnd(15)} ${cmd.description}`);
    return lines.join('\n');
  }
  
  private registerDefaultCommands() {
    this.registerCommand({ name: 'list', description: 'List all missions', execute: async () => {
      const repos = getRepositories();
      const missions = repos.missions.findAll(50);
      if (!missions.length) return 'No missions found.';
      return missions.map(m => `${m.id} [${m.status}] ${m.title}`).join('\n');
    }});
    
    this.registerCommand({ name: 'status', description: 'Show mission status', execute: async (args) => {
      const repos = getRepositories();
      const id = args[0];
      if (!id) return 'Usage: pi-missions status <mission-id>';
      const m = repos.missions.findById(id);
      if (!m) return `Mission not found: ${id}`;
      const features = repos.features.findByMission(id);
      const done = features.filter(f => f.status === 'done').length;
      return `${m.title}\nStatus: ${m.status}\nProgress: ${done}/${features.length}\nTokens: ${m.total_tokens}`;
    }});
    
    this.registerCommand({ name: 'analytics', description: 'Show analytics', execute: async () => {
      const repos = getRepositories();
      const missions = repos.missions.findAll(100);
      const total = missions.length;
      const completed = missions.filter(m => m.status === 'complete').length;
      const active = missions.filter(m => m.status === 'active').length;
      return `📊 Analytics\nTotal: ${total}\nActive: ${active}\nCompleted: ${completed}\nSuccess Rate: ${total > 0 ? Math.round(completed/total*100) : 0}%`;
    }});
    
    this.registerCommand({ name: 'templates', description: 'List templates', execute: async () => {
      const repos = getRepositories();
      const templates = repos.templates.findAll();
      return templates.map(t => `${t.id.padEnd(15)} ${t.name} - ${t.description || ''}`).join('\n');
    }});
    
    this.registerCommand({ name: 'history', description: 'Show mission history', execute: async (args) => {
      const repos = getRepositories();
      const id = args[0];
      if (!id) return 'Usage: pi-missions history <mission-id>';
      const history = repos.history.findByMission(id, 20);
      if (!history.length) return 'No history entries.';
      return history.map(h => `${new Date(h.timestamp).toISOString()} ${h.event} ${h.note || ''}`).join('\n');
    }});
    
    this.registerCommand({ name: 'doctor', description: 'Run diagnostics', execute: async () => {
      const repos = getRepositories();
      const missions = repos.missions.count();
      const templates = repos.templates.findAll().length;
      return `✅ Database: OK\n📊 Missions: ${missions}\n📋 Templates: ${templates}`;
    }});
  }
}

export function createCLI(): CLI {
  return new CLI();
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && import.meta.url === pathToFileURL(entry).href);
}

if (isDirectExecution()) {
  createCLI().execute(process.argv.slice(2))
    .then((output) => {
      if (output) console.log(output);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
