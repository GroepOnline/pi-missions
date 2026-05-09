import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

export const SCHEMA_VERSION = 3;

export const DEFAULT_FEATURE_MAX_WALL_CLOCK_MS = 30 * 60 * 1000; // 30 min
export const DEFAULT_FEATURE_MAX_TOOL_CALLS = 150;
export const STALE_FEATURE_WARN_MS = 20 * 60 * 1000; // 20 min

// ═══════════════════════════════════════════════════════════════════════════
// Literal union types
// ═══════════════════════════════════════════════════════════════════════════

export type MissionStatus =
  | "planning" | "active" | "paused" | "blocked"
  | "complete" | "budget_limited" | "failed";

export type FeatureStatus =
  | "pending" | "waiting" | "active" | "done" | "blocked" | "failed";

export type MilestoneStatus = "pending" | "active" | "complete";

export type CheckType = "manual" | "bash" | "test_file";

export type AutopilotMode = "manual" | "assisted" | "autopilot";

export type StopReason =
  | "mission_complete" | "paused_by_user" | "blocked" | "disabled"
  | "max_iterations" | "max_consecutive_failures" | "context_limit"
  | "no_active_feature" | "needs_user_decision" | "no_progress"
  | "validation_failed" | "error";

export type ToolPhase = "planning" | "execution" | "verification";

export type ErrorCategory =
  | "transient" | "permanent" | "user" | "system"
  | "network" | "permission" | "unknown";

export type ErrorSeverity = "low" | "medium" | "high" | "critical";

export type RecoveryAction =
  | "retry" | "fallback" | "skip" | "block" | "ask_user" | "degrade";

export type CompletionConfidence = "low" | "medium" | "high";

export type AgentSource = "pi" | "devin" | "opencode" | "codex" | "unknown";

// ═══════════════════════════════════════════════════════════════════════════
// Core models
// ═══════════════════════════════════════════════════════════════════════════

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

export interface MissionState {
  schemaVersion: number;
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
  autopilot: MissionAutopilot;
  userPreferences?: { allowBashInPlanning?: boolean };
  createdAt: number;
  updatedAt: number;
}

