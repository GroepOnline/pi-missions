/**
 * Analytics Dashboard
 * 
 * Rich terminal UI for mission analytics, progress visualization,
 * and real-time monitoring.
 */

import type { MissionState, Feature, Milestone } from '../core/types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface DashboardConfig {
  showCharts: boolean;
  showMetrics: boolean;
  showTimeline: boolean;
  showRecommendations: boolean;
  compactMode: boolean;
}

export interface MissionAnalytics {
  totalMissions: number;
  activeMissions: number;
  completedMissions: number;
  failedMissions: number;
  successRate: number;
  avgDurationMs: number;
  totalTokensUsed: number;
  avgTokensPerMission: number;
  avgFeaturesPerMission: number;
  topBlockers: { blocker: string; count: number }[];
  recentActivity: ActivityEntry[];
}

export interface ActivityEntry {
  timestamp: number;
  missionId: string;
  missionTitle: string;
  event: string;
  details: string;
}

export interface FeatureStats {
  total: number;
  completed: number;
  inProgress: number;
  blocked: number;
  failed: number;
  avgDurationMs: number;
  avgToolCalls: number;
  avgTokens: number;
}

export interface ProgressChart {
  label: string;
  value: number;
  max: number;
  percentage: number;
  bar: string;
}

export interface TrendData {
  period: string;
  value: number;
  change: number;
  changePercent: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Analytics Dashboard
// ═══════════════════════════════════════════════════════════════════════════

export class AnalyticsDashboard {
  private config: DashboardConfig;
  
  constructor(config: Partial<DashboardConfig> = {}) {
    this.config = {
      showCharts: config.showCharts ?? true,
      showMetrics: config.showMetrics ?? true,
      showTimeline: config.showTimeline ?? true,
      showRecommendations: config.showRecommendations ?? true,
      compactMode: config.compactMode ?? false,
    };
  }
  
  /**
   * Generate full dashboard for a mission
   */
  generateMissionDashboard(mission: MissionState): string[] {
    const lines: string[] = [];
    
    // Header
    lines.push(...this.renderHeader(mission));
    lines.push('');
    
    // Progress overview
    if (this.config.showCharts) {
      lines.push(...this.renderProgressCharts(mission));
      lines.push('');
    }
    
    // Milestone details
    lines.push(...this.renderMilestoneDetails(mission));
    lines.push('');
    
    // Feature timeline
    if (this.config.showTimeline) {
      lines.push(...this.renderFeatureTimeline(mission));
      lines.push('');
    }
    
    // Token usage
    if (this.config.showMetrics) {
      lines.push(...this.renderTokenUsage(mission));
      lines.push('');
    }
    
    // Recommendations
    if (this.config.showRecommendations) {
      lines.push(...this.renderRecommendations(mission));
    }
    
    return lines;
  }
  
  /**
   * Generate analytics overview for all missions
   */
  generateAnalyticsOverview(analytics: MissionAnalytics): string[] {
    const lines: string[] = [];
    
    lines.push('📊 Mission Analytics Overview');
    lines.push('═'.repeat(60));
    lines.push('');
    
    // Summary cards
    lines.push(...this.renderSummaryCards(analytics));
    lines.push('');
    
    // Success rate chart
    if (this.config.showCharts) {
      lines.push(...this.renderSuccessRateChart(analytics));
      lines.push('');
    }
    
    // Top blockers
    if (analytics.topBlockers.length > 0) {
      lines.push(...this.renderTopBlockers(analytics.topBlockers));
      lines.push('');
    }
    
    // Recent activity
    if (this.config.showTimeline && analytics.recentActivity.length > 0) {
      lines.push(...this.renderRecentActivity(analytics.recentActivity));
    }
    
    return lines;
  }
  
