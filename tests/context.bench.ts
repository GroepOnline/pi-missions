import { bench, describe } from "vitest";
import { createMission } from "../src/state.js";
import {
  buildMissionContext,
  buildCompactionSummary,
  completionSignal,
  featureSummary,
} from "../src/context.js";
import type { Feature, MissionState } from "../src/types.js";
import * as crypto from "node:crypto";

function makeFeature(
  id: string,
  milestoneId: string,
  overrides: Partial<Feature> = {},
): Feature {
  return {
    id,
    milestoneId,
    title: `Feature ${id}`,
    description: `Description for ${id}`,
    priority: 1,
    dependsOn: [],
    acceptance: [
      {
        id: `acc-${id}-0`,
        description: "Verify correctness",
        checkType: "manual" as const,
        verified: false,
      },
    ],
    status: "pending" as const,
    sessions: [],
    toolCallCount: 0,
    ...overrides,
  };
}

function createLargeMission(): MissionState {
  const m = createMission(
    "Context Benchmark",
    "Benchmark context generation with realistic data",
  );
  // createMission gives 1 milestone with 2 features + 4ms × 4feat = 18 features total
  for (let mi = 0; mi < 4; mi++) {
    const msId = crypto.randomUUID();
    const features = Array.from({ length: 4 }, (_, fi) =>
      makeFeature(`feat-${mi}-${fi}`, msId, {
        title: `Feature ${mi}.${fi}: Context window optimization`,
        description: `Performance of context generation for feature ${mi}.${fi}`,
        dependsOn: fi > 0 ? [`feat-${mi}-${fi - 1}`] : [],
        toolCallCount: 0,
      }),
    );
    m.milestones.push({
      id: msId,
      title: `Context Milestone ${mi}`,
      description: `Testing context generation at scale`,
      features,
      status: mi <= 1 ? "active" : ("pending" as const),
      dependsOn: mi > 0 ? [m.milestones[mi - 1].id] : [],
    });
  }

  m.milestones[0].features[0].status = "done";
  m.milestones[0].features[0].completedAt = Date.now() - 3600000;
  m.milestones[0].features[0].notes = "Context generation returns valid output";
  m.milestones[0].features[1].status = "done";
  m.milestones[0].features[1].completedAt = Date.now() - 1800000;
  m.milestones[0].features[1].notes = "Compaction summary reduces token usage";
  m.milestones[1].features[0].status = "active";
  m.milestones[1].features[0].toolCallCount = 120;
  m.milestones[1].features[1].status = "active";
  m.milestones[1].features[1].toolCallCount = 45;
  m.tokensUsed = 45000;
  m.status = "active";
  return m;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Context generation benchmarks
// ═══════════════════════════════════════════════════════════════════════════════

describe("context generation", () => {
  const m = createLargeMission();

  bench("buildMissionContext (18 features, 5 milestones)", () => {
    buildMissionContext(m);
  });

  bench("buildCompactionSummary (18 features)", () => {
    buildCompactionSummary(m);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Context scaling benchmarks (tiny → medium → large)
// ═══════════════════════════════════════════════════════════════════════════════

describe("context scaling", () => {
  const tiny = createMission("Tiny", "small"); // Default: 2 features in 1 milestone

  const medium = (() => {
    const m = createMission("Medium", "testing");
    const msId = m.milestones[0].id;
    m.milestones[0].features.push(
      ...Array.from({ length: 7 }, (_, i) =>
        makeFeature(`f-med-${i}`, msId, {
          title: `Scaled feature ${i + 3}`,
          description: "Scaling test",
          toolCallCount: 0,
        }),
      ),
    );
    return m;
  })();

  bench("buildMissionContext (tiny: 2 features)", () => {
    buildMissionContext(tiny);
  });

  bench("buildMissionContext (medium: 9 features)", () => {
    buildMissionContext(medium);
  });

  bench("buildCompactionSummary (tiny)", () => {
    buildCompactionSummary(tiny);
  });

  bench("buildCompactionSummary (medium)", () => {
    buildCompactionSummary(medium);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Signal detection benchmarks
// ═══════════════════════════════════════════════════════════════════════════════

describe("completion signal detection", () => {
  const positiveShort =
    "The implementation of feature X is done and all tests pass.";
  const positiveLong =
    "We have completed the authentication module. All unit tests pass, " +
    "integration tests are green, and the feature is ready for review. " +
    "The code has been reviewed by the team and all comments addressed. " +
    "This completes the requirements specified in the original issue. " +
    "Additional edge cases have been handled and documented. " +
    "The feature is complete. ".repeat(5);
  const negative = "Working on implementing the database migration scripts";

  bench("completionSignal (short, positive)", () => {
    completionSignal(positiveShort);
  });

  bench("completionSignal (long, positive)", () => {
    completionSignal(positiveLong);
  });

  bench("completionSignal (negative, no match)", () => {
    completionSignal(negative);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Feature summary benchmarks
// ═══════════════════════════════════════════════════════════════════════════════

describe("feature summary", () => {
  const m = createLargeMission();
  const features = m.milestones.flatMap((ms) => ms.features);

  bench("featureSummary (18 features sequential)", () => {
    for (const f of features) {
      featureSummary(f);
    }
  });
});
