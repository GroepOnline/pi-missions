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

/**
 * Compute the approximate context usage percentage reported by a runtime context.
 *
 * @param ctx - Runtime context that may expose a `getContextUsage()` method returning usage metrics.
 * @returns The context usage as a rounded integer percent (0–100), or `null` when usage is unavailable or cannot be determined.
 */
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

/**
 * Determines whether all features in a mission are completed.
 *
 * @param mission - The mission state containing features to check
 * @returns `true` if the mission has at least one feature and every feature's status is `"done"`, `false` otherwise
 */
export function isMissionComplete(mission: MissionState): boolean {
  const all = getAllFeatures(mission);
  return all.length > 0 && all.every((f) => f.status === "done");
}

/**
 * Determine whether autopilot should proceed with the mission or stop for a specific reason.
 *
 * @param mission - The mission state used to evaluate autopilot and mission-level stop conditions.
 * @param ctx - Optional runtime context used to evaluate context budget (may be passed to `getContextPercent`).
 * @returns A ContinueDecision where `continue` is `false` and `reason`/`message` indicate why autopilot should stop when a stop condition applies; otherwise `continue` is `true`.
 */
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

/**
 * Ensure the mission has an active, runnable feature; activate the next pending feature if found.
 *
 * This mutates the provided mission state: it may mark features as "waiting" (when dependencies are unmet),
 * activate a runnable feature (setting feature and mission status, timestamps, active ids, and appending history),
 * mark the mission "complete" and auto-complete milestones when all features are done, or set the mission to
 * "blocked" and record an autopilot stop reason when remaining features are only blocked/failed.
 *
 * @param mission - The mission state to inspect and update
 * @returns The feature that is active after this call, or `null` when no active/runnable feature exists
 */
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

/**
 * Format a feature's acceptance criteria as a Markdown-style bullet list.
 *
 * @param feature - The feature to format; may be `null` or have no acceptance entries.
 * @returns The formatted acceptance criteria where each item is prefixed with a checkbox (`[x]` if verified or waived, `[ ]` otherwise). Returns `"- No explicit acceptance criteria."` when the feature is `null` or has no acceptance items.
 */
function formatAcceptanceCriteria(feature: Feature | null): string {
  if (!feature?.acceptance.length) return "- No explicit acceptance criteria.";
  return feature.acceptance.map((ac) => `- [${ac.verified || ac.waived ? "x" : " "}] ${ac.id}: ${ac.description}${ac.checkCommand ? ` (check: ${ac.checkCommand})` : ""}`).join("\n");
}

/**
 * Builds the natural-language continuation prompt describing the mission's current state for the Pi agent.
 *
 * @param mission - The mission state used to populate the prompt (title, goal, active feature, milestone, and autopilot counters).
 * @returns A string prompt instructing the agent how to continue the active mission and feature; if no active feature exists, a short prompt asking the agent to report the blocker.
 */
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

/**
 * Checks whether the mission's last autopilot continuation occurred within the minimum continuation interval.
 *
 * @returns `true` if the last continuation time is less than MIN_CONTINUATION_INTERVAL_MS ago, `false` otherwise.
 */
function recentlyTriggered(mission: MissionState): boolean {
  const last = mission.autopilot.lastContinuationAt ? Date.parse(mission.autopilot.lastContinuationAt) : 0;
  return Boolean(last && Date.now() - last < MIN_CONTINUATION_INTERVAL_MS);
}

/**
 * Trigger the autopilot to continue work on the active feature by preparing mission state and sending a follow-up prompt to the agent.
 *
 * If there is no active feature or autopilot should stop, the function persists the mission and updates the UI footer and returns. If a continuation is allowed and not throttled, it advances the autopilot iteration, records history, persists state, updates the footer, and sends a follow-up prompt to the agent.
 *
 * @param pi - Extension API used to deliver the follow-up prompt to the agent
 * @param ctx - UI/runtime context used for footer updates and context checks
 * @param mission - Mission state to read and mutate for autopilot progression
 * @throws Re-throws any error raised while sending the prompt after incrementing the mission's consecutive failure count, recording an "error" stop reason/message, and persisting the mission state
 */
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

/**
 * Extracts and concatenates plain text content from an agent event payload.
 *
 * Traverses event.messages and each message's content array, collecting items where `type === "text"` and `text` is a string, then joins them with newlines.
 *
 * @param event - Event object expected to contain a `messages` array of message objects with `content` arrays
 * @returns The concatenated text blocks from the event, or an empty string if none are found
 */
function extractAgentText(event: any): string {
  const messages = Array.isArray(event?.messages) ? event.messages : [];
  return messages
    .flatMap((m: any) => Array.isArray(m.content) ? m.content : [])
    .filter((c: any) => c?.type === "text" && typeof c.text === "string")
    .map((c: any) => c.text)
    .join("\n");
}

/**
 * Evaluate an agent turn and summarize its outcome for the autopilot state machine.
 *
 * Determines, based on the active feature (or the provided feature snapshot) and the agent's event text, whether the feature was completed, the mission or feature is blocked, user input is required, progress was made, or the turn failed. Also returns extracted evidence and a concise message describing the evaluation.
 *
 * @param mission - The mission state used to inspect mission/feature statuses and counters.
 * @param event - The agent event payload from which textual output is extracted and analyzed.
 * @param featureBefore - Optional feature snapshot to evaluate instead of the current active feature.
 * @returns A TurnEvaluation describing:
 *  - `completedFeature`: `true` if the feature was completed (or auto-completed), `false` otherwise.
 *  - `blocked`: `true` if the mission or feature is blocked or the agent signaled a blocker, `false` otherwise.
 *  - `needsUser`: `true` if the agent requested or indicated user input is required, `false` otherwise.
 *  - `madeProgress`: `true` if the agent made observable progress (keywords or detector suggestion), `false` otherwise.
 *  - `failed`: `true` if the agent reported an error and no progress was detected, `false` otherwise.
 *  - `evidence`: Optional short evidence string (detector reason or agent text) when available.
 *  - `message`: A short human-readable message describing the evaluation or the detector reason.
 */
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

/**
 * Handle an agent turn outcome to update autopilot feature and mission state and decide whether to continue.
 *
 * Evaluates the agent's response, applies updates to the active feature and mission (marking features done, blocking, stopping for user input, adjusting failure/progress counters, completing the mission, and recording history), persists state, updates the UI footer, and either triggers the next autopilot continuation or disables autopilot with a recorded stop reason.
 *
 * @param event - The agent event payload whose messages are evaluated to determine progress, blocking, or required user input.
 * @param runtime - The runtime state containing the active mission; the function reads and mutates the mission within this runtime and persists those changes.
 */
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
      for (const ac of current.acceptance) if (!ac.waived) ac.verified = true;
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
  } else {
    mission.autopilot.lastStopReason = decision.reason;
    mission.autopilot.lastStopMessage = decision.message;
    mission.autopilot.enabled = false;
    await saveMissionSafe(mission);
    updateFooter(ctx, mission);
  }
}
