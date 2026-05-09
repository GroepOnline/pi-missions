import type { Feature, MissionState } from "./types.js";
import {
  appendHistory,
  autoCompleteMilestones,
  autoUnblockResolved,
  autoVerifyAcceptance,
  getActiveFeature,
  getAllFeatures,
  getNextPendingFeature,
  saveEvidence,
} from "./state.js";

function allFeaturesDone(mission: MissionState): boolean {
  return getAllFeatures(mission).every((f) => f.status === "done");
}

export type CompleteFeatureResult =
  | { ok: true; feature: Feature; evidenceFile: string; missionComplete: boolean }
  | { ok: false; reason: string; unverifiedBashCount?: number };

export interface CompleteFeatureOptions {
  evidence: string;
  notes?: string;
  autoVerify?: boolean;
  markAcceptanceVerified?: boolean;
  historyNote?: string;
  historyDetails?: Record<string, unknown>;
}

export function completeActiveFeature(mission: MissionState, options: CompleteFeatureOptions): CompleteFeatureResult {
  const feature = getActiveFeature(mission);
  if (!feature) return { ok: false, reason: "No active mission feature." };

  if (options.autoVerify && feature._execFn) {
    autoVerifyAcceptance(feature, feature._execFn);
  }

  const unverifiedBash = feature.acceptance.filter((ac) => !ac.verified && !ac.waived && ac.checkType === "bash");
  if (unverifiedBash.length > 0) {
    const details = unverifiedBash.map((ac) => `${ac.id}: ${ac.description}${ac.checkCommand ? ` [bash: ${ac.checkCommand}]` : ""}`).join("\n");
    return {
      ok: false,
      reason: `Cannot mark feature done: ${unverifiedBash.length} bash acceptance criteria need to be verified.\n${details}`,
      unverifiedBashCount: unverifiedBash.length,
    };
  }

  feature.status = "done";
  feature.completedAt = Date.now();
  if (options.notes !== undefined) feature.notes = options.notes;
  if (options.markAcceptanceVerified) {
    for (const ac of feature.acceptance) if (!ac.waived) ac.verified = true;
  }

  const evidenceFile = saveEvidence(mission, feature, options.evidence || "Marked done.");
  appendHistory(mission, {
    event: "feature_done",
    featureId: feature.id,
    note: options.historyNote ?? options.notes,
    details: { evidenceFile, ...options.historyDetails },
  });

  autoUnblockResolved(mission);
  const missionComplete = !getNextPendingFeature(mission) && allFeaturesDone(mission);
  if (missionComplete) {
    mission.status = "complete";
    mission.autopilot.enabled = false;
    mission.autopilot.lastStopReason = "mission_complete";
  }
  autoCompleteMilestones(mission);

  return { ok: true, feature, evidenceFile, missionComplete };
}

export type ActivateNextResult =
  | { ok: true; next: Feature }
  | { ok: false; reason: "active_not_done"; active: Feature }
  | { ok: false; reason: "mission_complete" }
  | { ok: false; reason: "no_unblocked_pending" };

export function activateNextFeature(mission: MissionState, note?: string): ActivateNextResult {
  const active = getActiveFeature(mission);
  if (active?.status === "active") return { ok: false, reason: "active_not_done", active };

  autoUnblockResolved(mission);
  const next = getNextPendingFeature(mission);
  if (!next) {
    if (allFeaturesDone(mission)) {
      mission.status = "complete";
      mission.autopilot.enabled = false;
      mission.autopilot.lastStopReason = "mission_complete";
      autoCompleteMilestones(mission);
      appendHistory(mission, { event: "mission_complete", note: note ?? "All features complete" });
      return { ok: false, reason: "mission_complete" };
    }
    return { ok: false, reason: "no_unblocked_pending" };
  }

  next.status = "active";
  next.startedAt = next.startedAt ?? Date.now();
  mission.status = "active";
  mission.activeFeatureId = next.id;
  mission.activeMilestoneId = next.milestoneId;
  appendHistory(mission, { event: "feature_active", featureId: next.id, note });
  return { ok: true, next };
}
