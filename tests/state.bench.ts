import { bench, describe } from "vitest";
import {
  createMission,
  computeMissionMetrics,
  autoBlockBlockedFeatures,
  autoUnblockResolved,
  detectStaleFeature,
  exportMarkdown,
  buildWorkerPrompt,
  getAllFeatures,
  getActiveFeature,
} from "../src/state.js";
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
  const m = createMission("Benchmark Mission", "A mission with realistic data");
  // First milestone: 5 features (some done, some active)
  m.milestones[0].features = [
    makeFeature("feat-0-0", m.milestones[0].id, {
      status: "done",
      completedAt: Date.now() - 1800000,
      notes: "Unit tests pass",
      toolCallCount: 25,
    }),
    makeFeature("feat-0-1", m.milestones[0].id, {
      status: "done",
      completedAt: Date.now() - 900000,
      notes: "Integration tests pass",
      dependsOn: ["feat-0-0"],
      toolCallCount: 40,
    }),
    makeFeature("feat-0-2", m.milestones[0].id, {
      status: "active",
      dependsOn: ["feat-0-1"],
      toolCallCount: 50,
    }),
    makeFeature("feat-0-3", m.milestones[0].id, {
      status: "pending",
      dependsOn: ["feat-0-2"],
      toolCallCount: 0,
    }),
    makeFeature("feat-0-4", m.milestones[0].id, {
      status: "pending",
      dependsOn: ["feat-0-3"],
      toolCallCount: 0,
    }),
  ];
  // Add 2 more milestones with 5 features each
  for (let mi = 1; mi < 3; mi++) {
    const msId = crypto.randomUUID();
    const features = Array.from({ length: 5 }, (_, fi) =>
      makeFeature(`feat-${mi}-${fi}`, msId, {
        dependsOn: fi > 0 ? [`feat-${mi}-${fi - 1}`] : [],
        toolCallCount: 0,
      }),
    );
    m.milestones.push({
      id: msId,
      title: `Milestone ${mi}`,
      description: `Benchmark milestone ${mi}`,
      features,
      status: "pending" as const,
      dependsOn: mi > 0 ? [m.milestones[mi - 1].id] : [],
    });
  }
  m.milestones[0].status = "active";
  m.tokensUsed = 25000;
  m.status = "active";
  return m;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mission creation & serialization benchmarks
// ═══════════════════════════════════════════════════════════════════════════════

describe("mission creation", () => {
  bench("createMission (small)", () => {
    createMission("Small", "Just a small mission");
  });

  bench("createMission with milestones (large)", () => {
    createLargeMission();
  });

  bench("exportMarkdown (large mission)", () => {
    const m = createLargeMission();
    exportMarkdown(m);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Metrics & analysis benchmarks
// ═══════════════════════════════════════════════════════════════════════════════

describe("mission analysis", () => {
  const m = createLargeMission();

  bench("computeMissionMetrics", () => {
    computeMissionMetrics(m);
  });

  bench("autoBlockBlockedFeatures", () => {
    autoBlockBlockedFeatures(m);
  });

  bench("autoUnblockResolved", () => {
    autoUnblockResolved(m);
  });

  bench("detectStaleFeature (no stale)", () => {
    detectStaleFeature(m, Date.now());
  });

  bench("detectStaleFeature (deep stale)", () => {
    const clone = structuredClone(m);
    const af = getActiveFeature(clone);
    if (af) {
      af.toolCallCount = 999;
      af.startedAt = Date.now() - 3600000 * 24 * 7; // 7 days old
    }
    detectStaleFeature(clone, Date.now());
  });

  bench("getAllFeatures", () => {
    getAllFeatures(m);
  });

  bench("getActiveFeature", () => {
    getActiveFeature(m);
  });

  bench("buildWorkerPrompt", () => {
    const f = getActiveFeature(m);
    if (f) buildWorkerPrompt(m, f);
  });
});
