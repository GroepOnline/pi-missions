import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_AUTOPILOT,
  type AcceptanceCriterion,
  type CheckType,
  type Feature,
  type FeatureStatus,
  type GoalNode,
  type GoalNodeStatus,
  type Milestone,
  type MissionGoal,
  type MissionState,
} from "./types.js";
import { createMissionId, createValidationToken, slugify } from "./state.js";

type RawAcceptance = Partial<AcceptanceCriterion> & {
  checkType?: string;
};

type RawFeature = {
  id?: string;
  milestoneId?: string;
  title?: string;
  description?: string;
  priority?: number;
  dependsOn?: unknown;
  acceptance?: RawAcceptance[];
};

type RawMilestone = {
  id?: string;
  title?: string;
  description?: string;
  dependsOn?: string[];
  features?: RawFeature[];
};

export interface RawWizardMission {
  title?: string;
  milestones?: RawMilestone[];
}

const CHECK_TYPES = new Set<CheckType>(["manual", "bash", "test_file"]);
const FEATURE_ID_PATTERN = /^F\d{3}$/;

function missionBase(title: string, goal: string, now: number): Omit<MissionState, "milestones" | "activeMilestoneId" | "activeFeatureId"> {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: createMissionId(title, now),
    title,
    goal,
    status: "active",
    tokensUsed: 0,
    lastContextTokens: 0,
    validationToken: createValidationToken(),
    autopilot: { ...DEFAULT_AUTOPILOT, startedAt: new Date(now).toISOString() },
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeCheckType(value: unknown): CheckType {
  return typeof value === "string" && CHECK_TYPES.has(value as CheckType) ? value as CheckType : "manual";
}

function normalizeAcceptance(raw: RawAcceptance[] | undefined): AcceptanceCriterion[] {
  const source: RawAcceptance[] = raw?.length ? raw : [{ description: "Evidence confirms this feature is complete.", checkType: "manual" }];
  return source.map((ac, index) => {
    const checkType = normalizeCheckType(ac.checkType);
    return {
      id: ac.id && /^AC\d{3}$/.test(ac.id) ? ac.id : `AC${String(index + 1).padStart(3, "0")}`,
      description: ac.description?.trim() || "Evidence confirms this feature is complete.",
      checkType,
      checkCommand: checkType === "bash" || checkType === "test_file" ? ac.checkCommand : undefined,
      verified: false,
    };
  });
}

function normalizePriority(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.min(5, Math.round(value)))
    : 3;
}

function remapDependsOn(dependsOn: unknown, localFeatureIdMap: Map<string, string>, uniqueFeatureIdMap: Map<string, string>): string[] {
  if (!Array.isArray(dependsOn)) return [];
  return dependsOn
    .filter((id): id is string => typeof id === "string")
    .flatMap((id) => {
      const remapped = localFeatureIdMap.get(id) ?? uniqueFeatureIdMap.get(id);
      return remapped ? [remapped] : [];
    })
    .filter((id, index, all) => FEATURE_ID_PATTERN.test(id) && all.indexOf(id) === index);
}

function featureStatusToGoalStatus(status: FeatureStatus): GoalNodeStatus {
  switch (status) {
    case "done":
      return "done";
    case "active":
      return "active";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "pending":
    case "waiting":
    default:
      return "pending";
  }
}

function aggregateGoalStatus(children: GoalNode[]): GoalNodeStatus {
  if (!children.length) return "pending";
  if (children.every((child) => child.status === "done")) return "done";
  if (children.some((child) => child.status === "active")) return "active";
  if (children.some((child) => child.status === "failed")) return "failed";
  if (children.some((child) => child.status === "blocked")) return "blocked";
  return "pending";
}

export function buildMissionGoalTree(title: string, goal: string, milestones: Milestone[]): MissionGoal {
  const milestoneNodes: GoalNode[] = milestones.map((milestone) => {
    const featureNodes: GoalNode[] = milestone.features.map((feature) => ({
      id: `G-${feature.id}`,
      kind: "feature",
      title: feature.title,
      description: feature.description,
      status: featureStatusToGoalStatus(feature.status),
      children: [],
      milestoneId: milestone.id,
      featureId: feature.id,
    }));

    return {
      id: `G-${milestone.id}`,
      kind: "milestone",
      title: milestone.title,
      description: milestone.description,
      status: aggregateGoalStatus(featureNodes),
      children: featureNodes,
      milestoneId: milestone.id,
    };
  });

  return {
    version: 1,
    root: {
      id: "G-MISSION",
      kind: "mission",
      title,
      description: goal,
      status: aggregateGoalStatus(milestoneNodes),
      children: milestoneNodes,
    },
  };
}

