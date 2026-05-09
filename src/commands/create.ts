import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { RuntimeState } from "../types.js";
import { appendHistory, saveMissionSafe } from "../state.js";
import { createStructuredMission, missionFromWizardOutput } from "../mission-builder.js";
import { createMissionFromTemplate, MISSION_TEMPLATES } from "../templates.js";
import { injectMissionContext } from "./index.js";
import { updateFooter } from "../ui.js";
import { validate } from "../validation.js";
import { WizardOutputSchema } from "../schemas.js";
import { logger } from "../logger.js";

// ── Planning wizard prompt ──────────────────────────────────────────────────

export const PLANNING_WIZARD_PROMPT = `You are the mission planner for a software development mission. Analyze the user's goal and produce a structured mission plan.

Goal: {goal}
Constraints: {constraints}

Respond ONLY with a valid JSON object (no markdown, no explanation) in this exact format:
{
  "title": "short mission title",
  "milestones": [
    {
      "id": "M01",
      "title": "Milestone 1 title",
      "description": "What this milestone covers",
      "features": [
        {
          "id": "F001",
          "title": "Feature 1 title",
          "description": "What this feature does",
          "priority": 1,
          "dependsOn": [],
          "acceptance": [
            { "id": "AC001", "description": "Acceptance criterion", "checkType": "manual" }
          ]
        }
      ]
    }
  ]
}

Rules:
- id format: M01, M02, ... for milestones; F001, F002, ... for features (per milestone)
- At least 2 milestones, at least 5 total features
- Features within a milestone should have appropriate dependsOn (use feature IDs)
- Each feature needs at least one acceptance criterion with checkType: "manual" | "bash" | "test_file"
- For bash checks, add checkCommand field with the verification command
- priority: 1 (highest) to 5 (lowest)
- Be specific and actionable — no vague "implement X" without context
- Do not include runtime fields like status, milestoneId, sessions, verified, or toolCallCount; pi-missions will normalize those.
`;

// ── /mission new / /mission start ───────────────────────────────────────────

export async function handleNew(titleArg: string, ctx: ExtensionCommandContext, pi: ExtensionAPI, runtime: RuntimeState): Promise<void> {
  const title = titleArg || "Untitled mission";
  let goal = title;
  let constraints = "";
  if (ctx.hasUI) {
    goal = (await ctx.ui.input("Mission goal", `What should '${title}' achieve?`)) || title;
    constraints = (await ctx.ui.input("Constraints", "Hard rules? (tests, no deps, etc.)")) || "";
  }

  const planningPrompt = PLANNING_WIZARD_PROMPT.replace("{goal}", goal).replace("{constraints}", constraints);
  let parsedMission = null as ReturnType<typeof createStructuredMission> | null;
  let usedWizard = false;

  if ((pi as any).sendUserMessage) {
    try {
      ctx.ui.notify("🤖 Planning wizard generating milestones…", "info");
      const response = await (pi as any).sendUserMessage(planningPrompt, { timeoutMs: 60_000 });
      const text = typeof response === "string" ? response : (response?.content ?? JSON.stringify(response));
      const jsonMatch = String(text).match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const raw = JSON.parse(jsonMatch[0]);
        const validation = validate(WizardOutputSchema, raw);
        if (!validation.valid) {
          logger.error("commands", "Wizard output validation failed", undefined, { 
            validationErrors: validation.errors,
            missionTitle: title 
          });
          ctx.ui.notify("Wizard output was incomplete; falling back to structured mission scaffold.", "warning");
        } else {
          parsedMission = missionFromWizardOutput(raw, title, goal);
          if (!parsedMission) ctx.ui.notify("Wizard output had too little structure; falling back to structured mission scaffold.", "warning");
          else usedWizard = true;
        }
      }
    } catch (error) {
      logger.warn("commands", "Wizard failed, falling back to default mission", { 
        missionTitle: title,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const mission = parsedMission ?? createStructuredMission(title, goal, constraints);
  runtime.activeMission = mission;
  await saveMissionSafe(mission);
  appendHistory(mission, { event: "mission_created", note: goal, details: { usedWizard } });
  pi.appendEntry("pi-mission-active", { missionId: mission.id, validationToken: mission.validationToken });
  injectMissionContext(pi, ctx, mission, "mission_started");
  pi.setSessionName(`🎯 ${mission.title}`);
  updateFooter(ctx, mission);
  const featureCount = mission.milestones.reduce((acc, m) => acc + m.features.length, 0);
  const msg = usedWizard
    ? `✅ Mission created with ${mission.milestones.length} milestones, ${featureCount} features (AI-generated)`
    : `✅ Mission created: ${mission.id} — use /mission status or /mission next`;
  ctx.ui.notify(msg, "info");
}

// ── /mission templates ──────────────────────────────────────────────────────

export async function handleTemplates(sub: string | undefined, arg: string | undefined, title: string, ctx: ExtensionCommandContext, pi: ExtensionAPI, runtime: RuntimeState): Promise<void> {
  if (!sub || sub === "list") {
    const lines = ["Available templates:", ""];
    for (const t of MISSION_TEMPLATES) lines.push(`  ${t.id.padEnd(12)} ${t.label.padEnd(20)} ${t.description}`);
    lines.push("", "Use /mission templates scaffold <id> [title] to create a mission from a template.");
    ctx.ui.notify(lines.join("\n"), "info");
    return;
  }

  if (sub === "scaffold" && arg) {
    const mission = createMissionFromTemplate(arg, title);
    if (!mission) return ctx.ui.notify(`Unknown template: ${arg}. Use /mission templates list.`, "error");
    runtime.activeMission = mission;
    await saveMissionSafe(mission);
    appendHistory(mission, { event: "mission_created", note: `From template: ${arg}` });
    pi.appendEntry("pi-mission-active", { missionId: mission.id, validationToken: mission.validationToken });
    injectMissionContext(pi, ctx, mission, "mission_started_from_template");
    pi.setSessionName(`🎯 ${mission.title}`);
    updateFooter(ctx, mission);
    ctx.ui.notify(`✅ Mission created from '${arg}' template: ${mission.id}`, "info");
    return;
  }

  ctx.ui.notify("Usage: /mission templates [list|scaffold <id> [title]]", "warning");
}
