import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { RuntimeState, ToolCallEvent, ToolResultEvent } from "../core/types.js";
import { getMissionPhase } from "../core/state.js";
import {
  appendHistory, autoBlockBlockedFeatures, cleanupStaleLocks,
  getActiveFeature, loadMissionFromDisk, saveEvidence, saveMissionSafe,
} from "../core/state.js";
import { registerMissionCommand, compactionCheckpoint, missionSummaryForTree, saveSessionLink } from "../commands/index.js";
import { registerMissionTools, enforceToolPolicy, enforceToolMax, toolResultErrorMessage } from "../tools/index.js";
import { updateFooter } from "../ui/components.js";
import { buildLeanContext, buildMissionContext } from "../utils/context.js";
import { getCompletionDetector, resetCompletionDetector } from "../engines/completion.js";
import { getErrorRecoveryEngine, resetErrorRecoveryEngine } from "../engines/recovery.js";
import { sessionMetrics } from "../engines/metrics.js";
import { processAgentEndForAutopilot } from "../engines/autopilot.js";
import { activateNextFeature, completeActiveFeature } from "../core/state.js";
import { handleDashboard } from "../commands/index.js";
import { isValidMissionId } from "../utils/fs.js";

// Re-export types
export type { ToolCallEvent, ToolResultEvent };

// ═══════════════════════════════════════════════════════════════════════════
// Active mission session entry helper
// ═══════════════════════════════════════════════════════════════════════════

interface ActiveEntry {
  missionId: string;
  validationToken?: string;
}

