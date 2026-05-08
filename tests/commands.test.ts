import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TUI } from "@mariozechner/pi-tui";
import { cloneFeatureForFork, compactionCheckpoint, handleBlock, handleClear, handleDashboard, handleDebug, handleDone, handleEdit, handleExport, handleFork, handleList, handleLoad, handleNew, handleNext, handlePause, handleResume, handleStatus, handleTemplates, missionSummaryForTree, saveSessionLink } from "../src/commands.js";
import { missionControlOverlay } from "../src/dashboard.js";
import { appendHistory, autoBlockBlockedFeatures, createMission, exportMarkdown, loadMissionFromDisk, saveEvidence, saveMissionSafe } from "../src/state.js";
import type { MissionState, RuntimeState } from "../src/types.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = path.join(os.tmpdir(), `pi-missions-cmd-test-${process.pid}`);

function runtimeFixture(missionOverride: Partial<ReturnType<typeof createMission>> = {}): RuntimeState {
  return {
    activeMission: { ...createMission("Tree mission", "Goal"), ...missionOverride },
    autoSaveInterval: null,
  };
}

describe("missionSummaryForTree", () => {
  it("returns null when no mission is active", () => {
    expect(missionSummaryForTree({ activeMission: null, autoSaveInterval: null })).toBeNull();
  });

  it("returns mission title when no feature is active", () => {
    const rt = runtimeFixture({ activeFeatureId: undefined });
    expect(missionSummaryForTree(rt)).toBe("Mission: Tree mission");
  });

  it("returns mission title and active feature title", () => {
    const rt = runtimeFixture();
    expect(missionSummaryForTree(rt)).toContain("Mission: Tree mission");
    expect(missionSummaryForTree(rt)).toContain("Feature:");
  });
});

describe("saveSessionLink", () => {
  it("does nothing when no mission is active", () => {
    // Should not throw.
    expect(() =>
      saveSessionLink({ activeMission: null, autoSaveInterval: null }, "/some/session.jsonl")
    ).not.toThrow();
  });

  it("does nothing when sessionFile is undefined", () => {
    const rt = runtimeFixture();
    expect(() => saveSessionLink(rt, undefined)).not.toThrow();
  });
});

describe("compactionCheckpoint", () => {
  it("does nothing when no mission is active", () => {
    const mockPi = { appendEntry: () => { throw new Error("should not be called"); } };
    expect(() =>
      compactionCheckpoint(mockPi as any, { activeMission: null, autoSaveInterval: null })
    ).not.toThrow();
  });

  it("calls appendEntry with mission id when active", () => {
    const calls: any[] = [];
    const mockPi = { appendEntry: (...args: any[]) => { calls.push(args); } };
    const rt = runtimeFixture();
    compactionCheckpoint(mockPi as any, rt);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe("pi-mission-compaction-checkpoint");
    expect(calls[0]![1].missionId).toBe(rt.activeMission!.id);
  });
});

