import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { RuntimeState } from "../core/types.js";
import { WizardOutputSchema, validate } from "../core/types.js";
import {
  activateNextFeature, appendHistory, autoBlockBlockedFeatures,
  completeActiveFeature, getActiveFeature, getFeatureById, getMilestoneById,
  getNextPendingFeature,
  loadMissionFromDisk, listMissions, progress, readHistory, saveMissionSafe,
  readRawSchemaVersion, readRawMissionCounts, migrateMissionOnDisk,
} from "../core/state.js";
import { SCHEMA_VERSION } from "../core/types.js";
import { missionsRoot } from "../utils/fs.js";
import { buildMissionContext, buildMissionHelp, buildCompactionSummary } from "../utils/context.js";
import { createStructuredMission, missionFromWizardOutput, createMissionFromTemplate, MISSION_TEMPLATES, exportMarkdown } from "../utils/markdown.js";
import { updateFooter, statusText, dashboardRows } from "../ui/components.js";
import { missionControlOverlay } from "../ui/dashboard.js";
import { sessionMetrics } from "../engines/metrics.js";
import { ensureActiveFeature, shouldContinue, triggerContinuation } from "../engines/autopilot.js";
import { spawnWorker, killWorker, getActiveWorker, isWorkerRunning, type WorkerResult } from "../engines/worker.js";
import { calculateMetricsSummary, computeMissionMetrics } from "../core/state.js";
import { injectMissionContext, enforceToolPolicy, enforceToolMax } from "../tools/index.js";

// ═══════════════════════════════════════════════════════════════════════════
// Planning wizard prompt
// ═══════════════════════════════════════════════════════════════════════════

const PLANNING_WIZARD_PROMPT = `You are the mission planner for a software development mission. Analyze the user's goal and produce a structured mission plan.

Goal: {goal}
Constraints: {constraints}

Respond ONLY with a valid JSON object (no markdown, no explanation) in this exact format:
{
  "title": "short mission title",
  "milestones": [
    {
      "id": "M01",
      "title": "Milestone 1 title",
      "description": "What this milestone covers",
      "features": [
        {
          "id": "F001",
          "title": "Feature 1 title",
          "description": "What this feature does",
          "priority": 1,
          "dependsOn": [],
          "acceptance": [
            { "id": "AC001", "description": "Acceptance criterion", "checkType": "manual" }
          ]
        }
      ]
    }
  ]
}

Rules:
- id format: M01, M02, ... for milestones; F001, F002, ... per milestone
- At least 2 milestones, at least 5 total features
- Each feature needs at least one acceptance criterion
- checkType: "manual" | "bash" | "test_file"
- priority: 1 (highest) to 5 (lowest)
- Be specific and actionable
`;

// ═══════════════════════════════════════════════════════════════════════════
// Injection helper — thin wrapper that builds context before injecting
// ═══════════════════════════════════════════════════════════════════════════

function injectMissionContextWrapper(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  mission: NonNullable<RuntimeState["activeMission"]>,
  reason: string,
): void {
  injectMissionContext(pi, ctx, mission, reason, buildMissionContext(mission));
}

// ═══════════════════════════════════════════════════════════════════════════
// /mission new / /mission start
// ═══════════════════════════════════════════════════════════════════════════

export async function handleNew(
  titleArg: string, ctx: ExtensionCommandContext,
  pi: ExtensionAPI, runtime: RuntimeState,
): Promise<void> {
  const title = titleArg || "Untitled mission";
  let goal = title;
  let constraints = "";
  let usedWizard = false;

  if (ctx.hasUI) {
    goal = (await ctx.ui.input("Mission goal", `What should '${title}' achieve?`)) || title;
    constraints = (await ctx.ui.input("Constraints", "Hard rules? (tests, no deps, etc.)")) || "";
  }

  let parsedMission: ReturnType<typeof createStructuredMission> | null = null;
  const planningPrompt = PLANNING_WIZARD_PROMPT.replace("{goal}", goal).replace("{constraints}", constraints);

  const piWithSend = pi as ExtensionAPI & { sendUserMessage?: (m: string, o?: { timeoutMs: number }) => Promise<unknown> };
  if (piWithSend.sendUserMessage) {
    try {
      ctx.ui.notify("🤖 Planning wizard generating milestones…", "info");
      const response = await piWithSend.sendUserMessage(planningPrompt, { timeoutMs: 60_000 });
      const text = typeof response === "string" ? response : String((response as Record<string, unknown>)?.content ?? JSON.stringify(response));
      const m = String(text).match(/\{[\s\S]*\}/);
      if (m) {
        const raw = JSON.parse(m[0]);
        const validation = validate(WizardOutputSchema, raw);
        if (!validation.valid) {
          ctx.ui.notify("Wizard output incomplete; falling back to structured scaffold.", "warning");
        } else {
          parsedMission = missionFromWizardOutput(raw, title, goal);
          if (!parsedMission) ctx.ui.notify("Wizard output too little structure; falling back.", "warning");
          else usedWizard = true;
        }
      }
    } catch { /* fall through */ }
  }

  const mission = parsedMission ?? createStructuredMission(title, goal, constraints);
  runtime.activeMission = mission;
  await saveMissionSafe(mission);
  appendHistory(mission, { event: "mission_created", note: goal, details: { usedWizard } });
  pi.appendEntry("pi-mission-active", { missionId: mission.id, validationToken: mission.validationToken });
  injectMissionContextWrapper(pi, ctx, mission, "mission_started");
  pi.setSessionName(`🎯 ${mission.title}`);
  updateFooter(ctx, mission);
  const fc = mission.milestones.reduce((s, m) => s + m.features.length, 0);
  ctx.ui.notify(usedWizard
    ? `✅ Mission created: ${mission.milestones.length} milestones, ${fc} features (AI-generated)`
    : `✅ Mission created: ${mission.id} — /mission status or /mission next`, "info");
}

