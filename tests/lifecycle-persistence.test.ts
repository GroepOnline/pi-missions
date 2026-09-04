import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MissionState, RuntimeState } from "../src/core/types.js";

const mocks = vi.hoisted(() => ({
  isWorkerRunning: vi.fn(() => false),
  loadMissionFromDisk: vi.fn(),
  saveMissionSafe: vi.fn(),
}));

vi.mock("../src/engines/worker.js", () => ({
  isWorkerRunning: mocks.isWorkerRunning,
}));

vi.mock("../src/core/state.js", async () => {
  const actual = await vi.importActual<typeof import("../src/core/state.js")>("../src/core/state.js");
  return {
    ...actual,
    loadMissionFromDisk: mocks.loadMissionFromDisk,
    saveMissionSafe: mocks.saveMissionSafe,
  };
});

import { createMission } from "../src/core/state.js";
import { reconcileMissionLifecycle } from "../src/core/lifecycle-persistence.js";

function runtimeWithMission(): RuntimeState {
  return {
    activeMission: createMission("Lifecycle", "Concentrate persistence policy"),
    autoSaveInterval: null,
    phaseToolCallCount: 0,
    currentPhase: "execution",
  };
}

describe("reconcileMissionLifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isWorkerRunning.mockReturnValue(false);
  });

  it("returns no_mission without consulting worker state", async () => {
    const runtime: RuntimeState = {
      activeMission: null,
      autoSaveInterval: null,
      phaseToolCallCount: 0,
      currentPhase: "execution",
    };

    await expect(reconcileMissionLifecycle({ runtime, checkpoint: "turn_end" }))
      .resolves.toEqual({ kind: "no_mission" });
    expect(mocks.isWorkerRunning).not.toHaveBeenCalled();
  });

  it("refreshes from disk and suppresses idle work while a worker is active", async () => {
    const runtime = runtimeWithMission();
    const freshMission = structuredClone(runtime.activeMission!);
    freshMission.milestones[0]!.features[0]!.status = "done";
    mocks.isWorkerRunning.mockReturnValue(true);
    mocks.loadMissionFromDisk.mockReturnValue(freshMission);
    const whenIdle = vi.fn();

    const result = await reconcileMissionLifecycle({ runtime, checkpoint: "turn_end", whenIdle });

    expect(result).toEqual({ kind: "worker_active", mission: freshMission });
    expect(runtime.activeMission).toBe(freshMission);
    expect(whenIdle).not.toHaveBeenCalled();
    expect(mocks.saveMissionSafe).not.toHaveBeenCalled();
  });

  it("runs idle work before persisting a turn-end checkpoint", async () => {
    const runtime = runtimeWithMission();
    const whenIdle = vi.fn((mission: MissionState) => { mission.tokensUsed = 42; });

    const result = await reconcileMissionLifecycle({ runtime, checkpoint: "turn_end", whenIdle });

    expect(result.kind).toBe("persisted");
    expect(whenIdle).toHaveBeenCalledWith(runtime.activeMission);
    expect(mocks.saveMissionSafe).toHaveBeenCalledWith(runtime.activeMission);
    expect(runtime.activeMission!.tokensUsed).toBe(42);
  });

  it("leaves agent-end persistence to completion handling", async () => {
    const runtime = runtimeWithMission();

    const result = await reconcileMissionLifecycle({ runtime, checkpoint: "agent_end" });

    expect(result.kind).toBe("idle");
    expect(mocks.saveMissionSafe).not.toHaveBeenCalled();
  });

  it("persists an idle shutdown checkpoint", async () => {
    const runtime = runtimeWithMission();

    const result = await reconcileMissionLifecycle({ runtime, checkpoint: "shutdown" });

    expect(result.kind).toBe("persisted");
    expect(mocks.saveMissionSafe).toHaveBeenCalledWith(runtime.activeMission);
  });

  it("skips autosave for an inactive mission", async () => {
    const runtime = runtimeWithMission();
    runtime.activeMission!.status = "paused";

    const result = await reconcileMissionLifecycle({ runtime, checkpoint: "autosave" });

    expect(result.kind).toBe("skipped");
    expect(mocks.isWorkerRunning).not.toHaveBeenCalled();
    expect(mocks.saveMissionSafe).not.toHaveBeenCalled();
  });
});