export interface RuntimeState {
  activeMission: MissionState | null;
  autoSaveInterval: ReturnType<typeof setInterval> | null;
  phaseToolCallCount: number;
  currentPhase: ToolPhase;
  lastFeatureId?: string;
  pendingCompletionAction?: "auto_done" | "suggest_done" | "continue" | "ask_user";
  pendingCompletionReason?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// History, metrics, evidence
// ═══════════════════════════════════════════════════════════════════════════

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

export interface SessionMetrics {
  sessionId: string;
  startTime: number;
  endTime?: number;
  toolCalls: { total: number; byTool: Record<string, number>; successful: number; failed: number };
  tokensUsed: number;
  featuresCompleted: number;
  errors: { total: number; byCategory: Record<string, number> };
  autoAdvanceCount: number;
  stuckDetectionCount: number;
}

export interface StaleFeatureAlert {
  featureId: string;
  title: string;
  activeMs: number;
  maxMs: number;
  warnMs: number;
  toolCallsUsed: number;
  maxToolCalls: number;
  level: "warn" | "critical";
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool policy
// ═══════════════════════════════════════════════════════════════════════════

export interface ToolPolicy {
  phase: ToolPhase;
  allowedTools: string[];
  maxToolCalls: number;
}

export const TOOL_POLICIES: Record<ToolPhase, ToolPolicy> = {
  planning: {
    phase: "planning",
    allowedTools: [
      "read", "grep", "find", "ls",
      "mission_next_feature", "mission_feature_done", "mission_ask_user",
      "mission_block_self", "mission_fork",
      "mission_error_status", "mission_retry_error",
    ],
    maxToolCalls: 30,
  },
  execution: {
    phase: "execution",
    allowedTools: [
      "read", "write", "edit", "bash", "grep", "find", "ls",
      "mission_next_feature", "mission_feature_done", "mission_ask_user",
      "mission_block_self", "mission_fork",
      "mission_error_status", "mission_retry_error",
    ],
    maxToolCalls: 120,
  },
  verification: {
    phase: "verification",
    allowedTools: [
      "read", "bash", "grep", "find", "ls",
      "mission_next_feature", "mission_feature_done", "mission_ask_user",
      "mission_block_self", "mission_fork",
      "mission_error_status", "mission_retry_error",
    ],
    maxToolCalls: 60,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Error recovery types
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// Completion detection types
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// Tool event types
// ═══════════════════════════════════════════════════════════════════════════

export interface ToolCallEvent {
  toolName: string;
  toolCallId?: string;
  input?: Record<string, unknown>;
}

export interface ToolResultEvent {
  toolName: string;
  toolCallId?: string;
  input?: Record<string, unknown>;
  content?: Array<{ type?: string; text?: string }>;
  details?: unknown;
  isError: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Transition result types
// ═══════════════════════════════════════════════════════════════════════════

export interface CompleteFeatureOptions {
  evidence: string;
  notes?: string;
  autoVerify?: boolean;
  markAcceptanceVerified?: boolean;
  historyNote?: string;
  historyDetails?: Record<string, unknown>;
}

export type CompleteFeatureResult =
  | { ok: true; feature: Feature; evidenceFile: string; missionComplete: boolean }
  | { ok: false; reason: string; unverifiedBashCount?: number };

export type ActivateNextResult =
  | { ok: true; next: Feature }
  | { ok: false; reason: "active_not_done"; active: Feature }
  | { ok: false; reason: "mission_complete" }
  | { ok: false; reason: "no_unblocked_pending" };

// ═══════════════════════════════════════════════════════════════════════════
// Fork helper types
// ═══════════════════════════════════════════════════════════════════════════

export interface ForkSessionManager {
  getLeafId?: () => string | null;
  getSessionFile?: () => string | undefined;
}

export interface ForkReplacementContext {
  sessionManager?: ForkSessionManager;
  sendUserMessage?: (message: string) => Promise<unknown>;
  ui: { notify: (message: string, severity: string) => void };
}

export interface ContinuationDecision {
  continue: boolean;
  reason?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Active mission session entry
// ═══════════════════════════════════════════════════════════════════════════

export interface ActiveMissionSessionEntry {
  missionId: string;
  validationToken?: string;
}

export type ActiveMissionSessionEntryResult =
  | { kind: "none" }
  | { kind: "valid"; entry: ActiveMissionSessionEntry }
  | { kind: "invalid"; reason: string; data: unknown };

// ═══════════════════════════════════════════════════════════════════════════
// Mission context session manager
// ═══════════════════════════════════════════════════════════════════════════

export interface MissionContextSessionManager {
  appendCustomMessageEntry?: (
    customType: string,
    content: string,
    display: boolean,
    details?: Record<string, unknown>,
  ) => string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Degraded result for graceful fallbacks
// ═══════════════════════════════════════════════════════════════════════════

export interface DegradedResult<T> {
  ok: boolean;
  value: T | undefined;
  degraded: boolean;
  error?: unknown;
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterFactor?: number;
  shouldRetry?: (error: unknown) => boolean;
  operationName?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// TypeBox Schemas — for validation and wizard output
// ═══════════════════════════════════════════════════════════════════════════

export const CriterionSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 50 }),
  description: Type.String({ minLength: 1, maxLength: 500 }),
  checkType: Type.Union([Type.Literal("manual"), Type.Literal("bash"), Type.Literal("test_file")]),
  checkCommand: Type.Optional(Type.String({ maxLength: 1000 })),
  evidence: Type.Optional(Type.String()),
  verified: Type.Boolean(),
  waived: Type.Optional(Type.Boolean()),
});

export const FeatureSchema = Type.Object({
  id: Type.String({ pattern: "^F[0-9]{3}$" }),
  milestoneId: Type.String({ pattern: "^M[0-9]{2}$" }),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.String({ minLength: 1, maxLength: 2000 }),
  priority: Type.Integer({ minimum: 1, maximum: 5 }),
  dependsOn: Type.Array(Type.String({ pattern: "^F[0-9]{3}$" })),
  acceptance: Type.Array(CriterionSchema, { minItems: 1 }),
  status: Type.Union([
    Type.Literal("pending"), Type.Literal("waiting"), Type.Literal("active"),
    Type.Literal("done"), Type.Literal("blocked"), Type.Literal("failed"),
  ]),
  sessions: Type.Array(Type.String()),
  toolCallCount: Type.Integer({ minimum: 0 }),
  startedAt: Type.Optional(Type.Integer()),
  completedAt: Type.Optional(Type.Integer()),
  maxWallClockMs: Type.Optional(Type.Integer({ minimum: 0 })),
  maxToolCalls: Type.Optional(Type.Integer({ minimum: 0 })),
  notes: Type.Optional(Type.String({ maxLength: 1000 })),
});

export const MilestoneSchema = Type.Object({
  id: Type.String({ pattern: "^M[0-9]{2}$" }),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.String({ maxLength: 1000 }),
  status: Type.Union([Type.Literal("pending"), Type.Literal("active"), Type.Literal("complete")]),
  features: Type.Array(FeatureSchema, { minItems: 1 }),
  dependsOn: Type.Optional(Type.Array(Type.String({ pattern: "^M[0-9]{2}$" }))),
});

export const WizardCriterionSchema = Type.Object({
  id: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
  description: Type.String({ minLength: 1, maxLength: 500 }),
  checkType: Type.Union([Type.Literal("manual"), Type.Literal("bash"), Type.Literal("test_file")]),
  checkCommand: Type.Optional(Type.String({ maxLength: 1000 })),
}, { additionalProperties: false });

export const WizardFeatureSchema = Type.Object({
  id: Type.Optional(Type.String({ pattern: "^F[0-9]{3}$" })),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.String({ minLength: 1, maxLength: 2000 }),
  priority: Type.Integer({ minimum: 1, maximum: 5 }),
  dependsOn: Type.Array(Type.String({ pattern: "^F[0-9]{3}$" })),
  acceptance: Type.Array(WizardCriterionSchema, { minItems: 1 }),
}, { additionalProperties: false });

export const WizardMilestoneSchema = Type.Object({
  id: Type.Optional(Type.String({ pattern: "^M[0-9]{2}$" })),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.String({ maxLength: 1000 }),
  features: Type.Array(WizardFeatureSchema, { minItems: 1 }),
}, { additionalProperties: false });

export const WizardOutputSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }),
  milestones: Type.Array(WizardMilestoneSchema, { minItems: 2, maxItems: 20 }),
}, { additionalProperties: false });

