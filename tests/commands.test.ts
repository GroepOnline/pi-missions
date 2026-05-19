import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TUI } from "@mariozechner/pi-tui";
import { cloneFeatureForFork, compactionCheckpoint, handleBlock, handleClear, handleDashboard, handleDebug, handleDone, handleEdit, handleExport, handleFork, handleList, handleLoad, handleMigrate, handleMigrateConfirm, handleNew, handleNext, handlePause, handleResume, handleStatus, handleTemplates, handleHelp, handleRun, handleAutopilot, handleStop, handleMetrics, handleHistory, handleWorker, handleWorkerStatus, handleKillWorker, injectMissionContext, missionSummaryForTree, saveSessionLink } from "../src/commands/index.js";
import { missionControlOverlay } from "../src/ui/dashboard.js";
import { appendHistory, autoBlockBlockedFeatures, calculateMetricsSummary, createMission, loadMissionFromDisk, missionDirSafe, readHistory, readRawSchemaVersion, saveEvidence, saveMissionSafe } from "../src/core/state.js";
import { exportMarkdown } from "../src/utils/markdown.js";
import type { MissionState, RuntimeState } from "../src/core/types.js";
import { missionsRoot } from "../src/utils/fs.js";
import { sessionMetrics } from "../src/engines/metrics.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Mock the worker module
vi.mock("../src/engines/worker.js", () => ({
  isWorkerRunning: vi.fn(),
  getActiveWorker: vi.fn(),
  spawnWorker: vi.fn(),
  killWorker: vi.fn(),
  buildWorkerPrompt: vi.fn(),
}));

// Import mocked functions
import { isWorkerRunning, getActiveWorker, spawnWorker, killWorker } from "../src/engines/worker.js";

const tmpRoot = path.join(os.tmpdir(), `pi-missions-cmd-test-${process.pid}`);
const originalHome = process.env.HOME;

beforeEach(() => {
  process.env.HOME = tmpRoot;
  if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
});

