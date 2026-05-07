import { describe, expect, it } from "vitest";
import { buildCompactionSummary, buildMissionContext, completionSignal, featureSummary } from "../src/context.js";
import { createMission } from "../src/state.js";
import type { Feature, MissionState } from "../src/types.js";

function missionFixture(overrides: Partial<MissionState> = {}): MissionState {
  return { ...createMission("Test mission", "Achieve something"), ...overrides };
}

function featureFixture(overrides: Partial<Feature> = {}): Feature {
  return {
    id: "F001",
    milestoneId: "M01",
    title: "Test",
    description: "A test feature",
    priority: 1,
    dependsOn: [],
    acceptance: [{ id: "AC001", description: "Works", checkType: "manual", verified: false }],
    status: "active",
    sessions: [],
    toolCallCount: 0,
    ...overrides,
  };
}

describe("buildMissionContext", () => {
  it("includes mission id, goal, progress and status", () => {
    const ctx = buildMissionContext(missionFixture());
    expect(ctx).toContain("## Active Mission: Test mission");
    expect(ctx).toContain("Goal: Achieve something");
    expect(ctx).toContain("Progress: 0/3 features (0%)");
    expect(ctx).toContain("Status: active");
  });

  it("shows active feature details with acceptance criteria", () => {
    const mission = missionFixture();
    const f = mission.milestones[0].features[0];
    f!.title = "Refactor auth";
    f!.description = "Refactor the auth module";
    f!.acceptance = [
      { id: "AC001", description: "Tests pass", checkType: "bash", checkCommand: "npm test", verified: false },
      { id: "AC002", description: "No behavior change", checkType: "manual", verified: true },
    ];
    mission.activeFeatureId = "F001";

    const ctx = buildMissionContext(mission);
    expect(ctx).toContain("### Current Feature: F001 — Refactor auth");
    expect(ctx).toContain("Refactor the auth module");
    expect(ctx).toContain("- [ ] AC001: Tests pass");
    expect(ctx).toContain("- [x] AC002: No behavior change");
  });

  it("shows dependencies on active feature", () => {
    const mission = missionFixture();
    const f = mission.milestones[0].features[0]!;
    f.dependsOn = ["F000"];
    mission.activeFeatureId = "F001";
    expect(buildMissionContext(mission)).toContain("Dependencies: F000");
  });

  it("shows recently completed features (max 5)", () => {
    const mission = missionFixture();
    // Add 6 done features.
    mission.milestones[0].features = Array.from({ length: 6 }, (_, i) => ({
      ...featureFixture({ id: `F${String(i).padStart(3, "0")}`, title: `Feature ${i}`, status: "done" }),
    }));
    mission.activeFeatureId = "F999";
    const ctx = buildMissionContext(mission);
    // Should only show the last 5.
    expect(ctx).toContain("✅ F001: Feature 1");
    expect(ctx).toContain("✅ F005: Feature 5");
    expect(ctx).not.toContain("✅ F000: Feature 0");
  });

  it("shows pending count when there are pending features", () => {
    const mission = missionFixture();
    const ctx = buildMissionContext(mission);
    expect(ctx).toContain("2 pending features omitted");
  });

  it("includes mission rule at the end", () => {
    expect(buildMissionContext(missionFixture())).toContain(
      "Mission rule: work only on the active feature unless the user or /mission next changes it."
    );
  });

  it("handles mission without active feature", () => {
    const mission = missionFixture();
    mission.activeFeatureId = undefined;
    const ctx = buildMissionContext(mission);
    expect(ctx).not.toContain("### Current Feature");
  });
});

describe("buildCompactionSummary", () => {
  it("includes all key fields", () => {
    const summary = buildCompactionSummary(missionFixture());
    expect(summary).toContain("Mission: Test mission");
    expect(summary).toContain("Goal: Achieve something");
    expect(summary).toContain("Status: active");
    expect(summary).toContain("Progress: 0/3 (0%)");
    expect(summary).toContain("Active feature: F001 — Clarify scope and current state");
    expect(summary).toContain("plan.json, history.jsonl, evidence/");
  });

  it("says 'Active feature: none' when no feature is active", () => {
    const summary = buildCompactionSummary(missionFixture({ activeFeatureId: undefined }));
    expect(summary).toContain("Active feature: none");
  });
});

describe("completionSignal", () => {
  it.each([
    ["Task is done", true],
    ["I have completed the implementation", true],
    ["Het is klaar", true],
    ["De feature is voltooid", true],
    ["Tests pass groen", true],
    ["Tests slagen allemaal", true],
    ["geïmplementeerd zonder signaalwoorden", false],
    ["Just getting started", false],
    ["Working on it", false],
    ["In progress", false],
    ["", false],
  ])('"%s" → %s', (text, expected) => {
    expect(completionSignal(text)).toBe(expected);
  });
});

describe("featureSummary", () => {
  it("formats id, status and title", () => {
    expect(featureSummary(featureFixture({ id: "F042", status: "done", title: "Add login" }))).toBe(
      "F042 done Add login"
    );
  });
});
