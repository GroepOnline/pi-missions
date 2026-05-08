export const CURRENT_SCHEMA_VERSION = 3;

export type MissionStatus = "planning" | "active" | "paused" | "complete" | "budget_limited" | "failed";
export type FeatureStatus = "pending" | "active" | "done" | "blocked" | "failed";
export type MilestoneStatus = "pending" | "active" | "complete";
export type CheckType = "manual" | "bash" | "test_file";

export interface AcceptanceCriterion {
  id: string;
  description: string;
  checkType: CheckType;
  checkCommand?: string;
  evidence?: string;
  verified: boolean;
  waived?: boolean;
}

export interface Feature {
  id: string;
  milestoneId: string;
  title: string;
  description: string;
  priority: number;
  dependsOn: string[];
  acceptance: AcceptanceCriterion[];
  status: FeatureStatus;
  sessions: string[];
  completedAt?: number;
  startedAt?: number;
  maxWallClockMs?: number;
  maxToolCalls?: number;
  toolCallCount: number;
  notes?: string;
}

export interface Milestone {
  id: string;
  title: string;
  description: string;
  status: MilestoneStatus;
  features: Feature[];
  dependsOn?: string[];
}

export interface MissionState {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  id: string;
  title: string;
  goal: string;
  status: MissionStatus;
  milestones: Milestone[];
  activeMilestoneId?: string;
  activeFeatureId?: string;
  tokensBudget?: number;
  tokensUsed: number;
  lastContextTokens: number;
  validationToken: string;
  userPreferences?: {
    allowBashInPlanning?: boolean;
  };
  createdAt: number;
  updatedAt: number;
}

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

export interface MissionMetricsSummary {
  totalMissions: number;
  completedMissions: number;
  successRate: number;
  averageTokensPerMission: number;
  averageFeaturesPerMission: number;
  averageCompletionTimeMs: number;
}

// Session-level metrics for terminal/pi session tracking
export interface SessionMetrics {
  sessionId: string;
  startTime: number;
  endTime?: number;
  toolCalls: {
    total: number;
    byTool: Record<string, number>;
    successful: number;
    failed: number;
  };
  tokensUsed: number;
  featuresCompleted: number;
  errors: {
    total: number;
    byCategory: Record<string, number>;
  };
  autoAdvanceCount: number;
  stuckDetectionCount: number;
}

export interface MissionHistoryEntry {
  ts: number;
  missionId: string;
  event: string;
  milestoneId?: string;
  featureId?: string;
  note?: string;
  duration_ms?: number;
  tokensUsed?: number;
  details?: Record<string, unknown>;
}

export interface RuntimeState {
  activeMission: MissionState | null;
  autoSaveInterval: NodeJS.Timeout | null;
}

export type ToolPhase = "planning" | "execution" | "verification";

export interface ToolPolicy {
  phase: ToolPhase;
  allowedTools: string[];
  maxToolCalls: number;
}

export const TOOL_POLICIES: Record<ToolPhase, ToolPolicy> = {
  planning: { phase: "planning", allowedTools: ["read", "grep", "find", "ls", "mission_next_feature", "mission_feature_done", "mission_ask_user", "mission_block_self", "mission_fork", "mission_error_status", "mission_retry_error"], maxToolCalls: 30 },
  execution: { phase: "execution", allowedTools: ["read", "write", "edit", "bash", "grep", "find", "ls", "mission_next_feature", "mission_feature_done", "mission_ask_user", "mission_block_self", "mission_fork", "mission_error_status", "mission_retry_error"], maxToolCalls: 120 },
  verification: { phase: "verification", allowedTools: ["read", "bash", "grep", "find", "ls", "mission_next_feature", "mission_feature_done", "mission_ask_user", "mission_block_self", "mission_fork", "mission_error_status", "mission_retry_error"], maxToolCalls: 60 },
};

export const DEFAULT_FEATURE_MAX_WALL_CLOCK_MS = 30 * 60 * 1000; // 30 minutes
export const DEFAULT_FEATURE_MAX_TOOL_CALLS = 150;
export const STALE_FEATURE_WARN_CLOCK_MS = 20 * 60 * 1000; // 20 min — warn before hard limit

// ---------------------------------------------------------------------------
// Error Recovery Types
// ---------------------------------------------------------------------------

export type ErrorCategory = "transient" | "permanent" | "user" | "system" | "network" | "permission" | "unknown";
export type ErrorSeverity = "low" | "medium" | "high" | "critical";
export type RecoveryAction = "retry" | "fallback" | "skip" | "block" | "ask_user" | "degrade";

export interface ErrorContext {
  toolName?: string;
  featureId?: string;
  missionId?: string;
  timestamp: number;
  errorType: string;
  errorMessage: string;
  stackTrace?: string;
}

export interface ErrorRecoveryStrategy {
  category: ErrorCategory;
  maxRetries: number;
  backoffMs: number;
  fallbackAction?: RecoveryAction;
  degradeAction?: () => void;
}

export interface ErrorRecord {
  id: string;
  context: ErrorContext;
  category: ErrorCategory;
  severity: ErrorSeverity;
  retryCount: number;
  actionTaken: RecoveryAction;
  resolved: boolean;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Completion Detection Engine Types
// ---------------------------------------------------------------------------

export type CompletionConfidence = "low" | "medium" | "high";

export interface CompletionSignal {
  type: "keyword" | "acceptance" | "tool_pattern" | "error_free_streak" | "user_confirmation";
  confidence: CompletionConfidence;
  evidence: string;
  timestamp: number;
}

export interface CompletionDetectionResult {
  isComplete: boolean;
  confidence: CompletionConfidence;
  signals: CompletionSignal[];
  suggestedAction: "auto_done" | "suggest_done" | "continue" | "ask_user";
  reason: string;
}
