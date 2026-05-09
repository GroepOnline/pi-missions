import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { MissionState, RuntimeState } from "../types.js";
import { DEFAULT_AUTOPILOT } from "../types.js";
import { appendHistory, autoBlockBlockedFeatures, autoCompleteMilestones, autoUnblockResolved, autoVerifyAcceptance, getActiveFeature, getAllFeatures, getNextPendingFeature, saveEvidence, saveMissionSafe } from "../state.js";
import { ensureActiveFeature, shouldContinueMission, triggerMissionContinuation } from "../autopilot.js";
import { updateFooter } from "../ui.js";

function allFeaturesDone(mission: MissionState): boolean {
  return getAllFeatures(mission).every((f) => f.status === "done");
}

// ── /mission next ───────────────────────────────────────────────────────────

export async function handleNext(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  if (!mission) return ctx.ui.notify("No active mission.", "warning");

  const active = getActiveFeature(mission);
  if (active?.status === "active") {
    return ctx.ui.notify(`Active feature is not done yet: ${active.id} — ${active.title}\nUse /mission done when complete, or /mission block <reason> if it cannot continue.`, "warning");
  }

  autoUnblockResolved(mission);
  const next = getNextPendingFeature(mission);
  if (!next) {
    if (allFeaturesDone(mission)) {
      mission.status = "complete";
      autoCompleteMilestones(mission);
      await saveMissionSafe(mission);
      updateFooter(ctx, mission);
      return ctx.ui.notify("🎉 Mission complete.", "info");
    }
    return ctx.ui.notify("No unblocked pending feature found. Check blocked features and dependencies with /mission status.", "warning");
  }

  next.status = "active";
  mission.status = "active";
  mission.activeFeatureId = next.id;
  mission.activeMilestoneId = next.milestoneId;
  autoBlockBlockedFeatures(mission);
  appendHistory(mission, { event: "feature_active", featureId: next.id });
  await saveMissionSafe(mission);
  updateFooter(ctx, mission);
  ctx.ui.notify(`➡️ Active feature: ${next.id} — ${next.title}\n${next.description}`, "info");
}

// ── /mission done ───────────────────────────────────────────────────────────

export async function handleDone(evidence: string, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  const feature = mission ? getActiveFeature(mission) : null;
  if (!mission || !feature) return ctx.ui.notify("No active feature.", "warning");
  if (!evidence && ctx.hasUI) evidence = (await ctx.ui.input("Evidence", "Why is this feature done?")) || "Marked done manually.";

  if ((feature as any)._execFn) {
    autoVerifyAcceptance(feature, (feature as any)._execFn);
  }

  const unverifiedBash = feature.acceptance.filter((ac) => !ac.verified && !ac.waived && ac.checkType === "bash");
  if (unverifiedBash.length > 0) {
    const names = unverifiedBash.map((ac) => `  - ${ac.id}: ${ac.description} [bash: ${ac.checkCommand}]`).join("\n");
    return ctx.ui.notify(`Cannot mark feature done: ${unverifiedBash.length} bash acceptance criteria need to be verified.\n${names}\n\nUse /mission edit to waive or verify them, or ensure bash checks pass.`, "warning");
  }

  feature.status = "done";
  feature.completedAt = Date.now();
  const evidenceFile = saveEvidence(mission, feature, evidence || "Marked done.");
  appendHistory(mission, { event: "feature_done", featureId: feature.id, details: { evidenceFile } });
  autoUnblockResolved(mission);
  const next = getNextPendingFeature(mission);
  if (!next && allFeaturesDone(mission)) mission.status = "complete";
  autoCompleteMilestones(mission);
  await saveMissionSafe(mission);
  updateFooter(ctx, mission);
  ctx.ui.notify(`✅ ${feature.id} done. Evidence: ${evidenceFile}`, "info");
}

// ── /mission block ──────────────────────────────────────────────────────────

export async function handleBlock(reason: string, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  const feature = mission ? getActiveFeature(mission) : null;
  if (!mission || !feature) return ctx.ui.notify("No active feature.", "warning");
  feature.status = "blocked";
  feature.notes = reason || "Blocked";
  appendHistory(mission, { event: "feature_blocked", featureId: feature.id, note: feature.notes });
  await saveMissionSafe(mission);
  updateFooter(ctx, mission);
}

// ── /mission run ────────────────────────────────────────────────────────────

