import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getCompletionDetector } from "./completion.js";
import { appendHistory, autoCompleteMilestones, autoUnblockResolved, dependenciesDone, getActiveFeature, getAllFeatures, getFeatureById, getMilestoneById, getNextPendingFeature, saveEvidence, saveMissionSafe } from "./state.js";
import type { Feature, MissionState, RuntimeState, StopReason } from "./types.js";
import { updateFooter } from "./ui.js";

export interface ContinueDecision {
  continue: boolean;
  reason?: StopReason;
  message?: string;
}

export interface TurnEvaluation {
  completedFeature: boolean;
  blocked: boolean;
  needsUser: boolean;
  madeProgress: boolean;
  failed: boolean;
  evidence?: string;
  message: string;
}

const MIN_CONTINUATION_INTERVAL_MS = 1_000;
let continuationInFlight = false;

export function getContextPercent(ctx?: any): number | null {
  try {
    const usage = ctx?.getContextUsage?.();
    if (!usage) return null;
    if (typeof usage.percent === "number") return Math.round(usage.percent);
    if (typeof usage.contextPercent === "number") return Math.round(usage.contextPercent);
    if (typeof usage.usedPercent === "number") return Math.round(usage.usedPercent);
    if (typeof usage.tokens === "number" && typeof usage.maxTokens === "number" && usage.maxTokens > 0) {
      return Math.round((usage.tokens / usage.maxTokens) * 100);
    }
    if (typeof usage.usedTokens === "number" && typeof usage.totalTokens === "number" && usage.totalTokens > 0) {
      return Math.round((usage.usedTokens / usage.totalTokens) * 100);
    }
  } catch {
    return null;
  }
  return null;
}

export function isMissionComplete(mission: MissionState): boolean {
  const all = getAllFeatures(mission);
  return all.length > 0 && all.every((f) => f.status === "done");
}

export function shouldContinueMission(mission: MissionState, ctx?: any): ContinueDecision {
  if (!mission.autopilot?.enabled) return { continue: false, reason: "paused_by_user", message: "Autopilot is disabled." };
  if (mission.status === "complete") return { continue: false, reason: "mission_complete" };
  if (mission.status === "paused") return { continue: false, reason: "paused_by_user" };
  if (mission.status === "blocked") return { continue: false, reason: "blocked" };
  if (mission.status === "failed") return { continue: false, reason: "error", message: "Mission status is failed." };
  if (mission.status === "budget_limited") return { continue: false, reason: "context_limit", message: "Mission is budget limited." };
  if (mission.autopilot.iteration >= mission.autopilot.maxIterations) return { continue: false, reason: "max_iterations", message: "Maximum autopilot iterations reached." };
  if (mission.autopilot.consecutiveFailures >= mission.autopilot.maxConsecutiveFailures) return { continue: false, reason: "max_consecutive_failures", message: "Too many consecutive failed turns." };
  if (mission.autopilot.noProgressTurns >= mission.autopilot.maxNoProgressTurns) return { continue: false, reason: "no_progress", message: "No meaningful progress detected for multiple turns." };
  const active = getActiveFeature(mission);
  if (!active) {
    if (isMissionComplete(mission)) return { continue: false, reason: "mission_complete" };
    return { continue: false, reason: "no_active_feature", message: "No active feature is available." };
  }
  if (active.status !== "active") return { continue: false, reason: "no_active_feature", message: `Active feature is ${active.status}, not active.` };
  const contextPercent = getContextPercent(ctx);
  if (contextPercent !== null && contextPercent >= mission.autopilot.maxContextPercent) {
    return { continue: false, reason: "context_limit", message: `Context usage is ${contextPercent}%.` };
  }
  return { continue: true };
}

export function ensureActiveFeature(mission: MissionState): Feature | null {
  const existing = getActiveFeature(mission);
  if (existing?.status === "active") return existing;
  autoUnblockResolved(mission);
  for (const feature of getAllFeatures(mission)) {
    if ((feature.status === "pending" || feature.status === "waiting") && !dependenciesDone(mission, feature)) {
      feature.status = "waiting";
      feature.notes = `Waiting on ${feature.dependsOn.filter((id) => getFeatureById(mission, id)?.status !== "done").join(", ")}`;
    }
  }
  const next = getNextPendingFeature(mission);
  if (next) {
    next.status = "active";
    next.startedAt ??= Date.now();
    mission.status = "active";
    mission.activeFeatureId = next.id;
    mission.activeMilestoneId = next.milestoneId;
    appendHistory(mission, { event: "feature_active", featureId: next.id, note: "Autopilot selected runnable feature" });
    return next;
  }
  if (isMissionComplete(mission)) {
    mission.status = "complete";
    autoCompleteMilestones(mission);
    return null;
  }
  const remaining = getAllFeatures(mission).filter((f) => f.status !== "done");
  if (remaining.length && remaining.every((f) => f.status === "blocked" || f.status === "failed")) {
    mission.status = "blocked";
    mission.autopilot.lastStopReason = "blocked";
    mission.autopilot.lastStopMessage = "All remaining features are blocked or failed.";
  }
  return null;
}

