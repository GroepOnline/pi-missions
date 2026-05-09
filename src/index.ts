import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { completionSignal, buildLeanContext } from "./context.js";
import { compactionCheckpoint, handleDashboard, missionSummaryForTree, registerMissionCommand, saveSessionLink } from "./commands/index.js";
import { appendHistory, autoBlockBlockedFeatures, getActiveFeature, getMissionPhase, isValidMissionId, loadMissionFromDisk, saveEvidence, saveMissionSafe } from "./state.js";
import type { RuntimeState, ToolPhase } from "./types.js";
import { TOOL_POLICIES } from "./types.js";
import { isReadOnlyPlanningBash, PLANNING_READ_ONLY_BASH_COMMANDS } from "./planning-bash.js";
import { registerMissionTools } from "./tools.js";
import { updateFooter } from "./ui.js";
import { getCompletionDetector, resetCompletionDetector } from "./completion.js";
import { getErrorRecoveryEngine, resetErrorRecoveryEngine } from "./recovery.js";
// cleanupStaleLocks removed from session_start — proper-lockfile handles stale locks 
// automatically via the stale timeout option on lock acquisition.
import { logger } from "./logger.js";
import { sessionMetrics, SessionMetricsCollector } from "./metrics.js";

import { toolResultErrorMessage, type ToolCallEvent, type ToolResultEvent } from "./planning-bash.js";
import { processAgentEndForAutopilot } from "./autopilot.js";
import { activateNextFeature, completeActiveFeature } from "./transitions.js";
import { latestActiveMissionSessionEntry } from "./session-entry.js";

// Re-export types needed for downstream consumers
export type { ToolCallEvent, ToolResultEvent };

