import { describe, expect, it } from "vitest";
import {
  buildFeatureItems,
  featureDescription,
  featureDetailLines,
  featureLabel,
  missionControlOverlay,
} from "../src/dashboard.js";
import { createMission } from "../src/state.js";
import type { Feature } from "../src/types.js";

// ── featureLabel ──────────────────────────────────────────────────────────────

describe("featureLabel", () => {
  it("formats an active feature with acceptance criteria", () => {
    const f: Feature = {
      id: "F001",
      milestoneId: "M01",
      title: "Build login page",
      description: "Implement the login form",
      priority: 1,
      dependsOn: [],
      acceptance: [
        { id: "AC01", description: "User can log in", checkType: "manual", verified: true },
        { id: "AC02", description: "Error shown on bad pw", checkType: "bash", checkCommand: "curl -s localhost:3000/login", verified: false },
      ],
      status: "active",
      sessions: [],
      toolCallCount: 0,
    };
    const label = featureLabel(f);
    expect(label).toContain("F001");
    expect(label).toContain("[P1]");
    expect(label).toContain("Build login page");
    expect(label).toContain("[1/2 AC]");
    expect(label).toContain("➡️"); // active icon
  });

  it("formats a done feature with all AC verified or waived", () => {
    const f: Feature = {
      id: "F002",
      milestoneId: "M01",
      title: "Dashboard",
      description: "Main dashboard",
      priority: 2,
      dependsOn: [],
      acceptance: [
        { id: "AC01", description: "Renders", checkType: "manual", verified: true },
        { id: "AC02", description: "Responsive", checkType: "manual", verified: false, waived: true },
      ],
      status: "done",
      sessions: [],
      toolCallCount: 0,
    };
    const label = featureLabel(f);
    expect(label).toContain("✅"); // done icon
    expect(label).toContain("[2/2 AC]"); // both verified or waived
  });

  it("formats a blocked feature", () => {
    const f: Feature = {
      id: "F003",
      milestoneId: "M01",
      title: "API integration",
      description: "Integrate with backend",
      priority: 1,
      dependsOn: ["F001"],
      acceptance: [],
      status: "blocked",
      sessions: [],
      toolCallCount: 0,
    };
    const label = featureLabel(f);
    expect(label).toContain("⛔"); // blocked icon
    expect(label).not.toContain("AC"); // no acceptance badge
    expect(label).toContain("API integration");
  });

  it("formats a pending feature with no acceptance criteria", () => {
    const f: Feature = {
      id: "F004",
      milestoneId: "M02",
      title: "Refactor utils",
      description: "Clean up utility functions",
      priority: 3,
      dependsOn: [],
      acceptance: [],
      status: "pending",
      sessions: [],
      toolCallCount: 0,
    };
    const label = featureLabel(f);
    expect(label).toContain("•"); // pending icon
    expect(label).toContain("[P3]");
    expect(label).not.toContain("AC");
  });

  it("formats a failed feature", () => {
    const f: Feature = {
      id: "F005",
      milestoneId: "M01",
      title: "Broken feature",
      description: "It broke",
      priority: 1,
      dependsOn: [],
      acceptance: [],
      status: "failed",
      sessions: [],
      toolCallCount: 0,
    };
    const label = featureLabel(f);
    expect(label).toContain("❌"); // failed icon
  });

  it("falls back to bullet for unknown status", () => {
    const f: Feature = {
      id: "F006",
      milestoneId: "M01",
      title: "Weird",
      description: "Unknown status",
      priority: 5,
      dependsOn: [],
      acceptance: [],
      status: "weird" as any,
      sessions: [],
      toolCallCount: 0,
    };
    const label = featureLabel(f);
    expect(label).toContain("•"); // fallback bullet
    expect(label).toContain("F006");
  });

  it("counts waived criteria as done in badge", () => {
    const f: Feature = {
      id: "F007",
      milestoneId: "M01",
      title: "Waived test",
      description: "Only waived ACs",
      priority: 1,
      dependsOn: [],
      acceptance: [
        { id: "AC01", description: "Skipped", checkType: "manual", verified: false, waived: true },
      ],
      status: "active",
      sessions: [],
      toolCallCount: 0,
    };
    const label = featureLabel(f);
    expect(label).toContain("[1/1 AC]");
  });
});

