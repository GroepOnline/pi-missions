/**
 * Learning Engine
 * 
 * Learns from completed missions to improve future planning and execution.
 * Stores insights, patterns, and recommendations for reuse.
 */

import { getRepositories } from '../database/index.js';
import type { LearningRow, PatternRow } from '../database/index.js';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface LearningContext {
  missionGoal?: string;
  featureTitle?: string;
  techStack?: string[];
  projectType?: string;
  teamSize?: number;
}

export interface LearnedInsight {
  id: number;
  type: string;
  category: string;
  insight: string;
  confidence: number;
  applicableTo: string[];
  relevanceScore: number;
}

export interface PlanningAdvice {
  suggestions: string[];
  warnings: string[];
  estimatedDuration: { min: number; max: number; avg: number };
  successProbability: number;
  similarMissions: { id: string; title: string; successRate: number }[];
  recommendedApproach: string;
}

export interface ExecutionAdvice {
  beforeStart: string[];
  duringExecution: string[];
  onBlocker: string[];
  onFinish: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Learning Engine
// ═══════════════════════════════════════════════════════════════════════════

export class LearningEngine {
  private repos = getRepositories();
  
  /**
   * Learn from a completed mission
   */
  async learnFromMission(missionId: string): Promise<void> {
    const mission = this.repos.missions.findById(missionId);
    if (!mission) return;
    
    const features = this.repos.features.findByMission(missionId);
    const history = this.repos.history.findByMission(missionId, 1000);
    
    // Learn from success/failure patterns
    this.learnFromOutcomes(mission, features, history);
    
    // Learn from tool usage patterns
    this.learnFromToolUsage(features, history);
    
    // Learn from error patterns
    this.learnFromErrors(features, history);
    
    // Learn from timing patterns
    this.learnFromTiming(features);
    
    // Update mission success rate
    this.updateMissionMetrics(missionId);
  }
  
  /**
   * Get relevant insights for a new mission
   */
  getRelevantInsights(context: LearningContext): LearnedInsight[] {
    const allLearnings = this.repos.learnings.findByType('insight', 100);
    const successPatterns = this.repos.learnings.findByType('success_pattern', 50);
    const failurePatterns = this.repos.learnings.findByType('failure_pattern', 50);
    
    const all = [...allLearnings, ...successPatterns, ...failurePatterns];
    
    // Score relevance
    const scored = all.map(learning => {
      const tags: string[] = this.parseJSON(learning.applicable_to) || [];
      const contextTags = this.extractContextTags(context);
      
      const overlap = tags.filter(t => contextTags.includes(t)).length;
      const relevanceScore = overlap / Math.max(tags.length, 1);
      
      return {
        id: learning.id,
        type: learning.type,
        category: learning.category || 'general',
        insight: learning.insight,
        confidence: learning.confidence,
        applicableTo: tags,
        relevanceScore,
      };
    });
    
    // Sort by relevance and confidence
    return scored
      .filter(s => s.relevanceScore > 0 || s.confidence > 0.7)
      .sort((a, b) => (b.relevanceScore * b.confidence) - (a.relevanceScore * a.confidence))
      .slice(0, 20);
  }
  
  /**
   * Get planning advice for a new mission
   */
  getPlanningAdvice(goal: string, featureCount: number): PlanningAdvice {
    const context: LearningContext = { missionGoal: goal };
    const insights = this.getRelevantInsights(context);
    
    // Get similar missions
    const similarMissions = this.findSimilarMissions(goal);
    
    // Calculate success probability
    const successProbability = this.calculateSuccessProbability(featureCount, similarMissions);
    
    // Estimate duration
    const estimatedDuration = this.estimateDuration(featureCount, similarMissions);
    
    // Generate suggestions
    const suggestions = this.generateSuggestions(insights, featureCount);
    
    // Generate warnings
    const warnings = this.generateWarnings(insights, featureCount);
    
    // Determine recommended approach
    const recommendedApproach = this.determineApproach(featureCount, successProbability);
    
    return {
      suggestions,
      warnings,
      estimatedDuration,
      successProbability,
      similarMissions: similarMissions.map(m => ({
        id: m.id,
        title: m.title,
        successRate: m.features_completed / Math.max(m.total_features, 1),
      })),
      recommendedApproach,
    };
  }
  
  /**
   * Get execution advice for a feature
   */
  getExecutionAdvice(featureTitle: string, missionContext: string): ExecutionAdvice {
    const context: LearningContext = { 
      missionGoal: missionContext,
      featureTitle,
    };
    const insights = this.getRelevantInsights(context);
    
    return {
      beforeStart: this.extractAdvice(insights, 'before_start'),
      duringExecution: this.extractAdvice(insights, 'during_execution'),
      onBlocker: this.extractAdvice(insights, 'on_blocker'),
      onFinish: this.extractAdvice(insights, 'on_finish'),
    };
  }
  