// ═══════════════════════════════════════════════════════════════════════════
// /mission templates
// ═══════════════════════════════════════════════════════════════════════════

export async function handleTemplates(
  sub: string | undefined, arg: string | undefined, title: string,
  ctx: ExtensionCommandContext, pi: ExtensionAPI, runtime: RuntimeState,
): Promise<void> {
  if (!sub || sub === "list") {
    const lines = ["Available templates:", ""];
    for (const t of MISSION_TEMPLATES) lines.push(`  ${t.id.padEnd(12)} ${t.label.padEnd(20)} ${t.description}`);
    lines.push("", "/mission templates scaffold <id> [title]");
    ctx.ui.notify(lines.join("\n"), "info");
    return;
  }
  if (sub === "scaffold" && arg) {
    const mission = createMissionFromTemplate(arg, title);
    if (!mission) return ctx.ui.notify(`Unknown template: ${arg}. Use /mission templates list.`, "error");
    runtime.activeMission = mission;
    await saveMissionSafe(mission);
    appendHistory(mission, { event: "mission_created", note: `From template: ${arg}` });
    pi.appendEntry("pi-mission-active", { missionId: mission.id, validationToken: mission.validationToken });
    injectMissionContextWrapper(pi, ctx, mission, "mission_started_from_template");
    pi.setSessionName(`🎯 ${mission.title}`);
    updateFooter(ctx, mission);
    ctx.ui.notify(`✅ Mission created from '${arg}' template: ${mission.id}`, "info");
    return;
  }
  ctx.ui.notify("Usage: /mission templates [list|scaffold <id> [title]]", "warning");
}

// ═══════════════════════════════════════════════════════════════════════════
// /mission list
// ═══════════════════════════════════════════════════════════════════════════

export async function handleList(ctx: ExtensionCommandContext, pi: ExtensionAPI, runtime: RuntimeState): Promise<void> {
  const missions = listMissions();
  if (!missions.length) return ctx.ui.notify("No missions found.", "info");
  if (!ctx.hasUI) {
    return ctx.ui.notify(missions.map(m => `${m.id} — ${m.title} (${m.status})`).join("\n"), "info");
  }
  const labels = missions.map(m => `${m.id} — ${m.title} [${progress(m).done}/${progress(m).total}] ${m.status}`);
  const choice = await ctx.ui.select("Load mission:", labels);
  if (!choice) return;
  await handleLoad(choice.split(" — ")[0], ctx, pi, runtime);
}

// ═══════════════════════════════════════════════════════════════════════════
// /mission load
// ═══════════════════════════════════════════════════════════════════════════

export async function handleLoad(id: string | undefined, ctx: ExtensionCommandContext, pi: ExtensionAPI, runtime: RuntimeState): Promise<void> {
  if (!id) return ctx.ui.notify("Usage: /mission load <id>", "warning");
  const mission = loadMissionFromDisk(id);
  if (!mission) return ctx.ui.notify(`Mission not found: ${id}`, "error");

  autoBlockBlockedFeatures(mission);
  runtime.activeMission = mission;
  pi.appendEntry("pi-mission-active", { missionId: mission.id, validationToken: mission.validationToken });
  injectMissionContextWrapper(pi, ctx, mission, "mission_loaded");
  pi.setSessionName(`🎯 ${mission.title}`);
  updateFooter(ctx, mission);
  ctx.ui.notify(`Loaded mission: ${mission.title}`, "info");
}

// ═══════════════════════════════════════════════════════════════════════════
// /mission status
// ═══════════════════════════════════════════════════════════════════════════

