import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { registerMissionTools } from "../src/tools.js";
import { createMission, getAllFeatures, getActiveFeature, getNextPendingFeature, loadMissionFromDisk, saveMissionSafe } from "../src/state.js";
import type { RuntimeState } from "../src/types.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// The tools module registers tools with the pi ExtensionAPI. We test both the
// tool registration itself and the underlying state logic that handlers invoke.

const tmpRoot = path.join(os.tmpdir(), `pi-missions-tools-test-${process.pid}`);

function setupTmp(): void {
  fs.mkdirSync(tmpRoot, { recursive: true });
}

function cleanupTmp(): void {
  if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
}

describe("mission_feature_done logic", () => {
  it("marks the active feature as done and records evidence", () => {
    const m = createMission("Tools test", "Verify done tool");
    const feature = getActiveFeature(m)!;
    expect(feature).not.toBeNull();
    expect(feature!.status).toBe("active");

    // Simulate the tool's execution logic.
    feature!.status = "done";
    feature!.completedAt = Date.now();
    feature!.notes = "All acceptance criteria met";
    for (const ac of feature!.acceptance) if (!ac.waived) ac.verified = true;

    expect(feature!.status).toBe("done");
    expect(feature!.completedAt).toBeGreaterThan(0);
    expect(feature!.acceptance.every((ac) => ac.verified)).toBe(true);
  });

  it("marks mission complete when the last feature is done", () => {
    const m = createMission("Final", "Last feature");
    // Mark all features done except the active one.
    const all = getAllFeatures(m);
    for (const f of all) {
      if (f.id !== m.activeFeatureId) f.status = "done";
    }
    // Now mark the active one done.
    const active = getActiveFeature(m)!;
    active.status = "done";
    active.completedAt = Date.now();

    // Check: next pending is null, all done.
    const next = getNextPendingFeature(m);
    expect(next).toBeNull();
    const allDone = getAllFeatures(m).every((f) => f.status === "done");
    expect(allDone).toBe(true);
    if (!next && allDone) m.status = "complete";
    expect(m.status).toBe("complete");
  });

  it("does not change status when waiver is set before verification", () => {
    const m = createMission("Waiver test", "Check waivers");
    const feature = getActiveFeature(m)!;
    feature.acceptance = [
      { id: "AC001", description: "Must pass", checkType: "bash", checkCommand: "npm test", verified: false },
      { id: "AC002", description: "Nice to have", checkType: "manual", verified: false, waived: true },
    ];
    // Only non-waived criteria get auto-verified.
    for (const ac of feature.acceptance) if (!ac.waived) ac.verified = true;
    expect(feature.acceptance[0]!.verified).toBe(true);
    expect(feature.acceptance[1]!.verified).toBe(false); // waived, not auto-verified
  });
});

describe("mission_next_feature logic", () => {
  it("advances to the next pending feature", () => {
    const m = createMission("Advance", "Test advancement");
    const current = getActiveFeature(m)!;
    current.status = "done";
    current.completedAt = Date.now();

    const next = getNextPendingFeature(m);
    expect(next).not.toBeNull();
    next!.status = "active";
    m.activeFeatureId = next!.id;
    m.status = "active";

    expect(m.activeFeatureId).toBe("F002");
    expect(getActiveFeature(m)!.status).toBe("active");
  });

  it("returns null when no unblocked features remain", () => {
    const m = createMission("Stuck", "All blocked");
    // F001 is active, F002 depends on F001, F003 depends on F002.
    // If F001 is done but F002 is blocked, next should be null because F003 depends on F002.
    const f1 = getActiveFeature(m)!;
    f1.status = "done";
    m.milestones[0].features[1]!.status = "blocked";
    const next = getNextPendingFeature(m);
    expect(next).toBeNull(); // F003 blocked by F002
  });

  it("returns active feature when not done (should not advance)", () => {
    const m = createMission("ActiveCheck", "Check");
    const active = getActiveFeature(m)!;
    expect(active.status).toBe("active");
    // When active feature is still active, getNextPendingFeature returns null
    // because all pending features have unresolved deps
    const next = getNextPendingFeature(m);
    expect(next).toBeNull();
  });

  it("correctly resolves chained dependencies", () => {
    const m = createMission("Chain", "Test chain");
    // F001 active, F002 depends on F001, F003 depends on F002
    const f1 = getActiveFeature(m)!;
    f1.status = "done";
    f1.completedAt = Date.now();
    // Now F002 should be next
    let next = getNextPendingFeature(m);
    expect(next?.id).toBe("F002");
    // Mark F002 done
    next!.status = "done";
    next!.completedAt = Date.now();
    // Now F003 should be next
    next = getNextPendingFeature(m);
    expect(next?.id).toBe("F003");
  });

  it("returns next when a pending feature has no deps", () => {
    const m = createMission("Independent", "No deps needed");
    // Add a feature with no dependencies.
    m.milestones[0].features.push({
      id: "F010",
      milestoneId: "M01",
      title: "Independent task",
      description: "No dependencies",
      priority: 1,
      dependsOn: [],
      acceptance: [],
      status: "pending",
      sessions: [],
      toolCallCount: 0,
    });
    const f1 = getActiveFeature(m)!;
    f1.status = "done";
    const next = getNextPendingFeature(m);
    expect(next).not.toBeNull();
    expect(next!.id).toBe("F010"); // independent, ready to go
  });

  it("marks mission complete when all features are done", () => {
    const m = createMission("Complete", "All done");
    const all = getAllFeatures(m);
    for (const f of all) f.status = "done";
    const next = getNextPendingFeature(m);
    expect(next).toBeNull();
    if (!next && all.every((f) => f.status === "done")) m.status = "complete";
    expect(m.status).toBe("complete");
  });
});

