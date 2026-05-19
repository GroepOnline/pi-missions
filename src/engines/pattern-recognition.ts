/**
 * Pattern Recognition Engine
 * 
 * Analyzes mission history to find patterns in successes and failures.
 * Uses statistical analysis and simple heuristics (no ML required).
 */

import { getRepositories } from '../database/index.js';
import type { HistoryRow, LearningRow, PatternRow } from '../database/index.js';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface PatternAnalysis {
  patterns: DetectedPattern[];
  insights: Insight[];
  recommendations: Recommendation[];
}

export interface DetectedPattern {
  type: PatternType;
  name: string;
  description: string;
  confidence: number;
  evidence: string[];
  examples: string[];
}

export type PatternType = 
  | 'tool_sequence'
  | 'error_solution'
  | 'architecture'
  | 'testing'
  | 'performance'
  | 'workflow'
  | 'blocker_resolution'
  | 'token_efficiency';

export interface Insight {
  type: 'success_factor' | 'failure_factor' | 'optimization' | 'warning';
  category: string;
  message: string;
  confidence: number;
  actionable: boolean;
  suggestion?: string;
}

export interface Recommendation {
  priority: 'high' | 'medium' | 'low';
  category: string;
  title: string;
  description: string;
  impact: string;
  effort: 'low' | 'medium' | 'high';
}

export interface FeatureMetrics {
  featureId: string;
  title: string;
  status: string;
  toolCalls: number;
  tokensUsed: number;
  durationMs: number;
  errorCount: number;
  blockers: string[];
}

export interface MissionMetrics {
  missionId: string;
  title: string;
  status: string;
  totalFeatures: number;
  completedFeatures: number;
  failedFeatures: number;
  totalTokens: number;
  totalDurationMs: number;
  avgFeatureDurationMs: number;
  successRate: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Pattern Recognition Engine
// ═══════════════════════════════════════════════════════════════════════════

export class PatternRecognitionEngine {
  private repos = getRepositories();
  
  /**
   * Analyze mission history to detect patterns
   */
  async analyzeMissionHistory(missionId?: string): Promise<PatternAnalysis> {
    const patterns: DetectedPattern[] = [];
    const insights: Insight[] = [];
    const recommendations: Recommendation[] = [];
    
    // Get history data
    const history = missionId 
      ? this.repos.history.findByMission(missionId, 1000)
      : this.getRecentHistory(1000);
    
    if (history.length === 0) {
      return { patterns, insights, recommendations };
    }
    
    // Analyze different pattern types
    patterns.push(...this.detectToolSequences(history));
    patterns.push(...this.detectErrorPatterns(history));
    patterns.push(...this.detectWorkflowPatterns(history));
    
    // Generate insights
    insights.push(...this.generateInsights(history, patterns));
    
    // Generate recommendations
    recommendations.push(...this.generateRecommendations(insights, patterns));
    
    // Store detected patterns
    await this.storePatterns(patterns);
    
    // Store insights as learnings
    await this.storeInsights(insights);
    
    return { patterns, insights, recommendations };
  }
  
  /**
   * Analyze feature metrics to find performance patterns
   */
  analyzeFeatureMetrics(features: FeatureMetrics[]): {
    slowFeatures: FeatureMetrics[];
    tokenHeavyFeatures: FeatureMetrics[];
    errorProneFeatures: FeatureMetrics[];
    patterns: DetectedPattern[];
  } {
    // Use 50th percentile (median) as threshold for better detection
    const slowThreshold = this.calculatePercentile(features.map(f => f.durationMs), 50);
    const tokenThreshold = this.calculatePercentile(features.map(f => f.tokensUsed), 50);
    const errorThreshold = 3;
    
    const slowFeatures = features.filter(f => f.durationMs > slowThreshold);
    const tokenHeavyFeatures = features.filter(f => f.tokensUsed > tokenThreshold);
    const errorProneFeatures = features.filter(f => f.errorCount >= errorThreshold);
    
    const patterns: DetectedPattern[] = [];
    
    // Detect slow feature patterns
    if (slowFeatures.length > 0) {
      patterns.push({
        type: 'performance',
        name: 'Slow Features Detected',
        description: `${slowFeatures.length} features took longer than 75th percentile`,
        confidence: 0.8,
        evidence: slowFeatures.map(f => `${f.title}: ${Math.round(f.durationMs / 1000)}s`),
        examples: slowFeatures.map(f => f.featureId),
      });
    }
    
    // Detect token-heavy patterns
    if (tokenHeavyFeatures.length > 0) {
      patterns.push({
        type: 'token_efficiency',
        name: 'Token-Heavy Features',
        description: `${tokenHeavyFeatures.length} features used more tokens than 75th percentile`,
        confidence: 0.7,
        evidence: tokenHeavyFeatures.map(f => `${f.title}: ${f.tokensUsed} tokens`),
        examples: tokenHeavyFeatures.map(f => f.featureId),
      });
    }
    
    return { slowFeatures, tokenHeavyFeatures, errorProneFeatures, patterns };
  }
  