  /**
   * Generate feature statistics
   */
  generateFeatureStats(stats: FeatureStats): string[] {
    const lines: string[] = [];
    
    lines.push('📈 Feature Statistics');
    lines.push('─'.repeat(40));
    lines.push('');
    
    // Status distribution
    lines.push('Status Distribution:');
    lines.push(`  ✅ Completed: ${stats.completed} (${this.percentage(stats.completed, stats.total)})`);
    lines.push(`  🔄 In Progress: ${stats.inProgress} (${this.percentage(stats.inProgress, stats.total)})`);
    lines.push(`  ⏸️ Blocked: ${stats.blocked} (${this.percentage(stats.blocked, stats.total)})`);
    lines.push(`  ❌ Failed: ${stats.failed} (${this.percentage(stats.failed, stats.total)})`);
    lines.push('');
    
    // Averages
    lines.push('Averages:');
    lines.push(`  ⏱️ Duration: ${this.formatDuration(stats.avgDurationMs)}`);
    lines.push(`  🔧 Tool Calls: ${stats.avgToolCalls.toFixed(1)}`);
    lines.push(`  📝 Tokens: ${stats.avgTokens.toLocaleString()}`);
    
    return lines;
  }
  
  /**
   * Generate progress bar
   */
  generateProgressBar(value: number, max: number, width: number = 30): string {
    const percentage = max > 0 ? value / max : 0;
    const filled = Math.round(width * percentage);
    const empty = width - filled;
    
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const percent = (percentage * 100).toFixed(1);
    
    return `[${bar}] ${percent}%`;
  }
  
