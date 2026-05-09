import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { Feature, RuntimeState } from "../types.js";
import { appendHistory, autoBlockBlockedFeatures, getActiveFeature, getFeatureById, getMilestoneById, loadMissionFromDisk, readHistory, saveEvidence, saveMissionSafe } from "../state.js";
import { cloneFeatureForFork } from "./index.js";
import { updateFooter, statusText } from "../ui.js";
import { missionControlOverlay } from "../dashboard.js";
import { validate, formatValidationErrors } from "../validation.js";
import { FeatureSchema } from "../schemas.js";
import { logger } from "../logger.js";
import { sessionMetrics } from "../metrics.js";
import { listMissions, computeMissionMetrics, calculateMetricsSummary } from "../state.js";
import { exportMarkdown } from "../export.js";
import { createFeedback, formatError, getErrorSeverity } from "../feedback.js";

type ForkSessionManager = ExtensionCommandContext["sessionManager"] & {
  getLeafId?: () => string | null;
  getSessionFile?: () => string | undefined;
};

type ForkReplacementContext = ExtensionCommandContext & {
  sendUserMessage?: (message: string) => Promise<unknown>;
};

function appendForkNote(existing: string | undefined, lines: string[]): string {
  const block = lines.filter(Boolean).join("\n");
  return [existing?.trim(), block].filter(Boolean).join("\n\n");
}

function pushSessionRef(feature: Feature, ref: string | undefined | null): void {
  if (!ref || feature.sessions.includes(ref)) return;
  feature.sessions.push(ref);
}

function buildForkKickoffMessage(
  missionTitle: string,
  sourceFeature: Feature,
  forkedFeature: Feature,
  reason: string,
  parentSessionFile: string | undefined,
): string {
  return [
    `Continue mission "${missionTitle}" in this forked session.`,
    `Forked from ${sourceFeature.id} - ${sourceFeature.title}.`,
    `Active fork feature: ${forkedFeature.id} - ${forkedFeature.title}.`,
    `Reason: ${reason}.`,
    forkedFeature.description,
    "",
    "Immediate handoff:",
    `1. Treat ${forkedFeature.id} as the active implementation path.`,
    `2. Capture evidence and decisions back into the mission history.`,
    `3. Keep the original feature blocked until this fork proves out or is merged back.`,
    parentSessionFile ? `Parent session: ${parentSessionFile}` : "Parent session: unavailable",
  ].join("\n");
}

function buildManualForkHandoff(
  missionTitle: string,
  sourceFeature: Feature,
  forkedFeature: Feature,
  reason: string,
  parentLeafId: string | null,
  parentSessionFile: string | undefined,
): string {
  return [
    `🌿 Fork feature created: ${forkedFeature.title}`,
    `Mission: ${missionTitle}`,
    `Source feature blocked: ${sourceFeature.id}`,
    `Active fork feature: ${forkedFeature.id}`,
    `Reason: ${reason}`,
    parentLeafId ? `Current leaf: ${parentLeafId}` : "Current leaf: unavailable",
    parentSessionFile ? `Current session: ${parentSessionFile}` : "Current session: unavailable",
    "",
    "Next step: open or clone a new Pi session from this point and continue with the forked feature context above.",
  ].join("\n");
}

// ── /mission edit ───────────────────────────────────────────────────────────

export async function handleEdit(featureId: string | undefined, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  if (!mission || !featureId) return ctx.ui.notify("Usage: /mission edit <feature-id>", "warning");
  const feature = getFeatureById(mission, featureId);
  if (!feature) return ctx.ui.notify(`Feature not found: ${featureId}`, "error");
  if (!ctx.hasUI) return ctx.ui.notify(JSON.stringify(feature, null, 2), "info");
  const edited = await ctx.ui.editor("Edit feature JSON", JSON.stringify(feature, null, 2));
  if (!edited) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(edited);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return ctx.ui.notify(`Invalid feature JSON: ${message}`, "error");
  }

  const validation = validate(FeatureSchema, parsed);
  if (!validation.valid) {
    logger.error("commands", "Feature edit validation failed", undefined, { 
      featureId,
      validationErrors: validation.errors 
    });
    return ctx.ui.notify(`Invalid feature structure:\n${formatValidationErrors(validation.errors)}`, "error");
  }

  Object.assign(feature, parsed as Feature);
  appendHistory(mission, { event: "feature_edited", featureId });
  await saveMissionSafe(mission);
  updateFooter(ctx, mission);
}

// ── /mission fork ───────────────────────────────────────────────────────────

