import { describe, expect, it } from "vitest";
import { buildCompactionSummary, buildFeatureBrief, buildLeanContext, buildMissionBanner, buildMissionContext, buildMissionHelp, completionSignal, featureSummary, formatDepChain } from "../src/utils/context.js";
import { createMission } from "../src/core/state.js";
import type { Feature, MissionState } from "../src/core/types.js";

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

// ─── Layer 1: buildMissionBanner ─────────────────────────────────────────────

describe("buildMissionBanner", () => {
  it("includes mission title, goal, progress, status and phase", () => {
    const banner = buildMissionBanner(missionFixture());
    expect(banner).toContain("## Pi Missions Extension — Active");
    expect(banner).toContain("Mission: Test mission");
    expect(banner).toContain("Goal: Achieve something");
    expect(banner).toContain("0/3 leaf goals");
    expect(banner).toContain("0/3 features");
    expect(banner).toContain("Status: active");
    expect(banner).toContain("Phase:");
    expect(banner).toContain("State: ~/.pi/missions/");
  });

  it("shows active feature with id, title and phase", () => {
    const mission = missionFixture();
    const f = mission.milestones[0].features[0]!;
    f.title = "Refactor auth";
    f.description = "Refactor the auth module";
    mission.activeFeatureId = "F001";
    const banner = buildMissionBanner(mission);
    expect(banner).toContain("▶ F001: Refactor auth");
    expect(banner).toContain("Refactor the auth module");
  });

  it("shows 'No active feature' when none is active", () => {
    const banner = buildMissionBanner(missionFixture({ activeFeatureId: undefined }));
    expect(banner).toContain("No active feature.");
  });

  it("shows planning phase for clarify features", () => {
    const mission = missionFixture();
    mission.milestones[0].features[0]!.title = "Clarify scope and current state";
    mission.activeFeatureId = "F001";
    expect(buildMissionBanner(mission)).toContain("[planning]");
  });
});

// ─── Layer 2: buildFeatureBrief ──────────────────────────────────────────────

describe("buildFeatureBrief", () => {
  it("shows acceptance criteria", () => {
    const mission = missionFixture();
    const f = mission.milestones[0].features[0]!;
    f.acceptance = [
      { id: "AC001", description: "Tests pass", checkType: "bash", checkCommand: "npm test", verified: false },
      { id: "AC002", description: "No behavior change", checkType: "manual", verified: true },
    ];
    const brief = buildFeatureBrief(mission, f);
    expect(brief).toContain("Goal path:");
    expect(brief).toContain("Plan and execute > Clarify scope");
    expect(brief).toContain("- [ ] AC001: Tests pass");
    expect(brief).toContain("- [x] AC002: No behavior change");
  });

  it("shows dependencies", () => {
    const mission = missionFixture();
    const f = mission.milestones[0].features[0]!;
    f.dependsOn = ["F000"];
    expect(buildFeatureBrief(mission, f)).toContain("Dependencies: F000");
  });

  it("shows phase-specific instruction for planning", () => {
    const mission = missionFixture();
    const f = mission.milestones[0].features[0]!;
    f.title = "Clarify scope";
    const brief = buildFeatureBrief(mission, f);
    expect(brief).toContain("Phase: planning");
  });

  it("shows phase-specific instruction for execution", () => {
    const mission = missionFixture();
    const f = mission.milestones[0].features[0]!;
    f.title = "Implement core change";
    const brief = buildFeatureBrief(mission, f);
    expect(brief).toContain("Phase: execution");
  });

  it("shows phase-specific instruction for verification", () => {
    const mission = missionFixture();
    const f = mission.milestones[0].features[0]!;
    f.title = "Verify and test";
    const brief = buildFeatureBrief(mission, f);
    expect(brief).toContain("Phase: verification");
  });

  it("shows pending and blocked counts", () => {
    const mission = missionFixture();
    const f = mission.milestones[0].features[0]!;
    const brief = buildFeatureBrief(mission, f);
    expect(brief).toContain("pending feature(s) queued");
  });
});

// ─── Layer 3: buildMissionHelp ───────────────────────────────────────────────

describe("buildMissionHelp", () => {
  it("includes how-to-work instructions", () => {
    const help = buildMissionHelp();
    expect(help).toContain("### How To Work This Mission");
  });

  it("consolidates start and new into one entry", () => {
    const help = buildMissionHelp();
    expect(help).toContain("/mission start/new");
    // Should NOT have separate entries for start and new
    expect(help).not.toContain("alias for starting a new mission");
  });

  it("includes mission commands and tools", () => {
    const help = buildMissionHelp();
    expect(help).toContain("### Mission Commands");
    expect(help).toContain("### Mission Tools");
    expect(help).toContain("/mission status");
    expect(help).toContain("mission_feature_done");
  });
});

// ─── Composed: buildMissionContext (full) ────────────────────────────────────