function formatAcceptanceCriteria(feature: Feature | null): string {
  if (!feature?.acceptance.length) return "- No explicit acceptance criteria.";
  return feature.acceptance.map((ac) => `- [${ac.verified || ac.waived ? "x" : " "}] ${ac.id}: ${ac.description}${ac.checkCommand ? ` (check: ${ac.checkCommand})` : ""}`).join("\n");
}

export function buildAutopilotContinuationPrompt(mission: MissionState): string {
  const feature = getActiveFeature(mission);
  if (!feature) return `Continue the active Pi Mission.\nMission: ${mission.title}\nNo active feature is available; report the blocker.`;
  const milestone = getMilestoneById(mission, feature.milestoneId);
  return `Continue the active Pi Mission.

Mission:
${mission.title}

Mission goal:
${mission.goal}

Current milestone:
${milestone?.id ?? "unknown"} - ${milestone?.title ?? "unknown"}

Current feature:
${feature.id} - ${feature.title}

Feature goal:
${feature.description ?? feature.title}

Acceptance criteria:
${formatAcceptanceCriteria(feature)}

Current runtime:
- autopilot iteration: ${mission.autopilot.iteration + 1}/${mission.autopilot.maxIterations}
- consecutive failures: ${mission.autopilot.consecutiveFailures}/${mission.autopilot.maxConsecutiveFailures}
- no-progress turns: ${mission.autopilot.noProgressTurns}/${mission.autopilot.maxNoProgressTurns}

Rules:
- Work only on the current active feature.
- Make the smallest useful verifiable step.
- Do not start unrelated work.
- If the feature is complete, call mission_feature_done with concrete evidence.
- If blocked, call mission_block_self with the exact blocker and what is needed.
- If user input is required, call mission_ask_user.
- If you made progress but are not done, summarize exactly what changed.
- Stop after this turn; the Pi Missions runtime will decide whether to continue.`.trim();
}

function recentlyTriggered(mission: MissionState): boolean {
  const last = mission.autopilot.lastContinuationAt ? Date.parse(mission.autopilot.lastContinuationAt) : 0;
  return Boolean(last && Date.now() - last < MIN_CONTINUATION_INTERVAL_MS);
}

export async function triggerMissionContinuation(pi: ExtensionAPI, ctx: any, mission: MissionState): Promise<void> {
  const feature = ensureActiveFeature(mission);
  if (!feature) {
    await saveMissionSafe(mission);
    updateFooter(ctx, mission);
    return;
  }
  const decision = shouldContinueMission(mission, ctx);
  if (!decision.continue) {
    mission.autopilot.lastStopReason = decision.reason;
    mission.autopilot.lastStopMessage = decision.message;
    mission.autopilot.enabled = false;
    await saveMissionSafe(mission);
    updateFooter(ctx, mission);
    return;
  }
  if (continuationInFlight || recentlyTriggered(mission)) return;
  continuationInFlight = true;
  try {
    mission.autopilot.iteration += 1;
    mission.autopilot.lastContinuationAt = new Date().toISOString();
    appendHistory(mission, { event: "autopilot_continuation", featureId: feature.id, details: { iteration: mission.autopilot.iteration } });
    const prompt = buildAutopilotContinuationPrompt(mission);
    await saveMissionSafe(mission);
    updateFooter(ctx, mission);
    await (pi as any).sendUserMessage(prompt, { deliverAs: "followUp" });
  } catch (error) {
    mission.autopilot.consecutiveFailures += 1;
    mission.autopilot.lastStopReason = "error";
    mission.autopilot.lastStopMessage = error instanceof Error ? error.message : String(error);
    await saveMissionSafe(mission);
    throw error;
  } finally {
    continuationInFlight = false;
  }
}

function extractAgentText(event: any): string {
  const messages = Array.isArray(event?.messages) ? event.messages : [];
  return messages
    .flatMap((m: any) => Array.isArray(m.content) ? m.content : [])
    .filter((c: any) => c?.type === "text" && typeof c.text === "string")
    .map((c: any) => c.text)
    .join("\n");
}