export async function handleRun(ctx: ExtensionCommandContext, pi: ExtensionAPI, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  if (!mission) return ctx.ui.notify("No active mission. Use /mission new <title> or /mission load <id>.", "warning");
  mission.status = "active";
  mission.autopilot = {
    ...mission.autopilot,
    enabled: true,
    mode: "autopilot",
    iteration: 0,
    consecutiveFailures: 0,
    noProgressTurns: 0,
    startedAt: new Date().toISOString(),
    lastStopReason: undefined,
    lastStopMessage: undefined,
  };
  const feature = ensureActiveFeature(mission);
  if (!feature) {
    mission.autopilot.enabled = false;
    mission.autopilot.lastStopReason = "no_active_feature";
    await saveMissionSafe(mission);
    updateFooter(ctx, mission);
    return ctx.ui.notify("No runnable feature is available for autopilot.", "warning");
  }
  appendHistory(mission, { event: "autopilot_started", featureId: feature.id });
  await saveMissionSafe(mission);
  updateFooter(ctx, mission);
  await triggerMissionContinuation(pi, ctx, mission);
  ctx.ui.notify(`Autopilot started for ${feature.id} - ${feature.title}.`, "info");
}

// ── /mission autopilot ──────────────────────────────────────────────────────

export async function handleAutopilot(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  if (!mission) return ctx.ui.notify("No active mission.", "warning");
  const decision = shouldContinueMission(mission, ctx);
  const a = mission.autopilot;
  ctx.ui.notify([
    `Autopilot: ${a.enabled ? "ON" : "OFF"} (${a.mode})`,
    `Iteration: ${a.iteration}/${a.maxIterations}`,
    `Failures: ${a.consecutiveFailures}/${a.maxConsecutiveFailures}`,
    `No-progress: ${a.noProgressTurns}/${a.maxNoProgressTurns}`,
    `Context limit: ${a.maxContextPercent}%`,
    `Last continuation: ${a.lastContinuationAt ?? "never"}`,
    `Last stop: ${a.lastStopReason ?? "none"}${a.lastStopMessage ? ` - ${a.lastStopMessage}` : ""}`,
    `Would continue: ${decision.continue ? "yes" : `no (${decision.reason})`}`,
  ].join("\n"), "info");
}

// ── /mission stop ───────────────────────────────────────────────────────────

export async function handleStop(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  if (!mission) return ctx.ui.notify("No active mission.", "warning");
  mission.autopilot.enabled = false;
  mission.autopilot.mode = "manual";
  mission.autopilot.lastStopReason = "paused_by_user";
  mission.autopilot.lastStopMessage = "Stopped by user.";
  appendHistory(mission, { event: "autopilot_stopped" });
  await saveMissionSafe(mission);
  updateFooter(ctx, mission);
  ctx.ui.notify("Autopilot stopped.", "info");
}

// ── /mission pause ──────────────────────────────────────────────────────────

export async function handlePause(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  if (!runtime.activeMission) return ctx.ui.notify("No active mission.", "warning");
  runtime.activeMission.status = "paused";
  runtime.activeMission.autopilot.enabled = false;
  runtime.activeMission.autopilot.lastStopReason = "paused_by_user";
  runtime.activeMission.autopilot.lastStopMessage = "Paused by user.";
  appendHistory(runtime.activeMission, { event: "mission_paused" });
  await saveMissionSafe(runtime.activeMission);
  updateFooter(ctx, runtime.activeMission);
}

// ── /mission resume ─────────────────────────────────────────────────────────

export async function handleResume(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  if (!runtime.activeMission) return ctx.ui.notify("No active mission.", "warning");
  runtime.activeMission.status = "active";
  runtime.activeMission.autopilot.enabled = true;
  runtime.activeMission.autopilot.mode = "autopilot";
  runtime.activeMission.autopilot.lastStopReason = undefined;
  runtime.activeMission.autopilot.lastStopMessage = undefined;
  ensureActiveFeature(runtime.activeMission);
  appendHistory(runtime.activeMission, { event: "mission_resumed" });
  await saveMissionSafe(runtime.activeMission);
  updateFooter(ctx, runtime.activeMission);
  ctx.ui.notify("Mission resumed. Use /mission run to trigger the next autopilot turn immediately.", "info");
}

// ── /mission clear ──────────────────────────────────────────────────────────

export async function handleClear(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  runtime.activeMission = null;
  updateFooter(ctx, null);
  ctx.ui.notify("Mission detached from this session.", "info");
}
