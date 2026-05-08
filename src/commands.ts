import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { buildCompactionSummary } from "./context.js";
import { clearModelConfigCache, formatAgentModelLine, formatModelConfig, loadModelConfig, type ModelsConfig } from "./models.js";
import { appendHistory, autoBlockBlockedFeatures, autoCompleteMilestones, autoVerifyAcceptance, calculateMetricsSummary, computeMissionMetrics, createMission, createMissionFromTemplate, createMissionId, createValidationToken, exportMarkdown, getActiveFeature, getAllFeatures, getFeatureById, getMilestoneById, getNextPendingFeature, isValidMissionId, linkSession, listMissions, loadMissionFromDisk, MISSION_TEMPLATES, progress, readHistory, saveEvidence, saveMissionSafe } from "./state.js";
import type { Feature, MissionState, RuntimeState } from "./types.js";
import { missionControlOverlay } from "./dashboard.js";
import { dashboardRows, statusText, updateFooter } from "./ui.js";
import { validate, formatValidationErrors } from "./validation.js";
import { WizardOutputSchema, FeatureSchema } from "./schemas.js";
import { logger } from "./logger.js";

export function registerMissionCommand(pi: ExtensionAPI, runtime: RuntimeState): void {
  pi.registerCommand("mission", {
    description: "Mission management: new|list|load|status|next|done|block|pause|resume|clear|edit|fork|debug|dashboard|metrics",
    getArgumentCompletions: (prefix: string) =>
      ["new", "list", "load", "status", "next", "done", "block", "pause", "resume", "clear", "edit", "fork", "debug", "dashboard", "metrics", "models", "export", "templates"]
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
        case "metrics": return handleMetrics(ctx, runtime);
        case "models": return handleModels(rest[0], rest[1], ctx, runtime);
        case "export": return handleExport(rest[0], ctx, runtime);
        case "templates": return handleTemplates(rest[0], rest[1], rest.slice(2).join(" "), ctx, pi, runtime);
        default: return ctx.ui.notify(`Unknown /mission subcommand: ${sub}`, "warning");
      }
    },
  });
}

function allFeaturesDone(mission: MissionState): boolean {
  return getAllFeatures(mission).every((f) => f.status === "done");
}

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

