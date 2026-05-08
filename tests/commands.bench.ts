import { bench, describe } from "vitest";
import {
  cloneFeatureForFork,
  missionSummaryForTree,
  saveSessionLink,
} from "../src/commands.js";
import { createMission, exportMarkdown } from "../src/state.js";
import type { RuntimeState } from "../src/types.js";

function createLargeMission(): import("../src/types.js").MissionState {
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

describe("command helpers", () => {
  const m = createLargeMission();

  bench("cloneFeatureForFork", () => {
    const f = m.milestones[0].features[0]!;
    cloneFeatureForFork(f, `${f.id}-fork-1`, `${f.title} [fork]`, "Alternative approach");
  });

  bench("missionSummaryForTree (active mission + feature)", () => {
    const rt: RuntimeState = { activeMission: m, autoSaveInterval: null };
    missionSummaryForTree(rt);
  });

  bench("missionSummaryForTree (no mission)", () => {
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    missionSummaryForTree(rt);
  });

  bench("saveSessionLink (no mission)", () => {
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    saveSessionLink(rt, "/tmp/session.jsonl");
  });

  bench("exportMarkdown (large mission)", () => {
    exportMarkdown(m);
  });
});


