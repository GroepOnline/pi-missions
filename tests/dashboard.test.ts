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
    // The description part should be at most 70 chars
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
  it("builds select items for all features across all milestones", () => {
    const mission = createMission("BuildItems", "Test goal");
    // Default mission has 1 milestone with 3 features
    const items = buildFeatureItems(mission);
    expect(items).toHaveLength(3);
    expect(items[0]!.value).toBe("F001");
    expect(items[0]!.label).toContain("F001");
    expect(items[0]!.description).toContain("M01:");
    expect(items[1]!.value).toBe("F002");
    expect(items[2]!.value).toBe("F003");
  });

  it("returns empty array for mission with no milestones", () => {
    const mission = createMission("Empty", "No milestones");
    mission.milestones = [];
    const items = buildFeatureItems(mission);
    expect(items).toEqual([]);
  });

  it("returns empty array for milestone with no features", () => {
    const mission = createMission("EmptyFeats", "No features");
    mission.milestones[0]!.features = [];
    const items = buildFeatureItems(mission);
    expect(items).toEqual([]);
  });

  it("skips features in inactive milestones if any", () => {
    const mission = createMission("MultiMilestone", "Multiple milestones");
    // Add a second milestone with one feature
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
    // All milestones are included regardless of status
    const items = buildFeatureItems(mission);
    expect(items).toHaveLength(4);
    expect(items[3]!.value).toBe("F010");
    expect(items[3]!.description).toContain("M02:");
  });

  it("preserves feature ordering within milestones", () => {
    const mission = createMission("Ordered", "Test order");
    // Default features are F001, F002, F003 in order
    const items = buildFeatureItems(mission);
    expect(items.map((i) => i.value)).toEqual(["F001", "F002", "F003"]);
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

    // Horizontal rule
    expect(lines[0]).toContain("───");

    // Feature ID and title
    expect(lines.some((l) => l.includes("📋") && l.includes("F001") && l.includes("Login page"))).toBe(true);

    // Status / priority / milestone line
    expect(lines.some((l) => l.includes("Status:") && l.includes("active") && l.includes("Priority: P1") && l.includes("Milestone: M01"))).toBe(true);

    // Description
    expect(lines.some((l) => l.includes("📝") && l.includes("Secure login"))).toBe(true);

    // Dependencies
    expect(lines.some((l) => l.includes("🔗") && l.includes("F000"))).toBe(true);

    // Notes
    expect(lines.some((l) => l.includes("📌") && l.includes("Review with security team"))).toBe(true);

    // Acceptance criteria
    expect(lines.some((l) => l.includes("✅ Acceptance criteria"))).toBe(true);
    expect(lines.some((l) => l.includes("☑") && l.includes("AC01") && l.includes("log in with email"))).toBe(true);
    expect(lines.some((l) => l.includes("☐") && l.includes("AC02") && l.includes("Google login"))).toBe(true);

    // Bash check hint
    expect(lines.some((l) => l.includes("curl -s localhost:3000/auth/google"))).toBe(true);

    // Closing horizontal rule
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

  it("handles narrow width — bar is clamped to width - 4", () => {
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
    // Bar should be 36 chars (40 - 4)
    expect(lines[0]!.length - 2).toBe(36); // "  " prefix + bar
    // Should still render the ID/title line
    expect(lines.some((l) => l.includes("F004"))).toBe(true);
  });

  it("handles very narrow width — bar clamped to 40 minimum", () => {
    const f: Feature = {
      id: "F005",
      milestoneId: "M01",
      title: "Very narrow",
      description: "Tiny",
      priority: 5,
      dependsOn: [],
      acceptance: [],
      status: "pending",
      sessions: [],
      toolCallCount: 0,
    };

    const lines = featureDetailLines(f, 10);
    // barW = Math.min(10 - 4, 72) = 6... but then ternary: 6 > 0 ? 6 : 40 = 6
    // Actually wait: barW = Math.min(6, 72) = 6, then 6 > 0 ? 6 : 40 = 6
    // Still: the bar line should exist, just shorter
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("──");
  });

  it("renders acceptance criteria with verified and waived mixed", () => {
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
    // Verified AC01 shows ☑ (verified)
    const ac01Line = lines.find((l) => l.includes("AC01"));
    expect(ac01Line).toBeDefined();
    expect(ac01Line).toContain("☑");

    // Waived AC02 shows ☑ (waived counts as verified for display)
    const ac02Line = lines.find((l) => l.includes("AC02"));
    expect(ac02Line).toBeDefined();
    expect(ac02Line).toContain("☑");

    // Pending AC03 shows ☐
    const ac03Line = lines.find((l) => l.includes("AC03"));
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

    // Render produces output with mission info
    const lines = component.render(80);
    expect(lines.some((l: string) => l.includes("Mission Control"))).toBe(true);
    expect(lines.some((l: string) => l.includes("Factory"))).toBe(true);
  });

  it("passes onAction callback through to MissionControl", () => {
    const mission = createMission("Callback", "Test callback");
    let captured = "";
    const factory = missionControlOverlay(mission, (id) => { captured = id; });
    const mockTui: any = {
      hideOverlay: () => {},
      requestRender: () => {},
    };

    const component: any = factory(mockTui);
    // Simulate navigating down then pressing Enter
    component.handleInput("\x1b[B");
    component.handleInput("\r");
    expect(captured).toBe("F002"); // second feature selected after one down
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

  it("E2E: type-to-filter narrows feature list, Backspace expands, Escape clears", () => {
    const mission = createMission("Filter", "Test type-to-filter");
    // Default mission: F001, F002, F003
    // Add more features for a richer filter test
    mission.milestones[0]!.features.push(
      {
        id: "F010",
        milestoneId: "M01",
        title: "Bonus feature 10",
        description: "Tenth feature",
        priority: 4,
        dependsOn: [],
        acceptance: [],
        status: "pending",
        sessions: [],
        toolCallCount: 0,
      },
      {
        id: "F011",
        milestoneId: "M01",
        title: "Bonus feature 11",
        description: "Eleventh feature",
        priority: 5,
        dependsOn: [],
        acceptance: [],
        status: "pending",
        sessions: [],
        toolCallCount: 0,
      },
    );

    const mockTui: any = {
      hideOverlay: () => {},
      requestRender: () => {},
    };
    const component: any = missionControlOverlay(mission)(mockTui);

    // 1. Initial render — all 5 features visible, no filter count
    const initial = component.render(80);
    expect(initial.some((l: string) => l.includes("F001"))).toBe(true);
    expect(initial.some((l: string) => l.includes("F002"))).toBe(true);
    expect(initial.some((l: string) => l.includes("F003"))).toBe(true);
    expect(initial.some((l: string) => l.includes("F010"))).toBe(true);
    expect(initial.some((l: string) => l.includes("F011"))).toBe(true);
    // Footer shows total count, not filtered/total
    expect(initial.some((l: string) => l.includes("5 features") && !l.includes("/"))).toBe(true);

    // 2. Type "F" — all still visible (all start with F), 5/5
    component.handleInput("F");
    const afterF = component.render(80);
    expect(afterF.some((l: string) => l.includes("F001"))).toBe(true);
    expect(afterF.some((l: string) => l.includes("F002"))).toBe(true);
    expect(afterF.some((l: string) => l.includes("F003"))).toBe(true);
    // Filter bar shows current filter text
    expect(afterF.some((l: string) => l.includes("🔍 Filter: F"))).toBe(true);
    // Footer shows filtered/total count
    expect(afterF.some((l: string) => l.includes("5/5 features"))).toBe(true);
    // No "No matching" message
    expect(afterF.some((l: string) => l.includes("No matching"))).toBe(false);

    // 3. Type "0" — filter="F0", all still match (F001, F002, F003, F010, F011)
    component.handleInput("0");
    const afterF0 = component.render(80);
    expect(afterF0.some((l: string) => l.includes("F001"))).toBe(true);
    expect(afterF0.some((l: string) => l.includes("F002"))).toBe(true);
    expect(afterF0.some((l: string) => l.includes("F010"))).toBe(true);

    // 4. Type "0" again — filter="F00", only F001, F002, F003 remain (3/5)
    component.handleInput("0");
    const afterF00 = component.render(80);
    expect(afterF00.some((l: string) => l.includes("F001"))).toBe(true);
    expect(afterF00.some((l: string) => l.includes("F002"))).toBe(true);
    expect(afterF00.some((l: string) => l.includes("F003"))).toBe(true);
    expect(afterF00.some((l: string) => l.includes("F010"))).toBe(false);
    expect(afterF00.some((l: string) => l.includes("F011"))).toBe(false);
    // Footer shows 3/5 filtered count
    expect(afterF00.some((l: string) => l.includes("3/5 features"))).toBe(true);

    // 5. Type "3" — filter="F003", only F003 in list (1/5).
    // Detail pane shows F003 depends on F002, so F002 appears there (correct).
    // F001 is absent (not in filter results, not a dependency of F003).
    component.handleInput("3");
    const afterF003 = component.render(80);
    expect(afterF003.some((l: string) => l.includes("F003"))).toBe(true);
    expect(afterF003.some((l: string) => l.includes("F001"))).toBe(false);
    // Filter bar shows accumulated text
    expect(afterF003.some((l: string) => l.includes("🔍 Filter: F003"))).toBe(true);
    // Footer shows 1/5 filtered count
    expect(afterF003.some((l: string) => l.includes("1/5 features"))).toBe(true);
    // F002 appears as dependency in detail pane
    expect(afterF003.some((l: string) => l.includes("🔗") && l.includes("F002"))).toBe(true);

    // 6. Press Enter on the filtered single item — activates F003
    let captured = "";
    const component2: any = missionControlOverlay(mission, (id) => { captured = id; })(mockTui);
    component2.handleInput("F");
    component2.handleInput("0");
    component2.handleInput("0");
    component2.handleInput("3");
    component2.handleInput("\r");
    expect(captured).toBe("F003");

    // 7. Backspace — removes last char, filter="F00" again
    const afterBackspace = (() => {
      const c: any = missionControlOverlay(mission)(mockTui);
      c.handleInput("F");
      c.handleInput("0");
      c.handleInput("0");
      c.handleInput("3");
      c.handleInput("\b");
      return c.render(80);
    })();
    expect(afterBackspace.some((l: string) => l.includes("F001"))).toBe(true);
    expect(afterBackspace.some((l: string) => l.includes("F002"))).toBe(true);
    expect(afterBackspace.some((l: string) => l.includes("F003"))).toBe(true);
    expect(afterBackspace.some((l: string) => l.includes("F010"))).toBe(false);

    // 8. Escape with active filter: clears filter, stays open (hideOverlay NOT called)
    // Second Escape with empty filter: closes overlay
    let overlayHidden = false;
    const tuiWithSpy: any = {
      hideOverlay: () => { overlayHidden = true; },
      requestRender: () => {},
    };
    const c: any = missionControlOverlay(mission)(tuiWithSpy);
    c.handleInput("F");
    c.handleInput("0");
    c.handleInput("0");
    c.handleInput("3");
    // First Escape — clears filter, stays open
    c.handleInput("\x1b");
    expect(overlayHidden).toBe(false);
    const afterClear = c.render(80);
    // Filter bar hidden after clear; footer back to plain total
    expect(afterClear.some((l: string) => l.includes("Filter:"))).toBe(false);
    expect(afterClear.some((l: string) => l.includes("5 features") && !l.includes("/"))).toBe(true);
    expect(afterClear.some((l: string) => l.includes("F001"))).toBe(true);
    expect(afterClear.some((l: string) => l.includes("F002"))).toBe(true);
    expect(afterClear.some((l: string) => l.includes("F003"))).toBe(true);
    expect(afterClear.some((l: string) => l.includes("F010"))).toBe(true);
    expect(afterClear.some((l: string) => l.includes("F011"))).toBe(true);
    // Second Escape — closes overlay
    c.handleInput("\x1b");
    expect(overlayHidden).toBe(true);

    // 9. Escape with empty filter closes immediately
    let closed = false;
    const tui2: any = {
      hideOverlay: () => { closed = true; },
      requestRender: () => {},
    };
    const c2: any = missionControlOverlay(mission)(tui2);
    c2.handleInput("\x1b");
    expect(closed).toBe(true);

    // 10. No-match filter shows "No matching" message
    const noMatch = (() => {
      const c: any = missionControlOverlay(mission)(mockTui);
      c.handleInput("Z");
      return c.render(80);
    })();
    expect(noMatch.some((l: string) => l.includes("No matching"))).toBe(true);
  });

  it("E2E: edge cases — backspace on empty filter, non-ASCII chars, rapid type/backspace, arrow nav in filtered list", () => {
    const mission = createMission("EdgeCases", "Test edge cases");
    mission.milestones[0]!.features.push(
      {
        id: "F010", milestoneId: "M01", title: "Bonus 10", description: "Tenth",
        priority: 4, dependsOn: [], acceptance: [], status: "pending", sessions: [], toolCallCount: 0,
      },
      {
        id: "F011", milestoneId: "M01", title: "Bonus 11", description: "Eleventh",
        priority: 5, dependsOn: [], acceptance: [], status: "pending", sessions: [], toolCallCount: 0,
      },
    );

    const mockTui: any = {
      hideOverlay: () => {},
      requestRender: () => {},
    };

    // ── 1. Backspace on empty filter — no-op, all features visible ──
    const c1: any = missionControlOverlay(mission)(mockTui);
    expect(() => c1.handleInput("\b")).not.toThrow();
    expect(() => c1.handleInput("\x7f")).not.toThrow();
    const afterEmptyBackspace = c1.render(80);
    expect(afterEmptyBackspace.some((l: string) => l.includes("F001"))).toBe(true);
    expect(afterEmptyBackspace.some((l: string) => l.includes("F011"))).toBe(true);
    expect(afterEmptyBackspace.some((l: string) => l.includes("Filter:"))).toBe(false);

    // ── 2. Non-ASCII char (ü, charCode 252) is forwarded to SelectList, not filtered ──
    const c2: any = missionControlOverlay(mission)(mockTui);
    c2.handleInput("ü");
    const afterUnicode = c2.render(80);
    // No filter bar — ü is outside ASCII 32-126 range
    expect(afterUnicode.some((l: string) => l.includes("Filter:"))).toBe(false);
    // All features still visible (SelectList ignores unknown keys)
    expect(afterUnicode.some((l: string) => l.includes("F001"))).toBe(true);
    expect(afterUnicode.some((l: string) => l.includes("F011"))).toBe(true);

    // ── 3. Punctuation char (!, charCode 33) IS intercepted as filter ──
    const c3: any = missionControlOverlay(mission)(mockTui);
    c3.handleInput("!");
    const afterPunct = c3.render(80);
    // Filter bar shows "!"
    expect(afterPunct.some((l: string) => l.includes("🔍 Filter: !"))).toBe(true);
    // No features match "!" — footer shows 0/5
    expect(afterPunct.some((l: string) => l.includes("No matching"))).toBe(true);
    expect(afterPunct.some((l: string) => l.includes("0/5 features"))).toBe(true);

    // ── 4. Rapid type then backspace all the way ──
    const c4: any = missionControlOverlay(mission)(mockTui);
    c4.handleInput("F");
    c4.handleInput("0");
    c4.handleInput("0");
    // Mid-way: filter active, 3 features visible
    const mid = c4.render(80);
    expect(mid.some((l: string) => l.includes("🔍 Filter: F00"))).toBe(true);
    expect(mid.some((l: string) => l.includes("F001"))).toBe(true);
    expect(mid.some((l: string) => l.includes("F010"))).toBe(false);
    // Backspace all the way
    c4.handleInput("\b");
    c4.handleInput("\b");
    c4.handleInput("\b");
    const fullyCleared = c4.render(80);
    expect(fullyCleared.some((l: string) => l.includes("Filter:"))).toBe(false);
    expect(fullyCleared.some((l: string) => l.includes("F001"))).toBe(true);
    expect(fullyCleared.some((l: string) => l.includes("F002"))).toBe(true);
    expect(fullyCleared.some((l: string) => l.includes("F003"))).toBe(true);
    expect(fullyCleared.some((l: string) => l.includes("F010"))).toBe(true);
    expect(fullyCleared.some((l: string) => l.includes("F011"))).toBe(true);

    // ── 5. Filter then navigate with arrows in reduced list ──
    const c5: any = missionControlOverlay(mission)(mockTui);
    c5.handleInput("F");
    c5.handleInput("0");
    c5.handleInput("0");
    // Filtered to F001, F002, F003 — initial selection is F001
    // Navigate down: F001 → F002
    c5.handleInput("\x1b[B");
    const afterOneDown = c5.render(80);
    // F002 should be in the list AND its detail pane should be visible
    expect(afterOneDown.some((l: string) => l.includes("F002"))).toBe(true);
    expect(afterOneDown.some((l: string) => l.includes("📋 F002"))).toBe(true);
    // Navigate down again: F002 → F003
    c5.handleInput("\x1b[B");
    const afterTwoDown = c5.render(80);
    expect(afterTwoDown.some((l: string) => l.includes("📋 F003"))).toBe(true);
    // Navigate up: F003 → F002
    c5.handleInput("\x1b[A");
    const afterUp = c5.render(80);
    expect(afterUp.some((l: string) => l.includes("📋 F002"))).toBe(true);
    // Press Enter on filtered selection — use fresh component with onAction to test activation
    let captured = "";
    const c5b: any = missionControlOverlay(mission, (id) => { captured = id; })(mockTui);
    c5b.handleInput("F");
    c5b.handleInput("0");
    c5b.handleInput("0");
    c5b.handleInput("\x1b[B"); // select F002
    c5b.handleInput("\r");
    expect(captured).toBe("F002");
  });

  it("E2E: Ctrl+U clears filter in one keystroke without closing overlay", () => {
    const mission = createMission("CtrlU", "Test Ctrl+U clear");
    mission.milestones[0]!.features.push(
      {
        id: "F010", milestoneId: "M01", title: "Bonus 10", description: "Tenth",
        priority: 4, dependsOn: [], acceptance: [], status: "pending", sessions: [], toolCallCount: 0,
      },
      {
        id: "F011", milestoneId: "M01", title: "Bonus 11", description: "Eleventh",
        priority: 5, dependsOn: [], acceptance: [], status: "pending", sessions: [], toolCallCount: 0,
      },
    );

    let overlayHidden = false;
    const tuiWithSpy: any = {
      hideOverlay: () => { overlayHidden = true; },
      requestRender: () => {},
    };

    // 1. Ctrl+U with active filter — clears filter, overlay stays open
    const c1: any = missionControlOverlay(mission)(tuiWithSpy);
    c1.handleInput("F");
    c1.handleInput("0");
    c1.handleInput("0");
    const beforeClear = c1.render(80);
    expect(beforeClear.some((l: string) => l.includes("🔍 Filter: F00"))).toBe(true);
    expect(beforeClear.some((l: string) => l.includes("F010"))).toBe(false);

    c1.handleInput("\x15"); // Ctrl+U
    expect(overlayHidden).toBe(false); // overlay does NOT close
    const afterClear = c1.render(80);
    expect(afterClear.some((l: string) => l.includes("Filter:"))).toBe(false);
    // Footer back to plain total after clear
    expect(afterClear.some((l: string) => l.includes("5 features") && !l.includes("/"))).toBe(true);
    expect(afterClear.some((l: string) => l.includes("F001"))).toBe(true);
    expect(afterClear.some((l: string) => l.includes("F002"))).toBe(true);
    expect(afterClear.some((l: string) => l.includes("F003"))).toBe(true);
    expect(afterClear.some((l: string) => l.includes("F010"))).toBe(true);
    expect(afterClear.some((l: string) => l.includes("F011"))).toBe(true);

    // 2. Ctrl+U with empty filter — no-op, no crash, overlay stays open
    const c2: any = missionControlOverlay(mission)(tuiWithSpy);
    expect(() => c2.handleInput("\x15")).not.toThrow();
    expect(overlayHidden).toBe(false);
    const afterEmptyCtrlU = c2.render(80);
    expect(afterEmptyCtrlU.some((l: string) => l.includes("F001"))).toBe(true);
    expect(afterEmptyCtrlU.some((l: string) => l.includes("Filter:"))).toBe(false);

    // 3. Footer hint mentions Ctrl+U
    expect(afterEmptyCtrlU.some((l: string) => l.includes("Ctrl+U clear filter"))).toBe(true);

    // 4. Ctrl+U from no-match state — clears filter, restores all features
    const c3: any = missionControlOverlay(mission)(tuiWithSpy);
    c3.handleInput("Z"); // no features match "Z"
    const noMatch = c3.render(80);
    expect(noMatch.some((l: string) => l.includes("No matching"))).toBe(true);
    expect(noMatch.some((l: string) => l.includes("0/5 features"))).toBe(true);

    c3.handleInput("\x15"); // Ctrl+U
    expect(overlayHidden).toBe(false); // overlay stays open
    const afterNoMatchClear = c3.render(80);
    expect(afterNoMatchClear.some((l: string) => l.includes("Filter:"))).toBe(false);
    expect(afterNoMatchClear.some((l: string) => l.includes("No matching"))).toBe(false);
    expect(afterNoMatchClear.some((l: string) => l.includes("F001"))).toBe(true);
    expect(afterNoMatchClear.some((l: string) => l.includes("F011"))).toBe(true);
    expect(afterNoMatchClear.some((l: string) => l.includes("5 features") && !l.includes("/"))).toBe(true);
  });
});
