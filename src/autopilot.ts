import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { MissionState, Feature, RuntimeState, StopReason } from "./types.js";
import { getActiveFeature, getFeatureById, getNextPendingFeature, saveMissionSafe, appendHistory, autoBlockBlockedFeatures, autoUnblockResolved } from "./state.js";
import { updateFooter } from "./ui.js";
import { getCompletionDetector } from "./completion.js";

export interface ContinuationDecision {
  continue: boolean;
  reason?: string;
}

export function shouldContinueMission(mission: MissionState, ctx?: ExtensionCommandContext): ContinuationDecision {
  const a = mission.autopilot;
  if (!a.enabled) return { continue: false, reason: "disabled" };
  if (mission.status === "paused") return { continue: false, reason: "paused_by_user" };
  if (mission.status === "blocked") return { continue: false, reason: "blocked" };
  if (mission.status === "complete") return { continue: false, reason: "mission_complete" };
  if (a.iteration >= a.maxIterations) return { continue: false, reason: "max_iterations" };
  if (a.consecutiveFailures >= a.maxConsecutiveFailures) return { continue: false, reason: "max_consecutive_failures" };
  if (a.noProgressTurns >= a.maxNoProgressTurns) return { continue: false, reason: "no_progress" };
  const ctxUsage = ctx?.getContextUsage?.() ?? { percent: 0 };
  if (ctxUsage.percent > a.maxContextPercent) return { continue: false, reason: "context_limit" };
  return { continue: true };
}

export function ensureActiveFeature(mission: MissionState): Feature | null {
  let feature = getActiveFeature(mission);
  if (feature && feature.status === "active") return feature;
  autoUnblockResolved(mission);
  const next = getNextPendingFeature(mission);
  if (next) {
    next.status = "active";
    mission.activeFeatureId = next.id;
    mission.activeMilestoneId = next.milestoneId;
    appendHistory(mission, { event: "feature_active", featureId: next.id });
    return next;
  }
  // All done?
  if (mission.milestones.every(m => m.features.every(f => f.status === "done"))) {
    mission.status = "complete";
    mission.autopilot.enabled = false;
    mission.autopilot.lastStopReason = "mission_complete";
  }
  return null;
}

export function buildAutopilotContinuationPrompt(mission: MissionState): string {
  const feature = getActiveFeature(mission) || { id: "none", title: "no active feature" };
  return `
Mission: ${mission.title}
Active feature: ${feature.id} - ${feature.title}
Autopilot iteration: ${mission.autopilot.iteration}

Continue the mission with ONE controlled turn. After this turn the autopilot will evaluate progress and decide whether to continue or stop.
Stop conditions: mission complete, user stop, blocker, max iterations, etc.
`.trim();
}

export async function triggerMissionContinuation(pi: ExtensionAPI, ctx: ExtensionCommandContext, mission: MissionState): Promise<void> {
  const decision = shouldContinueMission(mission, ctx);
  if (!decision.continue) {
    mission.autopilot.lastStopReason = decision.reason as StopReason ?? undefined;
    await saveMissionSafe(mission);
    updateFooter(ctx, mission);
    return;
  }
  mission.autopilot.iteration++;
  mission.autopilot.lastContinuationAt = new Date().toISOString();
  const prompt = buildAutopilotContinuationPrompt(mission);
  await pi.sendUserMessage(prompt);
  await saveMissionSafe(mission);
  updateFooter(ctx, mission);
}

export async function processAgentEndForAutopilot(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  event: any,
  runtime: RuntimeState
): Promise<void> {
  const mission = runtime.activeMission;
  if (!mission || !mission.autopilot?.enabled) return;
  const feature = getActiveFeature(mission);
  // Aggregate ALL text across all messages (not just first fragment)
  const text = (event.messages ?? [])
    .flatMap((m: any) => Array.isArray(m.content) ? m.content : [])
    .filter((c: any) => c?.type === "text" && typeof c.text === "string")
    .map((c: any) => c.text)
    .join("\n");
  const lower = text.toLowerCase();

  // Detect aborted/cancelled operations as no-progress
  const wasAborted = /\b(operation aborted|operation cancelled|action cancelled)\b/i.test(text);

  // Detect text loop: use shared completion detector which accumulates across turns
  const detector = getCompletionDetector();
  // Note: turn_end already records text output to the detector, so we skip recordTextOutput here
  const textLoop = detector.detectTextLoop();
  const inTextLoop = textLoop.isStuck;

  // Detect "needs to ask user" pattern without actual tool call
  const wantsToAskUser = /\b(need to ask the user|should ask the user|must ask the user)\b/i.test(lower) &&
    !lower.includes("mission_ask_user");

  // Improved blocker detection
  const isBlocked = 
    mission.status === "blocked" ||
    (feature && feature.status === "blocked") ||
    lower.includes("mission_block_self") ||
    /\b(blocked|block self|self-block|stuck|cannot proceed|deadlock|need external|api key|permission)\b/i.test(lower);

  // Stop autopilot if text loop detected (model is looping without making progress)
  if (inTextLoop || wasAborted) {
    mission.autopilot.noProgressTurns += (inTextLoop ? 2 : 0) + (wasAborted ? 1 : 0);
  }

  // Stop if model wants to ask user but isn't using the tool
  if (wantsToAskUser) {
    mission.autopilot.enabled = false;
    mission.autopilot.lastStopReason = "needs_user_decision";
    mission.autopilot.lastStopMessage = text.slice(0, 200);
    appendHistory(mission, { event: "autopilot_stopped", note: "needs_user_decision (model wants to ask)" });
    await saveMissionSafe(mission);
    updateFooter(ctx, mission);
    return;
  }

  if (isBlocked) {
    mission.autopilot.enabled = false;
    mission.autopilot.lastStopReason = "blocked";
    mission.autopilot.lastStopMessage = text.slice(0, 200);
    if (feature) feature.status = "blocked";
    appendHistory(mission, { event: "autopilot_stopped", note: "blocked" });
    await saveMissionSafe(mission);
    updateFooter(ctx, mission);
    return;
  }
  // Progress check (simple heuristic)
  const madeProgress = !lower.includes("no progress") && !lower.includes("same state");
  if (!madeProgress) mission.autopilot.noProgressTurns++;
  else mission.autopilot.noProgressTurns = Math.max(0, mission.autopilot.noProgressTurns - 1);
  // Failure heuristic
  const hasError = lower.includes("error") || lower.includes("failed");
  if (hasError) mission.autopilot.consecutiveFailures++;
  else mission.autopilot.consecutiveFailures = 0;
  // Auto advance if done
  if (feature && (lower.includes("done") || lower.includes("complete"))) {
    // would be handled by tools, but fallback
  }
  const decision = shouldContinueMission(mission, ctx);
  if (decision.continue) {
    await triggerMissionContinuation(pi, ctx, mission);
  } else {
    mission.autopilot.enabled = false;
    mission.autopilot.lastStopReason = decision.reason as StopReason ?? undefined;
    appendHistory(mission, { event: "autopilot_stopped", note: decision.reason });
    await saveMissionSafe(mission);
    updateFooter(ctx, mission);
  }
}
