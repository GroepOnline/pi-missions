import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { RuntimeState } from "../types.js";
import { DEFAULT_AUTOPILOT } from "../types.js";
import { appendHistory, createMission, createMissionId, createValidationToken, saveMissionSafe } from "../state.js";
import { createMissionFromTemplate, MISSION_TEMPLATES } from "../templates.js";
import { injectMissionContext } from "./index.js";
import { updateFooter } from "../ui.js";
import { validate, formatValidationErrors } from "../validation.js";
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
  let parsedMission: ReturnType<typeof createMission> | null = null;
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
          ctx.ui.notify(`Wizard output validation failed:\n${formatValidationErrors(validation.errors)}`, "error");
          ctx.ui.notify("Falling back to default mission structure.", "warning");
        } else if (raw.milestones && Array.isArray(raw.milestones) && raw.milestones.length > 0) {
          const now = Date.now();
          parsedMission = {
            schemaVersion: 3,
            id: createMissionId(title, now),
            title: raw.title || title,
            goal,
            status: "active" as const,
            activeMilestoneId: raw.milestones[0]?.id ?? "M01",
            activeFeatureId: raw.milestones[0]?.features?.[0]?.id ?? "F001",
            tokensUsed: 0,
            lastContextTokens: 0,
            validationToken: createValidationToken(),
            autopilot: { ...DEFAULT_AUTOPILOT, startedAt: new Date(now).toISOString() },
            createdAt: now,
            updatedAt: now,
            milestones: raw.milestones.map((m: any, mi: number) => ({
              id: m.id || `M${String(mi + 1).padStart(2, "0")}`,
              title: m.title || `Milestone ${mi + 1}`,
              description: m.description || "",
              status: mi === 0 ? "active" as const : "pending" as const,
              features: (m.features || []).map((f: any, fi: number) => ({
                id: f.id || `F${String(fi + 1).padStart(3, "0")}`,
                milestoneId: m.id || `M${String(mi + 1).padStart(2, "0")}`,
                title: f.title || `Feature ${fi + 1}`,
                description: f.description || "",
                priority: f.priority ?? 1,
                dependsOn: f.dependsOn || [],
                status: mi === 0 && fi === 0 ? "active" as const : "pending" as const,
                sessions: [],
                toolCallCount: 0,
                startedAt: mi === 0 && fi === 0 ? now : undefined,
                acceptance: (f.acceptance || [{ id: `AC001`, description: "Complete", checkType: "manual", verified: false }]).map((ac: any) => ({
                  id: ac.id || `AC001`,
                  description: ac.description || "",
                  checkType: ac.checkType || "manual",
                  checkCommand: ac.checkCommand,
                  verified: false,
                })),
              })),
            })),
          };
          usedWizard = true;
        }
      }
    } catch (error) {
      logger.warn("commands", "Wizard failed, falling back to default mission", { 
        missionTitle: title,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const mission = parsedMission ?? createMission(title, goal, constraints);
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