describe("exportMarkdown", () => {
  const origHome = process.env.HOME;

  beforeAll(() => {
    process.env.HOME = tmpRoot;
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterAll(() => {
    process.env.HOME = origHome;
    if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("exports a complete markdown report", async () => {
    const m = createMission("Exporter", "Export mission");
    m.tokensUsed = 999;
    await saveMissionSafe(m);
    const md = exportMarkdown(m);
    expect(md).toContain("# Mission Report: Exporter");
    expect(md).toContain("**Goal**: Export mission");
    expect(md).toContain("**Status**: active");
    expect(md).toContain("**Progress**: 0/3 (0%)");
    expect(md).toContain("**Tokens used**: 999");
  });

  it("includes evidence in export when available", async () => {
    const m = createMission("Evidence", "Test");
    const f = m.milestones[0].features[0]!;
    f.status = "done";
    f.completedAt = Date.now();
    await saveMissionSafe(m);
    saveEvidence(m, f, "## Completed\nAll checks passed");
    const md = exportMarkdown(m);
    expect(md).toContain("Evidence");
    expect(md).toContain("All checks passed");
  });

  it("includes history section when history exists", async () => {
    const m = createMission("History", "Test");
    await saveMissionSafe(m);
    appendHistory(m, { event: "feature_done", featureId: "F001", note: "completed" });
    const md = exportMarkdown(m);
    expect(md).toContain("## Recent History");
    expect(md).toContain("feature_done");
  });

  it("handles empty milestones", () => {
    const m = createMission("Empty", "Test");
    m.milestones = [];
    const md = exportMarkdown(m);
    expect(md).toContain("# Mission Report: Empty");
  });
});

describe("saveEvidence integration", () => {
  it("saves and reads evidence", async () => {
    const m = createMission("EvidenceInt", "Integration test");
    const f = m.milestones[0].features[0]!;
    await saveMissionSafe(m);
    const file = saveEvidence(m, f, "Test evidence content");
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, "utf-8")).toBe("Test evidence content");
  });
});

describe("autoBlockBlockedFeatures integration", () => {
  it("blocks features correctly in save/load cycle", () => {
    // F001 active, F002 depends on F001 (not done), F003 depends on F002
    // So both F002 and F003 should be waiting
    const m = createMission("BlockTest", "Test");
    expect(autoBlockBlockedFeatures(m)).toBe(2);
    expect(m.milestones[0].features[1]!.status).toBe("waiting");
    expect(m.milestones[0].features[2]!.status).toBe("waiting");
  });
});

describe("cloneFeatureForFork", () => {
  it("clones a feature with new id, title, status and reset acceptance", () => {
    const m = createMission("ForkTest", "Goal");
    const f = m.milestones[0].features[0]!;
    f.acceptance = [
      { id: "AC001", description: "Works", checkType: "bash", checkCommand: "npm test", verified: true, evidence: "all good" },
    ];
    f.completedAt = Date.now();
    f.notes = "original notes";

    const forked = cloneFeatureForFork(f, "F001-fork-1", "Forked feature", "Alternative approach");
    expect(forked.id).toBe("F001-fork-1");
    expect(forked.title).toBe("Forked feature");
    expect(forked.status).toBe("active");
    expect(forked.completedAt).toBeUndefined();
    expect(forked.notes).toBe("Alternative approach");
    expect(forked.dependsOn).toEqual(f.dependsOn);
    expect(forked.sessions).toEqual(f.sessions);
    // Acceptance criteria are reset
    expect(forked.acceptance[0]!.verified).toBe(false);
    expect(forked.acceptance[0]!.evidence).toBeUndefined();
  });

  it("handles features with no acceptance criteria", () => {
    const m = createMission("ForkTest", "Goal");
    const f = m.milestones[0].features[1]!; // F002 has default acceptance
    f.acceptance = [];
    const forked = cloneFeatureForFork(f, "F002-fork-1", "Forked", "Test");
    expect(forked.acceptance).toEqual([]);
    expect(forked.status).toBe("active");
  });
});

describe("handleStatus", () => {
  function mockCtx(): any {
    let statusText = "";
    const calls: any[] = [];
    return {
      ui: {
        notify: (msg: string, level: string) => { calls.push({ msg, level }); },
        setStatus: (key: string, text: string) => { statusText = text; },
      },
      getCalls: () => calls,
    };
  }

  it("notifies 'no active mission' when none is set", async () => {
    const ctx = mockCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    await handleStatus(ctx as any, rt);
    expect(ctx.getCalls()).toHaveLength(1);
    expect(ctx.getCalls()[0]!.msg).toContain("No active mission");
  });

  it("shows status for active mission with feature info", async () => {
    const ctx = mockCtx();
    const rt = runtimeFixture();
    await handleStatus(ctx as any, rt);
    expect(ctx.getCalls()).toHaveLength(1);
    expect(ctx.getCalls()[0]!.msg).toContain("Tree mission");
    expect(ctx.getCalls()[0]!.level).toBe("info");
  });

  it("uses mission title from runtime in status output", async () => {
    const ctx = mockCtx();
    const rt = runtimeFixture();
    await handleStatus(ctx as any, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("Tree mission");
    expect(ctx.getCalls()[0]!.msg).toContain("Progress");
  });

  it("includes active feature in status", async () => {
    const ctx = mockCtx();
    const rt = runtimeFixture();
    await handleStatus(ctx as any, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("Active:");
  });
});

// ── Handler tests ────────────────────────────────────────────────────────────

function mkCtx(overrides: Record<string, any> = {}): any {
  const calls: any[] = [];
  const widgets: Record<string, string[]> = {};
  let lastCustom: { factory: any; options: any } | null = null;
  return {
    ui: {
      notify: (msg: string, level: string) => { calls.push({ type: "notify", msg, level }); },
      setStatus: () => {},
      setWidget: (key: string, rows: string[]) => { widgets[key] = rows; },
      custom: async (factory: any, options: any) => { lastCustom = { factory, options }; },
      input: async () => null,
      select: async () => null,
      editor: async () => null,
      confirm: async () => true,
    },
    sessionManager: { getLeafId: () => null, getEntries: () => [] },
    hasUI: false,
    fork: async () => {},
    getCalls: () => calls,
    getWidgets: () => widgets,
    getLastCustom: () => lastCustom,
    ...overrides,
  };
}

function mkPi(overrides: Record<string, any> = {}): any {
  const entries: Array<Record<string, any>> = [];
  return {
    appendEntry: (type: string, data: Record<string, any>) => { entries.push({ type, data }); },
    setSessionName: () => {},
    getEntries: () => entries,
    ...overrides,
  };
}

describe("handleBlock", () => {
  it("blocks active feature with reason", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await handleBlock("Blocked because of API changes", ctx, rt);
    const f = rt.activeMission!.milestones[0].features[0]!;
    expect(f.status).toBe("blocked");
    expect(f.notes).toContain("API changes");
  });

  it("defaults reason when empty", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await handleBlock("", ctx, rt);
    const f = rt.activeMission!.milestones[0].features[0]!;
    expect(f.status).toBe("blocked");
    expect(f.notes).toBe("Blocked");
  });

  it("notifies when no active mission", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    await handleBlock("reason", ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("No active feature");
  });
});

describe("handlePause", () => {
  it("pauses active mission", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await handlePause(ctx, rt);
    expect(rt.activeMission!.status).toBe("paused");
  });

  it("notifies when no active mission", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    await handlePause(ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("No active mission");
  });
});

describe("handleResume", () => {
  it("resumes paused mission", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    rt.activeMission!.status = "paused";
    await handleResume(ctx, rt);
    expect(rt.activeMission!.status).toBe("active");
  });

  it("notifies when no active mission", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    await handleResume(ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("No active mission");
  });
});

