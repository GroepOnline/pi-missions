import { describe, expect, it } from "vitest";
import { dashboardRows, statusText, updateFooter } from "../src/ui.js";
import { autoCompleteMilestones, createMission } from "../src/state.js";
import type { MissionState } from "../src/types.js";

function missionFixture(overrides: Partial<MissionState> = {}): MissionState {
  return { ...createMission("My mission", "Improve the codebase"), ...overrides };
}

describe("dashboardRows", () => {
  it("shows mission header with id, status, progress, tokens", () => {
    const rows = dashboardRows(missionFixture({ tokensUsed: 12345 }));
    // New format: rows[1] = "🎯 My mission", rows[2] = progress bar, rows[3] = metadata
    expect(rows.some((r) => r.includes("🎯 My mission") || r.includes("✅ My mission"))).toBe(true);
    expect(rows.some((r) => r.includes("ID:") && r.includes("Status: active") && r.includes("Tokens:"))).toBe(true);
  });

  it("shows milestones and features with status indicators", () => {
    const mission = missionFixture();
    mission.milestones = [
      {
        id: "M01",
        title: "Core",
        description: "Core milestone",
        status: "active",
        features: [
          {
            id: "F001", milestoneId: "M01", title: "Init", description: "", priority: 1,
            dependsOn: [], acceptance: [], status: "done", sessions: [], completedAt: Date.now(), toolCallCount: 0,
          },
          {
            id: "F002", milestoneId: "M01", title: "Build", description: "", priority: 2,
            dependsOn: ["F001"], acceptance: [], status: "active", sessions: [], toolCallCount: 0,
          },
          {
            id: "F003", milestoneId: "M01", title: "Blocked item", description: "", priority: 3,
            dependsOn: [], acceptance: [], status: "blocked", sessions: [], notes: "waiting", toolCallCount: 0,
          },
        ],
      },
    ];

    const rows = dashboardRows(mission);
    // New format: milestone header on its own line, progress bar on next line
    expect(rows.some((r) => r.includes("➡️ M01: Core"))).toBe(true);
    expect(rows.some((r) => r.includes("✅") && r.includes("F001") && r.includes("Init"))).toBe(true);
    expect(rows.some((r) => r.includes("➡️") && r.includes("F002") && r.includes("Build"))).toBe(true);
    expect(rows.some((r) => r.includes("⛔") && r.includes("F003") && r.includes("Blocked item"))).toBe(true);
  });

  it("handles empty mission gracefully", () => {
    const mission = missionFixture();
    mission.milestones = [];
    const rows = dashboardRows(mission);
    expect(rows.length).toBeGreaterThanOrEqual(4);
  });

  it("shows failed feature status", () => {
    const mission = missionFixture();
    mission.milestones = [
      {
        id: "M01", title: "Core", description: "", status: "active",
        features: [
          { id: "F001", milestoneId: "M01", title: "Failed", description: "", priority: 1,
            dependsOn: [], acceptance: [], status: "failed" as const, sessions: [], toolCallCount: 0 },
        ],
      },
    ];
    const rows = dashboardRows(mission);
    expect(rows.some((r) => r.includes("F001") && r.includes("failed"))).toBe(true);
  });

  it("sorts features by status then priority", () => {
    const mission = missionFixture();
    mission.milestones = [
      {
        id: "M01", title: "Core", description: "", status: "active",
        features: [
          { id: "F003", milestoneId: "M01", title: "Low prio done", description: "", priority: 10,
            dependsOn: [], acceptance: [], status: "done" as const, sessions: [], completedAt: Date.now(), toolCallCount: 0 },
          { id: "F001", milestoneId: "M01", title: "Active important", description: "", priority: 1,
            dependsOn: [], acceptance: [], status: "active" as const, sessions: [], toolCallCount: 0 },
          { id: "F002", milestoneId: "M01", title: "Blocked low", description: "", priority: 5,
            dependsOn: [], acceptance: [], status: "blocked" as const, sessions: [], notes: "wait", toolCallCount: 0 },
        ],
      },
    ];
    const rows = dashboardRows(mission);
    // Active should be first, then pending, then blocked, then done
    const featureLines = rows.filter((r) => r.startsWith("       "));
    expect(featureLines[0]).toContain("F001"); // active
    expect(featureLines[1]).toContain("F002"); // blocked
    expect(featureLines[2]).toContain("F003"); // done
  });

  it("shows dependency info in dashboard", () => {
    const mission = missionFixture();
    mission.milestones[0].features[0]!.dependsOn = ["F010", "F020"];
    const rows = dashboardRows(mission);
    expect(rows.some((r) => r.includes("🔗F010,F020") || r.includes("F010") && r.includes("F020"))).toBe(true);
  });

  it("shows complete icon for complete missions", () => {
    const mission = missionFixture({ status: "complete" });
    expect(dashboardRows(mission).some((r) => r.includes("✅ My mission"))).toBe(true);
  });

  it("shows milestone progress counts", () => {
    const mission = missionFixture();
    mission.milestones[0].features[0]!.status = "done";
    mission.milestones[0].features[1]!.status = "done";
    const rows = dashboardRows(mission);
    // New format: milestone title then progress bar on next line
    expect(rows.some((r) => r.includes("➡️ M01: Plan and execute"))).toBe(true);
    expect(rows.some((r) => r.includes("[2/3]") || r.includes("2/3"))).toBe(true);
  });

  it("collapses fully-done milestones", () => {
    const mission = missionFixture();
    mission.milestones[0].features.forEach((f) => { f.status = "done"; });
    mission.milestones[0].status = "complete";
    // Add second incomplete milestone
    mission.milestones.push({
      id: "M02", title: "Second", description: "", status: "active",
      features: [{ id: "F004", milestoneId: "M02", title: "P1", description: "", priority: 1, dependsOn: [], acceptance: [], status: "active", sessions: [], toolCallCount: 0 }],
    });
    const rows = dashboardRows(mission);
    // M01 should be collapsed: single line "✅ M01: ...all X features done"
    expect(rows.some((r) => r.includes("all 3 features done") && r.includes("M01"))).toBe(true);
    // M02 should NOT be collapsed
    expect(rows.some((r) => r.includes("➡️ M02: Second"))).toBe(true);
  });

  it("active feature shows acceptance criteria details", () => {
    const mission = missionFixture();
    mission.milestones[0].features[0]!.acceptance = [
      { id: "AC001", description: "Tests pass", checkType: "manual", verified: false },
      { id: "AC002", description: "Builds clean", checkType: "bash", checkCommand: "npm run build", verified: false },
    ];
    const rows = dashboardRows(mission);
    // Active feature should expand with acceptance criteria
    expect(rows.some((r) => r.includes("AC001") && r.includes("Tests pass"))).toBe(true);
    expect(rows.some((r) => r.includes("npm run build"))).toBe(true);
  });

  it("milestone auto-complete reflected in dashboard", () => {
    const mission = missionFixture();
    mission.milestones[0].features[0]!.status = "done";
    mission.milestones[0].features[1]!.status = "done";
    mission.milestones[0].features[2]!.status = "done";
    autoCompleteMilestones(mission);
    expect(mission.milestones[0].status).toBe("complete");
    const rows = dashboardRows(mission);
    expect(rows.some((r) => r.includes("✅ M01: Plan and execute") && r.includes("all 3 features done"))).toBe(true);
  });
});