export async function handleStatus(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  if (!mission) return ctx.ui.notify("No active mission. /mission new or /mission load.", "info");
  updateFooter(ctx, mission);
  ctx.ui.notify(statusText(mission), "info");
}

export async function handleHelp(ctx: ExtensionCommandContext): Promise<void> {
  ctx.ui.notify(buildMissionHelp(), "info");
}

// ═══════════════════════════════════════════════════════════════════════════
// /mission next
// ═══════════════════════════════════════════════════════════════════════════

export async function handleNext(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const m = runtime.activeMission;
  if (!m) return ctx.ui.notify("No active mission.", "warning");

  const result = activateNextFeature(m);
  if (!result.ok) {
    if (result.reason === "active_not_done") {
      return ctx.ui.notify(`Active feature not done yet: ${result.active.id} — ${result.active.title}\n/mission done or /mission block.`, "warning");
    }
    if (result.reason === "mission_complete") {
      await saveMissionSafe(m); updateFooter(ctx, m);
      return ctx.ui.notify("🎉 Mission complete.", "info");
    }
    return ctx.ui.notify("No unblocked pending feature found.", "warning");
  }
  autoBlockBlockedFeatures(m);
  await saveMissionSafe(m); updateFooter(ctx, m);
  ctx.ui.notify(`➡️ Active feature: ${result.next.id} — ${result.next.title}\n${result.next.description}`, "info");
}

// ═══════════════════════════════════════════════════════════════════════════
// /mission done
// ═══════════════════════════════════════════════════════════════════════════

export async function handleDone(evidence: string, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const m = runtime.activeMission;
  const f = m ? getActiveFeature(m) : null;
  if (!m || !f) return ctx.ui.notify("No active feature.", "warning");
  if (!evidence && ctx.hasUI) evidence = (await ctx.ui.input("Evidence", "Why is this feature done?")) || "Marked done.";

  const result = completeActiveFeature(m, { evidence: evidence || "Marked done.", autoVerify: true });
  if (!result.ok) return ctx.ui.notify(`${result.reason}\n\n/mission edit to waive criteria.`, "warning");

  await saveMissionSafe(m); updateFooter(ctx, m);
  
  // Suggest handoff for large features (>50 tool calls or >10 min active)
  const wallMs = (f.startedAt && f.completedAt) ? f.completedAt - f.startedAt : 0;
  const isLarge = f.toolCallCount > 50 || wallMs > 600_000;
  const nextPending = getNextPendingFeature(m);
  
  let notify = `✅ ${result.feature.id} done. Evidence: ${result.evidenceFile}`;
  if (isLarge && nextPending && !result.missionComplete) {
    notify += `\n\n🤝 Large feature completed (${f.toolCallCount} calls, ${Math.round(wallMs / 60000)}min). Consider /handoff "Continue ${m.title} from ${nextPending.id} — ${nextPending.title}" for a fresh session.`;
  }
  ctx.ui.notify(notify, "info");
}

// ═══════════════════════════════════════════════════════════════════════════
// /mission block
// ═══════════════════════════════════════════════════════════════════════════

export async function handleBlock(reason: string, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const m = runtime.activeMission;
  const f = m ? getActiveFeature(m) : null;
  if (!m || !f) return ctx.ui.notify("No active feature.", "warning");
  f.status = "blocked";
  f.notes = reason || "Blocked";
  appendHistory(m, { event: "feature_blocked", featureId: f.id, note: f.notes });
  await saveMissionSafe(m); updateFooter(ctx, m);
}

// ═══════════════════════════════════════════════════════════════════════════
// /mission run / /mission autopilot / /mission stop / pause / resume / clear
// ═══════════════════════════════════════════════════════════════════════════

export async function handleRun(ctx: ExtensionCommandContext, pi: ExtensionAPI, runtime: RuntimeState): Promise<void> {
  const m = runtime.activeMission;
  if (!m) return ctx.ui.notify("No active mission.", "warning");
  m.status = "active";
  m.autopilot = {
    ...m.autopilot, enabled: true, mode: "autopilot", iteration: 0,
    consecutiveFailures: 0, noProgressTurns: 0,
    startedAt: new Date().toISOString(), lastStopReason: undefined, lastStopMessage: undefined,
  };
  const f = ensureActiveFeature(m);
  if (!f) {
    m.autopilot.enabled = false; m.autopilot.lastStopReason = "no_active_feature";
    await saveMissionSafe(m); updateFooter(ctx, m);
    return ctx.ui.notify("No runnable feature available.", "warning");
  }
  appendHistory(m, { event: "autopilot_started", featureId: f.id });
  await saveMissionSafe(m); updateFooter(ctx, m);
  await triggerContinuation(pi, ctx, m);
  ctx.ui.notify(`Autopilot started for ${f.id} - ${f.title}.`, "info");
}