  /**
   * Generate trend chart
   */
  generateTrendChart(data: TrendData[], label: string): string[] {
    const lines: string[] = [];
    
    lines.push(`📈 ${label} Trend`);
    lines.push('─'.repeat(40));
    
    if (data.length === 0) {
      lines.push('  No data available');
      return lines;
    }
    
    const maxVal = Math.max(...data.map(d => d.value));
    
    for (const point of data.slice(-7)) {
      const bar = this.generateProgressBar(point.value, maxVal, 20);
      const change = point.change >= 0 ? `+${point.change}` : `${point.change}`;
      lines.push(`  ${point.period}: ${bar} (${change})`);
    }
    
    return lines;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // Private rendering methods
  // ═══════════════════════════════════════════════════════════════════════════
  
  private renderHeader(mission: MissionState): string[] {
    const statusIcon = this.getStatusIcon(mission.status);
    const progress = this.calculateProgress(mission);
    
    return [
      `${statusIcon} Mission: ${mission.title}`,
      `ID: ${mission.id}`,
      `Status: ${mission.status} | Progress: ${progress.done}/${progress.total} (${progress.percentage}%)`,
      '═'.repeat(60),
    ];
  }
  
  private renderProgressCharts(mission: MissionState): string[] {
    const lines: string[] = [];
    const progress = this.calculateProgress(mission);
    
    // Overall progress bar
    lines.push('📊 Overall Progress');
    lines.push(`  ${this.generateProgressBar(progress.done, progress.total, 40)}`);
    lines.push('');
    
    // Per-milestone progress
    lines.push('📦 Milestones:');
    for (const milestone of mission.milestones) {
      const mProgress = this.calculateMilestoneProgress(milestone);
      const icon = milestone.status === 'complete' ? '✅' : 
                   milestone.status === 'active' ? '🔄' : '⏳';
      
      lines.push(`  ${icon} ${milestone.title}`);
      lines.push(`     ${this.generateProgressBar(mProgress.done, mProgress.total, 25)} ${mProgress.done}/${mProgress.total}`);
    }
    
    return lines;
  }
  
  private renderMilestoneDetails(mission: MissionState): string[] {
    const lines: string[] = [];
    
    lines.push('📋 Milestone Details');
    lines.push('─'.repeat(40));
    
    for (const milestone of mission.milestones) {
      const features = milestone.features;
      const completed = features.filter(f => f.status === 'done').length;
      const active = features.filter(f => f.status === 'active').length;
      const blocked = features.filter(f => f.status === 'blocked').length;
      const pending = features.filter(f => f.status === 'pending').length;
      
      lines.push('');
      lines.push(`${this.getMilestoneIcon(milestone.status)} ${milestone.id}: ${milestone.title}`);
      lines.push(`  ✅ ${completed} done | 🔄 ${active} active | ⏸️ ${blocked} blocked | ⏳ ${pending} pending`);
      
      // Show active features
      const activeFeatures = features.filter(f => f.status === 'active');
      for (const feature of activeFeatures) {
        lines.push(`    ➡️ ${feature.id}: ${feature.title}`);
      }
    }
    
    return lines;
  }
  
  private renderFeatureTimeline(mission: MissionState): string[] {
    const lines: string[] = [];
    
    lines.push('⏱️ Feature Timeline');
    lines.push('─'.repeat(40));
    
    const allFeatures = mission.milestones.flatMap(m => m.features);
    const completedFeatures = allFeatures
      .filter(f => f.status === 'done' && f.completedAt)
      .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
      .slice(0, 5);
    
    if (completedFeatures.length === 0) {
      lines.push('  No completed features yet');
      return lines;
    }
    
    for (const feature of completedFeatures) {
      const duration = feature.completedAt && feature.startedAt 
        ? feature.completedAt - feature.startedAt 
        : 0;
      
      lines.push(`  ✅ ${feature.id}: ${feature.title}`);
      lines.push(`     Duration: ${this.formatDuration(duration)} | Tools: ${feature.toolCallCount}`);
    }
    
    return lines;
  }
  
  private renderTokenUsage(mission: MissionState): string[] {
    const lines: string[] = [];
    
    lines.push('📝 Token Usage');
    lines.push('─'.repeat(40));
    
    const allFeatures = mission.milestones.flatMap(m => m.features);
    const totalTokens = allFeatures.reduce((sum, f) => sum + (f.tokensUsed || 0), 0);
    const avgTokens = allFeatures.length > 0 ? totalTokens / allFeatures.length : 0;
    
    lines.push(`  Total: ${totalTokens.toLocaleString()} tokens`);
    lines.push(`  Average per feature: ${Math.round(avgTokens).toLocaleString()} tokens`);
    
    // Top token consumers
    const topConsumers = [...allFeatures]
      .sort((a, b) => (b.tokensUsed || 0) - (a.tokensUsed || 0))
      .slice(0, 3);
    
    if (topConsumers.length > 0 && topConsumers[0].tokensUsed) {
      lines.push('');
      lines.push('  Top consumers:');
      for (const feature of topConsumers) {
        if (feature.tokensUsed) {
          lines.push(`    • ${feature.id}: ${feature.tokensUsed.toLocaleString()} tokens`);
        }
      }
    }
    
    return lines;
  }
  
  private renderRecommendations(mission: MissionState): string[] {
    const lines: string[] = [];
    const recommendations = this.generateMissionRecommendations(mission);
    
    if (recommendations.length === 0) return lines;
    
    lines.push('💡 Recommendations');
    lines.push('─'.repeat(40));
    
    for (const rec of recommendations) {
      lines.push(`  ${rec.icon} ${rec.message}`);
    }
    
    return lines;
  }
  
  private renderSummaryCards(analytics: MissionAnalytics): string[] {
    const lines: string[] = [];
    
    lines.push('┌─────────────────┬─────────────────┬─────────────────┐');
    lines.push('│   Total         │   Active        │   Completed     │');
    lines.push(`│   ${analytics.totalMissions.toString().padEnd(13)} │   ${analytics.activeMissions.toString().padEnd(13)} │   ${analytics.completedMissions.toString().padEnd(13)} │`);
    lines.push('├─────────────────┼─────────────────┼─────────────────┤');
    lines.push('│   Success Rate  │   Avg Duration  │   Avg Tokens    │');
    lines.push(`│   ${(analytics.successRate * 100).toFixed(1).padEnd(12)}% │   ${this.formatDuration(analytics.avgDurationMs).padEnd(13)} │   ${analytics.avgTokensPerMission.toLocaleString().padEnd(13)} │`);
    lines.push('└─────────────────┴─────────────────┴─────────────────┘');
    
    return lines;
  }
  
  private renderSuccessRateChart(analytics: MissionAnalytics): string[] {
    const lines: string[] = [];
    
    lines.push('📈 Success Rate');
    lines.push(this.generateProgressBar(analytics.completedMissions, analytics.totalMissions, 40));
    lines.push(`  ${analytics.completedMissions} of ${analytics.totalMissions} missions completed successfully`);
    
    return lines;
  }
  
  private renderTopBlockers(blockers: { blocker: string; count: number }[]): string[] {
    const lines: string[] = [];
    
    lines.push('🚫 Top Blockers');
    lines.push('─'.repeat(40));
    
    for (const { blocker, count } of blockers.slice(0, 5)) {
      lines.push(`  • ${blocker} (${count} occurrences)`);
    }
    
    return lines;
  }
  
  private renderRecentActivity(activity: ActivityEntry[]): string[] {
    const lines: string[] = [];
    
    lines.push('🕐 Recent Activity');
    lines.push('─'.repeat(40));
    
    for (const entry of activity.slice(0, 5)) {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      lines.push(`  ${time} [${entry.missionTitle}] ${entry.event}`);
    }
    
    return lines;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // Helper methods
  // ═══════════════════════════════════════════════════════════════════════════
  
  private calculateProgress(mission: MissionState): { done: number; total: number; percentage: number } {
    const allFeatures = mission.milestones.flatMap(m => m.features);
    const done = allFeatures.filter(f => f.status === 'done').length;
    const total = allFeatures.length;
    const percentage = total > 0 ? Math.round((done / total) * 100) : 0;
    
    return { done, total, percentage };
  }
  
  private calculateMilestoneProgress(milestone: Milestone): { done: number; total: number } {
    const done = milestone.features.filter(f => f.status === 'done').length;
    return { done, total: milestone.features.length };
  }
  
  private getStatusIcon(status: string): string {
    switch (status) {
      case 'active': return '🎯';
      case 'complete': return '✅';
      case 'paused': return '⏸️';
      case 'blocked': return '🚫';
      case 'budget_limited': return '⚠️';
      default: return '📋';
    }
  }
  
  private getMilestoneIcon(status: string): string {
    switch (status) {
      case 'complete': return '✅';
      case 'active': return '🔄';
      default: return '⏳';
    }
  }
  
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
    return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
  }
  
  private percentage(value: number, total: number): string {
    if (total === 0) return '0%';
    return `${Math.round((value / total) * 100)}%`;
  }
  
  private generateMissionRecommendations(mission: MissionState): { icon: string; message: string }[] {
    const recommendations: { icon: string; message: string }[] = [];
    const allFeatures = mission.milestones.flatMap(m => m.features);
    
    // Check for blocked features
    const blocked = allFeatures.filter(f => f.status === 'blocked');
    if (blocked.length > 0) {
      recommendations.push({
        icon: '🔓',
        message: `${blocked.length} features are blocked. Consider addressing blockers first.`,
      });
    }
    
    // Check for high-priority pending features
    const highPriorityPending = allFeatures.filter(f => 
      f.status === 'pending' && f.priority <= 2
    );
    if (highPriorityPending.length > 0) {
      recommendations.push({
        icon: '⚡',
        message: `${highPriorityPending.length} high-priority features pending.`,
      });
    }
    
    // Check for long-running features
    const activeFeatures = allFeatures.filter(f => f.status === 'active');
    for (const feature of activeFeatures) {
      if (feature.startedAt) {
        const duration = Date.now() - feature.startedAt;
        if (duration > 3600000) { // > 1 hour
          recommendations.push({
            icon: '⏰',
            message: `Feature ${feature.id} has been active for ${this.formatDuration(duration)}.`,
          });
        }
      }
    }
    
    // Check token usage
    const totalTokens = allFeatures.reduce((sum, f) => sum + (f.tokensUsed || 0), 0);
    if (totalTokens > 100000) {
      recommendations.push({
        icon: '💰',
        message: `High token usage: ${totalTokens.toLocaleString()} tokens used.`,
      });
    }
    
    return recommendations;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Factory function
// ═══════════════════════════════════════════════════════════════════════════

export function createAnalyticsDashboard(config?: Partial<DashboardConfig>): AnalyticsDashboard {
  return new AnalyticsDashboard(config);
}