function latestActiveEntry(entries: Array<Record<string, unknown>>): ActiveEntry | null {
  for (const e of [...entries].reverse()) {
    // Direct type (real Pi API: appendEntry("pi-mission-active", ...))
    if (e?.type === "pi-mission-active" && typeof e.data === "object" && e.data !== null) {
      const d = e.data as Record<string, unknown>;
      if (typeof d.missionId === "string") return { missionId: d.missionId, validationToken: typeof d.validationToken === "string" ? d.validationToken : undefined };
    }
    // Custom message type (test mock format: type: "custom", customType: "pi-mission-active")
    if (e?.type === "custom" && e?.customType === "pi-mission-active" && typeof e.data === "object" && e.data !== null) {
      const d = e.data as Record<string, unknown>;
      if (typeof d.missionId === "string") return { missionId: d.missionId, validationToken: typeof d.validationToken === "string" ? d.validationToken : undefined };
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Extension entrypoint
// ═══════════════════════════════════════════════════════════════════════════

export default function piMissions(pi: ExtensionAPI): void {
  const runtime: RuntimeState = {
    activeMission: null, autoSaveInterval: null,
    phaseToolCallCount: 0, currentPhase: "execution",
    lastFeatureId: undefined,
  };

  function scheduleAutoSave(rt: RuntimeState): void {
    if (!rt.autoSaveInterval) {
      rt.autoSaveInterval = setInterval(async () => {
        if (rt.activeMission?.status === "active") await saveMissionSafe(rt.activeMission);
      }, 2 * 60 * 1000);
    }
  }

  registerMissionCommand(pi, runtime);
  registerMissionTools(pi, runtime);

  // ── session_start: auto-restore mission ────────────────────────────────

  (pi as unknown as { on: (e: string, h: (...args: unknown[]) => unknown) => void }).on("session_start", async (...args: unknown[]) => {
    const _event = args[0];
    const ctx = args[1] as ExtensionCommandContext;
    sessionMetrics.reset();
    const entries = (ctx.sessionManager as unknown as { getEntries: () => Array<Record<string, unknown>> }).getEntries();
    const active = latestActiveEntry(entries);
    if (!active) {
      // Check for malformed entries (pi-mission-active without missionId)
      const malformed = entries.some(e =>
        (e?.type === "pi-mission-active" || (e?.type === "custom" && (e as Record<string,unknown>).customType === "pi-mission-active")) &&
        typeof e?.data === "object" && e.data !== null &&
        typeof (e.data as Record<string,unknown>).missionId !== "string"
      );
      if (malformed) {
        ctx.ui?.notify("⚠️ Ignoring invalid mission session entry.", "warning");
      }
      return;
    }

    const { missionId, validationToken } = active;
    if (!isValidMissionId(missionId)) {
      const fallback = loadMissionFromDisk(missionId);
      if (!fallback) {
        ctx.ui?.notify(`⚠️ Mission '${missionId}' not found on disk. /mission load.`, "warning");
        return;
      }
      runtime.activeMission = fallback;
      autoBlockBlockedFeatures(fallback);
      updateFooter(ctx, fallback);
      pi.setSessionName(`🎯 ${fallback.title}`);
      scheduleAutoSave(runtime);
      return;
    }

    const mission = loadMissionFromDisk(missionId);
    if (!mission) {
      ctx.ui?.notify(`⚠️ Mission '${missionId}' not found on disk. /mission load.`, "warning");
      return;
    }

    if (validationToken && validationToken !== mission.validationToken) {
      ctx.ui?.notify("⚠️ Invalid mission event token.", "warning");
      return;
    }

    runtime.activeMission = mission;
    autoBlockBlockedFeatures(mission);
    updateFooter(ctx, mission);
    pi.setSessionName(`🎯 ${mission.title}`);
    scheduleAutoSave(runtime);
  });

  // ── resources_discover ─────────────────────────────────────────────────

  (pi as unknown as { on: (e: string, h: (...args: unknown[]) => unknown) => void }).on("resources_discover", async () => ({ skillPaths: [], promptPaths: [], themePaths: [] }));

  // ── session_before_tree ────────────────────────────────────────────────

  (pi as unknown as { on: (e: string, h: (...args: unknown[]) => unknown) => void }).on("session_before_tree", async () => {
    const summary = missionSummaryForTree(runtime);
    if (!summary) return;
    return { summary: { summary, details: { missionId: runtime.activeMission?.id } } };
  });

  // ── before_agent_start: phase reset (handler 1 of 2) ───────────────────

  (pi as unknown as { on: (e: string, h: (...args: unknown[]) => unknown) => void }).on("before_agent_start", async (..._args: unknown[]) => {
    runtime.pendingCompletionAction = undefined;
    runtime.pendingCompletionReason = undefined;
    runtime.phaseToolCallCount = 0;

    const mission = runtime.activeMission;
    if (!mission || mission.status !== "active") return;

    runtime.currentPhase = getMissionPhase(mission);

    const feature = getActiveFeature(mission);
    if (feature?.status === "active") {
      runtime.lastFeatureId = feature.id;
      getCompletionDetector().clearToolCallHistory();
      getErrorRecoveryEngine().clearErrorsForFeature(feature.id);

      getErrorRecoveryEngine().onAlert((alert) => {
        if (!runtime.activeMission) return;
        appendHistory(runtime.activeMission, {
          event: "error_alert", featureId: feature.id,
          note: alert.message.slice(0, 200),
          details: { alertType: alert.type, errorCategory: alert.record.category, errorSeverity: alert.record.severity, errorCount: alert.stats?.total },
        });
      });
    }
  });

  // ── before_agent_start: inject lean context + update footer (handler 2 of 2) ──

  (pi as unknown as { on: (e: string, h: (...args: unknown[]) => unknown) => void }).on("before_agent_start", async (...args: unknown[]) => {
    const _event = args[0];
    const ctx = args[1] as ExtensionCommandContext;

    const mission = runtime.activeMission;
    if (!mission || mission.status !== "active") return;

    updateFooter(ctx, mission);

    let lean = buildLeanContext(mission);

    if (runtime.pendingCompletionAction === "ask_user") {
      const reason = (runtime.pendingCompletionReason ?? "").replace(/^(Medium|Low) confidence - /i, "") || "completion is unclear";
      lean += `\n\n🚨 **STOP AND CALL THE TOOL**: ${reason}. Call **mission_ask_user** NOW. Do NOT describe — invoke the tool.`;
    } else if (runtime.pendingCompletionAction === "suggest_done") {
      const reason = runtime.pendingCompletionReason || "feature may be complete";
      lean += `\n\n💡 ${reason}. Consider **mission_feature_done** if you have concrete evidence.`;
    }

    return { message: { customType: "pi-mission-context", content: lean, display: false } };
  });

  // ── tool_call: enforce policy ──────────────────────────────────────────

  (pi as unknown as { on: (e: string, h: (...args: unknown[]) => unknown) => void }).on("tool_call", async (...args: unknown[]) => {
    const event = args[0] as ToolCallEvent;
    if (!runtime.activeMission) return;
    runtime.currentPhase = getMissionPhase(runtime.activeMission);
    const activeF = getActiveFeature(runtime.activeMission);

    const policyResult = enforceToolPolicy(
      event.toolName, runtime.currentPhase, event.input,
      runtime.activeMission.userPreferences?.allowBashInPlanning === true,
      runtime.phaseToolCallCount,
    );
    if (policyResult.blocked) return { block: true, reason: policyResult.reason };

    runtime.phaseToolCallCount++;
    const maxResult = enforceToolMax(runtime.currentPhase, runtime.phaseToolCallCount);
    if (maxResult.blocked) return { block: true, reason: maxResult.reason };
  });

  // ── tool_result: metrics + error recovery ──────────────────────────────

  (pi as unknown as { on: (e: string, h: (...args: unknown[]) => unknown) => void }).on("tool_result", async (...args: unknown[]) => {
    const event = args[0] as ToolResultEvent;
    if (!runtime.activeMission) return;
    const mission = runtime.activeMission;
    const feature = getActiveFeature(mission);
    const detector = getCompletionDetector();

    if (feature?.id && feature.id !== runtime.lastFeatureId) {
      detector.clearToolCallHistory();
      getErrorRecoveryEngine().clearErrorsForFeature(feature.id);
      runtime.lastFeatureId = feature.id;
    }

    const success = !event.isError;
    detector.recordToolCall(event.toolName, success);
    sessionMetrics.recordToolCall(event.toolName, success);

    if (!event.isError) {
      getErrorRecoveryEngine().clearConsecutiveFailures(event.toolName, feature?.id);
      return;
    }

    const recovery = getErrorRecoveryEngine();
    const errorMessage = toolResultErrorMessage(event);
    const { action, shouldRetry, retryAfter, record } = recovery.handleError({
      toolName: event.toolName, featureId: feature?.id, missionId: mission.id,
      timestamp: Date.now(), errorType: "ToolResultError", errorMessage,
    });

    sessionMetrics.recordError(record.category);
    appendHistory(mission, {
      event: "error_detected", featureId: feature?.id,
      note: `${event.toolName} failed: ${errorMessage}`,
      details: { category: record.category, severity: record.severity, action, shouldRetry, retryAfter, retryCount: record.retryCount },
    });
  });

  // ── Keyboard shortcuts ─────────────────────────────────────────────────

  pi.registerShortcut("ctrl+shift+m", {
    description: "Open Mission Control dashboard",
    handler: ((rawCtx: unknown) => handleDashboard(rawCtx as ExtensionCommandContext, runtime)) as unknown as (ctx: ExtensionContext) => void | Promise<void>,
  });

  pi.registerShortcut("ctrl+shift+d", {
    description: "Mark current feature as done",
    handler: (async (rawCtx: unknown) => {
      const ctx = rawCtx as ExtensionCommandContext;
      const m = runtime.activeMission;
      const f = m ? getActiveFeature(m) : null;
      if (!m || !f) return ctx.ui?.notify("No active feature.", "warning");

      let ok: boolean = true;
      if (ctx.hasUI) {
        ok = await ctx.ui.confirm("Feature done?", `Mark '${f.title}' as completed?`);
      }
      if (!ok) return;

      f.status = "done"; f.completedAt = Date.now();
      for (const ac of f.acceptance) if (!ac.waived) ac.verified = true;
      const evidenceFile = saveEvidence(m, f, "Done via keyboard shortcut.");
      appendHistory(m, { event: "feature_done", featureId: f.id, note: "Keyboard shortcut", details: { evidenceFile } });
      autoBlockBlockedFeatures(m);
      await saveMissionSafe(m); updateFooter(ctx, m);
      ctx.ui.notify(`✅ ${f.title} done!`, "info");
    }) as unknown as (ctx: ExtensionContext) => void | Promise<void>,
  });

  // ── turn_end: stuck detection + token tracking ─────────────────────────

  (pi as unknown as { on: (e: string, h: (...args: unknown[]) => unknown) => void }).on("turn_end", async (...args: unknown[]) => {
    const _event = args[0];
    const ctx = args[1] as ExtensionCommandContext;
    const m = runtime.activeMission;
    if (!m) return;

    const usage = (ctx as unknown as { getContextUsage?: () => { tokens?: number; percent?: number } }).getContextUsage?.();
    if (usage?.tokens !== undefined) {
      const delta = Math.max(0, usage.tokens - m.lastContextTokens);
      m.tokensUsed += delta;
      m.lastContextTokens = usage.tokens;
      if (m.tokensBudget && m.tokensUsed > m.tokensBudget * 0.8 && m.status === "active") {
        m.status = "budget_limited";
        ctx.ui.notify("⚠️ Token budget 80% used.", "warning");
      }
    }

    const leafId = (ctx.sessionManager as unknown as { getLeafId?: () => string | null }).getLeafId?.();
    const active = getActiveFeature(m);
    if (leafId && active) pi.setLabel(leafId, `🎯 ${active.title}`);

    // Feed text to completion detector for loop analysis
    const detector = getCompletionDetector();
    try {
      const entries = (ctx.sessionManager as unknown as { getEntries: () => Array<Record<string, unknown>> }).getEntries();
      const lastAsst = entries.filter(e => e?.role === "assistant").slice(-1)[0];
      const content = lastAsst?.content;
      if (Array.isArray(content)) {
        const text = (content as Array<{ type?: string; text?: string }>).filter(c => c?.type === "text").map(c => c.text ?? "").join("\n");
        if (text) detector.recordTextOutput(text);
      } else if (typeof content === "string") {
        detector.recordTextOutput(content);
      }
    } catch { /* best-effort */ }

    if (active?.status === "active") {
      const stuck = detector.detectStuck();
      const textLoop = detector.detectTextLoop();
      const effective = textLoop.isStuck ? textLoop : stuck;

      if (effective.isStuck && effective.suggestedAction === "block_self") {
        sessionMetrics.recordStuckDetection();
        appendHistory(m, { event: "stuck_detected", featureId: active.id, note: effective.reason, details: { source: textLoop.isStuck ? "text_loop" : "tool_pattern" } });
        active.status = "blocked";
        active.notes = `Auto-blocked: ${effective.reason}`;
        m.status = "blocked";
        m.autopilot.enabled = false;
        m.autopilot.lastStopReason = "blocked";
        m.autopilot.lastStopMessage = effective.reason;
        ctx.ui.notify(`🚫 Auto-blocked: ${effective.reason}`, "warning");
        await saveMissionSafe(m);
      } else if (effective.isStuck) {
        ctx.ui.notify(`⚠️ Stuck detected: ${effective.reason}. Consider mission_block_self.`, "warning");
      }
    }

    await saveMissionSafe(m);
    updateFooter(ctx, m);
  });

  // ── agent_end: completion detection + auto-advance ─────────────────────

  (pi as unknown as { on: (e: string, h: (...args: unknown[]) => unknown) => void }).on("agent_end", async (...args: unknown[]) => {
    const event = args[0] as { messages?: Array<{ content?: Array<{ type?: string; text?: string }> | string }> };
    const ctx = args[1] as ExtensionCommandContext;
    const m = runtime.activeMission;
    if (m?.autopilot?.enabled) {
      await processAgentEndForAutopilot(pi, ctx, event, runtime);
      return;
    }

    const feature = m ? getActiveFeature(m) : null;
    if (!m || !feature || feature.status !== "active") return;

    const text = (event.messages ?? [])
      .flatMap(msg => Array.isArray(msg.content) ? msg.content : [])
      .filter(c => c?.type === "text" && typeof c.text === "string")
      .map(c => c.text)
      .join("\n");

    const detector = getCompletionDetector();
    const detection = detector.detectCompletion(feature, text);

    appendHistory(m, {
      event: "completion_detection", featureId: feature.id,
      note: detection.reason,
      details: { isComplete: detection.isComplete, confidence: detection.confidence, suggestedAction: detection.suggestedAction, signals: detection.signals },
    });

    if (detection.suggestedAction === "auto_done") {
      const completed = completeActiveFeature(m, {
        evidence: `Auto-completed: ${detection.reason}\n\nSignals:\n${detection.signals.map(s => `- ${s.type}: ${s.evidence}`).join("\n")}`,
        markAcceptanceVerified: true,
        historyNote: "Auto-completed",
        historyDetails: { auto: true },
      });

      if (!completed.ok) {
        ctx.ui.notify(`Feature looks complete but cannot auto-complete: ${completed.reason}`, "info");
        await saveMissionSafe(m); updateFooter(ctx, m);
        return;
      }

      sessionMetrics.recordFeatureCompleted();
      const next = activateNextFeature(m, "Auto-advanced");

      if (next.ok) {
        sessionMetrics.recordAutoAdvance();
        autoBlockBlockedFeatures(m);
        ctx.ui.notify(`✅ Auto-completed ${completed.feature.id}. Advanced to ${next.next.id} — ${next.next.title}`, "info");
      } else if (next.reason === "mission_complete") {
        ctx.ui.notify("🎉 Mission complete!", "info");
      } else {
        autoBlockBlockedFeatures(m);
        ctx.ui.notify(`✅ Auto-completed ${completed.feature.id}. No pending features.`, "info");
      }

      await saveMissionSafe(m); updateFooter(ctx, m);
    } else if (detection.suggestedAction === "suggest_done") {
      runtime.pendingCompletionAction = "suggest_done";
      runtime.pendingCompletionReason = detection.reason;
      ctx.ui.notify(`Feature '${feature.title}' may be complete (${detection.confidence}). ${detection.reason}`, "info");
    } else if (detection.suggestedAction === "ask_user") {
      runtime.pendingCompletionAction = "ask_user";
      runtime.pendingCompletionReason = detection.reason;
      ctx.ui.notify(`Feature '${feature.title}' not clear if complete (${detection.confidence}). Model will be prompted to use mission_ask_user.`, "info");
    }
  });

  // ── session_before_compact ─────────────────────────────────────────────

  (pi as unknown as { on: (e: string, h: (...args: unknown[]) => unknown) => void }).on("session_before_compact", async () => compactionCheckpoint(pi, runtime));

  // ── session_shutdown ───────────────────────────────────────────────────

  (pi as unknown as { on: (e: string, h: (...args: unknown[]) => unknown) => void }).on("session_shutdown", async (...args: unknown[]) => {
    const _event = args[0];
    const ctx = args[1] as ExtensionCommandContext;
    sessionMetrics.endSession();
    if (runtime.autoSaveInterval) clearInterval(runtime.autoSaveInterval);
    runtime.autoSaveInterval = null;
    if (runtime.activeMission) {
      saveSessionLink(
        runtime,
        (ctx.sessionManager as unknown as { getSessionFile?: () => string }).getSessionFile?.(),
      );
      await saveMissionSafe(runtime.activeMission);
    }
    updateFooter(ctx, null);
  });
}
