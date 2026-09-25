import type { MissionState, RuntimeState } from "./types.js";
import { missionWriteRevision, missionWritesUnchanged, refreshActiveMission, updateMissionOnDisk, waitForMissionWrites } from "./state.js";
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
  const id = mission.id;
  const token = mission.validationToken;
  const isActive = () => runtime.activeMission === mission && mission.id === id && mission.validationToken === token;
  let idleHandled = false;
  while (isActive()) {
    await waitForMissionWrites(mission);
    if (!isActive()) break;
    const revision = missionWriteRevision(mission);
    const updated = await updateMissionOnDisk<MissionLifecycleResult>(id, async (freshMission) => {
      if (!isActive() || freshMission.validationToken !== token || !missionWritesUnchanged(mission, revision)) return { kind: "skipped", mission: freshMission };
      if (isWorkerRunning()) return { kind: "worker_active", mission: freshMission };
      if (checkpoint === "autosave" && freshMission.status !== "active") return { kind: "skipped", mission: freshMission };
      if (!idleHandled) {
        idleHandled = true;
        await whenIdle?.(freshMission);
      }
      if (!isActive() || !missionWritesUnchanged(mission, revision)) return { kind: "skipped", mission: freshMission };
      return { kind: PERSIST_AFTER_IDLE[checkpoint] ? "persisted" : "idle", mission: freshMission };
    }, { shouldPersist: (result) => result.kind === "persisted" });

    if (!updated || updated.mission.validationToken !== token) break;
    if (!missionWritesUnchanged(mission, revision)) continue;
    if (!refreshActiveMission(runtime, mission, updated.mission, revision)) break;
    return updated.result.kind === "no_mission" ? updated.result : { ...updated.result, mission };
  }
  return { kind: "skipped", mission };
}
