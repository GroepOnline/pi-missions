import type { MissionState, RuntimeState } from "./types.js";
import { loadMissionFromDisk, saveMissionSafe } from "./state.js";
import { isWorkerRunning } from "../engines/worker.js";

export type MissionLifecycleCheckpoint = "autosave" | "turn_end" | "agent_end" | "shutdown";

export type MissionLifecycleResult =
  | { kind: "no_mission" }
  | { kind: "skipped"; mission: MissionState }
  | { kind: "worker_active"; mission: MissionState }
  | { kind: "idle"; mission: MissionState }
  | { kind: "persisted"; mission: MissionState };

export interface ReconcileMissionLifecycleOptions {
  runtime: RuntimeState;
  checkpoint: MissionLifecycleCheckpoint;
  whenIdle?: (mission: MissionState) => void | Promise<void>;
}

const PERSIST_AFTER_IDLE = {
  autosave: true,
  turn_end: true,
  agent_end: false,
  shutdown: true,
} satisfies Record<MissionLifecycleCheckpoint, boolean>;

/**
 * Applies the worker-safe persistence policy shared by lifecycle hooks.
 * While a worker owns mission progress, the parent refreshes from disk and
 * never invokes its idle callback or persists its in-memory snapshot.
 */
export async function reconcileMissionLifecycle({
  runtime,
  checkpoint,
  whenIdle,
}: ReconcileMissionLifecycleOptions): Promise<MissionLifecycleResult> {
  const mission = runtime.activeMission;
  if (!mission) return { kind: "no_mission" };
  if (checkpoint === "autosave" && mission.status !== "active") {
    return { kind: "skipped", mission };
  }

  if (isWorkerRunning()) {
    const freshMission = loadMissionFromDisk(mission.id) ?? mission;
    runtime.activeMission = freshMission;
    return { kind: "worker_active", mission: freshMission };
  }

  await whenIdle?.(mission);
  if (!PERSIST_AFTER_IDLE[checkpoint]) return { kind: "idle", mission };

  await saveMissionSafe(mission);
  return { kind: "persisted", mission };
}