describe("handleClear", () => {
  it("clears active mission", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await handleClear(ctx, rt);
    expect(rt.activeMission).toBeNull();
    expect(ctx.getCalls()[0]!.msg).toContain("detached");
  });
});

describe("handleNext", () => {
  it("warns when active feature is not done", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await handleNext(ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("not done yet");
  });

  it("advances to next feature when active is done", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    rt.activeMission!.milestones[0].features[0]!.status = "done";
    await handleNext(ctx, rt);
    expect(rt.activeMission!.activeFeatureId).toBe("F002");
    expect(ctx.getCalls()[0]!.msg).toContain("➡️ Active feature: F002");
  });

  it("marks mission complete when all done", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    rt.activeMission!.milestones[0].features[0]!.status = "done";
    rt.activeMission!.milestones[0].features[1]!.status = "done";
    rt.activeMission!.milestones[0].features[2]!.status = "done";
    await handleNext(ctx, rt);
    expect(rt.activeMission!.status).toBe("complete");
    expect(ctx.getCalls()[0]!.msg).toContain("Mission complete");
  });

  it("warns when no unblocked features remain", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    // F001 is done, F002 is blocked but F2 depends on F1 (done), so F2 gets auto-unblocked
    // To test the "no unblocked" scenario, we need F2 to depend on something not done
    rt.activeMission!.milestones[0].features[0]!.status = "done";
    // Add a dependency on a non-existent feature to prevent auto-unblock
    rt.activeMission!.milestones[0].features[1]!.dependsOn = ["F000"]; // F000 doesn't exist, won't be done
    rt.activeMission!.milestones[0].features[1]!.status = "blocked";
    await handleNext(ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("No unblocked pending feature");
  });

  it("warns when mission is absent", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    await handleNext(ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("No active mission");
  });
});

