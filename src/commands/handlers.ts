import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { RuntimeState } from "../core/types.js";
import { WizardOutputSchema, validate } from "../core/types.js";
import {
  activateNextFeature, appendHistory, autoBlockBlockedFeatures,
  completeActiveFeature, getActiveFeature, getFeatureById, getMilestoneById,
  loadMissionFromDisk, listMissions, progress, readHistory, saveMissionSafe,
} from "../core/state.js";
import { missionsRoot } from "../utils/fs.js";
import { buildMissionContext, buildMissionHelp, buildCompactionSummary } from "../utils/context.js";
import { createStructuredMission, missionFromWizardOutput, createMissionFromTemplate, MISSION_TEMPLATES, exportMarkdown } from "../utils/markdown.js";
import { updateFooter, statusText, dashboardRows } from "../ui/components.js";
import { missionControlOverlay } from "../ui/dashboard.js";
import { sessionMetrics } from "../engines/metrics.js";
import { ensureActiveFeature, shouldContinue, triggerContinuation } from "../engines/autopilot.js";
import { calculateMetricsSummary, computeMissionMetrics } from "../core/state.js";
import { injectMissionContext as injectMissionCtx, enforceToolPolicy, enforceToolMax } from "../tools/index.js";

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

function injectMissionContext(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  mission: NonNullable<RuntimeState["activeMission"]>,
  reason: string,
): void {
  injectMissionCtx(pi, ctx, mission, reason, buildMissionContext(mission));
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
  injectMissionContext(pi, ctx, mission, "mission_started");
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
    injectMissionContext(pi, ctx, mission, "mission_started_from_template");
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
  injectMissionContext(pi, ctx, mission, "mission_loaded");
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
  ctx.ui.notify(`✅ ${result.feature.id} done. Evidence: ${result.evidenceFile}`, "info");
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
