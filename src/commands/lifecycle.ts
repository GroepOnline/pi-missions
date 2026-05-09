import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { RuntimeState } from "../types.js";
import { appendHistory, autoBlockBlockedFeatures, getActiveFeature, saveMissionSafe } from "../state.js";
import { ensureActiveFeature, shouldContinueMission, triggerMissionContinuation } from "../autopilot.js";
import { activateNextFeature, completeActiveFeature } from "../transitions.js";
import { updateFooter } from "../ui.js";

// ── /mission next ───────────────────────────────────────────────────────────

export async function handleNext(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  if (!mission) return ctx.ui.notify("No active mission.", "warning");

  const result = activateNextFeature(mission);
  if (!result.ok) {
    if (result.reason === "active_not_done") {
      return ctx.ui.notify(`Active feature is not done yet: ${result.active.id} — ${result.active.title}\nUse /mission done when complete, or /mission block <reason> if it cannot continue.`, "warning");
    }
    if (result.reason === "mission_complete") {
      await saveMissionSafe(mission);
      updateFooter(ctx, mission);
      return ctx.ui.notify("🎉 Mission complete.", "info");
    }
    return ctx.ui.notify("No unblocked pending feature found. Check blocked features and dependencies with /mission status.", "warning");
  }

  autoBlockBlockedFeatures(mission);
  await saveMissionSafe(mission);
  updateFooter(ctx, mission);
  ctx.ui.notify(`➡️ Active feature: ${result.next.id} — ${result.next.title}\n${result.next.description}`, "info");
}

// ── /mission done ───────────────────────────────────────────────────────────

export async function handleDone(evidence: string, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  const feature = mission ? getActiveFeature(mission) : null;
  if (!mission || !feature) return ctx.ui.notify("No active feature.", "warning");
  if (!evidence && ctx.hasUI) evidence = (await ctx.ui.input("Evidence", "Why is this feature done?")) || "Marked done manually.";

  const result = completeActiveFeature(mission, { evidence: evidence || "Marked done.", autoVerify: true });
  if (!result.ok) return ctx.ui.notify(`${result.reason}\n\nUse /mission edit to waive criteria, or ensure bash checks pass.`, "warning");

  await saveMissionSafe(mission);
  updateFooter(ctx, mission);
  ctx.ui.notify(`✅ ${result.feature.id} done. Evidence: ${result.evidenceFile}`, "info");
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
