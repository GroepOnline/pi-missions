import { describe, test } from "vitest";
import {
  cloneFeatureForFork,
  missionSummaryForTree,
  saveSessionLink,
} from "../src/commands/index.js";
import { exportMarkdown } from "../src/utils/markdown.js";
import { createMission } from "../src/core/state.js";
import type { RuntimeState } from "../src/core/types.js";

function createLargeMission(): import("../src/core/types.js").MissionState {
  const m = createMission("Command Benchmark", "Testing command helpers");
  const ms = m.milestones[0];
  for (let i = 3; i < 20; i++) {
    ms.features.push({
      id: `F${String(i + 1).padStart(3, "0")}`,
      milestoneId: ms.id,
      title: `Feature ${i + 1}: Performance optimization`,
      description: `Description for feature ${i + 1}`,
      priority: (i % 5) + 1,
      dependsOn: i > 3 ? [`F${String(i).padStart(3, "0")}`] : [],
      acceptance: [
        { id: `AC${i}-0`, description: "Verify correctness", checkType: "manual", verified: false },
      ],
      status: i % 3 === 0 ? "done" : i % 3 === 1 ? "active" : "pending",
      sessions: [],
      toolCallCount: i % 3 === 1 ? i * 5 : 0,
      completedAt: i % 3 === 0 ? Date.now() - i * 60000 : undefined,
    });
  }
  return m;
}

const emptyRuntime: RuntimeState = {
  activeMission: null,
  autoSaveInterval: null,
  phaseToolCallCount: 0,
  currentPhase: "execution",
  lastFeatureId: undefined,
};

describe("command helpers", () => {
  const m = createLargeMission();

  test("cloneFeatureForFork", async ({ bench }) => {
    await bench("cloneFeatureForFork", () => {
      const f = m.milestones[0].features[0]!;
      cloneFeatureForFork(f, `${f.id}-fork-1`, `${f.title} [fork]`, "Alternative approach");
    }).run();
  });

  test("missionSummaryForTree (active mission + feature)", async ({ bench }) => {
    await bench("missionSummaryForTree (active mission + feature)", () => {
      const rt: RuntimeState = { ...emptyRuntime, activeMission: m };
      missionSummaryForTree(rt);
    }).run();
  });

  test("missionSummaryForTree (no mission)", async ({ bench }) => {
    await bench("missionSummaryForTree (no mission)", () => {
      missionSummaryForTree(emptyRuntime);
    }).run();
  });

  test("saveSessionLink (no mission)", async ({ bench }) => {
    await bench("saveSessionLink (no mission)", () => {
      saveSessionLink(emptyRuntime, "/tmp/session.jsonl");
    }).run();
  });

  test("exportMarkdown (large mission)", async ({ bench }) => {
    await bench("exportMarkdown (large mission)", () => {
      exportMarkdown(m);
    }).run();
  });
});