  /**
   * Record a new learning
   */
  recordLearning(learning: {
    missionId?: string;
    featureId?: string;
    type: string;
    category: string;
    insight: string;
    confidence: number;
    applicableTo: string[];
    context?: Record<string, any>;
  }): void {
    this.repos.learnings.create({
      mission_id: learning.missionId || null,
      feature_id: learning.featureId || null,
      type: learning.type,
      category: learning.category,
      insight: learning.insight,
      confidence: learning.confidence,
      applicable_to: JSON.stringify(learning.applicableTo),
      context: JSON.stringify(learning.context || {}),
    });
  }
  
  /**
   * Update learning based on usage outcome
   */
  recordOutcome(learningId: number, success: boolean): void {
    this.repos.learnings.recordUsage(String(learningId), success);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // Private methods
  // ═══════════════════════════════════════════════════════════════════════════
  
  private learnFromOutcomes(mission: any, features: any[], history: any[]): void {
    const completedFeatures = features.filter(f => f.status === 'done');
    const failedFeatures = features.filter(f => f.status === 'failed');
    
    // Learn from successful patterns
    if (completedFeatures.length > 0) {
      const successRate = completedFeatures.length / features.length;
      
      if (successRate > 0.8) {
        this.recordLearning({
          missionId: mission.id,
          type: 'success_pattern',
          category: 'workflow',
          insight: `High success rate (${Math.round(successRate * 100)}%) achieved with ${features.length} features`,
          confidence: 0.8,
          applicableTo: ['workflow', 'planning'],
          context: {
            featureCount: features.length,
            successRate,
            completedCount: completedFeatures.length,
          },
        });
      }
    }
    
    // Learn from failures
    if (failedFeatures.length > 0) {
      const failureRate = failedFeatures.length / features.length;
      
      if (failureRate > 0.3) {
        this.recordLearning({
          missionId: mission.id,
          type: 'failure_pattern',
          category: 'workflow',
          insight: `High failure rate (${Math.round(failureRate * 100)}%) with ${failedFeatures.length} failed features`,
          confidence: 0.7,
          applicableTo: ['workflow', 'risk'],
          context: {
            featureCount: features.length,
            failureRate,
            failedCount: failedFeatures.length,
          },
        });
      }
    }
  }
  
  private learnFromToolUsage(features: any[], history: any[]): void {
    // Analyze tool call patterns
    const toolCalls = history.filter(h => h.event === 'tool_call');
    
    if (toolCalls.length > 0) {
      // Group by tool
      const toolCounts = new Map<string, number>();
      for (const call of toolCalls) {
        const details = this.parseJSON(call.details);
        const tool = details?.toolName || 'unknown';
        toolCounts.set(tool, (toolCounts.get(tool) || 0) + 1);
      }
      
      // Find most used tools
      const sorted = Array.from(toolCounts.entries())
        .sort((a, b) => b[1] - a[1]);
      
      if (sorted.length > 0) {
        const [topTool, count] = sorted[0];
        
        this.recordLearning({
          type: 'insight',
          category: 'tool_usage',
          insight: `Most used tool: ${topTool} (${count} calls)`,
          confidence: 0.6,
          applicableTo: ['tools', 'efficiency'],
          context: { toolCounts: Object.fromEntries(toolCounts) },
        });
      }
    }
  }
  
  private learnFromErrors(features: any[], history: any[]): void {
    const errors = history.filter(h => 
      h.event === 'error_detected' || 
      h.event === 'tool_error'
    );
    
    if (errors.length > 0) {
      // Group by error type
      const errorTypes = new Map<string, number>();
      for (const error of errors) {
        const details = this.parseJSON(error.details);
        const category = details?.category || 'unknown';
        errorTypes.set(category, (errorTypes.get(category) || 0) + 1);
      }
      
      // Record each error type
      for (const [type, count] of errorTypes) {
        if (count >= 2) {
          this.recordLearning({
            type: 'failure_pattern',
            category: 'errors',
            insight: `Common error type: ${type} (${count} occurrences)`,
            confidence: 0.7,
            applicableTo: ['errors', type],
            context: { errorType: type, count },
          });
        }
      }
    }
  }
  
  private learnFromTiming(features: any[]): void {
    const completedFeatures = features.filter(f => 
      f.status === 'done' && f.started_at && f.completed_at
    );
    
    if (completedFeatures.length > 0) {
      const durations = completedFeatures.map(f => f.completed_at - f.started_at);
      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
      const maxDuration = Math.max(...durations);
      
      // Learn about slow features
      const slowFeatures = completedFeatures.filter(f => 
        (f.completed_at - f.started_at) > avgDuration * 2
      );
      
      if (slowFeatures.length > 0) {
        this.recordLearning({
          type: 'optimization',
          category: 'performance',
          insight: `${slowFeatures.length} features took 2x longer than average`,
          confidence: 0.6,
          applicableTo: ['performance', 'timing'],
          context: {
            avgDurationMs: avgDuration,
            slowFeatureCount: slowFeatures.length,
            slowFeatureTitles: slowFeatures.map(f => f.title),
          },
        });
      }
    }
  }
  
  private updateMissionMetrics(missionId: string): void {
    const mission = this.repos.missions.findById(missionId);
    if (!mission) return;
    
    const features = this.repos.features.findByMission(missionId);
    const completed = features.filter(f => f.status === 'done').length;
    const failed = features.filter(f => f.status === 'failed').length;
    const totalTokens = features.reduce((sum, f) => sum + f.tokens_used, 0);
    
    this.repos.missions.update(missionId, {
      total_features: features.length,
      features_completed: completed,
      features_failed: failed,
      total_tokens: totalTokens,
      success_rate: features.length > 0 ? completed / features.length : 0,
    });
  }
  
  private findSimilarMissions(goal: string): any[] {
    const keywords = this.extractKeywords(goal);
    const missions = this.repos.missions.findAll(100);
    
    return missions
      .map(m => {
        const missionKeywords = this.extractKeywords(m.title + ' ' + (m.goal || ''));
        const overlap = keywords.filter(k => missionKeywords.includes(k)).length;
        return { mission: m, score: overlap / Math.max(keywords.length, 1) };
      })
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(s => s.mission);
  }
  
  private calculateSuccessProbability(featureCount: number, similarMissions: any[]): number {
    let probability = 0.7;
    
    // Adjust based on feature count
    if (featureCount > 10) probability -= 0.1;
    if (featureCount > 20) probability -= 0.1;
    
    // Adjust based on similar missions
    if (similarMissions.length > 0) {
      const avgSuccessRate = similarMissions.reduce((sum, m) => {
        const rate = m.features_completed / Math.max(m.total_features, 1);
        return sum + rate;
      }, 0) / similarMissions.length;
      
      probability = (probability + avgSuccessRate) / 2;
    }
    
    return Math.max(0.1, Math.min(0.95, probability));
  }
  
  private estimateDuration(featureCount: number, similarMissions: any[]): { min: number; max: number; avg: number } {
    // Base estimate: 30 minutes per feature
    const baseMinutes = featureCount * 30;
    
    // Adjust based on similar missions
    if (similarMissions.length > 0) {
      const avgDuration = similarMissions.reduce((sum, m) => {
        if (m.completed_at && m.created_at) {
          return sum + (m.completed_at - m.created_at);
        }
        return sum;
      }, 0) / similarMissions.length;
      
      if (avgDuration > 0) {
        const avgMinutes = avgDuration / 60000;
        return {
          min: Math.round(avgMinutes * 0.7),
          max: Math.round(avgMinutes * 1.5),
          avg: Math.round(avgMinutes),
        };
      }
    }
    
    return {
      min: Math.round(baseMinutes * 0.7),
      max: Math.round(baseMinutes * 1.5),
      avg: baseMinutes,
    };
  }
  
  private generateSuggestions(insights: LearnedInsight[], featureCount: number): string[] {
    const suggestions: string[] = [];
    
    // Add suggestions based on insights
    for (const insight of insights) {
      if (insight.type === 'success_pattern' && insight.confidence > 0.7) {
        suggestions.push(`Consider: ${insight.insight}`);
      }
      
      if (insight.type === 'optimization' && insight.category === 'performance') {
        suggestions.push(`Optimize: ${insight.insight}`);
      }
    }
    
    // Add general suggestions
    if (featureCount > 10) {
      suggestions.push('Consider breaking down into smaller milestones');
    }
    
    return suggestions.slice(0, 5);
  }
  
  private generateWarnings(insights: LearnedInsight[], featureCount: number): string[] {
    const warnings: string[] = [];
    
    for (const insight of insights) {
      if (insight.type === 'failure_pattern' && insight.confidence > 0.6) {
        warnings.push(`Warning: ${insight.insight}`);
      }
    }
    
    if (featureCount > 20) {
      warnings.push('Large number of features may lead to context issues');
    }
    
    return warnings.slice(0, 3);
  }
  
  private determineApproach(featureCount: number, successProbability: number): string {
    if (featureCount <= 5 && successProbability > 0.8) {
      return 'Direct implementation - small scope with high success probability';
    }
    
    if (featureCount <= 10) {
      return 'Iterative approach - implement in 2-3 batches';
    }
    
    return 'Phased approach - break into milestones with validation gates';
  }
  
  private extractAdvice(insights: LearnedInsight[], phase: string): string[] {
    return insights
      .filter(i => {
        const context = this.parseJSON(JSON.stringify(i));
        return i.applicableTo.includes(phase) || i.category === phase;
      })
      .map(i => i.insight)
      .slice(0, 3);
  }
  
  private extractContextTags(context: LearningContext): string[] {
    const tags: string[] = [];
    
    if (context.missionGoal) {
      tags.push(...this.extractKeywords(context.missionGoal));
    }
    
    if (context.featureTitle) {
      tags.push(...this.extractKeywords(context.featureTitle));
    }
    
    if (context.techStack) {
      tags.push(...context.techStack);
    }
    
    if (context.projectType) {
      tags.push(context.projectType);
    }
    
    return [...new Set(tags)];
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
}

// ═══════════════════════════════════════════════════════════════════════════
// Singleton instance
// ═══════════════════════════════════════════════════════════════════════════

let engine: LearningEngine | null = null;

export function getLearningEngine(): LearningEngine {
  if (!engine) {
    engine = new LearningEngine();
  }
  return engine;
}
