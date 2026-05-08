import { Type, Static, TSchema } from "@sinclair/typebox";

/**
 * TypeBox schemas for mission data validation.
 * Provides runtime type checking for user-provided JSON input.
 */

// String enums
const MissionStatus = Type.Union([
  Type.Literal("planning"),
  Type.Literal("active"),
  Type.Literal("paused"),
  Type.Literal("complete"),
  Type.Literal("budget_limited"),
  Type.Literal("failed"),
]);

const FeatureStatus = Type.Union([
  Type.Literal("pending"),
  Type.Literal("active"),
  Type.Literal("done"),
  Type.Literal("blocked"),
  Type.Literal("failed"),
]);

const MilestoneStatus = Type.Union([
  Type.Literal("pending"),
  Type.Literal("active"),
  Type.Literal("complete"),
]);

const CheckType = Type.Union([
  Type.Literal("manual"),
  Type.Literal("bash"),
  Type.Literal("test_file"),
]);

// Core schemas
export const AcceptanceCriterionSchema = Type.Object({
  id: Type.String(),
  description: Type.String(),
  checkType: CheckType,
  checkCommand: Type.Optional(Type.String()),
  evidence: Type.Optional(Type.String()),
  verified: Type.Boolean(),
  waived: Type.Optional(Type.Boolean()),
});

export const FeatureSchema = Type.Object({
  id: Type.String(),
  milestoneId: Type.String(),
  title: Type.String(),
  description: Type.String(),
  priority: Type.Number(),
  dependsOn: Type.Array(Type.String()),
  acceptance: Type.Array(AcceptanceCriterionSchema),
  status: FeatureStatus,
  sessions: Type.Array(Type.String()),
  completedAt: Type.Optional(Type.Number()),
  startedAt: Type.Optional(Type.Number()),
  maxWallClockMs: Type.Optional(Type.Number()),
  maxToolCalls: Type.Optional(Type.Number()),
  toolCallCount: Type.Number(),
  notes: Type.Optional(Type.String()),
});

export const MilestoneSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  description: Type.String(),
  status: MilestoneStatus,
  features: Type.Array(FeatureSchema),
  dependsOn: Type.Optional(Type.Array(Type.String())),
});

export const MissionStateSchema = Type.Object({
  schemaVersion: Type.Number(),
  id: Type.String(),
  title: Type.String(),
  goal: Type.String(),
  status: MissionStatus,
  milestones: Type.Array(MilestoneSchema),
  activeMilestoneId: Type.Optional(Type.String()),
  activeFeatureId: Type.Optional(Type.String()),
  tokensBudget: Type.Optional(Type.Number()),
  tokensUsed: Type.Number(),
  lastContextTokens: Type.Number(),
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
});

export const MissionHistoryEntrySchema = Type.Object({
  ts: Type.Number(),
  missionId: Type.String(),
  event: Type.String(),
  milestoneId: Type.Optional(Type.String()),
  featureId: Type.Optional(Type.String()),
  note: Type.Optional(Type.String()),
  duration_ms: Type.Optional(Type.Number()),
  tokensUsed: Type.Optional(Type.Number()),
  details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

// Export TypeScript types from schemas
export type AcceptanceCriterion = Static<typeof AcceptanceCriterionSchema>;
export type Feature = Static<typeof FeatureSchema>;
export type Milestone = Static<typeof MilestoneSchema>;
export type MissionState = Static<typeof MissionStateSchema>;
export type MissionHistoryEntry = Static<typeof MissionHistoryEntrySchema>;
