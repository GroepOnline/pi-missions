import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { RuntimeState } from "../core/types.js";
import { handleNew, handleTemplates } from "./handlers.js";
import { handleList, handleLoad, handleStatus, handleHelp } from "./handlers.js";
import { handleNext, handleDone, handleBlock, handlePause, handleResume, handleClear, handleRun, handleAutopilot, handleStop } from "./handlers.js";
import { handleEdit, handleFork, handleDashboard, handleDebug, handleMetrics, handleExport, handleHistory, handleWorker, handleWorkerStatus, handleKillWorker, handleMigrate, handleMigrateConfirm } from "./handlers.js";

// Re-export for consumers
export { handleNew, handleTemplates };
export { handleLoad, handleList, handleStatus, handleHelp };
export { handleNext, handleDone, handleBlock, handlePause, handleResume, handleClear, handleRun, handleAutopilot, handleStop };
export { handleEdit, handleFork, handleDashboard, handleDebug, handleMetrics, handleExport, handleHistory, handleWorker, handleWorkerStatus, handleKillWorker, handleMigrate, handleMigrateConfirm };

// Re-export fork helpers for backward compat test imports
export { cloneFeatureForFork, appendForkNote, pushSessionRef, buildForkKickoffMessage, buildManualForkHandoff } from "../tools/index.js";

// injectMissionContext wrapper: tools/index.ts takes 5 args, old tests call with 4
import { injectMissionContext as injectMissionCtx } from "../tools/index.js";
import { buildMissionContext } from "../utils/context.js";
export function injectMissionContext(pi: ExtensionAPI, ctx: ExtensionCommandContext, mission: NonNullable<RuntimeState["activeMission"]>, reason: string, content?: string): void {
  injectMissionCtx(pi, ctx, mission, reason, content ?? buildMissionContext(mission));
}

// ═══════════════════════════════════════════════════════════════════════════
// Main command registration
// ═══════════════════════════════════════════════════════════════════════════

export function registerMissionCommand(pi: ExtensionAPI, runtime: RuntimeState): void {
  const subs = ["start", "new", "list", "load", "run", "pause", "resume", "stop", "clear",
    "status", "autopilot", "help", "next", "done", "block", "edit", "fork", "debug",
    "dashboard", "metrics", "export", "templates", "history", "worker", "worker-status", "kill-worker", "migrate"];

  pi.registerCommand("mission", {
    description: `Mission management: ${subs.join("|")}`,
    getArgumentCompletions: (prefix: string) =>
      subs.filter(s => s.startsWith(prefix)).map(s => ({ value: s, label: s })),
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const [sub = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);
      switch (sub) {
        case "start": case "new": return handleNew(rest.join(" "), ctx, pi, runtime);
        case "list": return handleList(ctx, pi, runtime);
        case "load": return handleLoad(rest[0], ctx, pi, runtime);
        case "status": return handleStatus(ctx, runtime);
        case "help": return handleHelp(ctx);
        case "dashboard": return handleDashboard(ctx, runtime);
        case "next": return handleNext(ctx, runtime);
        case "done": return handleDone(rest.join(" "), ctx, runtime);
        case "block": return handleBlock(rest.join(" "), ctx, runtime);
        case "run": return handleRun(ctx, pi, runtime);
        case "pause": return handlePause(ctx, runtime);
        case "resume": return handleResume(ctx, runtime);
        case "stop": return handleStop(ctx, runtime);
        case "autopilot": return handleAutopilot(ctx, runtime);
        case "clear": return handleClear(ctx, runtime);
        case "edit": return handleEdit(rest[0], ctx, runtime);
        case "fork": return handleFork(rest.join(" "), ctx, runtime);
        case "debug": return handleDebug(rest[0], ctx, runtime);
        case "metrics": return handleMetrics(ctx, runtime);
        case "export": return handleExport(rest[0], ctx, runtime);
        case "templates": return handleTemplates(rest[0], rest[1], rest.slice(2).join(" "), ctx, pi, runtime);
        case "history": return handleHistory(rest[0], ctx, runtime);
        case "worker": return handleWorker(rest[0], ctx, runtime);
        case "worker-status": return handleWorkerStatus(ctx);
        case "kill-worker": return handleKillWorker(ctx);
        case "migrate":
          if (rest[0] && rest[1] === "confirm") return handleMigrateConfirm(rest[0], ctx, runtime);
          return handleMigrate(rest[0], ctx, runtime);
        default: return ctx.ui.notify(`Unknown /mission subcommand: ${sub}`, "warning");
      }
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Compaction / tree helpers
// ═══════════════════════════════════════════════════════════════════════════

import { buildCompactionSummary } from "../utils/context.js";
import { getActiveFeature, linkSession } from "../core/state.js";

export function compactionCheckpoint(pi: ExtensionAPI, runtime: RuntimeState): void {
  if (!runtime.activeMission) return;
  pi.appendEntry("pi-mission-compaction-checkpoint", {
    missionId: runtime.activeMission.id,
    summary: buildCompactionSummary(runtime.activeMission),
    timestamp: Date.now(),
  });
}

export function missionSummaryForTree(runtime: RuntimeState): string | null {
  const mission = runtime.activeMission;
  if (!mission) return null;
  const active = getActiveFeature(mission);
  return `Mission: ${mission.title}${active ? ` — Feature: ${active.title}` : ""}`;
}

export function saveSessionLink(runtime: RuntimeState, sessionFile: string | undefined): void {
  if (runtime.activeMission && sessionFile) {
    const agent = process.env.CODING_AGENT || "unknown";
    linkSession(runtime.activeMission, sessionFile, agent);
  }
}
