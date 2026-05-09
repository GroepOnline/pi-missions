import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { appendHistory, autoUnblockResolved, autoVerifyAcceptance, getActiveFeature, getAllFeatures, getNextPendingFeature, saveEvidence, saveMissionSafe } from "./state.js";
import type { MissionState, RuntimeState } from "./types.js";
import { updateFooter } from "./ui.js";
import { getCompletionDetector } from "./completion.js";
import { getErrorRecoveryEngine } from "./recovery.js";

function allFeaturesDone(mission: MissionState): boolean {
  return getAllFeatures(mission).every((f) => f.status === "done");
}

export function registerMissionTools(pi: ExtensionAPI, runtime: RuntimeState): void {
  pi.registerTool({
    name: "mission_feature_done",
    label: "Mission Feature Done",
    description: "Mark the active mission feature as done with evidence.",
    promptSnippet: "Mark the active mission feature as done with evidence",
    promptGuidelines: ["Use mission_feature_done only after all acceptance criteria are satisfied and evidence is available."],
    parameters: Type.Object({
      evidence: Type.String({ description: "Completion evidence, e.g. test output or summary of changes" }),
      notes: Type.Optional(Type.String({ description: "Optional notes" })),
    }),
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: ExtensionCommandContext) {
      const mission = runtime.activeMission;
      const feature = mission ? getActiveFeature(mission) : null;
      if (!mission || !feature) return { isError: true, content: [{ type: "text" as const, text: "No active mission feature." }], details: {} };
      
      // Check for unverified bash criteria - these need to be verified or waived
      const unverifiedBash = feature.acceptance.filter((ac) => !ac.verified && !ac.waived && ac.checkType === "bash");
      if (unverifiedBash.length > 0) {
        return { isError: true, content: [{ type: "text" as const, text: `Cannot mark feature done: ${unverifiedBash.length} bash acceptance criteria need to be verified. Use /mission edit to waive or verify them, or ensure bash checks pass.` }], details: {} };
      }
      
      feature.status = "done";
      feature.completedAt = Date.now();
      feature.notes = params.notes;
      const evidenceFile = saveEvidence(mission, feature, params.evidence);
      appendHistory(mission, { event: "feature_done", featureId: feature.id, note: params.notes, details: { evidenceFile } });
      autoUnblockResolved(mission);
      const next = getNextPendingFeature(mission);
      if (!next && allFeaturesDone(mission)) {
        mission.status = "complete";
        mission.autopilot.enabled = false;
        mission.autopilot.lastStopReason = "mission_complete";
      }
      await saveMissionSafe(mission);
      updateFooter(ctx, mission);
      return { content: [{ type: "text", text: `✅ Feature ${feature.id} done. Evidence: ${evidenceFile}` }], details: { featureId: feature.id, evidenceFile }, isError: false };
    },
  });

  pi.registerTool({
    name: "mission_next_feature",
    label: "Mission Next Feature",
    description: "Advance to the next pending mission feature.",
    parameters: Type.Object({}),
    async execute(_toolCallId: string, _params: any, _signal: any, _onUpdate: any, ctx: ExtensionCommandContext) {
      const mission = runtime.activeMission;
      if (!mission) return { isError: true, content: [{ type: "text" as const, text: "No active mission." }], details: {} };
      const current = getActiveFeature(mission);
      if (current?.status === "active") {
        return { isError: true, content: [{ type: "text" as const, text: `Active feature is not done yet: ${current.id} — ${current.title}. Use mission_feature_done when complete, or /mission block <reason> if it cannot continue.` }], details: {} };
      }

      autoUnblockResolved(mission);
      const next = getNextPendingFeature(mission);
      if (!next) {
        if (allFeaturesDone(mission)) {
          mission.status = "complete";
          await saveMissionSafe(mission);
          updateFooter(ctx, mission);
          return { content: [{ type: "text", text: "🎉 Mission complete." }], details: { missionId: mission.id }, isError: false };
        }
        return { isError: true, content: [{ type: "text" as const, text: "No unblocked pending feature found. Check blocked features and dependencies with /mission status." }], details: {} };
      }
      next.status = "active";
      mission.status = "active";
      mission.activeFeatureId = next.id;
      mission.activeMilestoneId = next.milestoneId;
      appendHistory(mission, { event: "feature_active", featureId: next.id });
      await saveMissionSafe(mission);
      updateFooter(ctx, mission);
      return { content: [{ type: "text", text: `➡️ Active feature: ${next.id} — ${next.title}\n${next.description}` }], details: { feature: next }, isError: false };
    },
  });

  pi.registerTool({
    name: "mission_ask_user",
    label: "Ask User",
    description: "Ask the user a question during mission execution. Use this when you need clarification, confirmation, or user input to proceed.",
    promptSnippet: "Ask the user a question",
    promptGuidelines: [
      "Use mission_ask_user when you need user input to proceed with the mission.",
      "Provide a clear, specific question with context.",
      "Use 'confirm' for yes/no decisions.",
      "Use 'select' when the user should choose from known options.",
      "Use 'input' for open-ended text responses.",
      "Always provide a sensible default value if possible."
    ],
    parameters: Type.Object({
      question: Type.String({ 
        description: "The question to ask the user. Be specific and provide context." 
      }),
      questionType: Type.Optional(Type.String({ 
        description: "Type of question: 'input' (text), 'confirm' (yes/no), or 'select' (choice from options). Default: 'input'",
        enum: ["input", "confirm", "select"]
      })),
      options: Type.Optional(Type.Array(Type.String({ 
        description: "Options for 'select' type questions. Each option should be a clear choice." 
      }))),
      defaultValue: Type.Optional(Type.String({ 
        description: "Default value if user provides no input." 
      })),
      context: Type.Optional(Type.String({ 
        description: "Additional context to help the user understand why this question is being asked." 
      }))
    }),
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: ExtensionCommandContext) {
      const mission = runtime.activeMission;
      if (!mission) throw new Error("No active mission. Cannot ask user.");
      mission.autopilot.enabled = false;
      mission.autopilot.lastStopReason = "needs_user_decision";
      mission.autopilot.lastStopMessage = params.question;
      
      const feature = getActiveFeature(mission);
      const questionType = params.questionType || "input";
      const defaultValue = params.defaultValue || null;
      
      let answer: string | null = null;
      let answerSource: "ui" | "default" | "no_ui" = "no_ui";
      
      // Log the question
      appendHistory(mission, { 
        event: "user_asked", 
        featureId: feature?.id, 
        note: `Q: ${params.question}`, 
        details: { 
          questionType, 
          options: params.options, 
          defaultValue 
        } 
      });
      
      if (ctx.hasUI) {
        try {
          switch (questionType) {
            case "confirm":
              answer = await ctx.ui.confirm(params.question, params.context || "") ? "yes" : "no";
              break;
              
            case "select":
              if (!params.options || params.options.length === 0) {
                throw new Error("Select questions require options.");
              }
              const choice = await ctx.ui.select(params.question, params.options);
              answer = choice || defaultValue || null;
              break;
              
            case "input":
            default:
              answer = await ctx.ui.input(params.question, params.context || "") || defaultValue || null;
              break;
          }
          answerSource = "ui";
        } catch (error) {
          answer = defaultValue;
          answerSource = "default";
        }
      } else {
        // Non-UI context: use default or indicate no UI available
        answer = defaultValue || "[No UI available - cannot ask user]";
        answerSource = "no_ui";
      }
      
      // Log the answer
      if (feature) {
        appendHistory(mission, { 
          event: "user_answered", 
          featureId: feature.id, 
          note: `A: ${answer}`, 
          details: { 
            answer, 
            answerSource, 
            questionType 
          } 
        });
      }
      
      // Update mission state with user preferences if applicable
      if (answer === "ALLOW_BASH_IN_PLANNING") {
        mission.userPreferences = mission.userPreferences || {};
        mission.userPreferences.allowBashInPlanning = true;
        await saveMissionSafe(mission);
      }
      
      return { 
        content: [{ 
          type: "text", 
          text: `User answered: ${answer}${answerSource !== "ui" ? ` (via ${answerSource})` : ""}` 
        }], 
        details: { 
          question: params.question, 
          answer, 
          answerSource,
          questionType 
        },
        isError: false 
      };
    },
  });

  pi.registerTool({
    name: "mission_block_self",
    label: "Mission Block Self",
    description: "Block the current feature when stuck or unable to proceed. Use this when you detect a deadlock, repeated failures, or need external input.",
    promptSnippet: "Block the current feature",
    promptGuidelines: [
      "Use mission_block_self when you're stuck and cannot proceed with the current feature.",
      "Provide a clear reason for blocking (e.g., missing dependencies, unclear requirements, repeated failures).",
      "This will mark the feature as blocked and allow moving to other features if possible."
    ],
    parameters: Type.Object({
      reason: Type.String({ description: "Reason for blocking the feature" }),
      context: Type.Optional(Type.String({ description: "Additional context about the block" })),
    }),
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: ExtensionCommandContext) {
      const mission = runtime.activeMission;
      const feature = mission ? getActiveFeature(mission) : null;
      if (!mission || !feature) throw new Error("No active mission feature.");
      
      feature.status = "blocked";
      feature.notes = `Self-blocked: ${params.reason}${params.context ? `\n\nContext: ${params.context}` : ""}`;
      mission.status = "blocked";
      mission.autopilot.enabled = false;
      mission.autopilot.lastStopReason = "blocked";
      mission.autopilot.lastStopMessage = params.reason;
      appendHistory(mission, { event: "feature_blocked", featureId: feature.id, note: params.reason, details: { context: params.context, self: true } });
      
      // Try to advance to next feature
      autoUnblockResolved(mission);
      const next = getNextPendingFeature(mission);
      if (next) {
        next.status = "active";
        mission.status = "active";
        mission.activeFeatureId = next.id;
        mission.activeMilestoneId = next.milestoneId;
        mission.autopilot.lastStopReason = undefined;
        mission.autopilot.lastStopMessage = undefined;
        appendHistory(mission, { event: "feature_active", featureId: next.id, note: "Auto-advanced after self-block" });
        await saveMissionSafe(mission);
        updateFooter(ctx, mission);
        return { 
          content: [{ type: "text", text: `🚫 Self-blocked feature ${feature.id}: ${params.reason}\n➡️ Auto-advanced to ${next.id} — ${next.title}` }], 
          details: { featureId: feature.id, nextFeatureId: next.id }, 
          isError: false 
        };
      } else {
        await saveMissionSafe(mission);
        updateFooter(ctx, mission);
        throw new Error(`Self-blocked feature ${feature.id}: ${params.reason}. No pending features available.`);
      }
    },
  });

  pi.registerTool({
    name: "mission_fork",
    label: "Mission Fork",
    description: "Fork the current feature into a separate session for parallel work or isolation.",
    promptSnippet: "Fork the current feature",
    promptGuidelines: [
      "Use mission_fork when you need to work on a subtask in isolation or parallel.",
      "Provide a clear reason for forking (e.g., complex subtask, need for separate context).",
      "This creates a new session with the current feature context."
    ],
    parameters: Type.Object({
      reason: Type.String({ description: "Reason for forking" }),
      subtask: Type.Optional(Type.String({ description: "Specific subtask to focus on in the forked session" })),
    }),
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: ExtensionCommandContext) {
      const mission = runtime.activeMission;
      const feature = mission ? getActiveFeature(mission) : null;
      if (!mission || !feature) throw new Error("No active mission feature.");
      
      appendHistory(mission, { 
        event: "feature_forked", 
        featureId: feature.id, 
        note: params.reason, 
        details: { 
          subtask: params.subtask, 
          self: true 
        } 
      });
      
      // Note: Actual forking would require Pi session management API
      // For now, we log the intent and provide guidance
      await saveMissionSafe(mission);
      
      return { 
        content: [{ 
          type: "text", 
          text: `🔀 Fork intent logged for feature ${feature.id}: ${params.reason}${params.subtask ? `\nSubtask: ${params.subtask}` : ""}\n\nTo complete the fork, use /mission fork in the Pi CLI.` 
        }], 
        details: { featureId: feature.id, reason: params.reason }, 
        isError: false 
      };
    },
  });

  pi.registerTool({
    name: "mission_error_status",
    label: "Mission Error Status",
    description: "View error recovery statistics and recent errors for the current feature or mission.",
    promptSnippet: "View error status",
    promptGuidelines: [
      "Use mission_error_status to check what errors have occurred and their recovery status.",
      "This helps understand why certain operations might be failing.",
      "Shows error categories, severity, and recovery actions taken."
    ],
    parameters: Type.Object({
      scope: Type.Optional(Type.String({ 
        description: "Scope: 'feature' (current feature) or 'mission' (entire mission). Default: 'feature'",
        enum: ["feature", "mission"]
      })),
    }),
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: ExtensionCommandContext) {
      const mission = runtime.activeMission;
      if (!mission) throw new Error("No active mission.");
      
      const feature = getActiveFeature(mission);
      const scope = params.scope || "feature";
      const recovery = getErrorRecoveryEngine();
      
      let errors;
      if (scope === "feature" && feature) {
        errors = recovery.getErrorsForFeature(feature.id);
      } else {
        errors = recovery.getErrorsForMission(mission.id);
      }
      
      const stats = recovery.getStats();
      
      if (errors.length === 0) {
        return { 
          content: [{ 
            type: "text", 
            text: `✅ No errors recorded for ${scope === "feature" ? `feature ${feature?.id}` : "mission"}.\n\nOverall mission stats: ${stats.total} total errors, ${stats.resolved} resolved.` 
          }], 
          details: { scope, errorCount: 0, stats }, 
          isError: false 
        };
      }
      
      const lines = [
        `📋 Error Status for ${scope === "feature" ? `feature ${feature?.id}` : "mission"}`,
        `Total errors: ${errors.length}`,
        `Resolved: ${errors.filter(e => e.resolved).length}`,
        "",
        "Recent errors:",
        ...errors.slice(-5).map(e => 
          `- [${e.resolved ? "✓" : "✗"}] ${e.context.toolName || "Unknown"}: ${e.context.errorMessage.slice(0, 50)}...`
        ),
        "",
        "By category:",
        ...Object.entries(stats.byCategory).map(([cat, count]) => 
          `- ${cat}: ${count}`
        ),
        "",
        "By severity:",
        ...Object.entries(stats.bySeverity).map(([sev, count]) => 
          `- ${sev}: ${count}`
        ),
      ];
      
      return { 
        content: [{ type: "text", text: lines.join("\n") }], 
        details: { scope, errors, stats }, 
        isError: false 
      };
    },
  });

  pi.registerTool({
    name: "mission_retry_error",
    label: "Mission Retry Error",
    description: "Retry a failed operation or clear error state to allow retry.",
    promptSnippet: "Retry failed operation",
    promptGuidelines: [
      "Use mission_retry_error when you want to retry a failed operation.",
      "This clears the error state and allows the tool to be called again.",
      "Use this after fixing the underlying issue that caused the error."
    ],
    parameters: Type.Object({
      errorId: Type.Optional(Type.String({ description: "Specific error ID to retry (from mission_error_status). If not provided, clears all errors for current feature." })),
    }),
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: ExtensionCommandContext) {
      const mission = runtime.activeMission;
      const feature = mission ? getActiveFeature(mission) : null;
      if (!mission || !feature) throw new Error("No active mission feature.");
      
      const recovery = getErrorRecoveryEngine();
      
      if (params.errorId) {
        // Mark specific error as resolved
        recovery.markResolved(params.errorId);
        appendHistory(mission, { 
          event: "error_resolved", 
          featureId: feature.id, 
          note: `Manually resolved error ${params.errorId}` 
        });
        return { 
          content: [{ type: "text", text: `✅ Error ${params.errorId} marked as resolved. You can now retry the operation.` }], 
          details: { errorId: params.errorId }, 
          isError: false 
        };
      } else {
        // Clear all errors for current feature
        recovery.clearErrorsForFeature(feature.id);
        appendHistory(mission, { 
          event: "errors_cleared", 
          featureId: feature.id, 
          note: "Cleared all errors for feature to allow retry" 
        });
        return { 
          content: [{ type: "text", text: `✅ Cleared all errors for feature ${feature.id}. You can now retry operations.` }], 
          details: { featureId: feature.id }, 
          isError: false 
        };
      }
    },
  });
}
