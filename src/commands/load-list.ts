import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { RuntimeState } from "../types.js";
import { appendHistory, autoBlockBlockedFeatures, getNextPendingFeature, isValidMissionId, loadMissionFromDisk, listMissions, progress, saveMissionSafe } from "../state.js";
import { injectMissionContext } from "./index.js";
import { updateFooter, statusText } from "../ui.js";
import { buildMissionHelp } from "../context.js";
import { logger } from "../logger.js";
import { createFeedback, formatError, getErrorSeverity } from "../feedback.js";

// ── /mission list ───────────────────────────────────────────────────────────

export async function handleList(ctx: ExtensionCommandContext, pi: ExtensionAPI, runtime: RuntimeState): Promise<void> {
  const missions = listMissions();
  if (!missions.length) return ctx.ui.notify("No missions found.", "info");
  if (!ctx.hasUI) return ctx.ui.notify(missions.map((m) => `${m.id} — ${m.title} (${m.status})`).join("\n"), "info");
  const labels = missions.map((m) => {
    const p = progress(m);
    return `${m.id} — ${m.title} [${p.done}/${p.total}] ${m.status}`;
  });
  const choice = await ctx.ui.select("Load mission:", labels);
  if (!choice) return;
  const id = choice.split(" — ")[0];
  await handleLoad(id, ctx, pi, runtime);
}

// ── /mission load ───────────────────────────────────────────────────────────

export async function handleLoad(id: string | undefined, ctx: ExtensionCommandContext, pi: ExtensionAPI, runtime: RuntimeState): Promise<void> {
  if (!id) return ctx.ui.notify("Usage: /mission load <id>", "warning");

  if (!isValidMissionId(id)) {
    return ctx.ui.notify(`Invalid mission ID format: ${id}. Expected pim:<timestamp>:<<slug>.`, "error");
  }

  const mission = loadMissionFromDisk(id);
  if (!mission) {
    ctx.ui.notify(`Mission not found: ${id}`, "error");
    logger.warn("commands", "Mission not found", { missionId: id });
    return;
  }

  try {
    autoBlockBlockedFeatures(mission);
    runtime.activeMission = mission;
    pi.appendEntry("pi-mission-active", { missionId: mission.id, validationToken: mission.validationToken });
    injectMissionContext(pi, ctx, mission, "mission_loaded");
    pi.setSessionName(`🎯 ${mission.title}`);
    updateFooter(ctx, mission);
    ctx.ui.notify(`Loaded mission: ${mission.title}`, "info");
    logger.info("commands", "Mission loaded successfully", { missionId: mission.id });
  } catch (error) {
    const feedback = createFeedback(error, "initializing loaded mission");
    ctx.ui.notify(formatError(feedback), getErrorSeverity(feedback));
    logger.error("commands", "Failed to initialize loaded mission", error as Error, { missionId: mission.id });
  }
}

// ── /mission status ─────────────────────────────────────────────────────────

export async function handleStatus(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  if (!mission) return ctx.ui.notify("No active mission. Use /mission new <title> or /mission load <id>.", "info");
  updateFooter(ctx, mission);
  ctx.ui.notify(statusText(mission), "info");
}

// ── /mission help ───────────────────────────────────────────────────────────

export async function handleHelp(ctx: ExtensionCommandContext): Promise<void> {
  ctx.ui.notify(buildMissionHelp(), "info");
}
