import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { buildCompactionSummary } from "./context.js";
import { appendHistory, createMission, getActiveFeature, getAllFeatures, getFeatureById, getMilestoneById, getNextPendingFeature, linkSession, listMissions, loadMissionFromDisk, progress, readHistory, saveEvidence, saveMissionSafe } from "./state.js";
import type { Feature, RuntimeState } from "./types.js";
import { dashboardRows, statusText, updateFooter } from "./ui.js";

export function registerMissionCommand(pi: ExtensionAPI, runtime: RuntimeState): void {
  pi.registerCommand("mission", {
    description: "Mission management: new|list|load|status|next|done|block|pause|resume|clear|edit|fork|debug|dashboard",
    getArgumentCompletions: (prefix: string) =>
      ["new", "list", "load", "status", "next", "done", "block", "pause", "resume", "clear", "edit", "fork", "debug", "dashboard"]
        .filter((s) => s.startsWith(prefix))
        .map((s) => ({ value: s, label: s })),
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const [sub = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);
      switch (sub) {
        case "new": return handleNew(rest.join(" "), ctx, pi, runtime);
        case "list": return handleList(ctx, pi, runtime);
        case "load": return handleLoad(rest[0], ctx, pi, runtime);
        case "status": return handleStatus(ctx, runtime);
        case "dashboard": return handleDashboard(ctx, runtime);
        case "next": return handleNext(ctx, runtime);
        case "done": return handleDone(rest.join(" "), ctx, runtime);
        case "block": return handleBlock(rest.join(" "), ctx, runtime);
        case "pause": return handlePause(ctx, runtime);
        case "resume": return handleResume(ctx, runtime);
        case "clear": return handleClear(ctx, runtime);
        case "edit": return handleEdit(rest[0], ctx, runtime);
        case "fork": return handleFork(rest.join(" "), ctx, runtime);
        case "debug": return handleDebug(rest[0], ctx, runtime);
        default: return ctx.ui.notify(`Unknown /mission subcommand: ${sub}`, "warning");
      }
    },
  });
}

async function handleNew(titleArg: string, ctx: ExtensionCommandContext, pi: ExtensionAPI, runtime: RuntimeState): Promise<void> {
  const title = titleArg || "Untitled mission";
  let goal = title;
  let constraints = "";
  if (ctx.hasUI) {
    goal = (await ctx.ui.input("Mission goal", `What should '${title}' achieve?`)) || title;
    constraints = (await ctx.ui.input("Constraints", "Hard rules? (tests, no deps, etc.)")) || "";
  }
  const mission = createMission(title, goal, constraints);
  runtime.activeMission = mission;
  saveMissionSafe(mission);
  appendHistory(mission, { event: "mission_created", note: goal });
  pi.appendEntry("pi-mission-active", { missionId: mission.id });
  pi.setSessionName(`🎯 ${mission.title}`);
  updateFooter(ctx, mission);
  ctx.ui.notify(`✅ Mission created: ${mission.id}\nUse /mission status or /mission next.`, "info");
}