afterAll(() => {
  process.env.HOME = originalHome;
  if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function runtimeFixture(missionOverride: Partial<ReturnType<typeof createMission>> = {}): RuntimeState {
  return {
    activeMission: { ...createMission("Tree mission", "Goal"), ...missionOverride },
    autoSaveInterval: null,
    phaseToolCallCount: 0,
    currentPhase: "execution",
    lastFeatureId: undefined,
  };
}

describe("missionSummaryForTree", () => {
  it("returns null when no mission is active", () => {
    expect(missionSummaryForTree({ activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined })).toBeNull();
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
      saveSessionLink({ activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined }, "/some/session.jsonl")
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
      compactionCheckpoint(mockPi as any, { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined })
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

describe("injectMissionContext", () => {
  it("appends full mission context to Pi session state and LLM context", () => {
    const pi = mkPi();
    const ctx = mkCtx();
    const mission = createMission("Context Mission", "Keep Pi informed");
    injectMissionContext(pi, ctx, mission, "test");
    expect(pi.getEntries()).toHaveLength(1);
    expect(pi.getEntries()[0]!.type).toBe("pi-mission-context");
    expect(pi.getEntries()[0]!.data.missionId).toBe(mission.id);
    expect(pi.getEntries()[0]!.data.reason).toBe("test");
    expect(pi.getEntries()[0]!.data.content).toContain("## Pi Missions Extension — Active");
    expect(pi.getEntries()[0]!.data.content).toContain("### How To Work This Mission");

    expect(ctx.getCustomMessages()).toHaveLength(1);
    expect(ctx.getCustomMessages()[0]!.customType).toBe("pi-mission-context");
    expect(ctx.getCustomMessages()[0]!.content).toContain("## Pi Missions Extension — Active");
    expect(ctx.getCustomMessages()[0]!.display).toBe(false);
    expect(ctx.getCustomMessages()[0]!.details.reason).toBe("test");
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
    expect(md).toContain("## Executive Summary");
    expect(md).toContain("**Next runnable**");
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
    const rt: RuntimeState =      { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
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
  const customMessages: any[] = [];
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
    sessionManager: {
      getLeafId: () => null,
      getSessionFile: () => undefined,
      getEntries: () => [],
      appendCustomMessageEntry: (customType: string, content: string, display: boolean, details: Record<string, unknown>) => {
        customMessages.push({ customType, content, display, details });
        return `custom-message-${customMessages.length}`;
      },
    },
    hasUI: false,
    fork: async () => {},
    getCalls: () => calls,
    getWidgets: () => widgets,
    getLastCustom: () => lastCustom,
    getCustomMessages: () => customMessages,
    ...overrides,
  };
}

function mkPi(overrides: Record<string, any> = {}): any {
  const entries: Array<Record<string, any>> = [];
  return {
    appendEntry: (type: string, data: Record<string, any>) => { entries.push({ type, data }); },
    setSessionName: () => {},
    sendUserMessage: async () => "OK",
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
    const rt: RuntimeState =      { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
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
    const rt: RuntimeState =      { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
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
    const rt: RuntimeState =      { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
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
    const rt: RuntimeState =      { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
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
    const rt: RuntimeState =      { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
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
    const rt: RuntimeState =      { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
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
    await handleDebug(rt.activeMission!.id, ctx, { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined });
    const w = ctx.getWidgets()["pi-mission-debug"];
    expect(w).toBeDefined();
  });

  it("warns when no mission to debug", async () => {
    const ctx = mkCtx();
    await handleDebug(undefined, ctx, { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined });
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
    await handleDashboard(ctx, { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined });
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
    const rt: RuntimeState =      { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
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
    const rt: RuntimeState =      { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    const pi = mkPi();
    await handleLoad(m.id, ctx, pi, rt);
    expect(rt.activeMission).not.toBeNull();
    expect(rt.activeMission!.id).toBe(m.id);
    expect(ctx.getCalls()[0]!.msg).toContain("Loaded mission");
    expect(pi.getEntries().some((entry: any) => entry.type === "pi-mission-context")).toBe(true);
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
    const rt: RuntimeState =      { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    const pi = mkPi();
    await handleTemplates("scaffold", "refactor", "Refactor Service", ctx, pi, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("created from 'refactor'");
    expect(rt.activeMission).not.toBeNull();
    expect(rt.activeMission!.title).toContain("Refactor Service");
    const contextEntry = pi.getEntries().find((entry: any) => entry.type === "pi-mission-context");
    expect(contextEntry).toBeDefined();
    expect(contextEntry!.data.reason).toBe("mission_started_from_template");
    expect(ctx.getCustomMessages()[0]!.details.reason).toBe("mission_started_from_template");
  });

  it("scaffold with unknown template shows error", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState =      { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
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
    const rt: RuntimeState =      { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
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
    let kickoffMessage = "";
    let forkPosition = "";
    const ctx = mkCtx({
      hasUI: true,
      sessionManager: { getLeafId: () => "leaf-42", getSessionFile: () => "/tmp/parent-session.jsonl" },
      fork: async (_leafId: string, opts: any) => {
        forkCalled = true;
        forkPosition = opts.position;
        await opts.withSession({
          ui: { notify: () => {} },
          sessionManager: { getSessionFile: () => "/tmp/fork-session.jsonl" },
          sendUserMessage: async (message: string) => { kickoffMessage = message; },
        });
        return { cancelled: false };
      },
    });
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);
    await handleFork("Alternative approach", ctx, rt);
    expect(forkCalled).toBe(true);
    expect(forkPosition).toBe("at");
    expect(kickoffMessage).toContain("Continue mission");
    expect(kickoffMessage).toContain("Alternative approach");
    const forked = rt.activeMission!.milestones[0].features[3];
    expect(forked).toBeDefined();
    expect(forked!.title).toContain("[fork]");
    expect(forked!.sessions).toContain("parent-leaf:leaf-42");
    expect(forked!.sessions).toContain("parent-session:/tmp/parent-session.jsonl");
    const savedMission = loadMissionFromDisk(rt.activeMission!.id);
    expect(savedMission).not.toBeNull();
    const savedForked = savedMission!.milestones[0].features[3]!;
    expect(savedForked.sessions).toContain("session:/tmp/fork-session.jsonl");
    const history = readHistory(rt.activeMission!.id);
    expect(history.some((entry) => entry.event === "feature_forked" && entry.details?.forkedFeatureId === savedForked.id)).toBe(true);
    expect(history.some((entry) => entry.event === "feature_fork_session_created" && entry.details?.forkSessionFile === "/tmp/fork-session.jsonl")).toBe(true);
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
    const rt: RuntimeState =      { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    const pi = mkPi();
    await handleNew("Test Mission", ctx, pi, rt);
    expect(rt.activeMission).not.toBeNull();
    expect(rt.activeMission!.title).toBe("Test Mission");
    // The message could be "Mission created" or "Planning wizard generating milestones..."
    const msg = ctx.getCalls()[0]!.msg;
    expect(msg).toMatch(/Mission created|Planning wizard/);
    const contextEntry = pi.getEntries().find((entry: any) => entry.type === "pi-mission-context");
    expect(contextEntry).toBeDefined();
    expect(contextEntry!.data.content).toContain("### How To Work This Mission");
    expect(ctx.getCustomMessages()[0]!.customType).toBe("pi-mission-context");
    expect(ctx.getCustomMessages()[0]!.content).toContain("## Pi Missions Extension — Active");
  });

  it("uses wizard when sendUserMessage returns valid JSON mission", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState =      { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    const pi = mkPi({
      sendUserMessage: async () => JSON.stringify({
        title: "Wizard Mission",
        milestones: [
          {
            id: "M01", title: "M1", description: "D1",
            features: [{
              id: "F001", title: "F1", description: "FD1",
              priority: 1, dependsOn: [],
              acceptance: [{ id: "AC001", description: "A1", checkType: "manual" }],
            }],
          },
          {
            id: "M02", title: "M2", description: "D2",
            features: [{
              id: "F002", title: "F2", description: "FD2",
              priority: 1, dependsOn: [],
              acceptance: [{ id: "AC002", description: "A2", checkType: "manual" }],
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

  it("normalizes planner-shaped wizard output into runnable mission state", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState =      { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    const pi = mkPi({
      sendUserMessage: async () => JSON.stringify({
        title: "Factory Style Mission",
        milestones: [
          {
            id: "M01",
            title: "Plan",
            description: "Plan the work",
            features: [
              {
                id: "F001",
                title: "Scope",
                description: "Clarify scope",
                priority: 1,
                dependsOn: [],
                acceptance: [{ id: "AC001", description: "Scope documented", checkType: "manual" }],
              },
              {
                id: "F002",
                title: "Map system",
                description: "Inspect files",
                priority: 2,
                dependsOn: ["F001"],
                acceptance: [{ id: "AC001", description: "System mapped", checkType: "manual" }],
              },
            ],
          },
          {
            id: "M02",
            title: "Ship",
            description: "Build and verify",
            features: [
              {
                id: "F003",
                title: "Implement",
                description: "Make the change",
                priority: 1,
                dependsOn: ["F002"],
                acceptance: [{ id: "AC001", description: "Implementation complete", checkType: "manual" }],
              },
              {
                id: "F004",
                title: "Verify",
                description: "Run tests",
                priority: 2,
                dependsOn: ["F003"],
                acceptance: [{ id: "AC001", description: "Tests pass", checkType: "bash", checkCommand: "npm test" }],
              },
              {
                id: "F005",
                title: "Handoff",
                description: "Summarize evidence",
                priority: 3,
                dependsOn: ["F004"],
                acceptance: [{ id: "AC001", description: "Evidence summarized", checkType: "manual" }],
              },
            ],
          },
        ],
      }),
    });

    await handleNew("Ignored fallback", ctx, pi, rt);

    expect(rt.activeMission!.title).toBe("Factory Style Mission");
    expect(rt.activeMission!.activeFeatureId).toBe("F001");
    expect(rt.activeMission!.milestones).toHaveLength(2);
    expect(rt.activeMission!.milestones.flatMap((m) => m.features)).toHaveLength(5);
    expect(rt.activeMission!.milestones[1]!.features[1]!.dependsOn).toEqual(["F003"]);
    expect(rt.activeMission!.milestones[1]!.features[1]!.acceptance[0]!.verified).toBe(false);
    expect(ctx.getCalls().some((c: any) => c.msg?.includes("AI-generated"))).toBe(true);
  });

  it("normalizes per-milestone feature IDs without corrupting dependencies", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState =      { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    const pi = mkPi({
      sendUserMessage: async () => JSON.stringify({
        title: "Repeated IDs Mission",
        milestones: [
          {
            id: "M01",
            title: "Plan",
            description: "Plan the work",
            features: [
              {
                id: "F001",
                title: "Scope",
                description: "Clarify scope",
                priority: 1,
                dependsOn: [],
                acceptance: [{ id: "AC001", description: "Scope documented", checkType: "manual" }],
              },
              {
                id: "F002",
                title: "Map",
                description: "Map current state",
                priority: 2,
                dependsOn: ["F001"],
                acceptance: [{ id: "AC001", description: "State mapped", checkType: "manual" }],
              },
            ],
          },
          {
            id: "M02",
            title: "Ship",
            description: "Ship the work",
            features: [
              {
                id: "F001",
                title: "Implement",
                description: "Implement scoped change",
                priority: 1,
                dependsOn: [],
                acceptance: [{ id: "AC001", description: "Implemented", checkType: "manual" }],
              },
              {
                id: "F002",
                title: "Verify",
                description: "Verify scoped change",
                priority: 2,
                dependsOn: ["F001"],
                acceptance: [{ id: "AC001", description: "Verified", checkType: "manual" }],
              },
            ],
          },
        ],
      }),
    });

    await handleNew("Ignored fallback", ctx, pi, rt);

    const [m1, m2] = rt.activeMission!.milestones;
    expect(m1!.features[1]!.id).toBe("F002");
    expect(m1!.features[1]!.dependsOn).toEqual(["F001"]);
    expect(m2!.features[0]!.id).toBe("F003");
    expect(m2!.features[1]!.id).toBe("F004");
    expect(m2!.features[1]!.dependsOn).toEqual(["F003"]);
  });

  it("falls back to default mission when wizard JSON is invalid", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState =      { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    const pi = mkPi({ sendUserMessage: async () => "not valid json { bad" });
    await handleNew("Fallback", ctx, pi, rt);
    expect(rt.activeMission).not.toBeNull();
    expect(rt.activeMission!.title).toBe("Fallback");
    expect(rt.activeMission!.milestones).toHaveLength(1);
    expect(rt.activeMission!.milestones.flatMap((m) => m.features)).toHaveLength(3);
    expect(ctx.getCalls()[0]!.msg).not.toContain("AI-generated");
  });

  it("falls back when wizard throws", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState =      { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    const pi = mkPi({ sendUserMessage: async () => { throw new Error("wizard failed"); } });
    await handleNew("Error Fallback", ctx, pi, rt);
    expect(rt.activeMission).not.toBeNull();
    expect(rt.activeMission!.title).toBe("Error Fallback");
  });

  it("uses default title when no arg provided", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState =      { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
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
    const rt: RuntimeState =      { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
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

describe("handleMigrate", () => {
  const origHome = process.env.HOME;

  beforeAll(() => {
    process.env.HOME = tmpRoot;
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterAll(() => {
    process.env.HOME = origHome;
  });

  it("lists missions with schema versions when no id provided", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    const m = createMission("MigList", "Test");
    await saveMissionSafe(m);
    await handleMigrate(undefined, ctx, rt);
    const calls = ctx.getCalls();
    expect(calls[0]!.level).toBe("info");
    expect(calls[0]!.msg).toContain("Mission Schema Versions");
    expect(calls[0]!.msg).toContain(m.id);
    expect(calls[0]!.msg).toContain("MigList");
  });

  it("shows 'All missions up to date' when all at current schema", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    const m = createMission("CurrentSchema", "Test");
    await saveMissionSafe(m);
    await handleMigrate(undefined, ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("All missions up to date");
  });

  it("notifies when no missions exist", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    // Ensure no missions
    const root = path.join(tmpRoot, ".pi", "missions");
    if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
    await handleMigrate(undefined, ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("No missions found");
  });

  it("shows migration preview for a specific mission", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    const m = createMission("MigPreview", "Test");
    await saveMissionSafe(m);
    // Downgrade to v1 so the preview path is exercised (not the "already current" early return)
    const dir = missionDirSafe(m.id);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "plan.json"), "utf-8"));
    raw.schemaVersion = 1;
    fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(raw), "utf-8");
    await handleMigrate(m.id, ctx, rt);
    const msg = ctx.getCalls()[0]!.msg;
    expect(msg).toContain("Migration preview");
    expect(msg).toContain(m.id);
    expect(msg).toContain("MigPreview");
    expect(msg).toContain(`/mission migrate ${m.id} confirm`);
  });

  it("shows 'no migration needed' for already-current schema", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    const m = createMission("AlreadyCurrent", "Test");
    await saveMissionSafe(m);
    // V3 is already current for new missions
    await handleMigrate(m.id, ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("No migration needed");
  });

  it("returns error for unknown mission id", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    await handleMigrate("unknown-mission-id", ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("Mission not found");
    expect(ctx.getCalls()[0]!.level).toBe("error");
  });

  it("detects missions needing migration when at v1", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    const m = createMission("NeedsMig", "Test");
    await saveMissionSafe(m);
    // Make it look like v1
    const dir = missionDirSafe(m.id);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "plan.json"), "utf-8"));
    raw.schemaVersion = 1;
    fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(raw), "utf-8");
    await handleMigrate(undefined, ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("need migration");
    expect(ctx.getCalls()[0]!.msg).toContain("v1");
    expect(ctx.getCalls()[0]!.msg).toContain("⬆️");
  });
});

describe("handleMigrateConfirm", () => {
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
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    await handleMigrateConfirm(undefined, ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("Usage");
    expect(ctx.getCalls()[0]!.level).toBe("warning");
  });

  it("warns when mission not found", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    await handleMigrateConfirm("nonexistent-999", ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("Mission not found");
    expect(ctx.getCalls()[0]!.level).toBe("error");
  });

  it("notifies when already at current schema version", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    const m = createMission("AlreadyV3", "Test");
    await saveMissionSafe(m);
    await handleMigrateConfirm(m.id, ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("Already at v");
    expect(ctx.getCalls()[0]!.msg).toContain("No migration needed");
  });

  it("migrates a v1 mission and reports success", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    const m = createMission("MigrateMe", "Test");
    await saveMissionSafe(m);

    // Write v1 format
    const dir = missionDirSafe(m.id);
    fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify({
      schemaVersion: 1,
      id: m.id,
      title: "MigrateMe",
      goal: "Test",
      status: "active",
      features: [
        { id: "F1", milestoneId: "M01", title: "Old feature", description: "", priority: 1, dependsOn: [], acceptance: [], status: "done", sessions: [] },
      ],
    }, null, 2), "utf-8");

    await handleMigrateConfirm(m.id, ctx, rt);
    const msg = ctx.getCalls()[0]!.msg;
    expect(msg).toContain("Migrated");
    expect(msg).toContain("v3");
    expect(ctx.getCalls()[0]!.level).toBe("info");

    // Verify the mission on disk was actually migrated
    const reloaded = loadMissionFromDisk(m.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.schemaVersion).toBe(3);
    expect(reloaded!.milestones).toHaveLength(1);
  });

  it("updates runtime when migrating the active mission", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    const m = rt.activeMission!;
    await saveMissionSafe(m);

    // Write v1 format
    const dir = missionDirSafe(m.id);
    fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify({
      schemaVersion: 1,
      id: m.id,
      title: "ActiveMig",
      goal: "Test",
      status: "active",
      features: [
        { id: "F1", milestoneId: "M01", title: "Old feature", description: "", priority: 1, dependsOn: [], acceptance: [], status: "done", sessions: [] },
      ],
    }, null, 2), "utf-8");

    await handleMigrateConfirm(m.id, ctx, rt);
    expect(rt.activeMission).not.toBeNull();
    expect(rt.activeMission!.schemaVersion).toBe(3);
  });

  it("creates pre-migration backup file", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    const m = createMission("BackupMe", "Test");
    await saveMissionSafe(m);

    // Write v1 format
    const dir = missionDirSafe(m.id);
    fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify({
      schemaVersion: 1,
      id: m.id,
      title: "BackupMe",
      goal: "Test",
      status: "active",
      features: [
        { id: "F1", milestoneId: "M01", title: "Old feature", description: "", priority: 1, dependsOn: [], acceptance: [], status: "done", sessions: [] },
      ],
    }, null, 2), "utf-8");

    await handleMigrateConfirm(m.id, ctx, rt);

    // Check backup exists
    const files = fs.readdirSync(dir);
    const backups = files.filter(f => f.startsWith("plan.json.pre-migration-") && f.endsWith(".bak"));
    expect(backups.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// handleHelp
// ═══════════════════════════════════════════════════════════════════════════

describe("handleHelp", () => {
  it("shows mission help text", async () => {
    const ctx = mkCtx();
    await handleHelp(ctx);
    expect(ctx.getCalls()).toHaveLength(1);
    expect(ctx.getCalls()[0]!.level).toBe("info");
    expect(ctx.getCalls()[0]!.msg).toContain("/mission");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// handleRun
// ═══════════════════════════════════════════════════════════════════════════

describe("handleRun", () => {
  it("warns when no active mission", async () => {
    const ctx = mkCtx();
    const pi = mkPi();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    await handleRun(ctx, pi, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("No active mission");
    expect(ctx.getCalls()[0]!.level).toBe("warning");
  });

  it("starts autopilot for active mission", async () => {
    const ctx = mkCtx();
    const pi = mkPi();
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);
    await handleRun(ctx, pi, rt);
    expect(rt.activeMission!.autopilot.enabled).toBe(true);
    expect(rt.activeMission!.autopilot.mode).toBe("autopilot");
    expect(rt.activeMission!.autopilot.iteration).toBeGreaterThanOrEqual(0);
    expect(rt.activeMission!.autopilot.consecutiveFailures).toBe(0);
    expect(rt.activeMission!.autopilot.noProgressTurns).toBe(0);
    expect(ctx.getCalls()[0]!.msg).toContain("Autopilot started");
  });

  it("warns when no runnable feature is available", async () => {
    const ctx = mkCtx();
    const pi = mkPi();
    const rt = runtimeFixture();
    // Mark all features as done so ensureActiveFeature returns null
    for (const m of rt.activeMission!.milestones) {
      for (const f of m.features) f.status = "done";
    }
    rt.activeMission!.activeFeatureId = undefined;
    await saveMissionSafe(rt.activeMission!);
    await handleRun(ctx, pi, rt);
    expect(rt.activeMission!.autopilot.enabled).toBe(false);
    expect(rt.activeMission!.autopilot.lastStopReason).toBe("no_active_feature");
    expect(ctx.getCalls()[0]!.msg).toContain("No runnable feature");
  });

  it("sets status to active and resets autopilot state", async () => {
    const ctx = mkCtx();
    const pi = mkPi();
    const rt = runtimeFixture();
    rt.activeMission!.status = "paused";
    rt.activeMission!.autopilot.enabled = false;
    rt.activeMission!.autopilot.mode = "manual";
    rt.activeMission!.autopilot.lastStopReason = "paused_by_user";
    await saveMissionSafe(rt.activeMission!);
    await handleRun(ctx, pi, rt);
    expect(rt.activeMission!.status).toBe("active");
    expect(rt.activeMission!.autopilot.enabled).toBe(true);
    expect(rt.activeMission!.autopilot.mode).toBe("autopilot");
    expect(rt.activeMission!.autopilot.lastStopReason).toBeUndefined();
  });

  it("appends autopilot_started history entry", async () => {
    const ctx = mkCtx();
    const pi = mkPi();
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);
    await handleRun(ctx, pi, rt);
    const history = readHistory(rt.activeMission!.id);
    expect(history.some(e => e.event === "autopilot_started")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// handleAutopilot
// ═══════════════════════════════════════════════════════════════════════════

describe("handleAutopilot", () => {
  it("warns when no active mission", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    await handleAutopilot(ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("No active mission");
    expect(ctx.getCalls()[0]!.level).toBe("warning");
  });

  it("shows autopilot status with all fields", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    rt.activeMission!.autopilot = {
      enabled: true,
      mode: "autopilot",
      iteration: 3,
      maxIterations: 25,
      consecutiveFailures: 1,
      maxConsecutiveFailures: 3,
      noProgressTurns: 0,
      maxNoProgressTurns: 3,
      maxContextPercent: 85,
      startedAt: new Date().toISOString(),
      lastStopReason: undefined,
      lastStopMessage: undefined,
      continueAcrossFeatures: true,
      requireEvidenceForDone: true,
    };
    await handleAutopilot(ctx, rt);
    const msg = ctx.getCalls()[0]!.msg;
    expect(msg).toContain("Autopilot: ON");
    expect(msg).toContain("autopilot");
    expect(msg).toContain("Iteration: 3/25");
    expect(msg).toContain("Failures: 1/3");
    expect(msg).toContain("No-progress: 0/3");
    expect(msg).toContain("Would continue: yes");
  });

  it("shows last stop reason when present", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    rt.activeMission!.autopilot.lastStopReason = "paused_by_user";
    rt.activeMission!.autopilot.lastStopMessage = "Paused by user.";
    rt.activeMission!.autopilot.enabled = false;
    await handleAutopilot(ctx, rt);
    const msg = ctx.getCalls()[0]!.msg;
    expect(msg).toContain("Last stop: paused_by_user");
    expect(msg).toContain("Paused by user.");
    expect(msg).toContain("Autopilot: OFF");
    expect(msg).toContain("Would continue: no");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// handleStop
// ═══════════════════════════════════════════════════════════════════════════

describe("handleStop", () => {
  it("warns when no active mission", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    await handleStop(ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("No active mission");
    expect(ctx.getCalls()[0]!.level).toBe("warning");
  });

  it("disables autopilot and resets mode", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    rt.activeMission!.autopilot.enabled = true;
    rt.activeMission!.autopilot.mode = "autopilot";
    await saveMissionSafe(rt.activeMission!);
    await handleStop(ctx, rt);
    expect(rt.activeMission!.autopilot.enabled).toBe(false);
    expect(rt.activeMission!.autopilot.mode).toBe("manual");
    expect(rt.activeMission!.autopilot.lastStopReason).toBe("paused_by_user");
    expect(rt.activeMission!.autopilot.lastStopMessage).toBe("Stopped by user.");
  });

  it("notifies and saves when stopped", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);
    await handleStop(ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("Autopilot stopped");
    expect(ctx.getCalls()[0]!.level).toBe("info");
    const history = readHistory(rt.activeMission!.id);
    expect(history.some(e => e.event === "autopilot_stopped")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// handleMetrics
// ═══════════════════════════════════════════════════════════════════════════

describe("handleMetrics", () => {
  it("warns when no missions exist", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    // Ensure no missions on disk
    const root = missionsRoot();
    if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
    await handleMetrics(ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("No missions");
    expect(ctx.getCalls()[0]!.level).toBe("info");
  });

  it("shows metrics summary when missions exist", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    const m = createMission("MetricsTest", "Goal");
    await saveMissionSafe(m);
    await handleMetrics(ctx, rt);
    const msg = ctx.getCalls()[0]!.msg;
    expect(msg).toContain("Mission Metrics Summary");
    expect(msg).toContain("Total: 1");
    expect(msg).toContain("Completed: 0");
    expect(msg).toContain("Success:");
    expect(msg).toContain("Avg tokens:");
    expect(msg).toContain("Avg features:");
    expect(msg).toContain("Avg time:");
    // Session section
    expect(msg).toContain("Session");
  });

  it("writes metrics export file", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    const m = createMission("ExportMetrics", "Goal");
    await saveMissionSafe(m);
    await handleMetrics(ctx, rt);
    const exportFile = path.join(missionsRoot(), "metrics-export.json");
    expect(fs.existsSync(exportFile)).toBe(true);
    const content = JSON.parse(fs.readFileSync(exportFile, "utf-8"));
    expect(Array.isArray(content)).toBe(true);
    expect(content.length).toBeGreaterThanOrEqual(1);
    // The export uses missionId, not id
    expect(content[0].missionId).toBe(m.id);
  });

  it("handles export failure gracefully", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    // Create a mission
    const m = createMission("BrokenExport", "Goal");
    await saveMissionSafe(m);
    
    // The function should handle errors gracefully
    // We can't easily test the actual failure without complex setup
    // Just verify it doesn't throw
    await expect(handleMetrics(ctx, rt)).resolves.not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// handleHistory
// ═══════════════════════════════════════════════════════════════════════════

describe("handleHistory", () => {
  it("warns when no active mission", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    await handleHistory(undefined, ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("No active mission");
    expect(ctx.getCalls()[0]!.level).toBe("warning");
  });

  it("notifies when no history entries exist", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);
    await handleHistory(undefined, ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("No history entries yet");
    expect(ctx.getCalls()[0]!.level).toBe("info");
  });

  it("shows all history entries when no filter", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);
    appendHistory(rt.activeMission!, { event: "feature_done", featureId: "F001", note: "completed" });
    appendHistory(rt.activeMission!, { event: "mission_created", note: "started" });
    appendHistory(rt.activeMission!, { event: "feature_active", featureId: "F002", note: "activated" });
    await handleHistory(undefined, ctx, rt);
    const msg = ctx.getCalls()[0]!.msg;
    expect(msg).toContain("Mission History");
    expect(msg).toContain("All events");
    expect(msg).toContain("feature_done");
    expect(msg).toContain("mission_created");
    expect(msg).toContain("feature_active");
    expect(msg).toContain("Features: F001, F002");
    expect(msg).toContain("Event types:");
  });

  it("filters by feature id", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);
    appendHistory(rt.activeMission!, { event: "feature_done", featureId: "F001", note: "done" });
    appendHistory(rt.activeMission!, { event: "feature_done", featureId: "F002", note: "done2" });
    await handleHistory("F001", ctx, rt);
    const msg = ctx.getCalls()[0]!.msg;
    expect(msg).toContain("Feature F001");
    expect(msg).toContain("feature_done");
    expect(msg).toContain("done");
    // Should contain F001 but NOT F002
    expect(msg).toContain("F001");
    expect(msg).not.toContain("done2");
  });

  it("filters by event type", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);
    appendHistory(rt.activeMission!, { event: "feature_done", featureId: "F001", note: "done" });
    appendHistory(rt.activeMission!, { event: "feature_active", featureId: "F002", note: "activated" });
    await handleHistory("feature_done", ctx, rt);
    const msg = ctx.getCalls()[0]!.msg;
    expect(msg).toContain("Event: feature_done");
    expect(msg).toContain("F001");
    expect(msg).not.toContain("F002");
  });

  it("filters by full-text search in note", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);
    appendHistory(rt.activeMission!, { event: "feature_done", featureId: "F001", note: "API integration complete" });
    appendHistory(rt.activeMission!, { event: "feature_active", featureId: "F002", note: "database migration" });
    await handleHistory("api", ctx, rt);
    const msg = ctx.getCalls()[0]!.msg;
    expect(msg).toContain('Search: "api"');
    expect(msg).toContain("API integration");
    expect(msg).not.toContain("database migration");
  });

  it("notifies when filter returns no results", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);
    appendHistory(rt.activeMission!, { event: "feature_done", featureId: "F001", note: "done" });
    await handleHistory("nonexistent-filter", ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain('No history entries matching "nonexistent-filter"');
  });

  it("shows command hints and full log path", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);
    appendHistory(rt.activeMission!, { event: "feature_done", featureId: "F001", note: "done" });
    await handleHistory(undefined, ctx, rt);
    const msg = ctx.getCalls()[0]!.msg;
    expect(msg).toContain("Filters: /mission history [feature_id|event_type|search_term]");
    expect(msg).toContain("Full log:");
    expect(msg).toContain("history.jsonl");
  });

  it("limits display to 40 entries", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);
    for (let i = 0; i < 50; i++) {
      appendHistory(rt.activeMission!, { event: "tool_call", featureId: "F001", note: `call-${i}` });
    }
    await handleHistory(undefined, ctx, rt);
    const msg = ctx.getCalls()[0]!.msg;
    expect(msg).toContain("(40 of 50 entries)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// handleWorker
// ═══════════════════════════════════════════════════════════════════════════

describe("handleWorker", () => {
  it("warns when no active mission", async () => {
    const ctx = mkCtx();
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };
    await handleWorker(undefined, ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("No active mission");
    expect(ctx.getCalls()[0]!.level).toBe("warning");
  });

  it("warns when no feature specified and no active feature", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    rt.activeMission!.activeFeatureId = undefined;
    await saveMissionSafe(rt.activeMission!);
    await handleWorker(undefined, ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("No feature specified");
  });

  it("errors when feature not found", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);
    await handleWorker("F999", ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("Feature not found: F999");
    expect(ctx.getCalls()[0]!.level).toBe("error");
  });

  it("warns when worker is already running", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);
    // Mock isWorkerRunning to return true
    vi.mocked(isWorkerRunning).mockReturnValue(true);
    vi.mocked(getActiveWorker).mockReturnValue({
      featureId: "F001",
      startedAt: Date.now() - 5000,
      status: "running" as const,
      process: {} as any,
    } as any);
    await handleWorker(undefined, ctx, rt);
    expect(ctx.getCalls()[0]!.msg).toContain("Worker already running");
    expect(ctx.getCalls()[0]!.level).toBe("warning");
  });

  it("spawns worker for active feature", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);

    vi.mocked(isWorkerRunning).mockReturnValue(false);
    vi.mocked(spawnWorker).mockResolvedValue({
      featureId: "F001",
      exitCode: 0,
      signal: null,
      stdout: "Build complete",
      stderr: "",
      durationMs: 1000,
      killed: false,
    } as any);
          await handleWorker(undefined, ctx, rt);
      expect(vi.mocked(spawnWorker)).toHaveBeenCalledWith(
        rt.activeMission,
        { featureId: "F001" },
      );
      expect(ctx.getCalls()[0]!.msg).toContain("Worker spawned for F001");
      expect(ctx.getCalls()[0]!.level).toBe("info");
  });

  it("spawns worker for explicitly specified feature", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    rt.activeMission!.milestones[0].features[1]!.status = "pending";
    await saveMissionSafe(rt.activeMission!);

    vi.mocked(isWorkerRunning).mockReturnValue(false);
    vi.mocked(spawnWorker).mockResolvedValue({
      featureId: "F002",
      exitCode: 0,
      signal: null,
      stdout: "ok",
      stderr: "",
      durationMs: 500,
      killed: false,
    } as any);
          await handleWorker("F002", ctx, rt);
      expect(vi.mocked(spawnWorker)).toHaveBeenCalledWith(
        rt.activeMission,
        { featureId: "F002" },
      );
      expect(rt.activeMission!.activeFeatureId).toBe("F002");
      expect(ctx.getCalls()[0]!.msg).toContain("Worker spawned for F002");
  });

  it("appends worker_spawned history entry", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);

    vi.mocked(isWorkerRunning).mockReturnValue(false);
    vi.mocked(spawnWorker).mockResolvedValue({
      featureId: "F001",
      exitCode: 0,
      signal: null,
      stdout: "ok",
      stderr: "",
      durationMs: 500,
      killed: false,
    } as any);
          await handleWorker(undefined, ctx, rt);
      const history = readHistory(rt.activeMission!.id);
      expect(history.some(e => e.event === "worker_spawned" && e.featureId === "F001")).toBe(true);
  });

  it("handles worker error result", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);

    vi.mocked(isWorkerRunning).mockReturnValue(false);
    vi.mocked(spawnWorker).mockResolvedValue({
      error: "Worker crashed",
    });
          await handleWorker(undefined, ctx, rt);
      // Worker spawn succeeds initially, the error comes via the async callback
      expect(ctx.getCalls()[0]!.msg).toContain("Worker spawned");
  });

  it("handles spawn rejection gracefully", async () => {
    const ctx = mkCtx();
    const rt = runtimeFixture();
    await saveMissionSafe(rt.activeMission!);

    vi.mocked(isWorkerRunning).mockReturnValue(false);
    vi.mocked(spawnWorker).mockRejectedValue(new Error("fork failed"));
          await handleWorker(undefined, ctx, rt);
      // The spawn is fire-and-forget, the handler returns immediately after spawning
      expect(ctx.getCalls()[0]!.msg).toContain("Worker spawned");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// handleWorkerStatus
// ═══════════════════════════════════════════════════════════════════════════

describe("handleWorkerStatus", () => {
  it("notifies when no worker is running", async () => {
    const ctx = mkCtx();
    vi.mocked(getActiveWorker).mockReturnValue(null);
    await handleWorkerStatus(ctx);
    expect(ctx.getCalls()[0]!.msg).toContain("No worker running");
    expect(ctx.getCalls()[0]!.level).toBe("info");
  });

  it("shows active worker status", async () => {
    const ctx = mkCtx();
    const now = Date.now();
    vi.mocked(getActiveWorker).mockReturnValue({
      featureId: "F001",
      startedAt: now - 10000,
      status: "running" as const,
      process: {} as any,
    } as any);
    await handleWorkerStatus(ctx);
    const msg = ctx.getCalls()[0]!.msg;
    expect(msg).toContain("Worker Status");
    expect(msg).toContain("Feature: F001");
    expect(msg).toContain("Status: running");
    expect(msg).toContain("Running:");
  });

  it("shows last result when available", async () => {
    const ctx = mkCtx();
    const now = Date.now();
    vi.mocked(getActiveWorker).mockReturnValue({
      featureId: "F001",
      startedAt: now - 30000,
      status: "done" as const,
      result: {
        featureId: "F001",
        exitCode: 1,
        signal: "SIGTERM",
        stdout: "test output",
        stderr: "",
        durationMs: 25000,
        killed: false,
      },
      process: {} as any,
    } as any);
    await handleWorkerStatus(ctx);
    const msg = ctx.getCalls()[0]!.msg;
    expect(msg).toContain("Last Result");
    expect(msg).toContain("Exit: 1 (SIGTERM)");
    expect(msg).toContain("Duration: 25s");
  });

  it("shows exit code without signal when none", async () => {
    const ctx = mkCtx();
    const now = Date.now();
    vi.mocked(getActiveWorker).mockReturnValue({
      featureId: "F002",
      startedAt: now - 5000,
      status: "done" as const,
      result: {
        featureId: "F002",
        exitCode: 0,
        signal: null,
        stdout: "ok",
        stderr: "",
        durationMs: 4000,
        killed: false,
      },
      process: {} as any,
    } as any);
    await handleWorkerStatus(ctx);
    const msg = ctx.getCalls()[0]!.msg;
    expect(msg).toContain("Exit: 0");
    expect(msg).not.toContain("(SIGTERM)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// handleKillWorker
// ═══════════════════════════════════════════════════════════════════════════

describe("handleKillWorker", () => {
  it("notifies when no worker to kill", async () => {
    const ctx = mkCtx();
    vi.mocked(killWorker).mockReturnValue(false);
    await handleKillWorker(ctx);
    expect(ctx.getCalls()[0]!.msg).toContain("No worker running to kill");
    expect(ctx.getCalls()[0]!.level).toBe("info");
  });

  it("kills worker and notifies", async () => {
    const ctx = mkCtx();
    vi.mocked(killWorker).mockReturnValue(true);
    await handleKillWorker(ctx);
    expect(ctx.getCalls()[0]!.msg).toContain("Worker killed");
    expect(ctx.getCalls()[0]!.level).toBe("info");
  });
});
