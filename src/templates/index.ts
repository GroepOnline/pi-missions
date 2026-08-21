import { getRepositories } from '../database/index.js';
import type { TemplateRow } from '../database/index.js';

export interface Template {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  content: any;
  tags: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedTimeHours: number;
  estimatedTokens: number;
  rating: number;
  usageCount: number;
}


export interface TemplateSearchResult {
  templates: Template[];
  total: number;
}

export class TemplateManager {
  private repos = getRepositories();
  
  getTemplate(id: string): Template | null {
    const row = this.repos.templates.findById(id);
    return row ? this.rowToTemplate(row) : null;
  }
  
  listTemplates(limit = 50): Template[] {
    return this.repos.templates.findAll(limit).map(r => this.rowToTemplate(r));
  }
  
  searchTemplates(query: string): TemplateSearchResult {
    const all = this.listTemplates(100);
    const q = query.toLowerCase();
    const filtered = all.filter(t => 
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.tags.some(tag => tag.toLowerCase().includes(q))
    );
    return { templates: filtered, total: filtered.length };
  }
  
  installTemplate(id: string): Template | null {
    const template = this.getTemplate(id);
    if (!template) return null;
    this.repos.templates.incrementUsage(id);
    return template;
  }
  
  rateTemplate(id: string, rating: number): boolean {
    if (rating < 1 || rating > 5) return false;
    this.repos.templates.rate(id, rating);
    return true;
  }
  
  getPopularTemplates(limit = 10): Template[] {
    return this.listTemplates(100)
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, limit);
  }
  
  getTopRatedTemplates(limit = 10): Template[] {
    return this.listTemplates(100)
      .filter(t => t.rating > 0)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, limit);
  }
  
  getTemplatesByTag(tag: string): Template[] {
    return this.listTemplates(100).filter(t => t.tags.includes(tag));
  }
  
  getTemplatesByDifficulty(difficulty: string): Template[] {
    return this.listTemplates(100).filter(t => t.difficulty === difficulty);
  }
  
  private rowToTemplate(row: TemplateRow): Template {
    return {
      id: row.id,
      name: row.name,
      description: row.description || '',
      author: row.author || 'Unknown',
      version: row.version,
      content: JSON.parse(row.content || '{}'),
      tags: JSON.parse(row.tags || '[]'),
      difficulty:
        row.difficulty === 'advanced' || row.difficulty === 'intermediate'
          ? row.difficulty
          : 'beginner',
      estimatedTimeHours: row.estimated_time_hours || 0,
      estimatedTokens: row.estimated_tokens || 0,
      rating: row.rating,
      usageCount: row.usage_count,
    };
  }
}

export function createTemplateManager(): TemplateManager {
  return new TemplateManager();
}
