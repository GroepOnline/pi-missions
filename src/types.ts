export const CURRENT_SCHEMA_VERSION = 3;

export type MissionStatus = "planning" | "active" | "paused" | "blocked" | "complete" | "budget_limited" | "failed";
export type FeatureStatus = "pending" | "waiting" | "active" | "done" | "blocked" | "failed";
export type GoalNodeStatus = "pending" | "active" | "done" | "blocked" | "failed";
export type GoalNodeKind = "mission" | "milestone" | "feature";

export type AutopilotMode = "manual" | "assisted" | "autopilot";

export type StopReason =
  | "mission_complete"
  | "paused_by_user"
  | "blocked"
  | "disabled"
  | "max_iterations"
  | "max_consecutive_failures"
  | "context_limit"
  | "no_active_feature"
  | "needs_user_decision"
  | "no_progress"
  | "validation_failed"
  | "error";

export interface MissionAutopilot {
  enabled: boolean;
  mode: AutopilotMode;
  iteration: number;
  maxIterations: number;
  consecutiveFailures: number;
  maxConsecutiveFailures: number;
  noProgressTurns: number;
  maxNoProgressTurns: number;
  maxContextPercent: number;
  startedAt: string;
  lastContinuationAt?: string;
  lastStopReason?: StopReason;
  lastStopMessage?: string;
  continueAcrossFeatures: boolean;
  requireEvidenceForDone: boolean;
}

export const DEFAULT_AUTOPILOT: MissionAutopilot = {
  enabled: false,
  mode: "manual",
  iteration: 0,
  maxIterations: 25,
  consecutiveFailures: 0,
  maxConsecutiveFailures: 3,
  noProgressTurns: 0,
  maxNoProgressTurns: 3,
  maxContextPercent: 85,
  startedAt: "",
  continueAcrossFeatures: true,
  requireEvidenceForDone: true,
};
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
  /** Runtime-injected executor for bash acceptance checks */
  _execFn?: (command: string) => { code: number; stdout: string; stderr?: string };
}

export interface Milestone {
  id: string;
  title: string;
  description: string;
  status: MilestoneStatus;
  features: Feature[];
  dependsOn?: string[];
}

export interface GoalNode {
  id: string;
  kind: GoalNodeKind;
  title: string;
  description: string;
  status: GoalNodeStatus;
  children: GoalNode[];
  milestoneId?: string;
  featureId?: string;
}

export interface MissionGoal {
  version: 1;
  root: GoalNode;
}

export interface MissionState {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  id: string;
  title: string;
  goal: string;
  goalTree?: MissionGoal;
  status: MissionStatus;
  milestones: Milestone[];
  activeMilestoneId?: string;
  activeFeatureId?: string;
  tokensBudget?: number;
  tokensUsed: number;
  lastContextTokens: number;
  validationToken: string;
  autopilot: MissionAutopilot;
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
  /** Per-turn tool call counter, reset each agent start. */
  phaseToolCallCount: number;
  /** Current tool phase, recomputed per tool call. */
  currentPhase: ToolPhase;
  /** Last active feature id, to detect feature switches. */
  lastFeatureId?: string;
  /** Completion detection action to inject on next agent start. Reset after injection. */
  pendingCompletionAction?: "auto_done" | "suggest_done" | "continue" | "ask_user";
  /** Reason for the pending completion action, injected into model context. */
  pendingCompletionReason?: string;
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
