import { Type, Static, TSchema } from "@sinclair/typebox";

// Acceptance Criterion Schema
export const AcceptanceCriterionSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 50 }),
  description: Type.String({ minLength: 1, maxLength: 500 }),
  checkType: Type.Union([Type.Literal("manual"), Type.Literal("bash"), Type.Literal("test_file")]),
  checkCommand: Type.Optional(Type.String({ maxLength: 1000 })),
  evidence: Type.Optional(Type.String()),
  verified: Type.Boolean(),
  waived: Type.Optional(Type.Boolean()),
});

export const WizardAcceptanceCriterionSchema = Type.Object({
  id: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
  description: Type.String({ minLength: 1, maxLength: 500 }),
  checkType: Type.Union([Type.Literal("manual"), Type.Literal("bash"), Type.Literal("test_file")]),
  checkCommand: Type.Optional(Type.String({ maxLength: 1000 })),
}, { additionalProperties: false });

// Feature Schema
export const FeatureSchema = Type.Object({
  id: Type.String({ pattern: "^F[0-9]{3}$" }),
  milestoneId: Type.String({ pattern: "^M[0-9]{2}$" }),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.String({ minLength: 1, maxLength: 2000 }),
  priority: Type.Integer({ minimum: 1, maximum: 5 }),
  dependsOn: Type.Array(Type.String({ pattern: "^F[0-9]{3}$" })),
  acceptance: Type.Array(AcceptanceCriterionSchema, { minItems: 1 }),
  status: Type.Union([
    Type.Literal("pending"),
    Type.Literal("waiting"),
    Type.Literal("active"),
    Type.Literal("done"),
    Type.Literal("blocked"),
    Type.Literal("failed"),
  ]),
  sessions: Type.Array(Type.String()),
  toolCallCount: Type.Integer({ minimum: 0 }),
  startedAt: Type.Optional(Type.Integer()),
  completedAt: Type.Optional(Type.Integer()),
  maxWallClockMs: Type.Optional(Type.Integer({ minimum: 0 })),
  maxToolCalls: Type.Optional(Type.Integer({ minimum: 0 })),
  notes: Type.Optional(Type.String({ maxLength: 1000 })),
});

// Milestone Schema
export const MilestoneSchema = Type.Object({
  id: Type.String({ pattern: "^M[0-9]{2}$" }),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.String({ maxLength: 1000 }),
  status: Type.Union([Type.Literal("pending"), Type.Literal("active"), Type.Literal("complete")]),
  features: Type.Array(FeatureSchema, { minItems: 1 }),
  dependsOn: Type.Optional(Type.Array(Type.String({ pattern: "^M[0-9]{2}$" }))),
});

export const WizardFeatureSchema = Type.Object({
  id: Type.Optional(Type.String({ pattern: "^F[0-9]{3}$" })),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.String({ minLength: 1, maxLength: 2000 }),
  priority: Type.Integer({ minimum: 1, maximum: 5 }),
  dependsOn: Type.Array(Type.String({ pattern: "^F[0-9]{3}$" })),
  acceptance: Type.Array(WizardAcceptanceCriterionSchema, { minItems: 1 }),
}, { additionalProperties: false });

export const WizardMilestoneSchema = Type.Object({
  id: Type.Optional(Type.String({ pattern: "^M[0-9]{2}$" })),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.String({ maxLength: 1000 }),
  features: Type.Array(WizardFeatureSchema, { minItems: 1 }),
}, { additionalProperties: false });

// Wizard Output Schema
export const WizardOutputSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }),
  milestones: Type.Array(WizardMilestoneSchema, { minItems: 2, maxItems: 20 }),
}, { additionalProperties: false });

// Export types
export type AcceptanceCriterion = Static<typeof AcceptanceCriterionSchema>;
export type Feature = Static<typeof FeatureSchema>;
export type Milestone = Static<typeof MilestoneSchema>;
export type WizardOutput = Static<typeof WizardOutputSchema>;
