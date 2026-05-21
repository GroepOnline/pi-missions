import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ContinuationDecision, Feature, MissionState, RuntimeState } from "../core/types.js";
import {
  appendHistory, autoUnblockResolved, getActiveFeature, getNextPendingFeature, saveMissionSafe,
} from "../core/state.js";
import { updateFooter } from "../ui/components.js";
import { getCompletionDetector } from "./completion.js";

// ═══════════════════════════════════════════════════════════════════════════
// Continuation decision
// ═══════════════════════════════════════════════════════════════════════════

export function shouldContinue(mission: MissionState, ctx?: ExtensionCommandContext): ContinuationDecision {
  const a = mission.autopilot;
  if (!a.enabled) return { continue: false, reason: "disabled" };
  if (mission.status === "paused") return { continue: false, reason: "paused_by_user" };
  if (mission.status === "blocked") return { continue: false, reason: "blocked" };
  if (mission.status === "complete") return { continue: false, reason: "mission_complete" };
  if (a.iteration >= a.maxIterations) return { continue: false, reason: "max_iterations" };
  if (a.consecutiveFailures >= a.maxConsecutiveFailures) return { continue: false, reason: "max_consecutive_failures" };
  if (a.noProgressTurns >= a.maxNoProgressTurns) return { continue: false, reason: "no_progress" };
  const usage = ctx?.getContextUsage?.() ?? { percent: 0 };
  if ((usage.percent ?? 0) > a.maxContextPercent) return { continue: false, reason: "context_limit" };
  return { continue: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// Ensure active feature
// ═══════════════════════════════════════════════════════════════════════════

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
  if (mission.milestones.every(m => m.features.every(f => f.status === "done"))) {
    mission.status = "complete";
    mission.autopilot.enabled = false;
    mission.autopilot.lastStopReason = "mission_complete";
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Trigger continuation
// ═══════════════════════════════════════════════════════════════════════════

export function buildContinuationPrompt(mission: MissionState): string {
  const feature = getActiveFeature(mission) || { id: "none", title: "no active feature" };
  return [
    `Mission: ${mission.title}`,
    `Active feature: ${feature.id} - ${feature.title}`,
    `Autopilot iteration: ${mission.autopilot.iteration}`,
    "",
    "Continue the mission with ONE controlled turn. After this turn the autopilot will evaluate progress and decide whether to continue or stop.",
    "Stop conditions: mission complete, user stop, blocker, max iterations, etc.",
  ].join("\n");
}

export async function triggerContinuation(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  mission: MissionState,
): Promise<void> {
  const decision = shouldContinue(mission, ctx);
  if (!decision.continue) {
    mission.autopilot.lastStopReason = decision.reason as MissionState["autopilot"]["lastStopReason"];
    await saveMissionSafe(mission);
    updateFooter(ctx, mission);
    return;
  }
  mission.autopilot.iteration++;
  mission.autopilot.lastContinuationAt = new Date().toISOString();
  await pi.sendUserMessage(buildContinuationPrompt(mission));
  await saveMissionSafe(mission);
  updateFooter(ctx, mission);
}

// ═══════════════════════════════════════════════════════════════════════════
// Process agent end for autopilot
// ═══════════════════════════════════════════════════════════════════════════

export async function processAgentEndForAutopilot(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  event: { messages?: Array<{ content?: Array<{ type?: string; text?: string }> | string }> },
  runtime: RuntimeState,
): Promise<void> {
  const mission = runtime.activeMission;
  if (!mission?.autopilot?.enabled) return;
  const feature = getActiveFeature(mission);

  const text = (event.messages ?? [])
    .flatMap(m => Array.isArray(m.content) ? m.content : [])
    .filter(c => c?.type === "text" && typeof c.text === "string")
    .map(c => c.text)
    .join("\n");
  const lower = text.toLowerCase();

  const wasAborted = /\b(operation aborted|operation cancelled|action cancelled)\b/i.test(text);
  const detector = getCompletionDetector();
  const textLoop = detector.detectTextLoop();
  const inTextLoop = textLoop.isStuck;

  const wantsToAskUser = /\b(need to ask the user|should ask the user|must ask the user)\b/i.test(lower) &&
    !lower.includes("mission_ask_user");

  const isBlocked =
    mission.status === "blocked" ||
    (feature && feature.status === "blocked") ||
    /\b(blocked|block self|self-block|stuck|cannot proceed|deadlock|need external|api key|permission)\b/i.test(lower);

  if (inTextLoop || wasAborted) {
    mission.autopilot.noProgressTurns += (inTextLoop ? 2 : 0) + (wasAborted ? 1 : 0);
  }

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

  const madeProgress = !lower.includes("no progress") && !lower.includes("same state");
  if (!madeProgress) mission.autopilot.noProgressTurns++;
  else mission.autopilot.noProgressTurns = Math.max(0, mission.autopilot.noProgressTurns - 1);

  const hasError = lower.includes("error") || lower.includes("failed");
  if (hasError) mission.autopilot.consecutiveFailures++;
  else mission.autopilot.consecutiveFailures = 0;

  const decision = shouldContinue(mission, ctx);
  if (decision.continue) {
    await triggerContinuation(pi, ctx, mission);
  } else {
    mission.autopilot.enabled = false;
    mission.autopilot.lastStopReason = decision.reason as MissionState["autopilot"]["lastStopReason"];
    appendHistory(mission, { event: "autopilot_stopped", note: decision.reason });
    await saveMissionSafe(mission);
    updateFooter(ctx, mission);
  }
}