export async function handleAutopilot(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const m = runtime.activeMission;
  if (!m) return ctx.ui.notify("No active mission.", "warning");
  const decision = shouldContinue(m, ctx);
  const a = m.autopilot;
  ctx.ui.notify([
    `Autopilot: ${a.enabled ? "ON" : "OFF"} (${a.mode})`,
    `Iteration: ${a.iteration}/${a.maxIterations}`,
    `Failures: ${a.consecutiveFailures}/${a.maxConsecutiveFailures}`,
    `No-progress: ${a.noProgressTurns}/${a.maxNoProgressTurns}`,
    `Last stop: ${a.lastStopReason ?? "none"}${a.lastStopMessage ? ` - ${a.lastStopMessage}` : ""}`,
    `Would continue: ${decision.continue ? "yes" : `no (${decision.reason})`}`,
  ].join("\n"), "info");
}

export async function handleStop(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const m = runtime.activeMission;
  if (!m) return ctx.ui.notify("No active mission.", "warning");
  m.autopilot.enabled = false; m.autopilot.mode = "manual";
  m.autopilot.lastStopReason = "paused_by_user"; m.autopilot.lastStopMessage = "Stopped by user.";
  appendHistory(m, { event: "autopilot_stopped" });
  await saveMissionSafe(m); updateFooter(ctx, m);
  ctx.ui.notify("Autopilot stopped.", "info");
}

export async function handlePause(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  if (!runtime.activeMission) return ctx.ui.notify("No active mission.", "warning");
  runtime.activeMission.status = "paused";
  runtime.activeMission.autopilot.enabled = false;
  runtime.activeMission.autopilot.lastStopReason = "paused_by_user";
  runtime.activeMission.autopilot.lastStopMessage = "Paused by user.";
  appendHistory(runtime.activeMission, { event: "mission_paused" });
  await saveMissionSafe(runtime.activeMission); updateFooter(ctx, runtime.activeMission);
}

export async function handleResume(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  if (!runtime.activeMission) return ctx.ui.notify("No active mission.", "warning");
  runtime.activeMission.status = "active";
  runtime.activeMission.autopilot.enabled = true;
  runtime.activeMission.autopilot.mode = "autopilot";
  runtime.activeMission.autopilot.lastStopReason = undefined;
  runtime.activeMission.autopilot.lastStopMessage = undefined;
  ensureActiveFeature(runtime.activeMission);
  appendHistory(runtime.activeMission, { event: "mission_resumed" });
  await saveMissionSafe(runtime.activeMission); updateFooter(ctx, runtime.activeMission);
  ctx.ui.notify("Resumed. /mission run for immediate autopilot turn.", "info");
}

export async function handleClear(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  runtime.activeMission = null;
  updateFooter(ctx, null);
  ctx.ui.notify("Mission detached.", "info");
}

// ═══════════════════════════════════════════════════════════════════════════
// /mission edit
// ═══════════════════════════════════════════════════════════════════════════

export async function handleEdit(featureId: string | undefined, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const m = runtime.activeMission;
  if (!m || !featureId) return ctx.ui.notify("Usage: /mission edit <feature-id>", "warning");
  const f = getFeatureById(m, featureId);
  if (!f) return ctx.ui.notify(`Feature not found: ${featureId}`, "error");
  if (!ctx.hasUI) return ctx.ui.notify(JSON.stringify(f, null, 2), "info");

  const edited = await ctx.ui.editor("Edit feature JSON", JSON.stringify(f, null, 2));
  if (!edited) return;
  let parsed: unknown;
  try { parsed = JSON.parse(edited); } catch (e) {
    return ctx.ui.notify(`Invalid feature JSON: ${e instanceof Error ? e.message : String(e)}`, "error");
  }
  const { FeatureSchema } = await import("../core/types.js");
  const validation = validate(FeatureSchema, parsed);
  if (!validation.valid) {
    const errors = validation.errors.slice(0, 5).map(e => `- ${e.path}: ${e.message}`).join("\n");
    return ctx.ui.notify(`Invalid feature:\n${errors}`, "error");
  }
  Object.assign(f, parsed);
  appendHistory(m, { event: "feature_edited", featureId });
  await saveMissionSafe(m); updateFooter(ctx, m);
}

// ═══════════════════════════════════════════════════════════════════════════
// /mission fork
// ═══════════════════════════════════════════════════════════════════════════

import type { ForkSessionManager, ForkReplacementContext } from "../core/types.js";
import { buildForkKickoffMessage, buildManualForkHandoff, appendForkNote, pushSessionRef, cloneFeatureForFork } from "../tools/index.js";

