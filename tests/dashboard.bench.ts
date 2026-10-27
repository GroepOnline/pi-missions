import { describe, test } from "vitest";
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

function createOverlay(m: MissionState): any {
  return missionControlOverlay(m, () => {})({
    hideOverlay: () => {},
    requestRender: () => {},
  } as any);
}

describe("dashboard helpers", () => {
  const m = createLargeMission();

  test("featureLabel (done feature)", async ({ bench }) => {
    await bench("featureLabel (done feature)", () => {
      featureLabel(m.milestones[0].features[0]!);
    }).run();
  });

  test("featureLabel (active feature)", async ({ bench }) => {
    await bench("featureLabel (active feature)", () => {
      featureLabel(m.milestones[0].features[1]!);
    }).run();
  });

  test("featureLabel (blocked feature)", async ({ bench }) => {
    await bench("featureLabel (blocked feature)", () => {
      featureLabel(m.milestones[0].features[2]!);
    }).run();
  });

  test("buildFeatureItems (15 features)", async ({ bench }) => {
    await bench("buildFeatureItems (15 features)", () => {
      buildFeatureItems(m);
    }).run();
  });

  test("featureDetailLines (active feature with deps)", async ({ bench }) => {
    await bench("featureDetailLines (active feature with deps)", () => {
      featureDetailLines(m.milestones[0].features[1]!, 80);
    }).run();
  });

  test("featureDetailLines (done feature with notes)", async ({ bench }) => {
    await bench("featureDetailLines (done feature with notes)", () => {
      featureDetailLines(m.milestones[0].features[0]!, 80);
    }).run();
  });
});

describe("mission control overlay", () => {
  const m = createLargeMission();

  test("missionControlOverlay render (15 features, 80 cols)", async ({ bench }) => {
    await bench("missionControlOverlay render (15 features, 80 cols)", () => {
      createOverlay(m).render(80);
    }).run();
  });

  test("missionControlOverlay render (15 features, 120 cols)", async ({ bench }) => {
    await bench("missionControlOverlay render (15 features, 120 cols)", () => {
      createOverlay(m).render(120);
    }).run();
  });

  test("missionControlOverlay handleInput navigation", async ({ bench }) => {
    await bench("missionControlOverlay handleInput navigation", () => {
      const comp: any = createOverlay(m);
      for (let i = 0; i < 10; i++) {
        comp.handleInput("\x1b[B"); // down arrow
      }
      for (let i = 0; i < 5; i++) {
        comp.handleInput("\x1b[A"); // up arrow
      }
    }).run();
  });
});