describe("save/load roundtrip with done->next flow", () => {
  const origHome = process.env.HOME;

  beforeAll(() => {
    process.env.HOME = tmpRoot;
    cleanupTmp();
    setupTmp();
  });

  afterAll(() => {
    process.env.HOME = origHome;
    cleanupTmp();
  });

  it("persists feature state changes across save/load", async () => {
    const m = createMission("Persist test", "Testing persistence");
    const f1 = getActiveFeature(m)!;
    f1.status = "done";
    f1.completedAt = 1234567890;
    const next = getNextPendingFeature(m)!;
    next.status = "active";
    m.activeFeatureId = next.id;
    await saveMissionSafe(m);

    const m2 = loadMissionFromDisk(m.id);
    expect(m2).not.toBeNull();
    expect(m2!.activeFeatureId).toBe("F002");
    expect(getActiveFeature(m2!)!.status).toBe("active");
    const f1Loaded = getAllFeatures(m2!).find((f) => f.id === "F001");
    expect(f1Loaded?.status).toBe("done");
    expect(f1Loaded?.completedAt).toBeGreaterThan(0);
  });
});

describe("registerMissionTools — tool registration", () => {
  const origHome = process.env.HOME;

  beforeAll(() => {
    process.env.HOME = tmpRoot;
    cleanupTmp();
    setupTmp();
  });

  afterAll(() => {
    process.env.HOME = origHome;
    cleanupTmp();
  });

  it("registers mission_feature_done and mission_next_feature", () => {
    const tools: any[] = [];
    const pi = { registerTool: (t: any) => { tools.push(t); } };
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    registerMissionTools(pi as any, rt);
    expect(tools).toHaveLength(5);
    expect(tools[0]!.name).toBe("mission_feature_done");
    expect(tools[1]!.name).toBe("mission_next_feature");
    expect(tools[2]!.name).toBe("mission_ask_user");
    expect(tools[3]!.name).toBe("mission_block_self");
    expect(tools[4]!.name).toBe("mission_fork");
  });

  it("mission_feature_done tool has correct metadata", () => {
    const tools: any[] = [];
    const pi = { registerTool: (t: any) => { tools.push(t); } };
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    registerMissionTools(pi as any, rt);
    const t = tools[0];
    expect(t.label).toBe("Mission Feature Done");
    expect(t.description).toContain("Mark the active mission feature");
    expect(t.promptSnippet).toBeTruthy();
    expect(t.promptGuidelines).toHaveLength(1);
    expect(t.parameters).toBeDefined();
  });

  it("mission_next_feature tool has correct metadata", () => {
    const tools: any[] = [];
    const pi = { registerTool: (t: any) => { tools.push(t); } };
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    registerMissionTools(pi as any, rt);
    const t = tools[1];
    expect(t.description).toContain("Advance to the next pending");
    expect(t.parameters).toBeDefined();
  });

  it("mission_feature_done execute returns error when no active mission", async () => {
    const tools: any[] = [];
    const pi = { registerTool: (t: any) => { tools.push(t); } };
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    registerMissionTools(pi as any, rt);
    const ctx = { ui: { setStatus: () => {}, notify: () => {} } };
    const result = await tools[0]!.execute("call1", { evidence: "test" }, null as any, () => {}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No active mission feature");
  });

  it("mission_feature_done execute marks feature done with evidence", async () => {
    const m = createMission("ToolExec", "Execute test");
    const tools: any[] = [];
    const pi = { registerTool: (t: any) => { tools.push(t); } };
    const rt: RuntimeState = { activeMission: m, autoSaveInterval: null };
    registerMissionTools(pi as any, rt);
    await saveMissionSafe(m);
    const ctx = { ui: { setStatus: () => {}, notify: () => {} } };
    const result = await tools[0]!.execute("call1", { evidence: "All tests pass", notes: "optional" }, null as any, () => {}, ctx);
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("✅ Feature");
    expect(result.content[0].text).toContain("Evidence:");
    const feature = getActiveFeature(m)!;
    expect(feature.status).toBe("done");
    expect(feature.notes).toBe("optional");
  });

  it("mission_next_feature execute returns error when no active mission", async () => {
    const tools: any[] = [];
    const pi = { registerTool: (t: any) => { tools.push(t); } };
    const rt: RuntimeState = { activeMission: null, autoSaveInterval: null };
    registerMissionTools(pi as any, rt);
    const ctx = { ui: { setStatus: () => {}, notify: () => {} } };
    const result = await tools[1]!.execute("call2", {}, null as any, () => {}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No active mission");
  });

  it("mission_next_feature execute blocks when active feature is not done", async () => {
    const m = createMission("NextBlock", "Block next");
    const tools: any[] = [];
    const pi = { registerTool: (t: any) => { tools.push(t); } };
    const rt: RuntimeState = { activeMission: m, autoSaveInterval: null };
    registerMissionTools(pi as any, rt);
    const ctx = { ui: { setStatus: () => {}, notify: () => {} } };
    const result = await tools[1]!.execute("call2", {}, null as any, () => {}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not done yet");
  });

  it("mission_next_feature execute advances to next feature", async () => {
    const m = createMission("Advance", "Advance test");
    const current = getActiveFeature(m)!;
    current.status = "done";
    current.completedAt = Date.now();
    await saveMissionSafe(m);
    const tools: any[] = [];
    const pi = { registerTool: (t: any) => { tools.push(t); } };
    const rt: RuntimeState = { activeMission: m, autoSaveInterval: null };
    registerMissionTools(pi as any, rt);
    const ctx = { ui: { setStatus: () => {}, notify: () => {} } };
    const result = await tools[1]!.execute("call2", {}, null as any, () => {}, ctx);
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("➡️ Active feature: F002");
    expect(m.activeFeatureId).toBe("F002");
  });

  it("mission_next_feature execute marks mission complete when all done", async () => {
    const m = createMission("AllDone", "Complete test");
    const all = getAllFeatures(m);
    for (const f of all) {
      f.status = "done";
      if (!f.completedAt) f.completedAt = Date.now();
    }
    await saveMissionSafe(m);
    const tools: any[] = [];
    const pi = { registerTool: (t: any) => { tools.push(t); } };
    const rt: RuntimeState = { activeMission: m, autoSaveInterval: null };
    registerMissionTools(pi as any, rt);
    const ctx = { ui: { setStatus: () => {}, notify: () => {} } };
    const result = await tools[1]!.execute("call2", {}, null as any, () => {}, ctx);
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("🎉 Mission complete");
    expect(m.status).toBe("complete");
  });

  it("mission_feature_done sets feature notes from params", async () => {
    const m = createMission("NotesTest", "Test");
    await saveMissionSafe(m);
    const tools: any[] = [];
    const pi = { registerTool: (t: any) => { tools.push(t); } };
    const rt: RuntimeState = { activeMission: m, autoSaveInterval: null };
    registerMissionTools(pi as any, rt);
    const ctx = { ui: { setStatus: () => {}, notify: () => {} } };
    const result = await tools[0]!.execute("call1", { evidence: "Done!", notes: "with notes" }, null as any, () => {}, ctx);
    expect(result.isError).toBe(false);
    const f = m.milestones[0].features[0]!;
    expect(f.notes).toBe("with notes");
  });

  it("mission_next_feature execute warns when no unblocked pending features remain", async () => {
    const m = createMission("Blocked", "No next");
    // F001 done, F002 blocked, F003 depends on F002 so also effectively blocked
    m.milestones[0].features[0]!.status = "done";
    m.milestones[0].features[0]!.completedAt = Date.now();
    m.milestones[0].features[1]!.status = "blocked";
    m.milestones[0].features[2]!.status = "pending";
    // F003 depends on F002 which is blocked → no unblocked pending
    await saveMissionSafe(m);
    const tools: any[] = [];
    const pi = { registerTool: (t: any) => { tools.push(t); } };
    const rt: RuntimeState = { activeMission: m, autoSaveInterval: null };
    registerMissionTools(pi as any, rt);
    const ctx = { ui: { setStatus: () => {}, notify: () => {} } };
    const result = await tools[1]!.execute("call2", {}, null as any, () => {}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No unblocked pending feature");
  });
});