export function refreshMissionGoalTree(mission: MissionState): MissionGoal {
  mission.goalTree = buildMissionGoalTree(mission.title, mission.goal, mission.milestones);
  return mission.goalTree;
}

export function getMissionGoalTree(mission: MissionState): MissionGoal {
  return refreshMissionGoalTree(mission);
}

export function goalTreeProgress(goalTree: MissionGoal): { done: number; total: number; pct: number } {
  const leaves: GoalNode[] = [];
  const stack: GoalNode[] = [goalTree.root];

  while (stack.length) {
    const node = stack.pop()!;
    if (!node.children.length) {
      leaves.push(node);
      continue;
    }
    stack.push(...node.children);
  }

  const total = leaves.length;
  const done = leaves.filter((node) => node.status === "done").length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

function goalStatusIcon(status: GoalNodeStatus): string {
  switch (status) {
    case "done":
      return "✅";
    case "active":
      return "▶";
    case "blocked":
      return "⛔";
    case "failed":
      return "✖";
    case "pending":
    default:
      return "•";
  }
}

export function renderGoalTree(goalTree: MissionGoal, maxNodes = 12): string[] {
  const lines: string[] = [];
  let truncated = false;

  const walk = (node: GoalNode, depth: number): boolean => {
    if (lines.length >= maxNodes) {
      truncated = true;
      return false;
    }
    lines.push(`${"  ".repeat(depth)}${goalStatusIcon(node.status)} ${node.title}`);
    for (const child of node.children) {
      if (!walk(child, depth + 1)) return false;
    }
    return true;
  };

  walk(goalTree.root, 0);
  return truncated ? [...lines, "  …"] : lines;
}

export function findGoalPathByFeatureId(goalTree: MissionGoal, featureId: string): GoalNode[] {
  const path: GoalNode[] = [];

  const walk = (node: GoalNode): boolean => {
    path.push(node);
    if (node.featureId === featureId) return true;
    for (const child of node.children) {
      if (walk(child)) return true;
    }
    path.pop();
    return false;
  };

  return walk(goalTree.root) ? path : [];
}

export function missionFromWizardOutput(raw: RawWizardMission, fallbackTitle: string, goal: string, now = Date.now()): MissionState | null {
  const rawMilestones = raw.milestones?.filter((m) => Array.isArray(m.features) && m.features.length > 0) ?? [];
  if (rawMilestones.length < 2) return null;

  const title = raw.title?.trim() || fallbackTitle || "Untitled mission";
  const localFeatureIdMaps = new Map<number, Map<string, string>>();
  const rawFeatureIdCounts = new Map<string, number>();
  const rawFeatureIdTargets = new Map<string, string>();
  let featureSeq = 1;

  rawMilestones.forEach((milestone, milestoneIndex) => {
    const localMap = new Map<string, string>();
    for (const feature of milestone.features ?? []) {
      const normalizedId = `F${String(featureSeq).padStart(3, "0")}`;
      if (feature.id && FEATURE_ID_PATTERN.test(feature.id)) {
        localMap.set(feature.id, normalizedId);
        rawFeatureIdCounts.set(feature.id, (rawFeatureIdCounts.get(feature.id) ?? 0) + 1);
        rawFeatureIdTargets.set(feature.id, normalizedId);
      }
      featureSeq++;
    }
    localFeatureIdMaps.set(milestoneIndex, localMap);
  });

  const uniqueFeatureIdMap = new Map<string, string>(
    [...rawFeatureIdTargets.entries()].filter(([rawId]) => rawFeatureIdCounts.get(rawId) === 1),
  );

  featureSeq = 1;
  const milestones: Milestone[] = rawMilestones.map((milestone, milestoneIndex) => {
    const milestoneId = /^M\d{2}$/.test(milestone.id ?? "") ? milestone.id! : `M${String(milestoneIndex + 1).padStart(2, "0")}`;
    const features: Feature[] = (milestone.features ?? []).map((feature, featureIndex) => {
      const id = `F${String(featureSeq++).padStart(3, "0")}`;
      return {
        id,
        milestoneId,
        title: feature.title?.trim() || `Feature ${featureIndex + 1}`,
        description: feature.description?.trim() || "Complete this mission feature with evidence.",
        priority: normalizePriority(feature.priority),
        dependsOn: remapDependsOn(feature.dependsOn, localFeatureIdMaps.get(milestoneIndex) ?? new Map(), uniqueFeatureIdMap),
        acceptance: normalizeAcceptance(feature.acceptance),
        status: milestoneIndex === 0 && featureIndex === 0 ? "active" : "pending",
        sessions: [],
        startedAt: milestoneIndex === 0 && featureIndex === 0 ? now : undefined,
        toolCallCount: 0,
      };
    });
    return {
      id: milestoneId,
      title: milestone.title?.trim() || `Milestone ${milestoneIndex + 1}`,
      description: milestone.description?.trim() || "Mission milestone",
      status: milestoneIndex === 0 ? "active" : "pending",
      dependsOn: milestone.dependsOn,
      features,
    };
  });

  return {
    ...missionBase(title, goal, now),
    activeMilestoneId: milestones[0]?.id,
    activeFeatureId: milestones[0]?.features[0]?.id,
    goalTree: buildMissionGoalTree(title, goal, milestones),
    milestones,
  };
}

export function createStructuredMission(title: string, goal: string, constraints = "", now = Date.now()): MissionState {
  const cleanTitle = title || "Untitled mission";
  const domainSlug = slugify(cleanTitle).split("-").slice(0, 4).join(" ") || "mission";
  const milestones: Milestone[] = [
    {
      id: "M01",
      title: "Plan and Mission Contract",
      description: constraints ? `Scope, constraints, and validation contract. Constraints: ${constraints}` : "Scope, constraints, and validation contract.",
      status: "active",
      features: [
        {
          id: "F001",
          milestoneId: "M01",
          title: "Define mission contract",
          description: `Clarify the concrete outcome for ${domainSlug}, identify files/systems in scope, and capture non-goals.`,
          priority: 1,
          dependsOn: [],
          acceptance: [
            { id: "AC001", description: "Scope, constraints, and non-goals are documented in the agent summary.", checkType: "manual", verified: false },
            { id: "AC002", description: "The active validation commands or manual checks are listed.", checkType: "manual", verified: false },
          ],
          status: "active",
          sessions: [],
          startedAt: now,
          toolCallCount: 0,
        },
        {
          id: "F002",
          milestoneId: "M01",
          title: "Map current system",
          description: "Inspect the existing architecture, state files, commands, tests, and known risks before editing.",
          priority: 2,
          dependsOn: ["F001"],
          acceptance: [
            { id: "AC001", description: "Relevant entrypoints and risky dependencies are identified.", checkType: "manual", verified: false },
          ],
          status: "pending",
          sessions: [],
          toolCallCount: 0,
        },
      ],
    },
    {
      id: "M02",
      title: "Execution and Verification",
      description: "Implement the scoped change, validate it, and leave durable handoff evidence.",
      status: "pending",
      features: [
        {
          id: "F003",
          milestoneId: "M02",
          title: "Implement coherent slice",
          description: "Make the smallest cohesive change that satisfies the mission contract and follows local patterns.",
          priority: 1,
          dependsOn: ["F002"],
          acceptance: [
            { id: "AC001", description: "Implementation is complete for the scoped slice.", checkType: "manual", verified: false },
          ],
          status: "pending",
          sessions: [],
          toolCallCount: 0,
        },
        {
          id: "F004",
          milestoneId: "M02",
          title: "Run validation gates",
          description: "Run targeted checks, record exact output, and investigate failures instead of declaring success early.",
          priority: 2,
          dependsOn: ["F003"],
          acceptance: [
            { id: "AC001", description: "Relevant tests or checks have been run and captured as evidence.", checkType: "manual", verified: false },
          ],
          status: "pending",
          sessions: [],
          toolCallCount: 0,
        },
        {
          id: "F005",
          milestoneId: "M02",
          title: "Prepare handoff",
          description: "Summarize changed files, validation evidence, residual risks, and the next best action.",
          priority: 3,
          dependsOn: ["F004"],
          acceptance: [
            { id: "AC001", description: "Final handoff includes deliverables, evidence, and gaps.", checkType: "manual", verified: false },
          ],
          status: "pending",
          sessions: [],
          toolCallCount: 0,
        },
      ],
    },
  ];

  return {
    ...missionBase(cleanTitle, goal, now),
    activeMilestoneId: "M01",
    activeFeatureId: "F001",
    goalTree: buildMissionGoalTree(cleanTitle, goal, milestones),
    milestones,
  };
}