export async function handleFork(reason: string, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  const feature = mission ? getActiveFeature(mission) : null;
  if (!mission || !feature) return ctx.ui.notify("No active feature to fork.", "warning");
  const approach = ctx.hasUI ? (await ctx.ui.input("Alternative approach", reason || "Try a smaller/safer approach")) || reason : reason;
  const forkReason = approach || reason || "Alternative approach";
  const createdAt = new Date().toISOString();
  const sessionManager = ctx.sessionManager as ForkSessionManager;
  const parentLeafId = sessionManager.getLeafId?.() ?? null;
  const parentSessionFile = sessionManager.getSessionFile?.();
  const forked = cloneFeatureForFork(
    feature,
    `${feature.id}-fork-${Date.now()}`,
    `${feature.title} [fork]`,
    `Fork: ${forkReason}`,
  );
  const milestone = getMilestoneById(mission, feature.milestoneId);
  if (!milestone) return ctx.ui.notify("Milestone not found.", "error");
  feature.status = "blocked";
  feature.notes = appendForkNote(feature.notes, [
    `Forked at ${createdAt}`,
    `Fork feature: ${forked.id}`,
    `Reason: ${forkReason}`,
    parentLeafId ? `Leaf: ${parentLeafId}` : "",
    parentSessionFile ? `Session: ${parentSessionFile}` : "",
  ]);
  pushSessionRef(feature, `fork:${forked.id}`);
  pushSessionRef(feature, parentLeafId ? `leaf:${parentLeafId}` : undefined);
  pushSessionRef(feature, parentSessionFile ? `session:${parentSessionFile}` : undefined);
  forked.notes = appendForkNote(forked.notes, [
    `Fork source: ${feature.id}`,
    `Created at: ${createdAt}`,
    `Reason: ${forkReason}`,
    parentSessionFile ? `Parent session: ${parentSessionFile}` : "",
  ]);
  pushSessionRef(forked, `parent-feature:${feature.id}`);
  pushSessionRef(forked, parentLeafId ? `parent-leaf:${parentLeafId}` : undefined);
  pushSessionRef(forked, parentSessionFile ? `parent-session:${parentSessionFile}` : undefined);
  milestone.features.push(forked);
  mission.activeFeatureId = forked.id;
  mission.status = "active";
  appendHistory(mission, {
    event: "feature_forked",
    featureId: feature.id,
    note: forkReason,
    details: {
      forkedFeatureId: forked.id,
      parentLeafId,
      parentSessionFile,
      forkApiAvailable: typeof ctx.fork === "function",
    },
  });
  await saveMissionSafe(mission);
  const kickoffMessage = buildForkKickoffMessage(mission.title, feature, forked, forkReason, parentSessionFile);
  if (!parentLeafId) {
    ctx.ui.notify(buildManualForkHandoff(mission.title, feature, forked, forkReason, parentLeafId, parentSessionFile), "warning");
    return;
  }
  if (!ctx.fork) {
    ctx.ui.notify(buildManualForkHandoff(mission.title, feature, forked, forkReason, parentLeafId, parentSessionFile), "warning");
    return;
  }
  const forkResult = await ctx.fork(parentLeafId, {
    position: "at",
    withSession: async (forkCtx: ForkReplacementContext) => {
      const forkSessionFile = (forkCtx.sessionManager as ForkSessionManager | undefined)?.getSessionFile?.();
      const persistedMission = loadMissionFromDisk(mission.id);
      const persistedFork = persistedMission ? getFeatureById(persistedMission, forked.id) : null;
      if (persistedMission && persistedFork) {
        pushSessionRef(persistedFork, forkSessionFile ? `session:${forkSessionFile}` : undefined);
        appendHistory(persistedMission, {
          event: "feature_fork_session_created",
          featureId: forked.id,
          note: forkReason,
          details: {
            sourceFeatureId: feature.id,
            forkSessionFile,
            parentLeafId,
          },
        });
        await saveMissionSafe(persistedMission);
      }
      if (typeof forkCtx.sendUserMessage === "function") {
        await forkCtx.sendUserMessage(kickoffMessage);
      } else {
        forkCtx.ui.notify(`🌿 Fork active: ${forked.title}\n\n${kickoffMessage}`, "info");
      }
    },
  });
  if (forkResult?.cancelled) {
    ctx.ui.notify(`Fork session creation cancelled.\n\n${buildManualForkHandoff(mission.title, feature, forked, forkReason, parentLeafId, parentSessionFile)}`, "warning");
  }
}

// ── /mission dashboard ──────────────────────────────────────────────────────