export default function piMissions(pi: ExtensionAPI): void {
  const runtime: RuntimeState = { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined };

  registerMissionCommand(pi, runtime);
  registerMissionTools(pi, runtime);

  pi.on("session_start", async (event, ctx) => {
    // Reset metrics on session start
    SessionMetricsCollector.reset();

    const entries = ctx.sessionManager.getEntries() as Array<Record<string, unknown>>;
    const activeEntry = latestActiveMissionSessionEntry(entries);
    
    if (activeEntry.kind === "none") {
      // No mission event - nothing to do
      return;
    }

    if (activeEntry.kind === "invalid") {
      logger.warn("index", "Invalid pi-mission-active session entry", { reason: activeEntry.reason });
      ctx.ui?.notify(
        `⚠️ Ignoring invalid mission session entry: ${activeEntry.reason}. Use /mission load <id> to restore manually.`,
        "warning"
      );
      return;
    }
    
    const { missionId, validationToken } = activeEntry.entry;
    
    // Validate mission ID format
    if (!isValidMissionId(missionId)) {
      logger.warn("index", "Invalid mission ID format", { missionId });
      console.warn(`[pi-missions] Invalid mission ID format: ${missionId}`);
      ctx.ui?.notify(
        `⚠️ Invalid mission ID format: ${missionId}. Expected pim:<timestamp>:<<slug>.`,
        "warning"
      );
      return;
    }
    
    // Load mission from disk
    const mission = loadMissionFromDisk(missionId);
    
    if (!mission) {
      logger.warn("index", "Mission not found on disk", { missionId });
      console.warn(`[pi-missions] Mission not found on disk: ${missionId}`);
      ctx.ui?.notify(
        `⚠️ Mission '${missionId}' not found on disk. Use /mission new or /mission load.`,
        "warning"
      );
      return;
    }
    
    // Validate event token if present
    if (validationToken && validationToken !== mission.validationToken) {
      logger.warn("index", "Invalid validation token for mission", { missionId });
      console.warn(`[pi-missions] Invalid validation token for mission: ${missionId}`);
      ctx.ui?.notify(
        `⚠️ Invalid mission event token. Event may be corrupted or tampered with.`,
        "warning"
      );
      return;
    }
    
    // Mission is valid - activate it
    runtime.activeMission = mission;
    autoBlockBlockedFeatures(runtime.activeMission);
    updateFooter(ctx, runtime.activeMission);
    pi.setSessionName(`🎯 ${runtime.activeMission.title}`);
    
    if (!runtime.autoSaveInterval) {
      runtime.autoSaveInterval = setInterval(async () => {
        if (runtime.activeMission && runtime.activeMission.status === "active") await saveMissionSafe(runtime.activeMission);
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
    return { message: { customType: "pi-mission-context", content: buildLeanContext(mission), display: false } };
  });

  // ── Tool call policy enforcement ────────────────────────────────────────────

  pi.on("before_agent_start", async () => {
    runtime.phaseToolCallCount = 0;
    if (runtime.activeMission) {
      runtime.currentPhase = getMissionPhase(runtime.activeMission);
      
      // Reset completion detector when starting a new feature
      const feature = getActiveFeature(runtime.activeMission);
      if (feature && feature.status === "active") {
        runtime.lastFeatureId = feature.id;
        const detector = getCompletionDetector();
        detector.clearToolCallHistory();
        
        // Reset error recovery for the new feature
        const recovery = getErrorRecoveryEngine();
        recovery.clearErrorsForFeature(feature.id);
      }
    }
  });

  pi.on("tool_call", async (event: ToolCallEvent) => {
    if (!runtime.activeMission) return;

    // Recompute on every call so later preflights see state changes that have
    // already landed, for example after mission_next_feature ran in a previous
    // turn or command. Pi preflights sibling tool calls before executing them,
    // so same-message feature switches intentionally take effect next turn.
    runtime.currentPhase = getMissionPhase(runtime.activeMission);
    // Enforce tool policy
    const policy = TOOL_POLICIES[runtime.currentPhase];
    const allowedByPolicy = policy.allowedTools.includes(event.toolName);
    const userAllowsPlanningBash = runtime.activeMission.userPreferences?.allowBashInPlanning === true;
    const allowedPlanningBash = runtime.currentPhase === "planning" && event.toolName === "bash" && (userAllowsPlanningBash || isReadOnlyPlanningBash(event.input));
    if (!allowedByPolicy && !allowedPlanningBash) {
      if (runtime.currentPhase === "planning" && event.toolName === "bash") {
        const allowedList = [...PLANNING_READ_ONLY_BASH_COMMANDS].sort().join(", ");
        return { block: true, reason: `Tool 'bash' is only allowed in planning phase for single read-only commands: ${allowedList}, git status/diff/show/log.` };
      }
      return { block: true, reason: `Tool '${event.toolName}' not allowed in ${runtime.currentPhase} phase. Allowed: ${policy.allowedTools.join(", ")}` };
    }
    runtime.phaseToolCallCount++;
    if (runtime.phaseToolCallCount > policy.maxToolCalls) {
      return { block: true, reason: `Max tool calls (${policy.maxToolCalls}) exceeded for ${runtime.currentPhase} phase.` };
    }
  });

  pi.on("tool_result", async (event: ToolResultEvent) => {
    if (!runtime.activeMission) return;

    const feature = getActiveFeature(runtime.activeMission);
    const detector = getCompletionDetector();
    if (feature?.id && feature.id !== runtime.lastFeatureId) {
      detector.clearToolCallHistory();
      getErrorRecoveryEngine().clearErrorsForFeature(feature.id);
      runtime.lastFeatureId = feature.id;
    }

    const success = !event.isError;
    detector.recordToolCall(event.toolName, success);
    sessionMetrics.recordToolCall(event.toolName, success);

    if (!event.isError) return;

    const recovery = getErrorRecoveryEngine();
    const errorMessage = toolResultErrorMessage(event);
    const errorContext = {
      toolName: event.toolName,
      featureId: feature?.id,
      missionId: runtime.activeMission.id,
      timestamp: Date.now(),
      errorType: "ToolResultError",
      errorMessage,
    };

    const { action, shouldRetry, retryAfter, record } = recovery.handleError(errorContext);
    sessionMetrics.recordError(record.category);

    logger.error("index", "Tool result failed, error recovery triggered", new Error(errorMessage), {
      toolName: event.toolName,
      featureId: feature?.id,
      missionId: runtime.activeMission.id,
      recoveryAction: action,
      errorCategory: record.category,
      errorSeverity: record.severity,
    });

    appendHistory(runtime.activeMission, {
      event: "error_detected",
      featureId: feature?.id,
      note: `${event.toolName} failed: ${errorMessage}`,
      details: {
        category: record.category,
        severity: record.severity,
        action,
        shouldRetry,
        retryAfter,
        retryCount: record.retryCount,
      },
    });
  });

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  pi.registerShortcut("ctrl+shift+m", {
    description: "Open Mission Control dashboard",
    handler: (ctx: any) => handleDashboard(ctx, runtime),
  });

  pi.registerShortcut("ctrl+shift+d", {
    description: "Mark current mission feature as done",
    handler: async (ctx: any) => {
      const mission = runtime.activeMission;
      const feature = mission ? getActiveFeature(mission) : null;
      if (!mission || !feature) return ctx.ui.notify("No active feature to mark done.", "warning");
      if (ctx.hasUI) {
        const ok = await ctx.ui.confirm("Feature done?", `Mark '${feature.title}' as completed?`);
        if (!ok) return;
      }
      feature.status = "done";
      feature.completedAt = Date.now();
      for (const ac of feature.acceptance) if (!ac.waived) ac.verified = true;
      const evidenceFile = saveEvidence(mission, feature, "Marked done via keyboard shortcut.");
      appendHistory(mission, { event: "feature_done", featureId: feature.id, note: "Keyboard shortcut", details: { evidenceFile } });
      autoBlockBlockedFeatures(mission);
      await saveMissionSafe(mission);
      updateFooter(ctx, mission);
      ctx.ui.notify(`✅ ${feature.title} marked as done! Evidence: ${evidenceFile}`, "success");
    },
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
    
    // Check if agent is stuck
    if (active && active.status === "active") {
      const detector = getCompletionDetector();
      const stuckDetection = detector.detectStuck();
      if (stuckDetection.isStuck && stuckDetection.suggestedAction === "block_self") {
        sessionMetrics.recordStuckDetection();
        appendHistory(mission, { 
          event: "stuck_detected", 
          featureId: active.id, 
          note: stuckDetection.reason, 
          details: { 
            suggestedAction: stuckDetection.suggestedAction 
          } 
        });
        ctx.ui.notify(`⚠️ Stuck pattern detected: ${stuckDetection.reason}. Consider using mission_block_self if you cannot proceed.`, "warning");
      }
    }
    
    await saveMissionSafe(mission);
    updateFooter(ctx, mission);
  });

  pi.on("agent_end", async (event, ctx) => {
    const mission = runtime.activeMission;
    if (mission?.autopilot?.enabled) {
      await processAgentEndForAutopilot(pi, ctx, event, runtime);
      return;
    }
    const feature = mission ? getActiveFeature(mission) : null;
    if (!mission || !feature || feature.status !== "active") return;
    
    const text = event.messages
      .flatMap((m: any) => Array.isArray(m.content) ? m.content : [])
      .filter((c: any) => c?.type === "text" && typeof c.text === "string")
      .map((c: any) => c.text)
      .join("\n");
    
    // Use completion detector for multi-factor analysis
    const detector = getCompletionDetector();
    const detectionResult = detector.detectCompletion(feature, text);
    
    // Log detection result for debugging
    appendHistory(mission, { 
      event: "completion_detection", 
      featureId: feature.id, 
      note: detectionResult.reason, 
      details: { 
        isComplete: detectionResult.isComplete, 
        confidence: detectionResult.confidence, 
        suggestedAction: detectionResult.suggestedAction,
        signals: detectionResult.signals 
      } 
    });
    
    // Handle auto-advance based on detection result
    if (detectionResult.suggestedAction === "auto_done") {
      const completed = completeActiveFeature(mission, {
        evidence: `Auto-completed: ${detectionResult.reason}\n\nSignals:\n${detectionResult.signals.map(s => `- ${s.type}: ${s.evidence}`).join("\n")}`,
        markAcceptanceVerified: true,
        historyNote: "Auto-completed",
        historyDetails: { auto: true },
      });
      if (!completed.ok) {
        ctx.ui.notify(`Feature '${feature.title}' looked complete, but cannot auto-complete: ${completed.reason}`, "info");
        await saveMissionSafe(mission);
        updateFooter(ctx, mission);
        return;
      }
      
      // Record metrics
      sessionMetrics.recordFeatureCompleted();
      
      // Auto-advance to next feature
      const nextResult = activateNextFeature(mission, "Auto-advanced");
      if (nextResult.ok) {
        sessionMetrics.recordAutoAdvance();
        autoBlockBlockedFeatures(mission);
        ctx.ui.notify(`✅ Auto-completed feature ${completed.feature.id}. Auto-advanced to ${nextResult.next.id} — ${nextResult.next.title}`, "info");
      } else if (nextResult.reason === "mission_complete") {
        ctx.ui.notify(`🎉 Mission complete! All features auto-completed.`, "info");
      } else {
        autoBlockBlockedFeatures(mission);
        ctx.ui.notify(`✅ Auto-completed feature ${completed.feature.id}. No pending features - check blocked features.`, "info");
      }
      
      await saveMissionSafe(mission);
      updateFooter(ctx, mission);
    } else if (detectionResult.suggestedAction === "suggest_done") {
      // Suggest completion to user (legacy behavior)
      if (completionSignal(text)) {
        ctx.ui.notify(`Feature '${feature.title}' looks complete. Use /mission done or mission_feature_done.`, "info");
      } else {
        ctx.ui.notify(`Feature '${feature.title}' may be complete (${detectionResult.confidence} confidence). ${detectionResult.reason}`, "info");
      }
    } else if (detectionResult.suggestedAction === "ask_user") {
      ctx.ui.notify(`Feature '${feature.title}' completion unclear (${detectionResult.confidence} confidence). ${detectionResult.reason}`, "info");
    }
    // If suggestedAction is "continue", do nothing
  });

  pi.on("session_before_compact", async () => compactionCheckpoint(pi, runtime));

  pi.on("session_shutdown", async (_event, ctx) => {
    // End session metrics
    sessionMetrics.endSession();
    
    if (runtime.autoSaveInterval) clearInterval(runtime.autoSaveInterval);
    runtime.autoSaveInterval = null;
    if (runtime.activeMission) {
      saveSessionLink(runtime, ctx.sessionManager.getSessionFile());
      await saveMissionSafe(runtime.activeMission);
    }
    updateFooter(ctx, null);
  });
}
