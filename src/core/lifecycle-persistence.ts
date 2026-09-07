import type { MissionState, RuntimeState } from "./types.js";
import { refreshActiveMission, updateMissionOnDisk } from "./state.js";
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
 * Every checkpoint reads current disk state under the plan lock, including
 * after worker exit. Idle callbacks must mutate the supplied mission, not a
 * captured parent snapshot, and must not recursively save it under this lock.
 */
export async function reconcileMissionLifecycle({
  runtime,
  checkpoint,
  whenIdle,
}: ReconcileMissionLifecycleOptions): Promise<MissionLifecycleResult> {
  const mission = runtime.activeMission;
  if (!mission) return { kind: "no_mission" };
  const updated = await updateMissionOnDisk<MissionLifecycleResult>(mission.id, async (freshMission) => {
    if (runtime.activeMission !== mission || freshMission.validationToken !== mission.validationToken) return { kind: "skipped", mission: freshMission };
    if (isWorkerRunning()) return { kind: "worker_active", mission: freshMission };
    if (checkpoint === "autosave" && freshMission.status !== "active") {
      return { kind: "skipped", mission: freshMission };
    }
    await whenIdle?.(freshMission);
    if (runtime.activeMission !== mission) return { kind: "skipped", mission: freshMission };
    return { kind: PERSIST_AFTER_IDLE[checkpoint] ? "persisted" : "idle", mission: freshMission };
  }, { shouldPersist: (result) => result.kind === "persisted" });

  if (!updated) return { kind: "skipped", mission };
  if (!refreshActiveMission(runtime, mission, updated.mission)) return { kind: "skipped", mission: updated.mission };
  return updated.result.kind === "no_mission" ? updated.result : { ...updated.result, mission };
}
