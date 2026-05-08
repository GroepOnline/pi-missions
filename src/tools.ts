import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { appendHistory, getActiveFeature, getAllFeatures, getNextPendingFeature, saveEvidence, saveMissionSafe } from "./state.js";
import type { MissionState, RuntimeState } from "./types.js";
import { updateFooter } from "./ui.js";

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
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const mission = runtime.activeMission;
      const feature = mission ? getActiveFeature(mission) : null;
      if (!mission || !feature) return { content: [{ type: "text", text: "No active mission feature." }], details: {}, isError: true };
      feature.status = "done";
      feature.completedAt = Date.now();
      feature.notes = params.notes;
      for (const ac of feature.acceptance) if (!ac.waived) ac.verified = true;
      const evidenceFile = saveEvidence(mission, feature, params.evidence);
      appendHistory(mission, { event: "feature_done", featureId: feature.id, note: params.notes, details: { evidenceFile } });
      const next = getNextPendingFeature(mission);
      if (!next && allFeaturesDone(mission)) mission.status = "complete";
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
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const mission = runtime.activeMission;
      if (!mission) return { content: [{ type: "text", text: "No active mission." }], details: {}, isError: true };
      const current = getActiveFeature(mission);
      if (current?.status === "active") {
        return {
          content: [{ type: "text", text: `Active feature is not done yet: ${current.id} — ${current.title}. Use mission_feature_done when complete, or /mission block <reason> if it cannot continue.` }],
          details: { featureId: current.id },
          isError: true,
        };
      }

      const next = getNextPendingFeature(mission);
      if (!next) {
        if (allFeaturesDone(mission)) {
          mission.status = "complete";
          await saveMissionSafe(mission);
          updateFooter(ctx, mission);
          return { content: [{ type: "text", text: "🎉 Mission complete." }], details: { missionId: mission.id }, isError: false };
        }
        return {
          content: [{ type: "text", text: "No unblocked pending feature found. Check blocked features and dependencies with /mission status." }],
          details: { missionId: mission.id },
          isError: true,
        };
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
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const mission = runtime.activeMission;
      if (!mission) {
        return { 
          content: [{ type: "text", text: "No active mission. Cannot ask user." }], 
          details: {}, 
          isError: true 
        };
      }
      
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
                return { content: [{ type: "text", text: "Select questions require options." }], details: {}, isError: true };
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
}