// The local fork handler delegates to the tool's fork helpers
// We inline the fork logic here since it's command-specific
async function forkFeatureInternally(
  m: NonNullable<RuntimeState["activeMission"]>,
  reason: string,
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const f = getActiveFeature(m);
  if (!f) { ctx.ui.notify("No active feature. Use /mission next to advance, then fork.", "warning"); return; }

  const sm = ctx.sessionManager as ForkSessionManager;
  const createdAt = new Date().toISOString();
  const parentLeafId = sm.getLeafId?.() ?? null;
  const parentSessionFile = sm.getSessionFile?.();
  const forkedId = `${f.id}-fork-${Date.now()}`;
  const forked = cloneFeatureForFork(f, forkedId, `${f.title} [fork]`, `Fork: ${reason}`);
  const milestone = getMilestoneById(m, f.milestoneId);
  if (!milestone) { ctx.ui.notify("Milestone not found.", "error"); return; }

  f.status = "blocked";
  f.notes = appendForkNote(f.notes, [`Forked at ${createdAt}`, `Fork: ${forked.id}`, `Reason: ${reason}`, parentLeafId ? `Leaf: ${parentLeafId}` : "", parentSessionFile ? `Session: ${parentSessionFile}` : ""]);
  pushSessionRef(f, `fork:${forked.id}`); pushSessionRef(f, parentLeafId ? `leaf:${parentLeafId}` : undefined); pushSessionRef(f, parentSessionFile ? `session:${parentSessionFile}` : undefined);

  forked.notes = appendForkNote(forked.notes, [`Fork source: ${f.id}`, `Created: ${createdAt}`, `Reason: ${reason}`, parentSessionFile ? `Parent session: ${parentSessionFile}` : ""]);
  pushSessionRef(forked, `parent-feature:${f.id}`); pushSessionRef(forked, parentLeafId ? `parent-leaf:${parentLeafId}` : undefined); pushSessionRef(forked, parentSessionFile ? `parent-session:${parentSessionFile}` : undefined);

  milestone.features.push(forked);
  m.activeFeatureId = forked.id; m.status = "active";
  appendHistory(m, { event: "feature_forked", featureId: f.id, note: reason, details: { forkedFeatureId: forked.id, parentLeafId, parentSessionFile, forkApiAvailable: typeof ctx.fork === "function" } });
  await saveMissionSafe(m);

  const kickoff = buildForkKickoffMessage(m.title, f, forked, reason, undefined, parentSessionFile);

  let forkResult: { cancelled?: boolean } | undefined;
  if (parentLeafId && typeof ctx.fork === "function") {
    forkResult = await ctx.fork(parentLeafId, {
      position: "at",
      withSession: async (fc) => {
        const fcCtx = fc as unknown as ForkReplacementContext;
        const fsf = (fc.sessionManager as ForkSessionManager | undefined)?.getSessionFile?.();
        const pm = loadMissionFromDisk(m.id);
        const pf = pm ? getFeatureById(pm, forked.id) : null;
        if (pm && pf) {
          pushSessionRef(pf, fsf ? `session:${fsf}` : undefined);
          appendHistory(pm, { event: "feature_fork_session_created", featureId: forked.id, note: reason, details: { sourceFeatureId: f.id, forkSessionFile: fsf, parentLeafId } });
          await saveMissionSafe(pm);
        }
        if (typeof fc.sendUserMessage === "function") await fc.sendUserMessage(kickoff);
        else fc.ui.notify(`🌿 Fork: ${forked.title}\n\n${kickoff}`, "info");
      },
    });
    if (!forkResult?.cancelled) return;
  }

  const manual = buildManualForkHandoff(m.title, f, forked, reason, parentLeafId, parentSessionFile);
  ctx.ui.notify(`${manual}\n\n${kickoff}`, forkResult?.cancelled ? "warning" : "info");
}

export async function handleFork(reason: string, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const m = runtime.activeMission;
  if (!m) return ctx.ui.notify("No active feature. Forks can only be created from an active feature.", "warning");
  if (ctx.hasUI) reason = (await ctx.ui.input("Alternative approach", reason || "Try a smaller/safer approach")) || reason;
  await forkFeatureInternally(m, reason || "Alternative approach", {} as ExtensionAPI, ctx);
}

// ═══════════════════════════════════════════════════════════════════════════
// /mission dashboard
// ═══════════════════════════════════════════════════════════════════════════

