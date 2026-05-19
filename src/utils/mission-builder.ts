// Shim: mission-builder for backward compat with old tests
import type { Milestone, MissionState } from "../core/types.js";
import { missionFromWizardOutput as v2Wizard } from "./markdown.js";

// ── Goal tree types ──────────────────────────────────────────────────────

export interface GoalTreeNode {
  id: string;
  label: string;
  children: GoalTreeNode[];
  status: string;
  root: GoalTreeNode;
}

export function buildMissionGoalTree(title: string, goal: string, milestones: Milestone[]): GoalTreeNode {
  const children = milestones.map((m) => ({
    id: m.id,
    label: m.title,
    status: m.status,
    children: m.features.map((f) => ({
      id: f.id,
      label: f.title,
      status: f.status,
      children: [] as GoalTreeNode[],
      root: {} as GoalTreeNode,
    })),
    root: {} as GoalTreeNode,
  }));

  const tree: GoalTreeNode = {
    id: "root",
    label: title,
    status: "active",
    children,
    root: {} as GoalTreeNode,
  };
  tree.root = tree;
  // Fix root references in children
  for (const mc of tree.children) {
    mc.root = tree;
    for (const fc of mc.children) fc.root = tree;
  }
  return tree;
}

export function getMissionGoalTree(mission: MissionState): GoalTreeNode {
  if (mission.goalTree) {
    // Refresh stale goalTree: rebuild from current mission state
    const fresh = buildMissionGoalTree(mission.title, mission.goal, mission.milestones);
    mission.goalTree = fresh;
    return fresh;
  }
  const tree = buildMissionGoalTree(mission.title, mission.goal, mission.milestones);
  mission.goalTree = tree;
  return tree;
}

export function goalTreeProgress(tree: GoalTreeNode): { done: number; total: number; pct: number } {
  if (!tree) return { done: 0, total: 0, pct: 0 };
  function count(n: GoalTreeNode): [number, number] {
    if (!n || !n.children || !n.children.length) return [n.status === "done" ? 1 : 0, 1];
    const results = n.children.map(count);
    return [results.reduce((s, r) => s + r[0], 0), results.reduce((s, r) => s + r[1], 0)];
  }
  const [done, total] = count(tree);
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function renderGoalTree(tree: GoalTreeNode, maxNodes?: number): string {
  const lines: string[] = [];
  let count = 0;

  function walk(node: GoalTreeNode, indent: number): void {
    if (maxNodes !== undefined && count >= maxNodes) {
      if (count === maxNodes) lines.push("  …");
      count++;
      return;
    }
    const prefix = "  ".repeat(indent);
    const icon = node.status === "done" ? "✅" : node.status === "active" ? "➡️" : "•";
    lines.push(`${prefix}${icon} ${node.label}`);
    count++;
    for (const child of node.children) walk(child, indent + 1);
  }

  walk(tree, 0);
  return lines.join("\n");
}

// ── Wizard output ────────────────────────────────────────────────────────

export function missionFromWizardOutput(
  wizardOutput: {
    title: string;
    milestones: Array<{
      id: string;
      title: string;
      description: string;
      features: Array<{
        id: string;
        title: string;
        description: string;
        priority: number;
        dependsOn: string[];
        acceptance: Array<{ id: string; description: string; checkType: string }>;
      }>;
    }>;
  },
  fallbackTitle: string,
  goal: string,
  _mode?: number,
): MissionState | null {
  // Build per-feature ID mapping: reassign all feature IDs sequentially.
  // Use a list of (oldId, newId) pairs to handle duplicate old IDs correctly.
  const mapping: Array<{ oldId: string; newId: string }> = [];
  let counter = 0;
  const normalizedOutput = {
    title: wizardOutput.title,
    milestones: wizardOutput.milestones.map((m) => ({
      ...m,
      features: m.features.map((f) => {
        const newId = `F${String(++counter).padStart(3, "0")}`;
        mapping.push({ oldId: f.id, newId });
        return { ...f, id: newId, dependsOn: [] as string[] };
      }),
    })),
  };

  // Build lookup: oldId → set of newIds (may be multiple if dupes)
  const oldToNewSet = new Map<string, string[]>();
  for (const { oldId, newId } of mapping) {
    const arr = oldToNewSet.get(oldId) || [];
    arr.push(newId);
    oldToNewSet.set(oldId, arr);
  }

  // Also build: newId → original wizard feature index for dep resolution
  const wizardFeatures = wizardOutput.milestones.flatMap((wm, mi) =>
    wm.features.map((wf, fi) => ({ ...wf, _mi: mi, _fi: fi }))
  );

  // Second pass: resolve deps using the mapping
  let mapIdx = 0;
  for (let mi = 0; mi < normalizedOutput.milestones.length; mi++) {
    const m = normalizedOutput.milestones[mi]!;
    for (let fi = 0; fi < m.features.length; fi++) {
      const f = m.features[fi]!;
      mapIdx++;
      const orig = wizardFeatures[mapIdx - 1];
      if (!orig) continue;
      f.dependsOn = (orig.dependsOn ?? [])
        .filter((d: string) => oldToNewSet.has(d))
        .map((d: string) => {
          const candidates = oldToNewSet.get(d)!;
          // Resolve each candidate to its wizard feature via the 1:1 mapping index
          const resolveMilestone = (cid: string): number | undefined => {
            const idx = mapping.findIndex(me => me.newId === cid);
            return idx >= 0 ? wizardFeatures[idx]?._mi : undefined;
          };
          // Prefer candidate in the same original milestone
          const sameMilestone = candidates.find(cid => resolveMilestone(cid) === orig._mi);
          if (sameMilestone) return sameMilestone;
          // Next, prefer earlier milestone candidates (strictly before orig._mi)
          const earlier = candidates.find(cid => {
            const mi = resolveMilestone(cid);
            return mi !== undefined && mi < (orig._mi ?? 99);
          });
          if (earlier) return earlier;
          return candidates[0]!;
        });
    }
  }

  return v2Wizard(normalizedOutput as Parameters<typeof v2Wizard>[0], fallbackTitle, goal);
}

// ── Augment MissionState with goalTree ───────────────────────────────────
declare module "../core/types.js" {
  interface MissionState {
    goalTree?: GoalTreeNode;
  }
}