// ── featureDescription ────────────────────────────────────────────────────────

describe("featureDescription", () => {
  it("returns milestone-prefixed description", () => {
    const f: Feature = {
      id: "F001",
      milestoneId: "M01",
      title: "Login",
      description: "Build a secure login form with validation and error handling",
      priority: 1,
      dependsOn: [],
      acceptance: [],
      status: "active",
      sessions: [],
      toolCallCount: 0,
    };
    const desc = featureDescription(f, "M01");
    expect(desc).toContain("M01:");
    expect(desc).toContain("Build a secure login form");
  });

  it("truncates description at 70 characters", () => {
    const longDesc = "A".repeat(100);
    const f: Feature = {
      id: "F002",
      milestoneId: "M02",
      title: "Long",
      description: longDesc,
      priority: 1,
      dependsOn: [],
      acceptance: [],
      status: "pending",
      sessions: [],
      toolCallCount: 0,
    };
    const desc = featureDescription(f, "M02");
    const descPart = desc.replace("M02: ", "");
    expect(descPart.length).toBeLessThanOrEqual(70);
  });

  it("appends dependency links when dependsOn is non-empty", () => {
    const f: Feature = {
      id: "F003",
      milestoneId: "M01",
      title: "Dashboard",
      description: "Main dashboard view",
      priority: 2,
      dependsOn: ["F001", "F002"],
      acceptance: [],
      status: "blocked",
      sessions: [],
      toolCallCount: 0,
    };
    const desc = featureDescription(f, "M01");
    expect(desc).toContain("🔗F001,F002");
  });

  it("omits dependency link when dependsOn is empty", () => {
    const f: Feature = {
      id: "F004",
      milestoneId: "M01",
      title: "Solo",
      description: "No dependencies",
      priority: 1,
      dependsOn: [],
      acceptance: [],
      status: "active",
      sessions: [],
      toolCallCount: 0,
    };
    const desc = featureDescription(f, "M01");
    expect(desc).not.toContain("🔗");
  });
});

// ── buildFeatureItems ─────────────────────────────────────────────────────────

describe("buildFeatureItems", () => {
  it("builds items for all features across all milestones", () => {
    const mission = createMission("BuildItems", "Test goal");
    const items = buildFeatureItems(mission);
    expect(items).toHaveLength(4); // 1 session metrics + 3 features
    expect(items[0]!.value).toBe("__session_metrics__");
    expect(items[0]!.label).toContain("Session Metrics");
    expect(items[1]!.value).toBe("F001");
    expect(items[1]!.label).toContain("F001");
    expect(items[1]!.description).toContain("M01:");
    expect(items[2]!.value).toBe("F002");
    expect(items[3]!.value).toBe("F003");
  });

  it("returns single item for mission with no milestones", () => {
    const mission = createMission("Empty", "No milestones");
    mission.milestones = [];
    const items = buildFeatureItems(mission);
    expect(items).toHaveLength(1);
    expect(items[0]!.value).toBe("__session_metrics__");
  });

  it("includes features from all milestones regardless of status", () => {
    const mission = createMission("MultiMilestone", "Multiple milestones");
    mission.milestones.push({
      id: "M02",
      title: "Second milestone",
      description: "Extra work",
      status: "pending",
      features: [
        {
          id: "F010",
          milestoneId: "M02",
          title: "Extra feature",
          description: "Bonus work",
          priority: 4,
          dependsOn: [],
          acceptance: [],
          status: "pending",
          sessions: [],
          toolCallCount: 0,
        },
      ],
    });
    const items = buildFeatureItems(mission);
    expect(items).toHaveLength(5); // 1 session metrics + 4 features
    expect(items[4]!.value).toBe("F010");
    expect(items[4]!.description).toContain("M02:");
  });

  it("preserves feature ordering within milestones", () => {
    const mission = createMission("Ordered", "Test order");
    const items = buildFeatureItems(mission);
    expect(items.map((i) => i.value)).toEqual(["__session_metrics__", "F001", "F002", "F003"]);
  });
});