describe("handleDone", () => {
  it("marks active feature done and saves evidence", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);
    await handleDone("Feature completed successfully", ctx, rt);
    const f = rt.activeMission!.milestones[0].features[0]!;
    expect(f.status).toBe("done");
    expect(f.completedAt).toBeGreaterThan(0);
    expect(ctx.getCalls()[0]!.msg).toContain("✅ F001 done");
    expect(ctx.getCalls()[0]!.msg).toContain("Evidence:");
  });

  it("warns when no active feature", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    await handleDone("", ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("No active feature");
  });

  it("completes mission when last feature is done", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);
    rt.activeMission!.milestones[0].features[1]!.status = "done";
    rt.activeMission!.milestones[0].features[2]!.status = "done";
    await handleDone("done", ctx, rt);
    expect(rt.activeMission!.status).toBe("complete");
  });

  it("auto-verifies bash acceptance criteria", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);
    // Set up feature with bash acceptance criteria and mock execFn
    rt.activeMission!.milestones[0].features[0]!.acceptance = [
      { id: "AC001", description: "Bash check", checkType: "bash", checkCommand: "echo ok", verified: false },
    ];
    // Add mock execFn that returns success
    (rt.activeMission!.milestones[0].features[0] as any)._execFn = () => ({ code: 0, stdout: "ok" });
    await handleDone("done", ctx, rt);
    const f = rt.activeMission!.milestones[0].features[0]!;
    expect(f.acceptance[0]!.verified).toBe(true);
    expect(f.acceptance[0]!.evidence).toBeTruthy();
  });
});

describe("handleExport", () => {
  it("exports markdown to notify when no filename", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await handleExport(undefined, ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("# Mission Report");
  });

  it("warns when no active mission", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    await handleExport(undefined, ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("No active mission");
  });

  it("exports to file when filename provided", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    const outFile = path.join(tmpRoot, "export-test.md");
    fs.mkdirSync(tmpRoot, { recursive: true });
    await handleExport(outFile, ctx, rt);
    expect(fs.existsSync(outFile)).toBe(true);
    const content = fs.readFileSync(outFile, "utf-8");
    expect(content).toContain("# Mission Report");
    fs.unlinkSync(outFile);
  });
});

describe("handleDebug", () => {
  it("shows debug widget for active mission", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await handleDebug(undefined, ctx, rt);
    const w = ctx.getWidgets()["pi-mission-debug"];
    expect(w).toBeDefined();
    expect(w[0]).toContain("Tree mission");
  });

  it("loads mission by id", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);
    await handleDebug(rt.activeMission!.id, ctx, { activeMission: null, autoSaveInterval: null });
    const w = ctx.getWidgets()["pi-mission-debug"];
    expect(w).toBeDefined();
  });

  it("warns when no mission to debug", async () => {
    const ctx = mkCtx();
    await handleDebug(undefined, ctx, { activeMission: null, autoSaveInterval: null });
    expect(ctx.getCalls()[0]!.msg).toContain("No mission to debug");
  });
});

