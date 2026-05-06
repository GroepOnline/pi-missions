export const CURRENT_SCHEMA_VERSION = 2;

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
  createdAt: number;
  updatedAt: number;
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