  /**
   * Find similar missions based on tags and characteristics
   */
  findSimilarMissions(goal: string, limit = 5): MissionMetrics[] {
    // Simple keyword matching - could be improved with embeddings
    const keywords = this.extractKeywords(goal);
    
    const missions = this.repos.missions.findAll(100);
    const scored = missions.map(m => {
      const missionKeywords = this.extractKeywords(m.title + ' ' + (m.goal || ''));
      const overlap = keywords.filter(k => missionKeywords.includes(k)).length;
      const score = overlap / Math.max(keywords.length, 1);
      return { mission: m, score };
    });
    
    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => this.toMissionMetrics(s.mission));
  }
  
  /**
   * Predict success probability for a new mission
   */
  predictSuccessProbability(features: { title: string; priority: number }[]): number {
    if (features.length === 0) return 0.5;
    
    // Base probability
    let probability = 0.7;
    
    // Adjust based on feature count
    if (features.length > 10) probability -= 0.1;
    if (features.length > 20) probability -= 0.1;
    
    // Adjust based on priority distribution
    const highPriority = features.filter(f => f.priority <= 2).length;
    const ratio = highPriority / features.length;
    if (ratio > 0.7) probability -= 0.05; // Too many high priority = risk
    
    // Check historical success rate
    const historicalRate = this.getHistoricalSuccessRate();
    if (historicalRate > 0) {
      probability = (probability + historicalRate) / 2;
    }
    
    return Math.max(0.1, Math.min(0.95, probability));
  }
  