async function handleList(ctx: ExtensionCommandContext, pi: ExtensionAPI, runtime: RuntimeState): Promise<void> {
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

async function handleLoad(id: string | undefined, ctx: ExtensionCommandContext, pi: ExtensionAPI, runtime: RuntimeState): Promise<void> {
  if (!id) return ctx.ui.notify("Usage: /mission load <id>", "warning");
  const mission = loadMissionFromDisk(id);
  if (!mission) return ctx.ui.notify(`Mission not found: ${id}`, "error");
  runtime.activeMission = mission;
  pi.appendEntry("pi-mission-active", { missionId: mission.id });
  pi.setSessionName(`🎯 ${mission.title}`);
  updateFooter(ctx, mission);
  ctx.ui.notify(`Loaded mission: ${mission.title}`, "info");
}

async function handleStatus(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  if (!mission) return ctx.ui.notify("No active mission. Use /mission new <title> or /mission load <id>.", "info");
  updateFooter(ctx, mission);
  ctx.ui.notify(statusText(mission), "info");
}

async function handleDashboard(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  if (!mission) return ctx.ui.notify("No active mission.", "warning");
  ctx.ui.setWidget("pi-mission-dashboard", dashboardRows(mission));
}

async function handleNext(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  if (!mission) return ctx.ui.notify("No active mission.", "warning");
  const next = getNextPendingFeature(mission);
  if (!next) {
    mission.status = "complete";
    saveMissionSafe(mission);
    updateFooter(ctx, mission);
    return ctx.ui.notify("🎉 Mission complete.", "info");
  }
  const active = getActiveFeature(mission);
  if (active && active.status === "active") active.status = "blocked";
  next.status = "active";
  mission.activeFeatureId = next.id;
  mission.activeMilestoneId = next.milestoneId;
  appendHistory(mission, { event: "feature_active", featureId: next.id });
  saveMissionSafe(mission);
  updateFooter(ctx, mission);
  ctx.ui.notify(`➡️ Active feature: ${next.id} — ${next.title}\n${next.description}`, "info");
}

async function handleDone(evidence: string, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  const feature = mission ? getActiveFeature(mission) : null;
  if (!mission || !feature) return ctx.ui.notify("No active feature.", "warning");
  if (!evidence && ctx.hasUI) evidence = (await ctx.ui.input("Evidence", "Why is this feature done?")) || "Marked done manually.";
  feature.status = "done";
  feature.completedAt = Date.now();
  for (const ac of feature.acceptance) if (!ac.waived) ac.verified = true;
  const evidenceFile = saveEvidence(mission, feature, evidence || "Marked done.");
  appendHistory(mission, { event: "feature_done", featureId: feature.id, details: { evidenceFile } });
  const next = getNextPendingFeature(mission);
  if (!next) mission.status = "complete";
  saveMissionSafe(mission);
  updateFooter(ctx, mission);
  ctx.ui.notify(`✅ ${feature.id} done. Evidence: ${evidenceFile}`, "info");
}

async function handleBlock(reason: string, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  const feature = mission ? getActiveFeature(mission) : null;
  if (!mission || !feature) return ctx.ui.notify("No active feature.", "warning");
  feature.status = "blocked";
  feature.notes = reason || "Blocked";
  appendHistory(mission, { event: "feature_blocked", featureId: feature.id, note: feature.notes });
  saveMissionSafe(mission);
  updateFooter(ctx, mission);
}

async function handlePause(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  if (!runtime.activeMission) return ctx.ui.notify("No active mission.", "warning");
  runtime.activeMission.status = "paused";
  appendHistory(runtime.activeMission, { event: "mission_paused" });
  saveMissionSafe(runtime.activeMission);
  updateFooter(ctx, runtime.activeMission);
}

async function handleResume(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  if (!runtime.activeMission) return ctx.ui.notify("No active mission.", "warning");
  runtime.activeMission.status = "active";
  appendHistory(runtime.activeMission, { event: "mission_resumed" });
  saveMissionSafe(runtime.activeMission);
  updateFooter(ctx, runtime.activeMission);
}

async function handleClear(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  runtime.activeMission = null;
  updateFooter(ctx, null);
  ctx.ui.notify("Mission detached from this session.", "info");
}

async function handleEdit(featureId: string | undefined, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  if (!mission || !featureId) return ctx.ui.notify("Usage: /mission edit <feature-id>", "warning");
  const feature = getFeatureById(mission, featureId);
  if (!feature) return ctx.ui.notify(`Feature not found: ${featureId}`, "error");
  if (!ctx.hasUI) return ctx.ui.notify(JSON.stringify(feature, null, 2), "info");
  const edited = await ctx.ui.editor("Edit feature JSON", JSON.stringify(feature, null, 2));
  if (!edited) return;
  const parsed = JSON.parse(edited) as Feature;
  Object.assign(feature, parsed);
  appendHistory(mission, { event: "feature_edited", featureId });
  saveMissionSafe(mission);
  updateFooter(ctx, mission);
}

async function handleFork(reason: string, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  const feature = mission ? getActiveFeature(mission) : null;
  if (!mission || !feature) return ctx.ui.notify("No active feature to fork.", "warning");
  const approach = ctx.hasUI ? (await ctx.ui.input("Alternative approach", reason || "Try a smaller/safer approach")) || reason : reason;
  const forked: Feature = { ...feature, id: `${feature.id}-fork-${Date.now()}`, title: `${feature.title} [fork]`, status: "active", notes: `Fork: ${approach}`, completedAt: undefined };
  const milestone = getMilestoneById(mission, feature.milestoneId);
  if (!milestone) return ctx.ui.notify("Milestone not found.", "error");
  feature.status = "blocked";
  milestone.features.push(forked);
  mission.activeFeatureId = forked.id;
  appendHistory(mission, { event: "feature_forked", featureId: feature.id, note: approach, details: { forkedFeatureId: forked.id } });
  saveMissionSafe(mission);
  const leafId = ctx.sessionManager.getLeafId();
  if (!leafId) {
    ctx.ui.notify(`🌿 Fork feature created: ${forked.title} (no session leaf available to fork)`, "warning");
    return;
  }
  await ctx.fork(leafId, {
    withSession: async (forkCtx) => forkCtx.ui.notify(`🌿 Fork active: ${forked.title}`, "info"),
  });
}

async function handleDebug(id: string | undefined, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
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

export function saveSessionLink(runtime: RuntimeState, sessionFile: string | undefined): void {
  if (runtime.activeMission && sessionFile) linkSession(runtime.activeMission, sessionFile);
}

export function missionSummaryForTree(runtime: RuntimeState): string | null {
  const mission = runtime.activeMission;
  if (!mission) return null;
  const active = getActiveFeature(mission);
  return `Mission: ${mission.title}${active ? ` — Feature: ${active.title}` : ""}`;
}

export function compactionCheckpoint(pi: ExtensionAPI, runtime: RuntimeState): void {
  if (!runtime.activeMission) return;
  pi.appendEntry("pi-mission-compaction-checkpoint", { missionId: runtime.activeMission.id, summary: buildCompactionSummary(runtime.activeMission), timestamp: Date.now() });
}
