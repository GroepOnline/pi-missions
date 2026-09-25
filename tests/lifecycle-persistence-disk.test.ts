import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMission, loadMissionFromDisk, missionDirSafe, missionWriteRevision, refreshActiveMission, saveMissionSafe, updateMissionOnDisk } from "../src/core/state.js";
import type { RuntimeState } from "../src/core/types.js";
import { reconcileMissionLifecycle } from "../src/core/lifecycle-persistence.js";
import { registerMissionTools } from "../src/tools/index.js";
import { handleDone } from "../src/commands/handlers.js";

const mocks = vi.hoisted(() => ({ running: vi.fn(() => false) }));
vi.mock("../src/engines/worker.js", () => ({
  isWorkerRunning: mocks.running, getActiveWorker: vi.fn(), spawnWorker: vi.fn(), killWorker: vi.fn(),
}));

describe("lifecycle disk reconciliation", () => {
  let root: string;
  let runtime: RuntimeState;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "missions-lifecycle-"));
    vi.stubEnv("MISSIONS_ROOT", root);
    vi.stubEnv("PI_MISSIONS_ROOT", root);
    mocks.running.mockReturnValue(false);
    const mission = createMission("Disk lifecycle", "Preserve worker progress");
    await saveMissionSafe(mission);
    runtime = { activeMission: mission, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution" };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each(["autosave", "turn_end", "shutdown", "agent_end"] as const)(
    "%s retains worker progress even after the worker has already exited",
    async (checkpoint) => {
      const id = runtime.activeMission!.id;
      await updateMissionOnDisk(id, (mission) => {
        mission.milestones[0]!.features[0]!.status = "done";
        mission.milestones[0]!.features[0]!.notes = "Worker evidence";
        mission.tokensUsed = 100;
      });
      const whenIdle = vi.fn((mission) => { mission.tokensUsed += 2; });

      await reconcileMissionLifecycle({ runtime, checkpoint, whenIdle });

      expect(runtime.activeMission!.milestones[0]!.features[0]!.status).toBe("done");
      expect(loadMissionFromDisk(id)!.milestones[0]!.features[0]!.notes).toBe("Worker evidence");
      expect(runtime.activeMission!.tokensUsed).toBe(102);
    },
  );

  it("serializes an idle mutation with a concurrent worker disk update", async () => {
    const id = runtime.activeMission!.id;
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const checkpoint = reconcileMissionLifecycle({ runtime, checkpoint: "turn_end", whenIdle: async (mission) => {
      entered();
      await wait;
      mission.tokensUsed += 2;
    } });
    await started;
    const worker = updateMissionOnDisk(id, (mission) => {
      mission.milestones[0]!.features[0]!.status = "done";
    });
    release();
    await Promise.all([checkpoint, worker]);

    expect(loadMissionFromDisk(id)!.milestones[0]!.features[0]!.status).toBe("done");
    expect(loadMissionFromDisk(id)!.tokensUsed).toBe(2);
  });

  it("refreshes an active worker without invoking idle work or rewriting the plan", async () => {
    const id = runtime.activeMission!.id;
    await updateMissionOnDisk(id, (mission) => { mission.tokensUsed = 100; });
    const plan = path.join(missionDirSafe(id), "plan.json");
    const before = fs.readFileSync(plan, "utf8");
    mocks.running.mockReturnValue(true);
    const whenIdle = vi.fn();

    expect((await reconcileMissionLifecycle({ runtime, checkpoint: "shutdown", whenIdle })).kind).toBe("worker_active");
    expect(whenIdle).not.toHaveBeenCalled();
    expect(runtime.activeMission!.tokensUsed).toBe(100);
    expect(fs.readFileSync(plan, "utf8")).toBe(before);
  });

  it("does not skip agent-end queued behind a refresh of the same active session", async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const autosave = reconcileMissionLifecycle({ runtime, checkpoint: "autosave", whenIdle: async (mission) => {
      entered();
      await wait;
      mission.tokensUsed = 12;
    } });
    await started;
    const whenIdle = vi.fn();
    const agentEnd = reconcileMissionLifecycle({ runtime, checkpoint: "agent_end", whenIdle });
    release();
    await autosave;

    expect((await agentEnd).kind).toBe("idle");
    expect(whenIdle).toHaveBeenCalledOnce();
    expect(whenIdle.mock.calls[0]![0].tokensUsed).toBe(12);
  });

  it.each(["tool", "command"])("retains %s completion queued behind an autosave", async (mode) => {
    const mission = runtime.activeMission!;
    mission.milestones[0]!.features[0]!.acceptance.forEach((criterion) => { criterion.verified = true; });
    await saveMissionSafe(mission);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const autosaveIdle = vi.fn(async () => {
      entered();
      await wait;
    });
    const autosave = reconcileMissionLifecycle({ runtime, checkpoint: "autosave", whenIdle: autosaveIdle });
    await started;
    const ctx = { hasUI: false, ui: { notify: vi.fn(), setStatus: vi.fn() } } as any;
    const tools: any[] = [];
    registerMissionTools({ registerTool: (tool: any) => { tools.push(tool); } } as any, runtime);
    const completion = mode === "tool"
      ? tools.find((tool) => tool.name === "mission_feature_done").execute("done", { evidence: "Verified completion" }, null, null, ctx)
      : handleDone("Verified completion", ctx, runtime);
    expect(mission.milestones[0]!.features[0]!.status).toBe("done");
    const agentEndIdle = vi.fn();
    const agentEnd = reconcileMissionLifecycle({ runtime, checkpoint: "agent_end", whenIdle: agentEndIdle });
    release();
    await autosave;
    const result = await completion;
    if (mode === "tool") expect(result.isError).toBe(false);

    expect(loadMissionFromDisk(mission.id)!.milestones[0]!.features[0]!.status).toBe("done");
    expect(runtime.activeMission!.milestones[0]!.features[0]!.status).toBe("done");
    expect(autosaveIdle).toHaveBeenCalledOnce();
    expect((await agentEnd).kind).toBe("idle");
    expect(agentEndIdle).toHaveBeenCalledOnce();
    expect(agentEndIdle.mock.calls[0]![0].milestones[0].features[0].status).toBe("done");
  });

  it("rejects an old refresh even after the completion write has settled", async () => {
    const mission = runtime.activeMission!;
    mission.milestones[0]!.features[0]!.acceptance.forEach((criterion) => { criterion.verified = true; });
    await saveMissionSafe(mission);
    const revision = missionWriteRevision(mission);
    const stale = loadMissionFromDisk(mission.id)!;
    const ctx = { hasUI: false, ui: { notify: vi.fn(), setStatus: vi.fn() } } as any;

    await handleDone("Verified completion", ctx, runtime);

    expect(refreshActiveMission(runtime, mission, stale, revision)).toBe(false);
    expect(runtime.activeMission!.milestones[0]!.features[0]!.status).toBe("done");
    expect(loadMissionFromDisk(mission.id)!.milestones[0]!.features[0]!.status).toBe("done");
  });

  it("captures queued saves without mutating later runtime changes on settlement", async () => {
    const mission = runtime.activeMission!;
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const owner = updateMissionOnDisk(mission.id, async () => { entered(); await wait; });
    await started;
    mission.milestones[0]!.features[0]!.notes = "Requested write";
    const save = saveMissionSafe(mission);
    mission.milestones[0]!.features[0]!.notes = "Later runtime edit";
    release();
    await Promise.all([owner, save]);

    expect(loadMissionFromDisk(mission.id)!.milestones[0]!.features[0]!.notes).toBe("Requested write");
    expect(runtime.activeMission!.milestones[0]!.features[0]!.notes).toBe("Later runtime edit");
  });

  it.each(["different_mission", "same_mission_new_session"])(
    "skips a checkpoint queued before a genuine %s switch", async (switchKind) => {
      const previous = runtime.activeMission!;
      let release!: () => void;
      let entered!: () => void;
      const started = new Promise<void>((resolve) => { entered = resolve; });
      const wait = new Promise<void>((resolve) => { release = resolve; });
      const owner = updateMissionOnDisk(previous.id, async () => { entered(); await wait; });
      await started;
      const whenIdle = vi.fn();
      const checkpoint = reconcileMissionLifecycle({ runtime, checkpoint: "turn_end", whenIdle });
      const next = switchKind === "different_mission"
        ? createMission("Other session", "Do not overwrite") : structuredClone(previous);
      runtime.activeMission = next;
      release();
      await owner;

      expect((await checkpoint).kind).toBe("skipped");
      expect(runtime.activeMission).toBe(next);
      expect(whenIdle).not.toHaveBeenCalled();
    },
  );

  it("does not resurrect a removed mission or run completion handling", async () => {
    const id = runtime.activeMission!.id;
    fs.rmSync(missionDirSafe(id), { recursive: true });
    const whenIdle = vi.fn();

    expect((await reconcileMissionLifecycle({ runtime, checkpoint: "agent_end", whenIdle })).kind).toBe("skipped");
    expect(whenIdle).not.toHaveBeenCalled();
    expect(loadMissionFromDisk(id)).toBeNull();
  });

  it("rejects a plan with the wrong mission identity before mutation", async () => {
    const id = runtime.activeMission!.id;
    const mismatched = createMission("Other", "Do not mutate");
    const plan = path.join(missionDirSafe(id), "plan.json");
    const before = JSON.stringify(mismatched);
    fs.writeFileSync(plan, before);
    const whenIdle = vi.fn();

    expect((await reconcileMissionLifecycle({ runtime, checkpoint: "shutdown", whenIdle })).kind).toBe("skipped");
    expect(whenIdle).not.toHaveBeenCalled();
    expect(fs.readFileSync(plan, "utf8")).toBe(before);
    expect(fs.existsSync(missionDirSafe(mismatched.id))).toBe(false);
  });
});