  /**
   * Estimate feature duration based on historical data
   */
  estimateFeatureDuration(title: string): { estimateMs: number; confidence: number } {
    const keywords = this.extractKeywords(title);
    
    // Find similar completed features
    const allFeatures = this.getCompletedFeatures();
    const similar = allFeatures.filter(f => {
      const featureKeywords = this.extractKeywords(f.title);
      return keywords.some(k => featureKeywords.includes(k));
    });
    
    if (similar.length === 0) {
      // No historical data - use overall average
      const avg = this.getAverageFeatureDuration();
      return { estimateMs: avg || 3600000, confidence: 0.3 };
    }
    
    // Calculate average of similar features
    const avgDuration = similar.reduce((sum, f) => sum + f.durationMs, 0) / similar.length;
    const confidence = Math.min(0.9, 0.5 + (similar.length * 0.1));
    
    return { estimateMs: avgDuration, confidence };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // Private methods
  // ═══════════════════════════════════════════════════════════════════════════
  
  private detectToolSequences(history: HistoryRow[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];
    
    // Group by feature
    const featureHistory = new Map<string, HistoryRow[]>();
    for (const entry of history) {
      if (entry.feature_id) {
        if (!featureHistory.has(entry.feature_id)) {
          featureHistory.set(entry.feature_id, []);
        }
        featureHistory.get(entry.feature_id)!.push(entry);
      }
    }
    
    // Analyze successful features
    const successfulFeatures: string[] = [];
    for (const [featureId, entries] of featureHistory) {
      const hasSuccess = entries.some(e => e.event === 'feature_done');
      if (hasSuccess) {
        successfulFeatures.push(featureId);
      }
    }
    
    if (successfulFeatures.length >= 3) {
      patterns.push({
        type: 'tool_sequence',
        name: 'Successful Feature Pattern',
        description: `${successfulFeatures.length} features completed successfully`,
        confidence: 0.7,
        evidence: successfulFeatures.slice(0, 5),
        examples: successfulFeatures.slice(0, 3),
      });
    }
    
    return patterns;
  }
  
  private detectErrorPatterns(history: HistoryRow[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];
    
    // Find error events
    const errors = history.filter(e => 
      e.event === 'error_detected' || 
      e.event === 'tool_error' ||
      (e.details && e.details.includes('"isError":true'))
    );
    
    if (errors.length >= 3) {
      // Group errors by type
      const errorTypes = new Map<string, number>();
      for (const error of errors) {
        const details = this.parseJSON(error.details);
        const category = details?.category || 'unknown';
        errorTypes.set(category, (errorTypes.get(category) || 0) + 1);
      }
      
      // Find most common error
      const [mostCommon, count] = Array.from(errorTypes.entries())
        .sort((a, b) => b[1] - a[1])[0] || ['unknown', 0];
      
      if (count >= 2) {
        patterns.push({
          type: 'error_solution',
          name: `Common Error: ${mostCommon}`,
          description: `${count} occurrences of ${mostCommon} errors`,
          confidence: 0.6,
          evidence: errors.filter(e => {
            const d = this.parseJSON(e.details);
            return d?.category === mostCommon;
          }).map(e => e.note || 'No details').slice(0, 3),
          examples: errors.slice(0, 3).map(e => e.feature_id || 'unknown'),
        });
      }
    }
    
    return patterns;
  }
  
  private detectWorkflowPatterns(history: HistoryRow[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];
    
    // Analyze mission completion patterns
    const missions = new Map<string, { started: boolean; completed: boolean }>();
    for (const entry of history) {
      if (entry.event === 'mission_created') {
        missions.set(entry.mission_id, { started: true, completed: false });
      }
      if (entry.event === 'mission_complete') {
        const mission = missions.get(entry.mission_id);
        if (mission) mission.completed = true;
      }
    }
    
    const completed = Array.from(missions.values()).filter(m => m.completed).length;
    const total = missions.size;
    
    if (total >= 3) {
      const rate = completed / total;
      patterns.push({
        type: 'workflow',
        name: 'Mission Completion Rate',
        description: `${completed} of ${total} missions completed (${Math.round(rate * 100)}%)`,
        confidence: 0.8,
        evidence: [`Completion rate: ${Math.round(rate * 100)}%`, `Total missions: ${total}`],
        examples: [],
      });
    }
    
    return patterns;
  }
  
  private generateInsights(history: HistoryRow[], patterns: DetectedPattern[]): Insight[] {
    const insights: Insight[] = [];
    
    // Check for token efficiency
    const tokenEvents = history.filter(e => e.event === 'token_usage');
    if (tokenEvents.length > 0) {
      const totalTokens = tokenEvents.reduce((sum, e) => {
        const d = this.parseJSON(e.details);
        return sum + (d?.tokens || 0);
      }, 0);
      
      if (totalTokens > 100000) {
        insights.push({
          type: 'optimization',
          category: 'tokens',
          message: `High token usage detected: ${totalTokens.toLocaleString()} tokens`,
          confidence: 0.7,
          actionable: true,
          suggestion: 'Consider using more specific prompts or caching common responses',
        });
      }
    }
    
    // Check for error patterns
    const errorPatterns = patterns.filter(p => p.type === 'error_solution');
    for (const pattern of errorPatterns) {
      insights.push({
        type: 'failure_factor',
        category: 'errors',
        message: pattern.description,
        confidence: pattern.confidence,
        actionable: true,
        suggestion: `Address the root cause of ${pattern.name} errors`,
      });
    }
    
    // Check for slow features
    const slowPatterns = patterns.filter(p => p.type === 'performance');
    for (const pattern of slowPatterns) {
      insights.push({
        type: 'warning',
        category: 'performance',
        message: pattern.description,
        confidence: pattern.confidence,
        actionable: true,
        suggestion: 'Consider breaking down large features or optimizing tool usage',
      });
    }
    
    return insights;
  }
  
  private generateRecommendations(insights: Insight[], patterns: DetectedPattern[]): Recommendation[] {
    const recommendations: Recommendation[] = [];
    
    // Generate recommendations from insights
    for (const insight of insights) {
      if (insight.type === 'failure_factor') {
        recommendations.push({
          priority: 'high',
          category: insight.category,
          title: `Address ${insight.category} issues`,
          description: insight.message,
          impact: 'Reduce failures and improve success rate',
          effort: 'medium',
        });
      }
      
      if (insight.type === 'optimization') {
        recommendations.push({
          priority: 'medium',
          category: insight.category,
          title: `Optimize ${insight.category} usage`,
          description: insight.message,
          impact: 'Reduce costs and improve efficiency',
          effort: 'low',
        });
      }
    }
    
    // Generate recommendations from patterns
    const completionPatterns = patterns.filter(p => p.type === 'workflow');
    for (const pattern of completionPatterns) {
      const rate = parseFloat(pattern.description.match(/(\d+)%/)?.[1] || '0');
      if (rate < 70) {
        recommendations.push({
          priority: 'high',
          category: 'workflow',
          title: 'Improve mission completion rate',
          description: `Current completion rate is ${rate}%`,
          impact: 'More missions completed successfully',
          effort: 'high',
        });
      }
    }
    
    return recommendations;
  }
  
  private async storePatterns(patterns: DetectedPattern[]): Promise<void> {
    for (const pattern of patterns) {
      // Check if similar pattern exists
      const existing = this.repos.patterns.findByType(pattern.type);
      const similar = existing.find(p => p.name === pattern.name);
      
      if (similar) {
        // Update existing pattern
        this.repos.patterns.recordOutcome(String(similar.id), true);
      } else {
        // Create new pattern
        this.repos.patterns.create({
          pattern_type: pattern.type,
          name: pattern.name,
          description: pattern.description,
          pattern_data: JSON.stringify({ evidence: pattern.evidence, examples: pattern.examples }),
          success_count: 1,
          failure_count: 0,
          success_rate: pattern.confidence,
          avg_duration_ms: null,
          avg_tokens: null,
          example_missions: JSON.stringify(pattern.examples),
          tags: JSON.stringify([pattern.type]),
        });
      }
    }
  }
  
  private async storeInsights(insights: Insight[]): Promise<void> {
    for (const insight of insights) {
      this.repos.learnings.create({
        mission_id: null,
        feature_id: null,
        type: insight.type === 'warning' ? 'warning' : 
              insight.type === 'optimization' ? 'optimization' : 'insight',
        category: insight.category,
        insight: insight.message,
        confidence: insight.confidence,
        applicable_to: JSON.stringify([insight.category]),
        context: JSON.stringify({ actionable: insight.actionable, suggestion: insight.suggestion }),
      });
    }
  }
  
  private getRecentHistory(limit: number): HistoryRow[] {
    // Get all missions and their history
    const missions = this.repos.missions.findAll(100);
    const allHistory: HistoryRow[] = [];
    
    for (const mission of missions) {
      const history = this.repos.history.findByMission(mission.id, limit);
      allHistory.push(...history);
    }
    
    return allHistory.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }
  
  private getCompletedFeatures(): { title: string; durationMs: number }[] {
    const missions = this.repos.missions.findAll(100);
    const features: { title: string; durationMs: number }[] = [];
    
    for (const mission of missions) {
      const missionFeatures = this.repos.features.findByMission(mission.id);
      for (const f of missionFeatures) {
        if (f.status === 'done' && f.started_at && f.completed_at) {
          features.push({
            title: f.title,
            durationMs: f.completed_at - f.started_at,
          });
        }
      }
    }
    
    return features;
  }
  
  private getAverageFeatureDuration(): number {
    const features = this.getCompletedFeatures();
    if (features.length === 0) return 0;
    
    const total = features.reduce((sum, f) => sum + f.durationMs, 0);
    return total / features.length;
  }
  
  private getHistoricalSuccessRate(): number {
    const missions = this.repos.missions.findAll(100);
    if (missions.length === 0) return 0;
    
    const completed = missions.filter(m => m.status === 'complete').length;
    return completed / missions.length;
  }
  
  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
  
  private extractKeywords(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 3)
      .filter(word => !['this', 'that', 'with', 'from', 'have', 'been'].includes(word));
  }
  
  private parseJSON(str: string): any {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }
  
  private toMissionMetrics(mission: any): MissionMetrics {
    const features = this.repos.features.findByMission(mission.id);
    const completed = features.filter(f => f.status === 'done').length;
    const failed = features.filter(f => f.status === 'failed').length;
    const totalTokens = features.reduce((sum, f) => sum + f.tokens_used, 0);
    const totalDuration = features.reduce((sum, f) => {
      if (f.started_at && f.completed_at) return sum + (f.completed_at - f.started_at);
      return sum;
    }, 0);
    
    return {
      missionId: mission.id,
      title: mission.title,
      status: mission.status,
      totalFeatures: features.length,
      completedFeatures: completed,
      failedFeatures: failed,
      totalTokens,
      totalDurationMs: totalDuration,
      avgFeatureDurationMs: features.length > 0 ? totalDuration / features.length : 0,
      successRate: features.length > 0 ? completed / features.length : 0,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Singleton instance
// ═══════════════════════════════════════════════════════════════════════════

let engine: PatternRecognitionEngine | null = null;

export function getPatternRecognitionEngine(): PatternRecognitionEngine {
  if (!engine) {
    engine = new PatternRecognitionEngine();
  }
  return engine;
}