export function evaluateAutopilotTurn(mission: MissionState, event: any, featureBefore?: Feature | null): TurnEvaluation {
  const feature = featureBefore ?? getActiveFeature(mission);
  const text = extractAgentText(event);
  const lower = text.toLowerCase();
  const completedFeature = Boolean(feature && feature.status === "done");
  const blocked = mission.status === "blocked" || Boolean(feature && feature.status === "blocked") || lower.includes("mission_block_self") || lower.includes("blocked");
  const needsUser = lower.includes("mission_ask_user") || lower.includes("need user") || lower.includes("requires user") || lower.includes("user input");
  const failed = lower.includes("error:") || lower.includes("failed") || lower.includes("exception") || lower.includes("traceback");
  const detector = feature ? getCompletionDetector().detectCompletion(feature, text) : null;
  const autoComplete = detector?.suggestedAction === "auto_done";
  const madeProgress = completedFeature || autoComplete || /implemented|updated|created|fixed|changed|added|removed|verified|tested|patched|wrote|saved/i.test(text);
  return {
    completedFeature: completedFeature || autoComplete,
    blocked,
    needsUser,
    madeProgress,
    failed: failed && !madeProgress,
    evidence: detector?.reason ?? (text ? text.slice(0, 1200) : undefined),
    message: detector?.reason ?? (text ? text.slice(0, 300) : "No agent output captured."),
  };
}

export async function processAgentEndForAutopilot(pi: ExtensionAPI, ctx: any, event: any, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  if (!mission?.autopilot?.enabled) return;
  const feature = getActiveFeature(mission);
  if (!feature) {
    ensureActiveFeature(mission);
    await saveMissionSafe(mission);
    return;
  }
  const beforeId = feature.id;
  const evaluation = evaluateAutopilotTurn(mission, event, feature);
  appendHistory(mission, { event: "autopilot_turn_evaluated", featureId: beforeId, note: evaluation.message, details: evaluation as unknown as Record<string, unknown> });

  if (evaluation.completedFeature) {
    const current = getFeatureById(mission, beforeId);
    if (current && current.status !== "done") {
      current.status = "done";
      current.completedAt = Date.now();
      for (const ac of current.acceptance) {
        if (!ac.waived && (ac.checkType === "manual" || !ac.checkType)) ac.verified = true;
      }
      const evidenceFile = saveEvidence(mission, current, evaluation.evidence ?? "Autopilot detected feature completion.");
      appendHistory(mission, { event: "feature_done", featureId: current.id, note: "Autopilot completion", details: { evidenceFile, auto: true } });
    }
    mission.autopilot.consecutiveFailures = 0;
    mission.autopilot.noProgressTurns = 0;
    autoUnblockResolved(mission);
    autoCompleteMilestones(mission);
    if (mission.autopilot.continueAcrossFeatures) ensureActiveFeature(mission);
  } else if (evaluation.blocked) {
    feature.status = "blocked";
    feature.notes = evaluation.message;
    mission.status = "blocked";
    mission.autopilot.enabled = false;
    mission.autopilot.lastStopReason = "blocked";
    mission.autopilot.lastStopMessage = evaluation.message;
  } else if (evaluation.needsUser) {
    mission.autopilot.enabled = false;
    mission.autopilot.lastStopReason = "needs_user_decision";
    mission.autopilot.lastStopMessage = evaluation.message;
  } else if (evaluation.madeProgress) {
    mission.autopilot.consecutiveFailures = 0;
    mission.autopilot.noProgressTurns = 0;
  } else if (evaluation.failed) {
    mission.autopilot.consecutiveFailures += 1;
  } else {
    mission.autopilot.noProgressTurns += 1;
  }

  if (isMissionComplete(mission)) {
    mission.status = "complete";
    mission.autopilot.enabled = false;
    mission.autopilot.lastStopReason = "mission_complete";
    appendHistory(mission, { event: "mission_complete", note: "Autopilot completed all features" });
  }
  await saveMissionSafe(mission);
  updateFooter(ctx, mission);
  const decision = shouldContinueMission(mission, ctx);
  if (decision.continue) {
    await triggerMissionContinuation(pi, ctx, mission);
  } else if (!mission.autopilot.lastStopReason) {
    // Only overwrite if not already set by evaluation (blocked, needs_user, etc.)
    mission.autopilot.lastStopReason = decision.reason;
    mission.autopilot.lastStopMessage = decision.message;
    mission.autopilot.enabled = false;
    await saveMissionSafe(mission);
    updateFooter(ctx, mission);
  }
}