// ── featureDetailLines ────────────────────────────────────────────────────────

describe("featureDetailLines", () => {
  it("renders full detail for a feature with all fields populated", () => {
    const f: Feature = {
      id: "F001",
      milestoneId: "M01",
      title: "Login page",
      description: "Secure login with OAuth2 support and MFA fallback",
      priority: 1,
      dependsOn: ["F000"],
      acceptance: [
        { id: "AC01", description: "User can log in with email/password", checkType: "manual", verified: true },
        { id: "AC02", description: "OAuth2 Google login works", checkType: "bash", checkCommand: "curl -s localhost:3000/auth/google", verified: false },
      ],
      status: "active",
      sessions: [],
      toolCallCount: 0,
      notes: "Review with security team before merging",
    };

    const lines = featureDetailLines(f, 80);
    expect(lines.length).toBeGreaterThan(5);

    expect(lines[0]).toContain("───");
    expect(lines.some((l) => l.includes("📋") && l.includes("F001") && l.includes("Login page"))).toBe(true);
    expect(lines.some((l) => l.includes("Status:") && l.includes("active") && l.includes("Priority: P1") && l.includes("Milestone: M01"))).toBe(true);
    expect(lines.some((l) => l.includes("🎯 Next action:"))).toBe(true);
    expect(lines.some((l) => l.includes("📈 Acceptance progress: 1/2"))).toBe(true);
    expect(lines.some((l) => l.includes("📝") && l.includes("Secure login"))).toBe(true);
    expect(lines.some((l) => l.includes("🔗") && l.includes("F000"))).toBe(true);
    expect(lines.some((l) => l.includes("📌") && l.includes("Review with security team"))).toBe(true);
    expect(lines.some((l) => l.includes("✅ Acceptance criteria"))).toBe(true);
    expect(lines.some((l) => l.includes("☑") && l.includes("AC01"))).toBe(true);
    expect(lines.some((l) => l.includes("☐") && l.includes("AC02"))).toBe(true);
    expect(lines.some((l) => l.includes("curl -s localhost:3000/auth/google"))).toBe(true);
    expect(lines[lines.length - 1]).toContain("───");
  });

  it("renders detail without notes or deps when absent", () => {
    const f: Feature = {
      id: "F002",
      milestoneId: "M01",
      title: "Simple feature",
      description: "Just the basics",
      priority: 3,
      dependsOn: [],
      acceptance: [],
      status: "pending",
      sessions: [],
      toolCallCount: 0,
    };

    const lines = featureDetailLines(f, 80);
    expect(lines.some((l) => l.includes("📋") && l.includes("F002"))).toBe(true);
    expect(lines.some((l) => l.includes("Status: pending"))).toBe(true);
    expect(lines.some((l) => l.includes("Acceptance progress: 0/0"))).toBe(true);
    expect(lines.some((l) => l.includes("📝"))).toBe(true);
    expect(lines.some((l) => l.includes("🔗"))).toBe(false);
    expect(lines.some((l) => l.includes("📌"))).toBe(false);
    expect(lines.some((l) => l.includes("✅ Acceptance"))).toBe(false);
  });

  it("renders without description line when description is empty", () => {
    const f: Feature = {
      id: "F003",
      milestoneId: "M01",
      title: "No description",
      description: "",
      priority: 2,
      dependsOn: [],
      acceptance: [],
      status: "active",
      sessions: [],
      toolCallCount: 0,
    };

    const lines = featureDetailLines(f, 80);
    expect(lines.some((l) => l.includes("📝"))).toBe(false);
  });

  it("handles narrow width", () => {
    const f: Feature = {
      id: "F004",
      milestoneId: "M01",
      title: "Narrow",
      description: "Test narrow rendering",
      priority: 1,
      dependsOn: [],
      acceptance: [],
      status: "active",
      sessions: [],
      toolCallCount: 0,
    };

    const lines = featureDetailLines(f, 40);
    expect(lines[0]!.length - 2).toBe(36);
    expect(lines.some((l) => l.includes("F004"))).toBe(true);
  });

  it("renders acceptance criteria with verified, waived, and pending mixed", () => {
    const f: Feature = {
      id: "F006",
      milestoneId: "M01",
      title: "Mixed AC",
      description: "Testing mixed AC states",
      priority: 1,
      dependsOn: [],
      acceptance: [
        { id: "AC01", description: "Verified check", checkType: "manual", verified: true },
        { id: "AC02", description: "Waived check", checkType: "manual", verified: false, waived: true },
        { id: "AC03", description: "Pending check", checkType: "manual", verified: false },
      ],
      status: "active",
      sessions: [],
      toolCallCount: 0,
    };

    const lines = featureDetailLines(f, 80);
    const ac01Line = lines.find((l) => l.includes("☑ AC01"));
    expect(ac01Line).toBeDefined();
    expect(ac01Line).toContain("☑");
    const ac02Line = lines.find((l) => l.includes("☑ AC02"));
    expect(ac02Line).toBeDefined();
    expect(ac02Line).toContain("☑");
    const ac03Line = lines.find((l) => l.includes("☐ AC03"));
    expect(ac03Line).toBeDefined();
    expect(ac03Line).toContain("☐");
  });

  it("does not show bash check hint for manual check types", () => {
    const f: Feature = {
      id: "F007",
      milestoneId: "M01",
      title: "Manual only",
      description: "All manual checks",
      priority: 1,
      dependsOn: [],
      acceptance: [
        { id: "AC01", description: "Manual test", checkType: "manual", verified: false },
      ],
      status: "active",
      sessions: [],
      toolCallCount: 0,
    };

    const lines = featureDetailLines(f, 80);
    const ac01Line = lines.find((l) => l.includes("AC01"));
    expect(ac01Line).toBeDefined();
    expect(ac01Line).not.toContain("→");
  });
});