export async function handleDashboard(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  if (!mission) return ctx.ui.notify("No active mission.", "warning");
  if (!ctx.hasUI) {
    ctx.ui.notify(statusText(mission), "info");
    return;
  }
  let selectedFeatureId: string | null = null;
  const ui = ctx.ui as any;
  if (ui?.custom) {
    await ui.custom(
      missionControlOverlay(mission, (featureId) => { selectedFeatureId = featureId; }),
      { overlay: true },
    );
  }
  if (selectedFeatureId) {
    const feature = getFeatureById(mission, selectedFeatureId);
    if (feature && mission.activeFeatureId !== selectedFeatureId) {
      feature.status = "active";
      mission.activeFeatureId = selectedFeatureId;
      mission.activeMilestoneId = feature.milestoneId;
      mission.status = "active";
      autoBlockBlockedFeatures(mission);
      appendHistory(mission, { event: "feature_active", featureId: selectedFeatureId });
      await saveMissionSafe(mission);
      updateFooter(ctx, mission);
      ctx.ui.notify(`➡️ Activated: ${selectedFeatureId} — ${feature.title}`, "info");
    } else if (feature && mission.activeFeatureId === selectedFeatureId) {
      ctx.ui.notify(`Already active: ${selectedFeatureId} — ${feature.title}`, "info");
    }
  }
}

// ── /mission debug ──────────────────────────────────────────────────────────

export async function handleDebug(id: string | undefined, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = id ? loadMissionFromDisk(id) : runtime.activeMission;
  if (!mission) return ctx.ui.notify("No mission to debug.", "warning");
  const history = readHistory(mission.id).slice(-25);
  ctx.ui.setWidget("pi-mission-debug", [
    `Mission: ${mission.title}`,
    `Status: ${mission.status}`,
    `Active: ${mission.activeFeatureId ?? "none"}`,
    "─".repeat(80),
    ...history.map((h) => `${new Date(h.ts * 1000).toISOString()} ${h.event} ${h.featureId ?? ""} ${h.note ?? ""}`),
  ]);
}

// ── /mission metrics ────────────────────────────────────────────────────────

export async function handleMetrics(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const summary = calculateMetricsSummary();
  const sessionMetricsSummary = sessionMetrics.getMetricsSummary();
  
  if (summary.totalMissions === 0) {
    return ctx.ui.notify("No missions found. Create a mission with /mission new <title>.", "info");
  }
  
  const lines = [
    "📊 Mission Metrics Summary",
    "=".repeat(40),
    `Total Missions: ${summary.totalMissions}`,
    `Completed Missions: ${summary.completedMissions}`,
    `Success Rate: ${(summary.successRate * 100).toFixed(1)}%`,
    `Average Tokens/Mission: ${summary.averageTokensPerMission.toFixed(0)}`,
    `Average Features/Mission: ${summary.averageFeaturesPerMission.toFixed(1)}`,
    `Avg Completion Time: ${(summary.averageCompletionTimeMs / 1000 / 60).toFixed(1)} min`,
    "",
    "📈 Session Metrics",
    "=".repeat(40),
    sessionMetricsSummary,
  ];
  
  ctx.ui.notify(lines.join("\n"), "info");
  
  const missions = listMissions();
  const allMetrics = missions.map(computeMissionMetrics);
  const metricsDir = path.join(process.env.HOME || process.env.USERPROFILE || "", ".pi", "missions");
  const metricsFile = path.join(metricsDir, "metrics-export.json");
  
  try {
    fs.mkdirSync(metricsDir, { recursive: true });
    fs.writeFileSync(metricsFile, JSON.stringify(allMetrics, null, 2), "utf-8");
    ctx.ui.notify(`📁 Metrics exported to: ${metricsFile}`, "info");
  } catch (error) {
    ctx.ui.notify(`Failed to export metrics: ${error instanceof Error ? error.message : String(error)}`, "warning");
  }
}

// ── /mission export ─────────────────────────────────────────────────────────

export async function handleExport(filename: string | undefined, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  if (!mission) return ctx.ui.notify("No active mission to export.", "warning");

  try {
    const markdown = exportMarkdown(mission);
    if (filename) {
      try {
        fs.writeFileSync(filename, markdown, "utf-8");
        ctx.ui.notify(`✅ Report exported to ${filename}`, "info");
      } catch (error) {
        const feedback = createFeedback(error, `exporting to ${filename}`);
        ctx.ui.notify(formatError(feedback), getErrorSeverity(feedback));
        logger.error("commands", "Failed to export mission to file", error as Error, { missionId: mission.id, filename });
      }
    } else {
      ctx.ui.notify(markdown, "info");
    }
  } catch (error) {
    const feedback = createFeedback(error, "generating export");
    ctx.ui.notify(formatError(feedback), getErrorSeverity(feedback));
    logger.error("commands", "Failed to generate mission export", error as Error, { missionId: mission.id });
  }
}