describe("handleDashboard", () => {
  it("shows status text when hasUI is false", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await handleDashboard(ctx, rt);
    const calls = ctx.getCalls();
    expect(calls[0]!.msg).toContain("Tree mission");
    expect(calls[0]!.level).toBe("info");
  });

  it("opens full-screen overlay when hasUI is true", async () => {
    const ctx = mkCtx({ hasUI: true });
    const rt = runtimeFixture();
    await handleDashboard(ctx, rt);
    const custom = ctx.getLastCustom();
    expect(custom).not.toBeNull();
    expect(custom.options).toEqual({ overlay: true });
    expect(typeof custom.factory).toBe("function");
  });

  it("factory builds valid component that renders and disposes", async () => {
    const ctx = mkCtx({ hasUI: true });
    const rt = runtimeFixture();
    await handleDashboard(ctx, rt);
    const custom = ctx.getLastCustom();
    expect(custom).not.toBeNull();
    // Call the factory with a minimal mock TUI to verify it builds correctly
    const mockTui = { hideOverlay: () => {}, requestRender: () => {} };
    const component = custom.factory(mockTui);
    expect(component).toBeDefined();
    expect(typeof component.render).toBe("function");
    expect(typeof component.handleInput).toBe("function");
    expect(typeof component.dispose).toBe("function");
    // Render should produce output lines with mission info
    const lines = component.render(80);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l: string) => l.includes("Mission Control"))).toBe(true);
    expect(lines.some((l: string) => l.includes("Tree mission"))).toBe(true);
    // Handle input forwarding and disposal should not throw
    component.handleInput("j");
    component.dispose();
  });

  it("E2E: navigates SelectList with arrow keys, selects feature with Enter, fires onAction and hides overlay", async () => {
    const mission = createMission("E2E Dashboard", "Test goal");

    let overlayHidden = false;
    let featureActivated: string | null = null;
    const mockTui = {
      hideOverlay: () => { overlayHidden = true; },
      requestRender: () => {},
    } as unknown as TUI;

    const component: any = missionControlOverlay(mission, (featureId) => { featureActivated = featureId; })(mockTui);

    // 1. Initial render — session metrics + 3 features listed, session metrics selected with → prefix
    const initial = component.render(80);
    expect(initial.some((l: string) => l.includes("Session Metrics"))).toBe(true);
    expect(initial.some((l: string) => l.includes("F001"))).toBe(true);
    expect(initial.some((l: string) => l.includes("F002"))).toBe(true);
    expect(initial.some((l: string) => l.includes("F003"))).toBe(true);
    expect(initial.some((l: string) => l.includes("→") && l.includes("Session Metrics"))).toBe(true);

    // 2. Navigate down (\x1b[B) to F001 — verify selection and detail pane
    component.handleInput("\x1b[B");
    const down1 = component.render(80);
    expect(down1.some((l: string) => l.includes("→") && l.includes("F001"))).toBe(true);
    expect(down1.some((l: string) => l.includes("F001:"))).toBe(true);

    // 3. Navigate down again to F002
    component.handleInput("\x1b[B");
    const down2 = component.render(80);
    expect(down2.some((l: string) => l.includes("→") && l.includes("F002"))).toBe(true);
    expect(down2.some((l: string) => l.includes("F002:"))).toBe(true);

    // 4. Navigate down again to F003
    component.handleInput("\x1b[B");
    const down3 = component.render(80);
    expect(down3.some((l: string) => l.includes("→") && l.includes("F003"))).toBe(true);
    expect(down3.some((l: string) => l.includes("F003:"))).toBe(true);

    // 5. Navigate back up (\x1b[A) to F002
    component.handleInput("\x1b[A");
    const up1 = component.render(80);
    expect(up1.some((l: string) => l.includes("→") && l.includes("F002"))).toBe(true);

    // 5. Press Enter (\r) — activates F002, hides overlay
    component.handleInput("\r");
    expect(featureActivated).toBe("F002");
    expect(overlayHidden).toBe(true);
  });

  it("E2E: pressing Escape hides overlay without firing onAction", async () => {
    const mission = createMission("E2E Escape", "Test goal");

    let overlayHidden = false;
    let featureActivated: string | null = null;
    const mockTui = {
      hideOverlay: () => { overlayHidden = true; },
      requestRender: () => {},
    } as unknown as TUI;

    const component: any = missionControlOverlay(mission, (featureId) => { featureActivated = featureId; })(mockTui);

    // Verify component renders correctly
    const lines = component.render(80);
    expect(lines.some((l: string) => l.includes("Mission Control"))).toBe(true);

    // Press Escape (\x1b) — should hide overlay but NOT activate any feature
    component.handleInput("\x1b");
    expect(overlayHidden).toBe(true);
    expect(featureActivated).toBeNull();
  });

  it("warns when no mission", async () => {
    const ctx = mkCtx();
    await handleDashboard(ctx, { activeMission: null, autoSaveInterval: null });
    expect(ctx.getCalls()[0]!.msg).toContain("No active mission");
  });
});