// ── missionControlOverlay factory ─────────────────────────────────────────────

describe("missionControlOverlay", () => {
  it("returns a factory function that builds a MissionControl component", () => {
    const mission = createMission("Factory", "Test factory");
    const factory = missionControlOverlay(mission);
    expect(typeof factory).toBe("function");

    const mockTui: any = {
      hideOverlay: () => {},
      requestRender: () => {},
    };

    const component = factory(mockTui);
    expect(component).toBeDefined();
    expect(typeof component.render).toBe("function");
    expect(typeof component.handleInput).toBe("function");
    expect(typeof component.dispose).toBe("function");

    const lines = component.render(80);
    expect(lines.some((l: string) => l.includes("Mission Control"))).toBe(true);
    expect(lines.some((l: string) => l.includes("Factory"))).toBe(true);
    expect(lines.some((l: string) => l.includes("Goal: Test factory"))).toBe(true);
    expect(lines.some((l: string) => l.includes("Handoff:"))).toBe(true);
  });

  it("disposes without error", () => {
    const mission = createMission("Dispose", "Test dispose");
    const factory = missionControlOverlay(mission);
    const mockTui: any = {
      hideOverlay: () => {},
      requestRender: () => {},
    };

    const component = factory(mockTui);
    expect(() => component.dispose()).not.toThrow();
  });

  it("navigates features with keyboard", () => {
    const mission = createMission("Nav", "Test navigation");
    let captured = "";
    const mockTui: any = {
      hideOverlay: () => {},
      requestRender: () => {},
    };

    // Test: arrow down selects next feature
    const component: any = missionControlOverlay(mission, (id) => { captured = id; })(mockTui);
    // Down twice: session metrics -> F001 -> F002, then Enter
    component.handleInput("\x1b[B"); // F001
    component.handleInput("\x1b[B"); // F002
    component.handleInput("\r"); // selects F002
    expect(captured).toBe("F002");
  });

  it("Escape closes the overlay", () => {
    const mission = createMission("Esc", "Test escape");
    let hidden = false;
    const mockTui: any = {
      hideOverlay: () => { hidden = true; },
      requestRender: () => {},
    };

    const component: any = missionControlOverlay(mission)(mockTui);
    component.handleInput("\x1b");
    expect(hidden).toBe(true);
  });
});
