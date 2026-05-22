import { describe, expect, it } from "vitest";
import {
  buildMissionGoalTree,
  getMissionGoalTree,
  goalTreeProgress,
  missionFromWizardOutput,
  renderGoalTree,
} from "../src/utils/mission-builder.js";
import { completeActiveFeature } from "../src/core/state.js";
import { createMission } from "../src/core/state.js";

describe("mission builder goal tree", () => {
  it("does not append truncation marker when maxNodes exactly matches tree size", () => {
    const mission = createMission("Tree", "Goal");
    const tree = buildMissionGoalTree(mission.title, mission.goal, mission.milestones);

    expect(renderGoalTree(tree, 5)).not.toContain("  …");
    expect(renderGoalTree(tree, 4)).toContain("  …");
  });

  it("generates a new goal tree when mission.goalTree is undefined", () => {
    const mission = createMission("Tree", "Goal");
    // Ensure goalTree is undefined initially (createMission might not set it, but we delete it to be sure)
    delete mission.goalTree;

    const tree = getMissionGoalTree(mission);

    expect(tree).toBeDefined();
    expect(tree.label).toBe("Tree");
    expect(tree.children.length).toBeGreaterThan(0);
    // The tree root should point to itself
    expect(tree.root).toBe(tree);
  });

  it("refreshes stale goalTree snapshots from current mission state", () => {
    const mission = createMission("Tree", "Goal");
    mission.goalTree = buildMissionGoalTree(mission.title, mission.goal, mission.milestones);
    mission.milestones[0]!.features[0]!.status = "done";

    const refreshed = getMissionGoalTree(mission);
    expect(goalTreeProgress(refreshed)).toEqual({ done: 1, total: 3, pct: 33 });
    expect(refreshed.root.children[0]!.children[0]!.status).toBe("done");
  });

  it("keeps goalTree in sync when completing active features", () => {
    const mission = createMission("Tree", "Goal");
    const result = completeActiveFeature(mission, {
      evidence: "manual evidence",
      markAcceptanceVerified: true,
    });

    expect(result.ok).toBe(true);
    expect(goalTreeProgress(mission.goalTree!)).toEqual({ done: 1, total: 3, pct: 33 });
    expect(mission.goalTree!.root.children[0]!.children[0]!.status).toBe("done");
  });
});

describe("missionFromWizardOutput dependency normalization", () => {
  it("drops dependencies that cannot be safely remapped to generated feature IDs", () => {
    const mission = missionFromWizardOutput({
      title: "Planner Mission",
      milestones: [
        {
          id: "M01",
          title: "Plan",
          description: "Plan the work",
          features: [{
            id: "F001",
            title: "Scope",
            description: "Clarify scope",
            priority: 1,
            dependsOn: ["F999", "not-a-feature"],
            acceptance: [{ id: "AC001", description: "Scope documented", checkType: "manual" }],
          }],
        },
        {
          id: "M02",
          title: "Build",
          description: "Build the work",
          features: [{
            id: "F001",
            title: "Implement",
            description: "Implement change",
            priority: 1,
            dependsOn: ["F001", "F999"],
            acceptance: [{ id: "AC001", description: "Tests pass", checkType: "manual" }],
          }],
        },
      ],
    }, "Fallback", "Goal", 1);

    expect(mission).not.toBeNull();
    expect(mission!.milestones[0]!.features[0]!.dependsOn).toEqual([]);
    expect(mission!.milestones[1]!.features[0]!.dependsOn).toEqual(["F002"]);
  });
});
