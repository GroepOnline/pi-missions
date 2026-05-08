import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { appendHistory, getActiveFeature, getAllFeatures, getNextPendingFeature, saveEvidence, saveMissionSafe } from "./state.js";
import type { MissionState, RuntimeState } from "./types.js";
import { updateFooter } from "./ui.js";

function allFeaturesDone(mission: MissionState): boolean {
  return getAllFeatures(mission).every((f) => f.status === "done");
}

export function registerMissionTools(pi: ExtensionAPI, runtime: RuntimeState): void {
  pi.registerTool({
    name: "mission_feature_done",
    label: "Mission Feature Done",
    description: "Mark the active mission feature as done with evidence.",
    promptSnippet: "Mark the active mission feature as done with evidence",
    promptGuidelines: ["Use mission_feature_done only after all acceptance criteria are satisfied and evidence is available."],
    parameters: Type.Object({
      evidence: Type.String({ description: "Completion evidence, e.g. test output or summary of changes" }),
      notes: Type.Optional(Type.String({ description: "Optional notes" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const mission = runtime.activeMission;
      const feature = mission ? getActiveFeature(mission) : null;
      if (!mission || !feature) return { content: [{ type: "text", text: "No active mission feature." }], details: {}, isError: true };
      feature.status = "done";
      feature.completedAt = Date.now();
      feature.notes = params.notes;
      for (const ac of feature.acceptance) if (!ac.waived) ac.verified = true;
      const evidenceFile = saveEvidence(mission, feature, params.evidence);
      appendHistory(mission, { event: "feature_done", featureId: feature.id, note: params.notes, details: { evidenceFile } });
      const next = getNextPendingFeature(mission);
      if (!next && allFeaturesDone(mission)) mission.status = "complete";
      await saveMissionSafe(mission);
      updateFooter(ctx, mission);
      return { content: [{ type: "text", text: `✅ Feature ${feature.id} done. Evidence: ${evidenceFile}` }], details: { featureId: feature.id, evidenceFile }, isError: false };
    },
  });

  pi.registerTool({
    name: "mission_next_feature",
    label: "Mission Next Feature",
    description: "Advance to the next pending mission feature.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const mission = runtime.activeMission;
      if (!mission) return { content: [{ type: "text", text: "No active mission." }], details: {}, isError: true };
      const current = getActiveFeature(mission);
      if (current?.status === "active") {
        return {
          content: [{ type: "text", text: `Active feature is not done yet: ${current.id} — ${current.title}. Use mission_feature_done when complete, or /mission block <reason> if it cannot continue.` }],
          details: { featureId: current.id },
          isError: true,
        };
      }

      const next = getNextPendingFeature(mission);
      if (!next) {
        if (allFeaturesDone(mission)) {
          mission.status = "complete";
          await saveMissionSafe(mission);
          updateFooter(ctx, mission);
          return { content: [{ type: "text", text: "🎉 Mission complete." }], details: { missionId: mission.id }, isError: false };
        }
        return {
          content: [{ type: "text", text: "No unblocked pending feature found. Check blocked features and dependencies with /mission status." }],
          details: { missionId: mission.id },
          isError: true,
        };
      }
      next.status = "active";
      mission.status = "active";
      mission.activeFeatureId = next.id;
      mission.activeMilestoneId = next.milestoneId;
      appendHistory(mission, { event: "feature_active", featureId: next.id });
      await saveMissionSafe(mission);
      updateFooter(ctx, mission);
      return { content: [{ type: "text", text: `➡️ Active feature: ${next.id} — ${next.title}\n${next.description}` }], details: { feature: next }, isError: false };
    },
  });
}