// Planning wizard prompt sent to the agent to generate milestones + features.
const PLANNING_WIZARD_PROMPT = `You are the mission planner for a software development mission. Analyze the user's goal and produce a structured mission plan.

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

export async function handleNew(titleArg: string, ctx: ExtensionCommandContext, pi: ExtensionAPI, runtime: RuntimeState): Promise<void> {
  const title = titleArg || "Untitled mission";
  let goal = title;
  let constraints = "";
  if (ctx.hasUI) {
    goal = (await ctx.ui.input("Mission goal", `What should '${title}' achieve?`)) || title;
    constraints = (await ctx.ui.input("Constraints", "Hard rules? (tests, no deps, etc.)")) || "";
  }

  // Planning wizard: ask the agent to generate milestones + features
  const planningPrompt = PLANNING_WIZARD_PROMPT.replace("{goal}", goal).replace("{constraints}", constraints);

  // Ask the agent to plan — send a user message and wait for response
  let parsedMission: ReturnType<typeof createMission> | null = null;
  let usedWizard = false;

  if ((pi as any).sendUserMessage) {
    try {
      ctx.ui.notify("🤖 Planning wizard generating milestones…", "info");
      const response = await (pi as any).sendUserMessage(planningPrompt, { timeoutMs: 60_000 });
      // Extract JSON from the response text
      const text = typeof response === "string" ? response : (response?.content ?? JSON.stringify(response));
      const jsonMatch = String(text).match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const raw = JSON.parse(jsonMatch[0]);
        
        // Validate wizard output against schema
        const validation = validate(WizardOutputSchema, raw);
        if (!validation.valid) {
          logger.error("commands", "Wizard output validation failed", undefined, { 
            validationErrors: validation.errors,
            missionTitle: title 
          });
          ctx.ui.notify(`Wizard output validation failed:\n${formatValidationErrors(validation.errors)}`, "error");
          ctx.ui.notify("Falling back to default mission structure.", "warning");
          // Fall through to default mission creation
        } else if (raw.milestones && Array.isArray(raw.milestones) && raw.milestones.length > 0) {
          // Build mission from validated wizard output
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
      // Wizard failed — fall through to default mission creation
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
  pi.setSessionName(`🎯 ${mission.title}`);
  updateFooter(ctx, mission);
  const featureCount = mission.milestones.reduce((acc, m) => acc + m.features.length, 0);
  const msg = usedWizard
    ? `✅ Mission created with ${mission.milestones.length} milestones, ${featureCount} features (AI-generated)`
    : `✅ Mission created: ${mission.id} — use /mission status or /mission next`;
  ctx.ui.notify(msg, "info");
}

export async function handleList(ctx: ExtensionCommandContext, pi: ExtensionAPI, runtime: RuntimeState): Promise<void> {
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

export async function handleLoad(id: string | undefined, ctx: ExtensionCommandContext, pi: ExtensionAPI, runtime: RuntimeState): Promise<void> {
  if (!id) return ctx.ui.notify("Usage: /mission load <id>", "warning");
  
  // Validate ID format
  if (!isValidMissionId(id)) {
    return ctx.ui.notify(`Invalid mission ID format: ${id}. Expected pim:<timestamp>:<<slug>.`, "error");
  }
  
  const mission = loadMissionFromDisk(id);
  if (!mission) return ctx.ui.notify(`Mission not found: ${id}`, "error");
  autoBlockBlockedFeatures(mission);
  runtime.activeMission = mission;
  pi.appendEntry("pi-mission-active", { missionId: mission.id, validationToken: mission.validationToken });
  pi.setSessionName(`🎯 ${mission.title}`);
  updateFooter(ctx, mission);
  ctx.ui.notify(`Loaded mission: ${mission.title}`, "info");
}

export async function handleStatus(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  if (!mission) return ctx.ui.notify("No active mission. Use /mission new <title> or /mission load <id>.", "info");
  updateFooter(ctx, mission);
  ctx.ui.notify(statusText(mission), "info");
}

export async function handleMetrics(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const summary = calculateMetricsSummary();
  
  if (summary.totalMissions === 0) {
    return ctx.ui.notify("No missions found. Create a mission with /mission new <title>.", "info");
  }
  
  const lines = [
    "📊 Mission Metrics Summary",
    "=".repeat(40),
    `Total Missions: ${summary.totalMissions}`,
    `Completed Missions: ${summary.completedMissions}`,
    `Success Rate: ${(summary.successRate * 100).toFixed(1)}%`,
    `Average Tokens/Mission: ${summary.averageTokensPerMission.toFixed(0)}`,
    `Average Features/Mission: ${summary.averageFeaturesPerMission.toFixed(1)}`,
    `Avg Completion Time: ${(summary.averageCompletionTimeMs / 1000 / 60).toFixed(1)} min`,
  ];
  
  ctx.ui.notify(lines.join("\n"), "info");
  
  // Export metrics to JSON file
  const missions = listMissions();
  const allMetrics = missions.map(computeMissionMetrics);
  const metricsDir = path.join(process.env.HOME || process.env.USERPROFILE || "", ".pi", "missions");
  const metricsFile = path.join(metricsDir, "metrics-export.json");
  
  try {
    fs.mkdirSync(metricsDir, { recursive: true });
    fs.writeFileSync(metricsFile, JSON.stringify(allMetrics, null, 2), "utf-8");
    ctx.ui.notify(`📁 Metrics exported to: ${metricsFile}`, "info");
  } catch (error) {
    ctx.ui.notify(`Failed to export metrics: ${error instanceof Error ? error.message : String(error)}`, "warning");
  }
}

export async function handleDashboard(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  if (!mission) return ctx.ui.notify("No active mission.", "warning");
  if (!ctx.hasUI) {
    // Fallback: show text status for non-UI sessions
    ctx.ui.notify(statusText(mission), "info");
    return;
  }
  // Full-screen interactive overlay via ctx.ui.custom()
  // Capture the selected feature via callback when user presses Enter
  let selectedFeatureId: string | null = null;
  await ctx.ui.custom(
    missionControlOverlay(mission, (featureId) => { selectedFeatureId = featureId; }),
    { overlay: true },
  );
  // Activate the selected feature if one was chosen
  if (selectedFeatureId) {
    const feature = getFeatureById(mission, selectedFeatureId);
    if (feature && mission.activeFeatureId !== selectedFeatureId) {
      feature.status = "active";
      mission.activeFeatureId = selectedFeatureId;
      mission.activeMilestoneId = feature.milestoneId;
      mission.status = "active";
      autoBlockBlockedFeatures(mission);
      appendHistory(mission, { event: "feature_active", featureId: selectedFeatureId });
      await saveMissionSafe(mission);
      updateFooter(ctx, mission);
      ctx.ui.notify(`➡️ Activated: ${selectedFeatureId} — ${feature.title}`, "info");
    } else if (feature && mission.activeFeatureId === selectedFeatureId) {
      ctx.ui.notify(`Already active: ${selectedFeatureId} — ${feature.title}`, "info");
    }
  }
}

export async function handleNext(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  if (!mission) return ctx.ui.notify("No active mission.", "warning");

  const active = getActiveFeature(mission);
  if (active?.status === "active") {
    return ctx.ui.notify(`Active feature is not done yet: ${active.id} — ${active.title}\nUse /mission done when complete, or /mission block <reason> if it cannot continue.`, "warning");
  }

  const next = getNextPendingFeature(mission);
  if (!next) {
    if (allFeaturesDone(mission)) {
      mission.status = "complete";
      autoCompleteMilestones(mission);
      await saveMissionSafe(mission);
      updateFooter(ctx, mission);
      return ctx.ui.notify("🎉 Mission complete.", "info");
    }
    return ctx.ui.notify("No unblocked pending feature found. Check blocked features and dependencies with /mission status.", "warning");
  }

  next.status = "active";
  mission.status = "active";
  mission.activeFeatureId = next.id;
  mission.activeMilestoneId = next.milestoneId;
  autoBlockBlockedFeatures(mission);
  appendHistory(mission, { event: "feature_active", featureId: next.id });
  await saveMissionSafe(mission);
  updateFooter(ctx, mission);
  ctx.ui.notify(`➡️ Active feature: ${next.id} — ${next.title}\n${next.description}`, "info");
}

export async function handleDone(evidence: string, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  const feature = mission ? getActiveFeature(mission) : null;
  if (!mission || !feature) return ctx.ui.notify("No active feature.", "warning");
  if (!evidence && ctx.hasUI) evidence = (await ctx.ui.input("Evidence", "Why is this feature done?")) || "Marked done manually.";

  // Auto-verify bash-check acceptance criteria before marking done.
  let autoVerified = 0;
  try {
    autoVerified = autoVerifyAcceptance(feature, (cmd: string) => {
      try {
        const out = execSync(cmd, { timeout: 30_000, encoding: "utf-8" });
        return { code: 0, stdout: out };
      } catch (e: any) {
        return { code: e.status ?? 1, stdout: e.stdout ?? "" };
      }
    });
  } catch {
    // execSync entirely unavailable — continue with manual verification.
  }

  feature.status = "done";
  feature.completedAt = Date.now();
  for (const ac of feature.acceptance) if (!ac.waived) ac.verified = true;
  const evidenceFile = saveEvidence(mission, feature, evidence || "Marked done.");
  appendHistory(mission, { event: "feature_done", featureId: feature.id, details: { evidenceFile, autoVerified } });
  const next = getNextPendingFeature(mission);
  if (!next && allFeaturesDone(mission)) mission.status = "complete";
  autoCompleteMilestones(mission);
  await saveMissionSafe(mission);
  updateFooter(ctx, mission);
  ctx.ui.notify(`✅ ${feature.id} done. Evidence: ${evidenceFile}`, "info");
}

export async function handleBlock(reason: string, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  const feature = mission ? getActiveFeature(mission) : null;
  if (!mission || !feature) return ctx.ui.notify("No active feature.", "warning");
  feature.status = "blocked";
  feature.notes = reason || "Blocked";
  appendHistory(mission, { event: "feature_blocked", featureId: feature.id, note: feature.notes });
  await saveMissionSafe(mission);
  updateFooter(ctx, mission);
}

export async function handlePause(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  if (!runtime.activeMission) return ctx.ui.notify("No active mission.", "warning");
  runtime.activeMission.status = "paused";
  appendHistory(runtime.activeMission, { event: "mission_paused" });
  await saveMissionSafe(runtime.activeMission);
  updateFooter(ctx, runtime.activeMission);
}

export async function handleResume(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  if (!runtime.activeMission) return ctx.ui.notify("No active mission.", "warning");
  runtime.activeMission.status = "active";
  appendHistory(runtime.activeMission, { event: "mission_resumed" });
  await saveMissionSafe(runtime.activeMission);
  updateFooter(ctx, runtime.activeMission);
}

export async function handleClear(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  runtime.activeMission = null;
  updateFooter(ctx, null);
  ctx.ui.notify("Mission detached from this session.", "info");
}

export async function handleEdit(featureId: string | undefined, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  if (!mission || !featureId) return ctx.ui.notify("Usage: /mission edit <feature-id>", "warning");
  const feature = getFeatureById(mission, featureId);
  if (!feature) return ctx.ui.notify(`Feature not found: ${featureId}`, "error");
  if (!ctx.hasUI) return ctx.ui.notify(JSON.stringify(feature, null, 2), "info");
  const edited = await ctx.ui.editor("Edit feature JSON", JSON.stringify(feature, null, 2));
  if (!edited) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(edited);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return ctx.ui.notify(`Invalid feature JSON: ${message}`, "error");
  }

  // Validate against schema
  const validation = validate(FeatureSchema, parsed);
  if (!validation.valid) {
    logger.error("commands", "Feature edit validation failed", undefined, { 
      featureId,
      validationErrors: validation.errors 
    });
    return ctx.ui.notify(`Invalid feature structure:\n${formatValidationErrors(validation.errors)}`, "error");
  }

  Object.assign(feature, parsed as Feature);
  appendHistory(mission, { event: "feature_edited", featureId });
  await saveMissionSafe(mission);
  updateFooter(ctx, mission);
}

export async function handleFork(reason: string, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  const feature = mission ? getActiveFeature(mission) : null;
  if (!mission || !feature) return ctx.ui.notify("No active feature to fork.", "warning");
  const approach = ctx.hasUI ? (await ctx.ui.input("Alternative approach", reason || "Try a smaller/safer approach")) || reason : reason;
  const forked = cloneFeatureForFork(
    feature,
    `${feature.id}-fork-${Date.now()}`,
    `${feature.title} [fork]`,
    `Fork: ${approach || "Alternative approach"}`,
  );
  const milestone = getMilestoneById(mission, feature.milestoneId);
  if (!milestone) return ctx.ui.notify("Milestone not found.", "error");
  feature.status = "blocked";
  milestone.features.push(forked);
  mission.activeFeatureId = forked.id;
  mission.status = "active";
  appendHistory(mission, { event: "feature_forked", featureId: feature.id, note: approach, details: { forkedFeatureId: forked.id } });
  await saveMissionSafe(mission);
  const leafId = ctx.sessionManager.getLeafId();
  if (!leafId) {
    ctx.ui.notify(`🌿 Fork feature created: ${forked.title} (no session leaf available to fork)`, "warning");
    return;
  }
  await ctx.fork(leafId, {
    withSession: async (forkCtx) => forkCtx.ui.notify(`🌿 Fork active: ${forked.title}`, "info"),
  });
}

export async function handleDebug(id: string | undefined, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
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

export async function handleModels(sub: string | undefined, arg: string | undefined, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const cfg = loadModelConfig();

  if (!sub || sub === "show") {
    ctx.ui.notify(formatModelConfig(cfg), "info");
    return;
  }

  if (sub === "set" && arg) {
    const parts = arg.split("=");
    if (parts.length === 2) {
      const agentName = parts[0]!;
      const presetName = parts[1]!;
      if (!cfg.agents[agentName]) return ctx.ui.notify(`Unknown agent: ${agentName}`, "error");
      if (!cfg.presets[presetName]) return ctx.ui.notify(`Unknown preset: ${presetName}. Available: ${Object.keys(cfg.presets).join(", ")}`, "error");
      cfg.agents[agentName]!.preset = presetName;
      persistModelConfig(cfg);
      ctx.ui.notify(`✅ ${agentName} → ${presetName} preset.`, "info");
    } else {
      ctx.ui.notify("Usage: /mission models set <agent>=<preset>  (e.g., mission-scout=balanced)", "warning");
    }
    return;
  }

  if (sub === "agent" && arg) {
    const resolved = formatAgentModelLine(arg, cfg);
    ctx.ui.notify(resolved, "info");
    return;
  }

  if (sub === "reload") {
    clearModelConfigCache();
    ctx.ui.notify("Model config cache cleared. Next resolution re-reads models.json.", "info");
    return;
  }

  if (sub === "preset" && arg) {
    if (!cfg.presets[arg]) return ctx.ui.notify(`Unknown preset: ${arg}`, "error");
    for (const name of Object.keys(cfg.agents)) cfg.agents[name]!.preset = arg;
    persistModelConfig(cfg);
    ctx.ui.notify(`✅ All agents set to '${arg}' preset.`, "info");
    return;
  }

  ctx.ui.notify(`Unknown /mission models sub: ${sub}. Use: show | set <agent>=<preset> | agent <name> | preset <name> | reload`, "warning");
}

function persistModelConfig(cfg: ModelsConfig): void {
  const modelsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "models.json");
  try {
    fs.writeFileSync(modelsPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
  } catch {
    // Non-fatal: config is still valid in-memory for the session.
  }
}

// ---------------------------------------------------------------------------
// /mission export [filename]
// ---------------------------------------------------------------------------

export async function handleExport(filename: string | undefined, ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const mission = runtime.activeMission;
  if (!mission) return ctx.ui.notify("No active mission to export.", "warning");
  const markdown = exportMarkdown(mission);
  if (filename) {
    fs.writeFileSync(filename, markdown, "utf-8");
    ctx.ui.notify(`✅ Report exported to ${filename}`, "info");
  } else {
    ctx.ui.notify(markdown, "info");
  }
}

// ---------------------------------------------------------------------------
// /mission templates [scaffold <id> [title]]
// ---------------------------------------------------------------------------

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
    pi.setSessionName(`🎯 ${mission.title}`);
    updateFooter(ctx, mission);
    ctx.ui.notify(`✅ Mission created from '${arg}' template: ${mission.id}`, "info");
    return;
  }

  ctx.ui.notify("Usage: /mission templates [list|scaffold <id> [title]]", "warning");
}

export function compactionCheckpoint(pi: ExtensionAPI, runtime: RuntimeState): void {
  if (!runtime.activeMission) return;
  pi.appendEntry("pi-mission-compaction-checkpoint", { missionId: runtime.activeMission.id, summary: buildCompactionSummary(runtime.activeMission), timestamp: Date.now() });
}
