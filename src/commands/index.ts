import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { Feature, MissionState, RuntimeState } from "../types.js";
import { buildCompactionSummary, buildMissionContext } from "../context.js";
import { getActiveFeature, getAllFeatures, linkSession } from "../state.js";
import { handleNew, handleTemplates, PLANNING_WIZARD_PROMPT } from "./create.js";
import { handleList, handleLoad, handleStatus, handleHelp } from "./load-list.js";
import { handleNext, handleDone, handleBlock, handlePause, handleResume, handleClear, handleRun, handleAutopilot, handleStop } from "./lifecycle.js";
import { handleEdit, handleFork, handleDashboard, handleDebug, handleMetrics, handleExport } from "./advanced.js";

// ── Re-export all handlers so the barrel stays backwards-compatible ──────────
export { handleNew, handleTemplates, PLANNING_WIZARD_PROMPT };
export { handleLoad, handleList, handleStatus, handleHelp };
export { handleNext, handleDone, handleBlock, handlePause, handleResume, handleClear, handleRun, handleAutopilot, handleStop };
export { handleEdit, handleFork, handleDashboard, handleDebug, handleMetrics, handleExport };

// ── Shared helpers ──────────────────────────────────────────────────────────

type MissionContextMessageSessionManager = ExtensionCommandContext["sessionManager"] & {
  appendCustomMessageEntry?: (
    customType: string,
    content: string,
    display: boolean,
    details?: Record<string, unknown>
  ) => string;
};

export function cloneFeatureForFork(feature: Feature, id: string, title: string, notes: string): Feature {
  return {
    ...feature,
    id,
    title,
    status: "active",
    completedAt: undefined,
    notes,
    dependsOn: [...feature.dependsOn],
    sessions: [...feature.sessions],
    acceptance: feature.acceptance.map((ac) => ({ ...ac, verified: false, evidence: undefined })),
  };
}

export function injectMissionContext(pi: ExtensionAPI, ctx: ExtensionCommandContext, mission: MissionState, reason: string): void {
  const content = buildMissionContext(mission);
  const details = {
    missionId: mission.id,
    reason,
    injectedAt: Date.now(),
  };

  const sessionManager = ctx.sessionManager as MissionContextMessageSessionManager;
  if (typeof sessionManager.appendCustomMessageEntry === "function") {
    sessionManager.appendCustomMessageEntry("pi-mission-context", content, false, details);
  }

  pi.appendEntry("pi-mission-context", {
    ...details,
    content,
  });
}

// ── main command registration ───────────────────────────────────────────────

export function registerMissionCommand(pi: ExtensionAPI, runtime: RuntimeState): void {
  pi.registerCommand("mission", {
    description: "Mission management: start|new|list|load|run|pause|resume|stop|clear|status|autopilot|help|next|done|block|edit|fork|debug|dashboard|metrics",
    getArgumentCompletions: (prefix: string) =>
      ["start", "new", "list", "load", "run", "pause", "resume", "stop", "clear", "status", "autopilot", "help", "next", "done", "block", "edit", "fork", "debug", "dashboard", "metrics", "export", "templates"]
        .filter((s) => s.startsWith(prefix))
        .map((s) => ({ value: s, label: s })),
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const [sub = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);
      switch (sub) {
        case "start": return handleNew(rest.join(" "), ctx, pi, runtime);
        case "new": return handleNew(rest.join(" "), ctx, pi, runtime);
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
        default: return ctx.ui.notify(`Unknown /mission subcommand: ${sub}`, "warning");
      }
    },
  });
}

// ── Compaction / tree helpers ───────────────────────────────────────────────

export function compactionCheckpoint(pi: ExtensionAPI, runtime: RuntimeState): void {
  if (!runtime.activeMission) return;
  pi.appendEntry("pi-mission-compaction-checkpoint", { missionId: runtime.activeMission.id, summary: buildCompactionSummary(runtime.activeMission), timestamp: Date.now() });
}

export function missionSummaryForTree(runtime: RuntimeState): string | null {
  const mission = runtime.activeMission;
  if (!mission) return null;
  const active = getActiveFeature(mission);
  return `Mission: ${mission.title}${active ? ` — Feature: ${active.title}` : ""}`;
}

export function saveSessionLink(runtime: RuntimeState, sessionFile: string | undefined): void {
  if (runtime.activeMission && sessionFile) linkSession(runtime.activeMission, sessionFile);
}