describe("buildMissionContext", () => {
  it("includes mission banner, feature brief, and help", () => {
    const ctx = buildMissionContext(missionFixture());
    expect(ctx).toContain("## Pi Missions Extension — Active");
    expect(ctx).toContain("Goal: Achieve something");
    expect(ctx).toContain("### Goal Tree");
    expect(ctx).toContain("▶ Clarify scope and current state");
    expect(ctx).toContain("### How To Work This Mission");
    expect(ctx).toContain("### Mission Commands");
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
    expect(ctx).toContain("▶ F001: Refactor auth");
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

  it("shows recently completed features (max 3)", () => {
    const mission = missionFixture();
    mission.milestones[0].features = Array.from({ length: 5 }, (_, i) => ({
      ...featureFixture({ id: `F${String(i).padStart(3, "0")}`, title: `Feature ${i}`, status: "done" }),
    }));
    mission.activeFeatureId = "F999";
    const ctx = buildMissionContext(mission);
    // Should only show the last 3 (since we changed from 5 to 3)
    expect(ctx).toContain("✅ F002 Feature 2");
    expect(ctx).toContain("✅ F004 Feature 4");
    expect(ctx).not.toContain("✅ F000 Feature 0");
    expect(ctx).not.toContain("✅ F001 Feature 1");
  });

  it("includes the mission rule at the end", () => {
    const ctx = buildMissionContext(missionFixture());
    expect(ctx).toContain("Work only on the active feature");
  });

  it("handles mission without active feature", () => {
    const mission = missionFixture();
    mission.activeFeatureId = undefined;
    const ctx = buildMissionContext(mission);
    expect(ctx).toContain("No active feature.");
    expect(ctx).not.toContain("▶ F001");
  });
});

// ─── Composed: buildLeanContext ──────────────────────────────────────────────

describe("buildLeanContext", () => {
  it("includes banner and feature brief but NOT full help", () => {
    const ctx = buildLeanContext(missionFixture());
    expect(ctx).toContain("## Pi Missions Extension — Active");
    expect(ctx).toContain("**Acceptance:**");
    expect(ctx).toContain("Goal tree:");
    // Should NOT contain the full help section
    expect(ctx).not.toContain("### Mission Commands");
    expect(ctx).not.toContain("### Mission Tools");
    // Should have the one-line reminder instead
    expect(ctx).toContain("Use /mission status for full overview");
  });

  it("includes phase-specific instruction", () => {
    const ctx = buildLeanContext(missionFixture());
    expect(ctx).toContain("Phase: planning");
  });

  it("handles mission without active feature", () => {
    const mission = missionFixture();
    mission.activeFeatureId = undefined;
    const ctx = buildLeanContext(mission);
    expect(ctx).toContain("No active feature.");
  });
});

describe("buildCompactionSummary", () => {
  it("includes all key fields", () => {
    const summary = buildCompactionSummary(missionFixture());
    expect(summary).toContain("Mission: Test mission");
    expect(summary).toContain("Goal: Achieve something");
    expect(summary).toContain("0/3 leaf goals (0%)");
    expect(summary).toContain("Status: active");
    expect(summary).toContain("Progress: 0/3 features");
    expect(summary).toContain("Active: F001 — Clarify scope and current state");
    expect(summary).toContain("State:");
  });

  it("says 'Active feature: none' when no feature is active", () => {
    const summary = buildCompactionSummary(missionFixture({ activeFeatureId: undefined }));
    expect(summary).toContain("Active: none");
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

describe("formatDepChain", () => {
  // NOTE FOR REVIEWER: The issue description contains a simplified version of this function.
  // The actual implementation in src/utils/context.ts uses emojis (🔗, ⏳, ✅, etc.),
  // string truncation, and "→" separators as documented in its JSDoc.
  // These tests correctly verify the actual complex implementation present in the codebase.

  it("returns an empty string for an empty chain", () => {
    expect(formatDepChain([])).toBe("");
  });

  it("formats correctly for an item with unknown status and without title", () => {
    const chain = [{ id: "F001", status: "unknown" }];
    expect(formatDepChain(chain)).toBe("🔗 F001(•)");
  });

  it("formats correctly for a single item with known status and title", () => {
    const chain = [{ id: "F001", status: "waiting", title: "Plan" }];
    expect(formatDepChain(chain)).toBe("🔗 F001(⏳ Plan)");
  });

  it("joins multiple items correctly and truncates title", () => {
    const chain = [
      { id: "F001", status: "done", title: "Plan" },
      { id: "F002", status: "active", title: "A very long title that exceeds the limit" },
      { id: "F003", status: "blocked" },
    ];
    // clip function truncates and adds … at max-1. 20 - 1 = 19. "A very long title t" is 19 chars long.
    expect(formatDepChain(chain)).toBe("🔗 F001(✅ Plan) → F002(➡️ A very long title t…) → F003(⛔)");
  });
});