describe("handleList", () => {
  const origHome = process.env.HOME;

  beforeAll(() => {
    process.env.HOME = tmpRoot;
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterAll(() => {
    process.env.HOME = origHome;
  });

  it("notifies when no missions exist", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    const pi = mkPi();
    await handleList(ctx, pi, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("No missions found");
  });

  it("lists missions as text when hasUI is false", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    const pi = mkPi();
    // Save a mission so listMissions finds something
    await saveMissionSafe(rt.activeMission!);
    await handleList(ctx, pi, rt);
    expect(ctx.getCalls()[0]!.level).toBe("info");
    expect(ctx.getCalls()[0]!.msg).toContain(rt.activeMission!.id);
  });

  it("selects and loads a mission when hasUI is true", async () => {
    const m = createMission("Selectable", "Test");
    await saveMissionSafe(m);
    const ctx = mkCtx({
      hasUI: true,
      ui: {
        notify: (msg: string, level: string) => { ctx.getCalls().push({ type: "notify", msg, level }); },
        setStatus: () => {},
        setWidget: () => {},
        custom: async () => {},
        input: async () => null,
        select: async () => `${m.id} — ${m.title} [0/3] active`,
        editor: async () => null,
        confirm: async () => true,
      },
    });
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    const pi = mkPi();
    await handleList(ctx, pi, rt);
    expect(rt.activeMission).not.toBeNull();
    expect(rt.activeMission!.id).toBe(m.id);
  });
});

describe("handleLoad", () => {
  const origHome = process.env.HOME;

  beforeAll(() => {
    process.env.HOME = tmpRoot;
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterAll(() => {
    process.env.HOME = origHome;
  });

  it("warns when no id provided", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    const pi = mkPi();
    await handleLoad(undefined, ctx, pi, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("Usage: /mission load");
    expect(ctx.getCalls()[0]!.level).toBe("warning");
  });

  it("warns when mission not found", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    const pi = mkPi();
    await handleLoad("pim:20260508120000000:nonexistent-mission-999", ctx, pi, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("Mission not found");
    expect(ctx.getCalls()[0]!.level).toBe("error");
  });

  it("loads mission by id and sets active", async () => {
    const m = createMission("Loadable", "Test load");
    await saveMissionSafe(m);
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    const pi = mkPi();
    await handleLoad(m.id, ctx, pi, rt);
    expect(rt.activeMission).not.toBeNull();
    expect(rt.activeMission!.id).toBe(m.id);
    expect(ctx.getCalls()[0]!.msg).toContain("Loaded mission");
  });
});

describe("handleEdit", () => {
  const origHome = process.env.HOME;

  beforeAll(() => {
    process.env.HOME = tmpRoot;
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterAll(() => {
    process.env.HOME = origHome;
  });

  it("warns when no feature id provided", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await handleEdit(undefined, ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("Usage: /mission edit");
    expect(ctx.getCalls()[0]!.level).toBe("warning");
  });

  it("warns when feature not found", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await handleEdit("F999", ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("Feature not found");
    expect(ctx.getCalls()[0]!.level).toBe("error");
  });

  it("shows JSON when hasUI is false", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await handleEdit("F001", ctx, rt);
    expect(ctx.getCalls()[0]!.level).toBe("info");
    expect(ctx.getCalls()[0]!.msg).toContain("F001");
  });

  it("edits feature via editor when hasUI is true", async () => {
    const ctx = mkCtx({
      hasUI: true,
      ui: {
        notify: (msg: string, level: string) => { ctx.getCalls().push({ type: "notify", msg, level }); },
        setStatus: () => {},
        setWidget: () => {},
        custom: async () => {},
        input: async () => null,
        select: async () => null,
        editor: async () => JSON.stringify({ ...rt.activeMission!.milestones[0].features[0]!, title: "Edited title" }),
        confirm: async () => true,
      },
    });
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);
    await handleEdit("F001", ctx, rt);
    expect(rt.activeMission!.milestones[0].features[0]!.title).toBe("Edited title");
  });

  it("handles invalid JSON from editor", async () => {
    const ctx = mkCtx({
      hasUI: true,
      ui: {
        notify: (msg: string, level: string) => { ctx.getCalls().push({ type: "notify", msg, level }); },
        setStatus: () => {},
        setWidget: () => {},
        custom: async () => {},
        input: async () => null,
        select: async () => null,
        editor: async () => "not valid json",
        confirm: async () => true,
      },
    });
    const rt = runtimeFixture();
    await handleEdit("F001", ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("Invalid feature JSON");
    expect(ctx.getCalls()[0]!.level).toBe("error");
  });
});

describe("handleTemplates", () => {
  it("lists templates by default", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    const pi = mkPi();
    await handleTemplates(undefined, undefined, "", ctx, pi, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("Available templates");
  });

  it("lists templates with 'list' sub", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    const pi = mkPi();
    await handleTemplates("list", undefined, "", ctx, pi, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("Available templates");
  });

  it("scaffolds a template mission", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    const pi = mkPi();
    await handleTemplates("scaffold", "refactor", "Refactor Service", ctx, pi, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("created from 'refactor'");
    expect(rt.activeMission).not.toBeNull();
    expect(rt.activeMission!.title).toContain("Refactor Service");
  });

  it("scaffold with unknown template shows error", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    const pi = mkPi();
    await handleTemplates("scaffold", "nonexistent", "", ctx, pi, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("Unknown template");
  });

  it("shows usage for unknown sub", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    const pi = mkPi();
    await handleTemplates("unknown", undefined, "", ctx, pi, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("Usage");
  });
});

describe("handleDashboard already-active branch", () => {
  it("notifies already active when selected feature is current active feature", async () => {
    const ctx = mkCtx({ hasUI: true });
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);
    // Manually trigger the overlay selection with the already-active feature
    let selectedFeatureId: string | null = null;
    await ctx.ui.custom(
      missionControlOverlay(rt.activeMission!, (featureId) => { selectedFeatureId = featureId; }),
      { overlay: true },
    );
    // The factory was captured via custom mock — we can't easily test this path
    // without a real TUI. Instead test via direct invocation of handleDashboard
    // by mocking the ui.custom callback to immediately select F001 (already active)
    let onActionCalled: string | null = null;
    const customCtx = mkCtx({
      hasUI: true,
      ui: {
        notify: (msg: string, level: string) => { customCtx.getCalls().push({ type: "notify", msg, level }); },
        setStatus: () => {},
        setWidget: () => {},
        custom: async (factory: any, _opts: any) => {
          const comp = factory({ hideOverlay: () => {}, requestRender: () => {} });
          // Navigate down to F001 (skip session metrics) and press Enter
          comp.handleInput("\x1b[B");
          comp.handleInput("\r");
        },
        input: async () => null,
        select: async () => null,
        editor: async () => null,
        confirm: async () => true,
      },
    });
    await handleDashboard(customCtx, rt);
    const alreadyActiveCall = customCtx.getCalls().find((c: any) => c.msg && c.msg.includes("Already active"));
    expect(alreadyActiveCall).toBeDefined();
    expect(alreadyActiveCall!.msg).toContain("F001");
  });
});

describe("handleFork", () => {
  it("warns when no active feature", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    await handleFork("reason", ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("No active feature");
  });

  it("forks active feature and creates new one", async () => {
    const ctx = mkCtx({ hasUI: true });
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);
    await handleFork("Alternative approach", ctx, rt);
    const f = rt.activeMission!.milestones[0].features[0]!;
    expect(f.status).toBe("blocked");
    // Fork creates a new feature in the milestone
    const forked = rt.activeMission!.milestones[0].features[3];
    expect(forked).toBeDefined();
    expect(forked!.title).toContain("[fork]");
  });

  it("forks and calls ctx.fork when leafId is available", async () => {
    let forkCalled = false;
    const ctx = mkCtx({
      hasUI: true,
      sessionManager: { getLeafId: () => "leaf-42" },
      fork: async (_leafId: string, _opts: any) => { forkCalled = true; },
    });
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);
    await handleFork("Alternative approach", ctx, rt);
    expect(forkCalled).toBe(true);
    const forked = rt.activeMission!.milestones[0].features[3];
    expect(forked).toBeDefined();
    expect(forked!.title).toContain("[fork]");
  });
});

describe("handleNew", () => {
  const origHome = process.env.HOME;

  beforeAll(() => {
    process.env.HOME = tmpRoot;
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterAll(() => {
    process.env.HOME = origHome;
  });

  it("creates mission without wizard when pi has no sendUserMessage", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    const pi = mkPi();
    await handleNew("Test Mission", ctx, pi, rt);
    expect(rt.activeMission).not.toBeNull();
    expect(rt.activeMission!.title).toBe("Test Mission");
    expect(ctx.getCalls()[0]!.msg).toContain("Mission created");
  });

  it("uses wizard when sendUserMessage returns valid JSON mission", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    const pi = mkPi({
      sendUserMessage: async () => JSON.stringify({
        title: "Wizard Mission",
        milestones: [
          {
            id: "M01", title: "M1", description: "D1", status: "active",
            features: [{
              id: "F001", milestoneId: "M01", title: "F1", description: "FD1",
              priority: 1, dependsOn: [],
              acceptance: [{ id: "AC001", description: "A1", checkType: "manual", verified: false }],
              status: "pending", sessions: [], toolCallCount: 0,
            }],
          },
          {
            id: "M02", title: "M2", description: "D2", status: "pending",
            features: [{
              id: "F002", milestoneId: "M02", title: "F2", description: "FD2",
              priority: 1, dependsOn: [],
              acceptance: [{ id: "AC002", description: "A2", checkType: "manual", verified: false }],
              status: "pending", sessions: [], toolCallCount: 0,
            }],
          },
        ],
      }),
    });
    await handleNew("Test Mission", ctx, pi, rt);
    expect(rt.activeMission).not.toBeNull();
    expect(rt.activeMission!.title).toBe("Wizard Mission");
    expect(rt.activeMission!.milestones.length).toBe(2);
    const aiGeneratedCall = ctx.getCalls().find((c: any) => c.msg && c.msg.includes("AI-generated"));
    expect(aiGeneratedCall).toBeDefined();
    expect(aiGeneratedCall!.msg).toContain("AI-generated");
  });

  it("falls back to default mission when wizard JSON is invalid", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    const pi = mkPi({ sendUserMessage: async () => "not valid json { bad" });
    await handleNew("Fallback", ctx, pi, rt);
    expect(rt.activeMission).not.toBeNull();
    expect(rt.activeMission!.title).toBe("Fallback");
    expect(ctx.getCalls()[0]!.msg).not.toContain("AI-generated");
  });

  it("falls back when wizard throws", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    const pi = mkPi({ sendUserMessage: async () => { throw new Error("wizard failed"); } });
    await handleNew("Error Fallback", ctx, pi, rt);
    expect(rt.activeMission).not.toBeNull();
    expect(rt.activeMission!.title).toBe("Error Fallback");
  });

  it("uses default title when no arg provided", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    const pi = mkPi();
    await handleNew("", ctx, pi, rt);
    expect(rt.activeMission).not.toBeNull();
    expect(rt.activeMission!.title).toBe("Untitled mission");
  });

  it("prompts for goal and constraints when hasUI is true", async () => {
    const inputs: string[] = ["Custom Goal", "no deps"];
    let inputIndex = 0;
    const ctx = mkCtx({
      hasUI: true,
      ui: {
        notify: (msg: string, level: string) => { ctx.getCalls().push({ type: "notify", msg, level }); },
        setStatus: () => {},
        setWidget: () => {},
        custom: async () => {},
        input: async () => inputs[inputIndex++] || null,
        select: async () => null,
        editor: async () => null,
        confirm: async () => true,
      },
    });
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    const pi = mkPi();
    await handleNew("UI Mission", ctx, pi, rt);
    expect(rt.activeMission).not.toBeNull();
    expect(rt.activeMission!.goal).toBe("Custom Goal");
  });
});

describe("handleDone auto-verifies acceptance criteria", () => {
  it("marks feature done and verifies bash checks", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);
    // Set up feature with bash acceptance criteria and mock execFn
    rt.activeMission!.milestones[0].features[0]!.acceptance = [
      { id: "AC001", description: "Bash check", checkType: "bash", checkCommand: "echo ok", verified: false },
    ];
    // Add mock execFn that returns success
    (rt.activeMission!.milestones[0].features[0] as any)._execFn = () => ({ code: 0, stdout: "ok" });
    await handleDone("done", ctx, rt);
    const f = rt.activeMission!.milestones[0].features[0]!;
    expect(f.status).toBe("done");
    expect(ctx.getCalls()[0]!.msg).toContain("✅ F001 done");
  });
});
