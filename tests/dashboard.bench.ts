import { bench, describe } from "vitest";
import {
  featureLabel,
  buildFeatureItems,
  featureDetailLines,
  missionControlOverlay,
} from "../src/ui/dashboard.js";
import { createMission } from "../src/core/state.js";
import type { MissionState } from "../src/core/types.js";

function createLargeMission(): MissionState {
  const m = createMission("Dashboard Benchmark", "Testing dashboard performance");
  // Add features with varied states
  const ms = m.milestones[0];
  ms.features[0]!.status = "done";
  ms.features[0]!.completedAt = Date.now() - 1800000;
  ms.features[0]!.notes = "Completed successfully with all tests passing";
  ms.features[1]!.status = "active";
  ms.features[1]!.startedAt = Date.now() - 600000;
  ms.features[1]!.toolCallCount = 75;
  ms.features[1]!.dependsOn = ["F001"];
  ms.features[2]!.status = "blocked";
  ms.features[2]!.notes = "Blocked: waiting on F002";

  // Add more features for scale
  for (let i = 3; i < 15; i++) {
    ms.features.push({
      id: `F${String(i + 1).padStart(3, "0")}`,
      milestoneId: ms.id,
      title: `Feature ${i + 1}: Complex dashboard rendering`,
      description: `Description for feature ${i + 1} with detailed information about implementation requirements and acceptance criteria`,
      priority: (i % 5) + 1,
      dependsOn: i > 3 ? [`F${String(i).padStart(3, "0")}`] : [],
      acceptance: [
        { id: `AC${i}-0`, description: "Verify correctness", checkType: "manual", verified: false },
        { id: `AC${i}-1`, description: "Performance meets threshold", checkType: "bash", verified: false },
      ],
      status: i % 3 === 0 ? "done" : i % 3 === 1 ? "active" : "pending",
      sessions: [],
      toolCallCount: i % 3 === 1 ? i * 5 : 0,
      completedAt: i % 3 === 0 ? Date.now() - i * 60000 : undefined,
      startedAt: i % 3 === 1 ? Date.now() - i * 30000 : undefined,
    });
  }
  return m;
}

describe("dashboard helpers", () => {
  const m = createLargeMission();

  bench("featureLabel (done feature)", () => {
    featureLabel(m.milestones[0].features[0]!);
  });

  bench("featureLabel (active feature)", () => {
    featureLabel(m.milestones[0].features[1]!);
  });

  bench("featureLabel (blocked feature)", () => {
    featureLabel(m.milestones[0].features[2]!);
  });

  bench("buildFeatureItems (15 features)", () => {
    buildFeatureItems(m);
  });

  bench("featureDetailLines (active feature with deps)", () => {
    featureDetailLines(m.milestones[0].features[1]!, 80);
  });

  bench("featureDetailLines (done feature with notes)", () => {
    featureDetailLines(m.milestones[0].features[0]!, 80);
  });
});

describe("mission control overlay", () => {
  const m = createLargeMission();

  bench("missionControlOverlay render (15 features, 80 cols)", () => {
    const comp: any = missionControlOverlay(m, () => {})({ hideOverlay: () => {}, requestRender: () => {} } as any);
    comp.render(80);
  });

  bench("missionControlOverlay render (15 features, 120 cols)", () => {
    const comp: any = missionControlOverlay(m, () => {})({ hideOverlay: () => {}, requestRender: () => {} } as any);
    comp.render(120);
  });

  bench("missionControlOverlay handleInput navigation", () => {
    const comp: any = missionControlOverlay(m, () => {})({ hideOverlay: () => {}, requestRender: () => {} } as any);
    for (let i = 0; i < 10; i++) {
      comp.handleInput("\x1b[B"); // down arrow
    }
    for (let i = 0; i < 5; i++) {
      comp.handleInput("\x1b[A"); // up arrow
    }
  });
});
