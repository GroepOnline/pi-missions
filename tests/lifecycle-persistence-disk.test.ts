import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMission, loadMissionFromDisk, missionDirSafe, saveMissionSafe, updateMissionOnDisk } from "../src/core/state.js";
import type { RuntimeState } from "../src/core/types.js";
import { reconcileMissionLifecycle } from "../src/core/lifecycle-persistence.js";

const mocks = vi.hoisted(() => ({ running: vi.fn(() => false) }));
vi.mock("../src/engines/worker.js", () => ({ isWorkerRunning: mocks.running }));

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
