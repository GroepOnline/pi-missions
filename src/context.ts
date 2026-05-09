import { getActiveFeature, getAllFeatures, getMissionPhase, progress } from "./state.js";
import type { Feature, MissionState } from "./types.js";
import { findGoalPathByFeatureId, getMissionGoalTree, goalTreeProgress, renderGoalTree } from "./mission-builder.js";

// ─── Layer 1: Mission banner — always injected, ~8 lines ─────────────────────

export function buildMissionBanner(mission: MissionState): string {
  const active = getActiveFeature(mission);
  const p = progress(mission);
  const phase = getMissionPhase(mission);
  const goalProgress = goalTreeProgress(getMissionGoalTree(mission));

  const lines = [
    "## Pi Missions Extension — Active",
    `Mission: ${mission.title}  [${p.pct}% done]`,
    `Goal: ${mission.goal}`,
    `Goal Tree: ${goalProgress.done}/${goalProgress.total} leaf goals | ${goalProgress.pct}% done`,
    `Progress: ${p.done}/${p.total} features | Status: ${mission.status} | Phase: ${phase}`,
    `State: ~/.pi/missions/${mission.id}/`,
  ];

  if (active) {
    lines.push(
      "",
      `### ▶ ${active.id}: ${active.title} [${phase}]`,
      active.description,
    );
  } else {
    lines.push("", "No active feature.");
  }

  return lines.join("\n");
}

// ─── Layer 2: Feature brief — per-feature detail, ~10-15 lines ───────────────

export function buildFeatureBrief(mission: MissionState, feature: Feature): string {
  const phase = getMissionPhase(mission);
  const allFeatures = getAllFeatures(mission);
  const pendingCount = allFeatures.filter((f) => f.status === "pending").length;
  const blockedCount = allFeatures.filter((f) => f.status === "blocked").length;
  const goalPath = findGoalPathByFeatureId(getMissionGoalTree(mission), feature.id);

  const lines: string[] = [];

  if (goalPath.length) {
    lines.push(`Goal path: ${goalPath.map((node) => node.title).join(" -> ")}`);
  }

  // Acceptance criteria
  if (feature.acceptance.length) {
    lines.push("**Acceptance:**");
    for (const ac of feature.acceptance) {
      const mark = ac.verified || ac.waived ? "x" : " ";
      const waived = ac.waived ? " (waived)" : "";
      lines.push(`- [${mark}] ${ac.id}: ${ac.description}${waived}`);
    }
  }

  // Dependencies
  if (feature.dependsOn.length) {
    lines.push(`Dependencies: ${feature.dependsOn.join(", ")}`);
  }

  // Phase-specific instruction (1 line)
  if (phase === "planning") {
    lines.push("", "🔍 **Planning phase** — explore, read, clarify. Avoid writes. Read-only bash allowed.");
  } else if (phase === "execution") {
    lines.push("", "🔧 **Execution phase** — implement the smallest change that satisfies acceptance criteria.");
  } else {
    lines.push("", "✅ **Verification phase** — run checks, capture evidence, report exact gaps.");
  }

  // Counts
  if (pendingCount) lines.push(`📋 ${pendingCount} pending feature(s) queued.`);
  if (blockedCount) lines.push(`⛔ ${blockedCount} blocked feature(s).`);

  return lines.join("\n");
}

// ─── Layer 3: Mission help — full commands/tools reference, one-time inject ───

