import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { completionSignal, buildMissionContext } from "./context.js";
import { compactionCheckpoint, missionSummaryForTree, registerMissionCommand, saveSessionLink } from "./commands.js";
import { getActiveFeature, loadMissionFromDisk, saveMissionSafe } from "./state.js";
import type { RuntimeState } from "./types.js";
import { registerMissionTools } from "./tools.js";
import { updateFooter } from "./ui.js";

export default function piMissions(pi: ExtensionAPI): void {
  const runtime: RuntimeState = { activeMission: null, autoSaveInterval: null };

  registerMissionCommand(pi, runtime);
  registerMissionTools(pi, runtime);

  pi.on("session_start", async (event, ctx) => {
    const entries = ctx.sessionManager.getEntries() as Array<Record<string, any>>;
    const activeEntry = [...entries].reverse().find((e) => e.type === "custom" && e.customType === "pi-mission-active");
    const missionId = activeEntry?.data?.missionId;
    if (typeof missionId === "string") runtime.activeMission = loadMissionFromDisk(missionId);
    if (runtime.activeMission) {
      updateFooter(ctx, runtime.activeMission);
      pi.setSessionName(`🎯 ${runtime.activeMission.title}`);
    }
    if (!runtime.autoSaveInterval) {
      runtime.autoSaveInterval = setInterval(() => {
        if (runtime.activeMission && runtime.activeMission.status === "active") saveMissionSafe(runtime.activeMission);
      }, 2 * 60 * 1000);
    }
  });

  pi.on("resources_discover", async () => ({ skillPaths: [], promptPaths: [], themePaths: [] }));

  pi.on("session_before_tree", async () => {
    const summary = missionSummaryForTree(runtime);
    if (!summary) return;
    return { summary: { summary, details: { missionId: runtime.activeMission?.id } } };
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    const mission = runtime.activeMission;
    if (!mission || mission.status !== "active") return;
    updateFooter(ctx, mission);
    return { message: { customType: "pi-mission-context", content: buildMissionContext(mission), display: false } };
  });

  pi.on("turn_end", async (_event, ctx) => {
    const mission = runtime.activeMission;
    if (!mission) return;
    const usage = ctx.getContextUsage();
    if (usage && typeof usage.tokens === "number") {
      const delta = Math.max(0, usage.tokens - (mission.lastContextTokens ?? 0));
      mission.tokensUsed += delta;
      mission.lastContextTokens = usage.tokens;
      if (mission.tokensBudget && mission.tokensUsed > mission.tokensBudget * 0.8 && mission.status === "active") {
        mission.status = "budget_limited";
        ctx.ui.notify("⚠️ Mission token budget 80% used.", "warning");
      }
    }
    const leafId = ctx.sessionManager.getLeafId();
    const active = getActiveFeature(mission);
    if (leafId && active) pi.setLabel(leafId, `🎯 ${active.title}`);
    saveMissionSafe(mission);
    updateFooter(ctx, mission);
  });

  pi.on("agent_end", async (event, ctx) => {
    const mission = runtime.activeMission;
    const feature = mission ? getActiveFeature(mission) : null;
    if (!mission || !feature || feature.status !== "active") return;
    const text = event.messages
      .flatMap((m: any) => Array.isArray(m.content) ? m.content : [])
      .filter((c: any) => c?.type === "text" && typeof c.text === "string")
      .map((c: any) => c.text)
      .join("\n");
    if (completionSignal(text)) ctx.ui.notify(`Feature '${feature.title}' looks complete. Use /mission done or mission_feature_done.`, "info");
  });

  pi.on("session_before_compact", async () => compactionCheckpoint(pi, runtime));

  pi.on("session_shutdown", async (_event, ctx) => {
    if (runtime.autoSaveInterval) clearInterval(runtime.autoSaveInterval);
    runtime.autoSaveInterval = null;
    if (runtime.activeMission) {
      saveSessionLink(runtime, ctx.sessionManager.getSessionFile());
      saveMissionSafe(runtime.activeMission);
    }
    updateFooter(ctx, null);
  });
}
