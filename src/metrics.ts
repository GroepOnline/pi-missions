/**
 * Metrics and observability utilities.
 * Tracks mission success rates and performance metrics.
 */

export interface MissionMetrics {
  missionId: string;
  created: number;
  completed?: number;
  totalFeatures: number;
  featuresDone: number;
  featuresFailed: number;
  totalTokensUsed: number;
  totalWallClockMs: number;
  acceptanceFailures: number;
  evidenceHashErrors: number;
}

export interface MetricsSummary {
  totalMissions: number;
  completedMissions: number;
  successRate: number;
  averageTokensPerMission: number;
  averageFeaturesPerMission: number;
  averageCompletionTimeMs: number;
}

export class MetricsCollector {
  private metrics: Map<string, MissionMetrics> = new Map();
  
  /**
   * Record metrics for a mission.
   * @param metrics - The mission metrics to record
   */
  recordMetrics(metrics: MissionMetrics): void {
    this.metrics.set(metrics.missionId, metrics);
  }
  
  /**
   * Get metrics for a specific mission.
   * @param missionId - The mission ID
   * @returns MissionMetrics or undefined if not found
   */
  getMetrics(missionId: string): MissionMetrics | undefined {
    return this.metrics.get(missionId);
  }
  
  /**
   * Get all recorded metrics.
   * @returns Array of all mission metrics
   */
  getAllMetrics(): MissionMetrics[] {
    return Array.from(this.metrics.values());
  }
  
  /**
   * Calculate summary statistics across all missions.
   * @returns MetricsSummary with aggregated statistics
   */
  getSummary(): MetricsSummary {
    const allMetrics = this.getAllMetrics();
    
    if (allMetrics.length === 0) {
      return {
        totalMissions: 0,
        completedMissions: 0,
        successRate: 0,
        averageTokensPerMission: 0,
        averageFeaturesPerMission: 0,
        averageCompletionTimeMs: 0,
      };
    }
    
    const completedMissions = allMetrics.filter(m => m.completed !== undefined);
    const totalTokens = allMetrics.reduce((sum, m) => sum + m.totalTokensUsed, 0);
    const totalFeatures = allMetrics.reduce((sum, m) => sum + m.totalFeatures, 0);
    const totalCompletionTime = completedMissions.reduce((sum, m) => {
      if (m.completed) {
        return sum + (m.completed - m.created);
      }
      return sum;
    }, 0);
    
    return {
      totalMissions: allMetrics.length,
      completedMissions: completedMissions.length,
      successRate: completedMissions.length / allMetrics.length,
      averageTokensPerMission: totalTokens / allMetrics.length,
      averageFeaturesPerMission: totalFeatures / allMetrics.length,
      averageCompletionTimeMs: completedMissions.length > 0 
        ? totalCompletionTime / completedMissions.length 
        : 0,
    };
  }
  
  /**
   * Clear all recorded metrics.
   */
  clear(): void {
    this.metrics.clear();
  }
  
  /**
   * Get metrics as JSON for export.
   * @returns JSON string of all metrics
   */
  toJSON(): string {
    return JSON.stringify(this.getAllMetrics(), null, 2);
  }
}

/**
 * Global metrics collector instance.
 */
export const metricsCollector = new MetricsCollector();

/**
 * Record metrics for a mission using the global collector.
 * @param metrics - The mission metrics to record
 */
export function recordMetrics(metrics: MissionMetrics): void {
  metricsCollector.recordMetrics(metrics);
}

/**
 * Get metrics summary using the global collector.
 * @returns MetricsSummary with aggregated statistics
 */
export function getMetricsSummary(): MetricsSummary {
  return metricsCollector.getSummary();
}

/**
 * Calculate success rate for completed missions.
 * @returns Success rate (0-1)
 */
export function getSuccessRate(): number {
  return metricsCollector.getSummary().successRate;
}

/**
 * Get average token usage per mission.
 * @returns Average tokens used
 */
export function getAverageTokensPerMission(): number {
  return metricsCollector.getSummary().averageTokensPerMission;
}