const MISSION_HELP = [
  "### How To Work This Mission",
  "- Work only on the active feature unless the user explicitly redirects you or /mission next changes it.",
  "- During planning: gather context, avoid writes; read-only shell exploration is allowed.",
  "- During execution: make the smallest coherent change that satisfies the mission goal.",
  "- During verification: run relevant checks, capture evidence, and report exact gaps.",
  "- Do not silently mark work complete. Use /mission done or mission_feature_done only with concrete evidence.",
  "- If blocked, use /mission block <reason> or mission_block_self with a clear reason and next option.",
  "",
  "### Mission Commands",
  "- /mission start/new <goal>: create a new mission.",
  "- /mission load <id>: resume an existing mission.",
  "- /mission status: show active mission, feature, progress, acceptance criteria.",
  "- /mission next: activate the next unblocked pending feature.",
  "- /mission done <evidence>: mark the active feature done and save evidence.",
  "- /mission block <reason>: block the active feature.",
  "- /mission fork <reason>: create a linked alternative feature.",
  "- /mission dashboard: open mission control UI.",
  "- /mission debug: inspect recent mission history.",
  "- /mission metrics: show mission/session metrics.",
  "- /mission templates list|scaffold: create from a built-in template.",
  "- /mission export [file]: export mission report as markdown.",
  "",
  "### Mission Tools",
  "- mission_next_feature: advance to the next pending feature.",
  "- mission_feature_done: mark the active feature done with evidence.",
  "- mission_ask_user: ask for clarification.",
  "- mission_block_self: self-block when stuck.",
  "- mission_fork: split into a linked fork.",
  "- mission_error_status: inspect error recovery state.",
  "- mission_retry_error: retry a retryable recorded error.",
].join("\n");

export function buildMissionHelp(): string {
  return MISSION_HELP;
}

// ─── Composed contexts ─────────────────────────────────────────────────────

/** Full context: banner + brief + help. Used on mission start/load (one-time). */
export function buildMissionContext(mission: MissionState): string {
  const active = getActiveFeature(mission);
  const banner = buildMissionBanner(mission);
  const brief = active ? buildFeatureBrief(mission, active) : "";
  const help = buildMissionHelp();
  const goalTreeLines = renderGoalTree(getMissionGoalTree(mission), 10);

  const allFeatures = getAllFeatures(mission);
  const doneRecent = allFeatures.filter((f) => f.status === "done").slice(-3);

  const parts = [banner];
  if (brief) parts.push(brief);
  if (goalTreeLines.length) parts.push("### Goal Tree", ...goalTreeLines);
  parts.push(help);
  if (doneRecent.length) {
    parts.push("", "### Recently completed");
    for (const f of doneRecent) parts.push(`- ✅ ${f.id}: ${f.title}`);
  }
  parts.push("", "Work only on the active feature unless the user or /mission next changes it.");

  return parts.join("\n");
}

/** Lean context: banner + feature brief only. Used before each agent start. */
export function buildLeanContext(mission: MissionState): string {
  const active = getActiveFeature(mission);
  const banner = buildMissionBanner(mission);
  const brief = active ? buildFeatureBrief(mission, active) : "";
  const parts = [banner];
  if (brief) parts.push(brief);
  parts.push("", `Goal tree snapshot: ${renderGoalTree(getMissionGoalTree(mission), 3).join(" | ")}`);
  // One-line reminder instead of full help dump
  parts.push("", "Use /mission status for full overview. /mission help for commands & tools reference.");
  return parts.join("\n");
}

export function buildCompactionSummary(mission: MissionState): string {
  const active = getActiveFeature(mission);
  const p = progress(mission);
  const goalProgress = goalTreeProgress(getMissionGoalTree(mission));
  return [
    `Mission: ${mission.title}`,
    `Mission ID: ${mission.id}`,
    `Goal: ${mission.goal}`,
    `Goal tree: ${goalProgress.done}/${goalProgress.total} leaf goals (${goalProgress.pct}%)`,
    `Status: ${mission.status}`,
    `Progress: ${p.done}/${p.total} (${p.pct}%)`,
    active ? `Active feature: ${active.id} — ${active.title}` : "Active feature: none",
    `State files: ~/.pi/missions/${mission.id}/plan.json, history.jsonl, evidence/`,
    "Resume by loading mission state and continuing the active feature.",
  ].join("\n");
}

export function completionSignal(text: string): boolean {
  const lower = text.toLowerCase();
  return ["klaar", "done", "complete", "completed", "voltooid", "tests pass", "tests slagen", "implemented"].some((s) => lower.includes(s));
}

export function featureSummary(feature: Feature): string {
  return `${feature.id} ${feature.status} ${feature.title}`;
}