// Schema-derived static types
export type AcceptanceCriterionValidated = Static<typeof CriterionSchema>;
export type FeatureValidated = Static<typeof FeatureSchema>;
export type MilestoneValidated = Static<typeof MilestoneSchema>;
export type WizardOutput = Static<typeof WizardOutputSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// Validation utilities
// ═══════════════════════════════════════════════════════════════════════════

export interface ValidationError {
  path: string;
  message: string;
  value: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export function validate<T extends TSchema>(schema: T, value: unknown): ValidationResult {
  try {
    if (Value.Check(schema, value)) return { valid: true, errors: [] };
    const errors: ValidationError[] = [];
    for (const error of Value.Errors(schema, value)) {
      errors.push({ path: error.path, message: error.message, value: error.value });
    }
    return { valid: false, errors };
  } catch (e) {
    return {
      valid: false,
      errors: [{ path: "root", message: e instanceof Error ? e.message : String(e), value }],
    };
  }
}

export function formatValidationErrors(errors: ValidationError[]): string {
  if (errors.length === 0) return "";
  const lines = ["Validation errors:"];
  for (const e of errors.slice(0, 10)) {
    lines.push(`  - ${e.path}: ${e.message}`);
    if (e.value !== undefined) lines.push(`    (value: ${JSON.stringify(e.value).slice(0, 50)})`);
  }
  if (errors.length > 10) lines.push(`  ... and ${errors.length - 10} more errors`);
  return lines.join("\n");
}