describe("statusText", () => {
  it("lists all features with status markers", () => {
    const mission = missionFixture();
    const text = statusText(mission);
    expect(text).toContain("🎯 Mission: My mission");
    expect(text).toContain("ID:");
    expect(text).toContain("Status: active");
    expect(text).toContain("Progress: 0/3 (0%)");
    expect(text).toContain("➡️");
    expect(text).toContain("F001:");
    expect(text).toContain("F002:");
    expect(text).toContain("F003:");
  });

  it("shows 'Active: none' when no feature is active", () => {
    const text = statusText(missionFixture({ activeFeatureId: undefined }));
    expect(text).toContain("Active: none");
  });

  it("shows done features with checkmark", () => {
    const mission = missionFixture();
    mission.milestones[0].features[0]!.status = "done";
    expect(statusText(mission)).toContain("✅ F001:");
  });

  it("shows milestone hierarchy", () => {
    const mission = missionFixture();
    expect(statusText(mission)).toContain("M01");
    expect(statusText(mission)).toContain("[0/3]");
  });

  it("shows blocked feature reason", () => {
    const mission = missionFixture();
    mission.milestones[0].features[0]!.status = "blocked";
    mission.milestones[0].features[0]!.notes = "Waiting for API key";
    expect(statusText(mission)).toContain("⛔");
    expect(statusText(mission)).toContain("Waiting for API key");
  });
});

describe("updateFooter", () => {
  it("clears status when no mission", () => {
    const calls: any[] = [];
    const ctx = { ui: { setStatus: (key: string, text: string) => { calls.push({ key, text }); } } };
    updateFooter(ctx as any, null);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.key).toBe("pi-mission");
    expect(calls[0]!.text).toBe("");
  });

  it("shows active mission with progress", () => {
    const calls: any[] = [];
    const ctx = { ui: { setStatus: (key: string, text: string) => { calls.push({ key, text }); } } };
    const m = missionFixture();
    updateFooter(ctx as any, m);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.key).toBe("pi-mission");
    expect(calls[0]!.text).toContain(m.title);
    expect(calls[0]!.text).toContain("[0/3 0%]");
  });

  it("shows paused icon for paused mission", () => {
    const calls: any[] = [];
    const ctx = { ui: { setStatus: (key: string, text: string) => { calls.push({ key, text }); } } };
    const m = missionFixture();
    m.status = "paused";
    updateFooter(ctx as any, m);
    expect(calls[0]!.text).toContain("⏸");
  });

  it("shows budget warning icon", () => {
    const calls: any[] = [];
    const ctx = { ui: { setStatus: (key: string, text: string) => { calls.push({ key, text }); } } };
    const m = missionFixture();
    m.status = "budget_limited";
    updateFooter(ctx as any, m);
    expect(calls[0]!.text).toContain("⚠️");
  });

  it("shows complete icon", () => {
    const calls: any[] = [];
    const ctx = { ui: { setStatus: (key: string, text: string) => { calls.push({ key, text }); } } };
    const m = missionFixture();
    m.status = "complete";
    updateFooter(ctx as any, m);
    expect(calls[0]!.text).toContain("✅");
  });

  it("includes active feature title when available", () => {
    const calls: any[] = [];
    const ctx = { ui: { setStatus: (key: string, text: string) => { calls.push({ key, text }); } } };
    const m = missionFixture();
    m.milestones[0].features[0]!.title = "Build features";
    updateFooter(ctx as any, m);
    expect(calls[0]!.text).toContain("Build features");
    m.activeFeatureId = undefined;
    calls.length = 0;
    updateFooter(ctx as any, m);
    expect(calls[0]!.text).not.toContain("—");
  });
});