export async function handleDashboard(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const m = runtime.activeMission;
  if (!m) return ctx.ui.notify("No active mission.", "warning");
  if (!ctx.hasUI) { ctx.ui.notify(statusText(m), "info"); return; }

  let selected: string | null = null;
  const ui = ctx.ui as unknown as Record<string, unknown>;
  if (typeof ui.custom === "function") {
    await (ui.custom as Function)(missionControlOverlay(m, (fid) => { selected = fid; }), { overlay: true });
  }
  if (selected) {
    const f = getFeatureById(m, selected);
    if (f && m.activeFeatureId !== selected) {
      f.status = "active"; m.activeFeatureId = selected; m.activeMilestoneId = f.milestoneId; m.status = "active";
      autoBlockBlockedFeatures(m);
      appendHistory(m, { event: "feature_active", featureId: selected });
      await saveMissionSafe(m); updateFooter(ctx, m);
      ctx.ui.notify(`➡️ Activated: ${selected} — ${f.title}`, "info");
    } else if (f) {
      ctx.ui.notify(`Already active: ${selected} — ${f.title}`, "info");
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// /mission debug
// ═══════════════════════════════════════════════════════════════════════════

export async function handleDebug(id: string | undefined, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const m = id ? loadMissionFromDisk(id) : runtime.activeMission;
  if (!m) return ctx.ui.notify("No mission to debug.", "warning");
  const history = readHistory(m.id).slice(-25);
  ctx.ui.setWidget("pi-mission-debug", [
    `Mission: ${m.title}`, `Status: ${m.status}`, `Active: ${m.activeFeatureId ?? "none"}`,
    "─".repeat(80),
    ...history.map(h => `${new Date(h.ts * 1000).toISOString()} ${h.event} ${h.featureId ?? ""} ${h.note ?? ""}`),
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════
// /mission metrics
// ═══════════════════════════════════════════════════════════════════════════

export async function handleMetrics(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const summary = calculateMetricsSummary();
  const sess = sessionMetrics.getMetricsSummary();
  if (summary.totalMissions === 0) return ctx.ui.notify("No missions. /mission new <title>.", "info");

  ctx.ui.notify([
    "📊 Mission Metrics Summary", "=".repeat(40),
    `Total: ${summary.totalMissions}`,
    `Completed: ${summary.completedMissions}`,
    `Success: ${(summary.successRate * 100).toFixed(1)}%`,
    `Avg tokens: ${summary.averageTokensPerMission.toFixed(0)}`,
    `Avg features: ${summary.averageFeaturesPerMission.toFixed(1)}`,
    `Avg time: ${(summary.averageCompletionTimeMs / 1000 / 60).toFixed(1)} min`,
    "", "📈 Session", "=".repeat(40), sess,
  ].join("\n"), "info");

  const metricsFile = path.join(missionsRoot(), "metrics-export.json");
  try {
    fs.mkdirSync(missionsRoot(), { recursive: true });
    fs.writeFileSync(metricsFile, JSON.stringify(listMissions().map(computeMissionMetrics), null, 2), "utf-8");
    ctx.ui.notify(`📁 Exported: ${metricsFile}`, "info");
  } catch (e) {
    ctx.ui.notify(`Export failed: ${e instanceof Error ? e.message : String(e)}`, "warning");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// /mission history
// ═══════════════════════════════════════════════════════════════════════════

export async function handleHistory(
  filter: string | undefined,
  ctx: ExtensionCommandContext,
  runtime: RuntimeState,
): Promise<void> {
  const m = runtime.activeMission;
  if (!m) return ctx.ui.notify("No active mission. /mission load <id> first.", "warning");

  const allEntries = readHistory(m.id);
  if (!allEntries.length) return ctx.ui.notify("No history entries yet.", "info");

  let entries = allEntries;
  let label = "All events";

  // Sub-filters: feature, event type, or feature-id
  if (filter) {
    const lf = filter.toLowerCase();
    if (getFeatureById(m, filter)) {
      entries = entries.filter(e => e.featureId === filter);
      label = `Feature ${filter}`;
    } else {
      // Try event type filter first, then full-text search
      const eventMatch = entries.filter(e => e.event === filter);
      if (eventMatch.length > 0) {
        entries = eventMatch;
        label = `Event: ${filter}`;
      } else {
        // Full-text search in note and event fields
        entries = entries.filter(e =>
          e.event.includes(lf) || (e.note ?? "").toLowerCase().includes(lf) ||
          (e.featureId ?? "").toLowerCase().includes(lf),
        );
        label = `Search: "${filter.slice(0, 40)}"`;
      }
    }
    if (!entries.length) return ctx.ui.notify(`No history entries matching "${filter}".`, "info");
  }

  const recent = entries.slice(-40);
  const features = new Set(recent.map(e => e.featureId).filter(Boolean));
  const eventTypes = new Set(recent.map(e => e.event));

  const lines = [
    `📜 Mission History — ${label} (${recent.length} of ${entries.length} entries)`,
    `Features: ${[...features].join(", ") || "none"}`,
    `Event types: ${[...eventTypes].join(", ")}`,
    "─".repeat(80),
  ];

  // Compact table: timestamp event feature note
  for (const h of recent) {
    const ts = new Date(h.ts * 1000).toISOString().replace("T", " ").slice(0, 19);
    const evt = h.event.padEnd(24);
    const fid = (h.featureId ?? "").padEnd(8);
    const note = (h.note ?? "").slice(0, 60);
    lines.push(`${ts}  ${evt} ${fid} ${note}`);
  }

  lines.push(
    "─".repeat(80),
    "Filters: /mission history [feature_id|event_type|search_term]",
    `Full log: ~/.pi/missions/${m.id}/history.jsonl`,
    "jq replay: jq -r '.event + \" \" + (.featureId // \"\")' ~/.pi/missions/<id>/history.jsonl",
  );

  ctx.ui.notify(lines.join("\n"), "info");
}

// ═══════════════════════════════════════════════════════════════════════════
// /mission export
// ═══════════════════════════════════════════════════════════════════════════

export async function handleExport(filename: string | undefined, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const m = runtime.activeMission;
  if (!m) return ctx.ui.notify("No active mission.", "warning");
  try {
    const md = exportMarkdown(m);
    if (filename) {
      fs.writeFileSync(filename, md, "utf-8");
      ctx.ui.notify(`✅ Exported to ${filename}`, "info");
    } else {
      ctx.ui.notify(md, "info");
    }
  } catch (e) {
    ctx.ui.notify(`Export failed: ${e instanceof Error ? e.message : String(e)}`, "warning");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// /mission worker / /mission worker-status / /mission kill-worker
// ═══════════════════════════════════════════════════════════════════════════

export async function handleWorker(
  featureId: string | undefined,
  ctx: ExtensionCommandContext,
  runtime: RuntimeState,
): Promise<void> {
  const m = runtime.activeMission;
  if (!m) return ctx.ui.notify("No active mission.", "warning");

  const fid = featureId || m.activeFeatureId;
  if (!fid) return ctx.ui.notify("No feature specified and no active feature.", "warning");

  const f = getFeatureById(m, fid);
  if (!f) return ctx.ui.notify(`Feature not found: ${fid}`, "error");

  if (isWorkerRunning()) {
    const aw = getActiveWorker();
    const elapsed = aw ? Math.round((Date.now() - aw.startedAt) / 1000) : 0;
    return ctx.ui.notify(`Worker already running for ${aw?.featureId} (${elapsed}s). Use /mission worker-status.`, "warning");
  }

  // Mark feature active
  f.status = "active";
  m.activeFeatureId = f.id;
  m.activeMilestoneId = f.milestoneId;
  m.status = "active";

  appendHistory(m, {
    event: "worker_spawned",
    featureId: f.id,
    note: `Worker spawned for ${f.id} — ${f.title}`,
  });

  await saveMissionSafe(m);

  ctx.ui.notify(`🚀 Worker spawned for ${f.id} — ${f.title}. Check /mission worker-status for progress.`, "info");

  // Fire-and-forget: spawn async, report result when done
  spawnWorker(m, { featureId: f.id }).then((result) => {
    if ("error" in result) {
      ctx.ui.notify(`❌ Worker error: ${result.error}`, "error");
      return;
    }
    const r = result as WorkerResult;
    const duration = Math.round(r.durationMs / 1000);
    const statusIcon = r.killed ? "⏱️" : r.exitCode === 0 ? "✅" : "❌";
    const lines = [
      `${statusIcon} Worker finished for ${r.featureId}`,
      `Exit: ${r.exitCode}${r.signal ? ` (${r.signal})` : ""} | Duration: ${duration}s`,
    ];
    const outSummary = r.stdout.slice(-1500);
    if (outSummary) lines.push("", "── Output (last 1500 chars) ──", outSummary);
    ctx.ui.notify(lines.join("\n"), "info");
  }).catch((err: unknown) => {
    ctx.ui.notify(`❌ Worker failed: ${err instanceof Error ? err.message : String(err)}`, "error");
  });
}

export async function handleWorkerStatus(ctx: ExtensionCommandContext): Promise<void> {
  const aw = getActiveWorker();
  if (!aw) return ctx.ui.notify("No worker running.", "info");

  const elapsed = Math.round((Date.now() - aw.startedAt) / 1000);
  const lines = [
    `🔧 Worker Status`,
    `Feature: ${aw.featureId}`,
    `Status: ${aw.status}`,
    `Running: ${elapsed}s`,
  ];

  if (aw.result) {
    lines.push(
      "", "Last Result:",
      `Exit: ${aw.result.exitCode}${aw.result.signal ? ` (${aw.result.signal})` : ""}`,
      `Duration: ${Math.round(aw.result.durationMs / 1000)}s`,
    );
  }

  ctx.ui.notify(lines.join("\n"), "info");
}

export async function handleKillWorker(ctx: ExtensionCommandContext): Promise<void> {
  const killed = killWorker();
  if (!killed) return ctx.ui.notify("No worker running to kill.", "info");
  ctx.ui.notify("🛑 Worker killed.", "info");
}

// ═══════════════════════════════════════════════════════════════════════════
// /mission migrate — schema migration
// ═══════════════════════════════════════════════════════════════════════════

export async function handleMigrate(
  id: string | undefined,
  ctx: ExtensionCommandContext,
  runtime: RuntimeState,
): Promise<void> {
  // List all missions and their schema versions
  if (!id) {
    const missions = listMissions();
    if (!missions.length) return ctx.ui.notify("No missions found.", "info");

    const lines = ["📋 Mission Schema Versions", "=".repeat(60)];
    let needsMigration = 0;
    for (const m of missions) {
      const rawVersion = readRawSchemaVersion(m.id);
      const versionStr = rawVersion !== null ? `v${rawVersion}` : "?";
      const status = rawVersion === SCHEMA_VERSION ? "✅" : rawVersion !== null ? "⬆️" : "❓";
      if (rawVersion !== null && rawVersion < SCHEMA_VERSION) needsMigration++;
      lines.push(`${status} ${m.id.padEnd(28)} ${versionStr.padEnd(6)} ${m.title.slice(0, 30)}`);
    }
    lines.push(
      "=".repeat(60),
      `Current schema: v${SCHEMA_VERSION}`,
      needsMigration > 0
        ? `${needsMigration} mission(s) need migration. Use /mission migrate <id> to migrate.`
        : "All missions up to date.",
    );
    ctx.ui.notify(lines.join("\n"), "info");
    return;
  }

  // Migrate a specific mission
  const rawVersion = readRawSchemaVersion(id);
  if (rawVersion === null) return ctx.ui.notify(`Mission not found: ${id}`, "error");
  if (rawVersion >= SCHEMA_VERSION) {
    return ctx.ui.notify(`Mission ${id} already at v${rawVersion} (current: v${SCHEMA_VERSION}). No migration needed.`, "info");
  }

  // Show preview — use raw counts for accuracy (loadMissionFromDisk migrates in-memory)
  const rawCounts = readRawMissionCounts(id);
  const current = loadMissionFromDisk(id);
  if (!current) return ctx.ui.notify(`Could not load mission ${id}.`, "error");

  const featuresBefore = rawCounts?.features ?? current.milestones.reduce((s, m) => s + m.features.length, 0);
  const milestonesBefore = rawCounts?.milestones ?? current.milestones.length;
  const preview = [
    `⬆️ Migration preview for ${id}`,
    "=".repeat(60),
    `Title: ${current.title}`,
    `Schema: v${rawVersion} → v${SCHEMA_VERSION}`,
    `Status: ${current.status}`,
    `Milestones: ${milestonesBefore}`,
    `Features: ${featuresBefore}`,
    "=".repeat(60),
    "",
    "Migration will:",
    "- Set schemaVersion to v3",
    rawVersion <= 1 ? "- Wrap flat features into a milestone if needed" : null,
    rawVersion <= 2 ? "- Add default autopilot settings" : null,
    "- Create a pre-migration backup",
    "",
    `Run /mission migrate ${id} confirm to proceed.`,
  ].filter(Boolean).join("\n");

  ctx.ui.notify(preview, "info");
}

export async function handleMigrateConfirm(
  id: string | undefined,
  ctx: ExtensionCommandContext,
  runtime: RuntimeState,
): Promise<void> {
  if (!id) return ctx.ui.notify("Usage: /mission migrate <id> confirm", "warning");

  const rawVersion = readRawSchemaVersion(id);
  if (rawVersion === null) return ctx.ui.notify(`Mission not found: ${id}`, "error");
  if (rawVersion >= SCHEMA_VERSION) {
    return ctx.ui.notify(`Already at v${rawVersion}. No migration needed.`, "info");
  }

  const migrated = await migrateMissionOnDisk(id);
  if (!migrated) return ctx.ui.notify(`Migration failed for ${id}.`, "error");

  // If this is the active mission, update runtime
  if (runtime.activeMission && runtime.activeMission.id === id) {
    runtime.activeMission = migrated;
  }

  const fc = migrated.milestones.reduce((s, m) => s + m.features.length, 0);
  ctx.ui.notify(
    `✅ Migrated ${id} from v${rawVersion} to v${SCHEMA_VERSION}.\n` +
    `Milestones: ${migrated.milestones.length}, Features: ${fc}\n` +
    `Backup saved to ~/.pi/missions/${id}/plan.json.pre-migration-*.bak`,
    "info",
  );
}
