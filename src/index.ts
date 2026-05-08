import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { completionSignal, buildMissionContext } from "./context.js";
import { compactionCheckpoint, handleDashboard, missionSummaryForTree, registerMissionCommand, saveSessionLink } from "./commands.js";
import { loadModelConfig } from "./models.js";
import { appendHistory, autoBlockBlockedFeatures, getActiveFeature, getMissionPhase, isValidMissionId, loadMissionFromDisk, saveEvidence, saveMissionSafe, getNextPendingFeature, getAllFeatures } from "./state.js";
import type { RuntimeState, ToolPhase } from "./types.js";
import { TOOL_POLICIES } from "./types.js";
import { registerMissionTools } from "./tools.js";
import { updateFooter } from "./ui.js";
import { getCompletionDetector, resetCompletionDetector } from "./completion.js";
import { getErrorRecoveryEngine, resetErrorRecoveryEngine } from "./recovery.js";
import { cleanupStaleLocks } from "./lock.js";
import { logger } from "./logger.js";

export default function piMissions(pi: ExtensionAPI): void {
  // Load model configuration at extension startup
  loadModelConfig();

  const runtime: RuntimeState = { activeMission: null, autoSaveInterval: null };

  registerMissionCommand(pi, runtime);
  registerMissionTools(pi, runtime);

  pi.on("session_start", async (event, ctx) => {
    // Cleanup stale locks from previous crashes
    try {
      await cleanupStaleLocks();
    } catch (error) {
      console.warn("[pi-missions] Failed to cleanup stale locks:", error);
    }

    const entries = ctx.sessionManager.getEntries() as Array<Record<string, any>>;
    const activeEntry = [...entries].reverse().find((e) => e.type === "custom" && e.customType === "pi-mission-active");
    
    if (!activeEntry?.data?.missionId) {
      // No mission event - nothing to do
      return;
    }
    
    const missionId = activeEntry.data.missionId;
    
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
    if (activeEntry.data.validationToken && activeEntry.data.validationToken !== mission.validationToken) {
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
    return { message: { customType: "pi-mission-context", content: buildMissionContext(mission), display: false } };
  });

  // ── Tool call policy enforcement ────────────────────────────────────────────
  let phaseToolCallCount = 0;
  let currentPhase: ToolPhase = "execution";

  pi.on("before_agent_start", async () => {
    phaseToolCallCount = 0;
    if (runtime.activeMission) {
      currentPhase = getMissionPhase(runtime.activeMission);
      
      // Reset completion detector when starting a new feature
      const feature = getActiveFeature(runtime.activeMission);
      if (feature && feature.status === "active") {
        const detector = getCompletionDetector();
        detector.clearToolCallHistory();
        
        // Reset error recovery for the new feature
        const recovery = getErrorRecoveryEngine();
        recovery.clearErrorsForFeature(feature.id);
      }
    }
  });

  pi.on("tool_call", async (event: { toolName: string; success?: boolean; error?: any }) => {
    if (!runtime.activeMission) return;
    
    // Record tool call for completion detection
    const detector = getCompletionDetector();
    const success = event.success !== false;
    detector.recordToolCall(event.toolName, success);
    
    // Handle error recovery if tool call failed
    if (!success && event.error) {
      const feature = getActiveFeature(runtime.activeMission);
      const recovery = getErrorRecoveryEngine();
      
      const errorContext = {
        toolName: event.toolName,
        featureId: feature?.id,
        missionId: runtime.activeMission.id,
        timestamp: Date.now(),
        errorType: event.error.name || "Error",
        errorMessage: event.error.message || String(event.error),
        stackTrace: event.error.stack,
      };
      
      const { action, shouldRetry, retryAfter, record } = recovery.handleError(errorContext);
      
      // Log error to mission history
      logger.error("index", "Tool call failed, error recovery triggered", event.error, {
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
        note: `${event.toolName} failed: ${errorContext.errorMessage}`,
        details: {
          category: record.category,
          severity: record.severity,
          action,
          shouldRetry,
          retryAfter,
          retryCount: record.retryCount,
        },
      });
      
      // Apply recovery action
      if (action === "block") {
        return { block: true, reason: `Tool '${event.toolName}' failed with ${record.category} error: ${errorContext.errorMessage}` };
      } else if (action === "ask_user") {
        // Don't block, but notify user
        // Note: We can't directly notify here, but the error will be visible in the agent output
      } else if (action === "retry" && shouldRetry && retryAfter) {
        // Don't block, let the agent retry naturally
        // The retry delay is informational
      }
    }
    
    // Enforce tool policy
    const policy = TOOL_POLICIES[currentPhase];
    if (!policy.allowedTools.includes(event.toolName)) {
      return { block: true, reason: `Tool '${event.toolName}' not allowed in ${currentPhase} phase. Allowed: ${policy.allowedTools.join(", ")}` };
    }
    phaseToolCallCount++;
    if (phaseToolCallCount > policy.maxToolCalls) {
      return { block: true, reason: `Max tool calls (${policy.maxToolCalls}) exceeded for ${currentPhase} phase.` };
    }
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
      // Auto-complete the feature
      feature.status = "done";
      feature.completedAt = Date.now();
      for (const ac of feature.acceptance) if (!ac.waived) ac.verified = true;
      const evidenceFile = saveEvidence(mission, feature, `Auto-completed: ${detectionResult.reason}\n\nSignals:\n${detectionResult.signals.map(s => `- ${s.type}: ${s.evidence}`).join("\n")}`);
      appendHistory(mission, { event: "feature_done", featureId: feature.id, note: "Auto-completed", details: { evidenceFile, auto: true } });
      
      // Auto-advance to next feature
      const next = getNextPendingFeature(mission);
      if (next) {
        next.status = "active";
        mission.activeFeatureId = next.id;
        mission.activeMilestoneId = next.milestoneId;
        autoBlockBlockedFeatures(mission);
        appendHistory(mission, { event: "feature_active", featureId: next.id, note: "Auto-advanced" });
        ctx.ui.notify(`✅ Auto-completed feature ${feature.id}. Auto-advanced to ${next.id} — ${next.title}`, "success");
      } else if (getAllFeatures(mission).every(f => f.status === "done")) {
        mission.status = "complete";
        appendHistory(mission, { event: "mission_complete", note: "Auto-completed all features" });
        ctx.ui.notify(`🎉 Mission complete! All features auto-completed.`, "success");
      } else {
        autoBlockBlockedFeatures(mission);
        ctx.ui.notify(`✅ Auto-completed feature ${feature.id}. No pending features - check blocked features.`, "info");
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
    if (runtime.autoSaveInterval) clearInterval(runtime.autoSaveInterval);
    runtime.autoSaveInterval = null;
    if (runtime.activeMission) {
      saveSessionLink(runtime, ctx.sessionManager.getSessionFile());
      await saveMissionSafe(runtime.activeMission);
    }
    updateFooter(ctx, null);
  });
}
