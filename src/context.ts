import { getActiveFeature, getAllFeatures, getMissionPhase, progress } from "./state.js";
import type { Feature, MissionState } from "./types.js";
import { findGoalPathByFeatureId, getMissionGoalTree, goalTreeProgress, renderGoalTree } from "./mission-builder.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function progressBar(done: number, total: number, width = 16): string {
  if (total === 0) return "[" + "░".repeat(width) + "]";
  const filled = Math.round((done / total) * width);
  return "[" + "█".repeat(filled) + "░".repeat(width - filled) + "]";
}

/** Compact phase instruction — always 1 line. */
function phaseLine(phase: string): string {
  switch (phase) {
    case "planning": return `🔍 Phase: planning — explore, read, clarify. Avoid writes. Read-only bash.`;
    case "verification": return `✅ Phase: verification — run checks, capture evidence, report exact gaps.`;
    default: return `🔧 Phase: execution — smallest change that satisfies acceptance criteria.`;
  }
}

// ─── Layer 1: Mission banner — ~6 lines ────────────────────────────────────

export function buildMissionBanner(mission: MissionState): string {
  const active = getActiveFeature(mission);
  const p = progress(mission);
  const phase = getMissionPhase(mission);
  const goalProgress = goalTreeProgress(getMissionGoalTree(mission));

  const gpBar = progressBar(goalProgress.done, goalProgress.total);
  const fpBar = progressBar(p.done, p.total);

  const lines = [
    "## Pi Missions Extension — Active",
    `Mission: ${mission.title}  |  Goal: ${mission.goal}`,
    `  ${fpBar} ${p.done}/${p.total} features (${p.pct}%)  |  ${gpBar} ${goalProgress.done}/${goalProgress.total} leaf goals`,
    `  Status: ${mission.status}  |  Phase: ${phase}`,
    `  State: ~/.pi/missions/${mission.id}/`,
  ];

  if (active) {
    lines.push(
      "",
      `  ▶ ${active.id}: ${active.title} [${phase}]`,
      `  ${active.description}`,
    );
  } else {
    lines.push("", "  No active feature.");
  }

  return lines.join("\n");
}

// ─── Layer 2: Feature brief — ~8-12 lines ───────────────────────────────────

export function buildFeatureBrief(mission: MissionState, feature: Feature, tokenBudget = 250): string {
  const phase = getMissionPhase(mission);
  const allFeatures = getAllFeatures(mission);
  const pendingCount = allFeatures.filter((f) => f.status === "pending").length;
  const blockedCount = allFeatures.filter((f) => f.status === "blocked").length;
  const goalPath = findGoalPathByFeatureId(getMissionGoalTree(mission), feature.id);

  const lines: string[] = [];
  let used = 0;

  function add(...items: string[]): void {
    for (const item of items) {
      const cost = item.length / 4;
      if (used + cost > tokenBudget) return;
      lines.push(item);
      used += cost;
    }
  }

  if (goalPath.length) {
    add(`Goal path: ${goalPath.map((node) => node.title).join(" > ")}`);
  }

  // Acceptance criteria
  if (feature.acceptance.length) {
    add("**Acceptance:**");
    for (const ac of feature.acceptance) {
      const mark = ac.verified || ac.waived ? "x" : " ";
      const waived = ac.waived ? " (waived)" : "";
      add(`- [${mark}] ${ac.id}: ${ac.description}${waived}`);
    }
  }

  // Dependencies
  if (feature.dependsOn.length) {
    add(`Dependencies: ${feature.dependsOn.join(", ")}`);
  }

  // Phase-specific instruction (always 1 line)
  add("");
  add(phaseLine(phase));

  // Counts
  if (pendingCount) add(`📋 ${pendingCount} pending feature(s) queued.`);
  if (blockedCount) add(`⛔ ${blockedCount} blocked feature(s).`);

  return lines.join("\n");
}

// ─── Layer 3: Mission help — full commands/tools reference ───────────────────

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
  "- /mission start/new: create a new mission.",
  "- /mission load: resume an existing mission.",
  "- /mission status: show active mission, feature, progress, acceptance criteria.",
  "- /mission next: activate the next unblocked pending feature.",
  "- /mission done: mark the active feature done and save evidence.",
  "- /mission block: block the active feature.",
  "- /mission fork: create a linked alternative feature.",
  "- /mission dashboard: open mission control UI.",
  "- /mission debug: inspect recent mission history.",
  "- /mission metrics: show mission/session metrics.",
  "- /mission templates: create from a built-in template.",
  "- /mission export: export mission report as markdown.",
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

/** Full context: banner + brief + help. Used on mission start/load (one-time). ~400 tokens */
export function buildMissionContext(mission: MissionState): string {
  const active = getActiveFeature(mission);
  const banner = buildMissionBanner(mission);
  const brief = active ? buildFeatureBrief(mission, active, 300) : "";
  const help = buildMissionHelp();
  const goalTreeLines = renderGoalTree(getMissionGoalTree(mission), 10);

  const allFeatures = getAllFeatures(mission);
  const doneRecent = allFeatures.filter((f) => f.status === "done").slice(-3);

  const parts = [banner];
  if (brief) parts.push("", brief);

  // Inline goal tree progress bar instead of loose lines
  const gp = goalTreeProgress(getMissionGoalTree(mission));
  parts.push("", `### Goal Tree  ${progressBar(gp.done, gp.total, 8)} ${gp.done}/${gp.total} (${gp.pct}%)`);
  parts.push(...goalTreeLines);

  parts.push("", help);

  if (doneRecent.length) {
    const recent = doneRecent.map((f) => `✅ ${f.id} ${f.title}`).join("  |  ");
    parts.push("", `### Recently completed: ${recent}`);
  }

  parts.push("", "Work only on the active feature unless the user or /mission next changes it.");

  return parts.join("\n");
}

/** Lean context: banner + feature brief only. ~250 tokens */
export function buildLeanContext(mission: MissionState): string {
  const active = getActiveFeature(mission);
  const banner = buildMissionBanner(mission);
  const brief = active ? buildFeatureBrief(mission, active, 200) : "";
  const parts = [banner];
  if (brief) parts.push("", brief);

  // Inline goal tree snapshot as a one-liner
  const tree = renderGoalTree(getMissionGoalTree(mission), 3);
  parts.push("", `🎯 Goal tree: ${tree.join(" | ")}`);

  parts.push("", "Use /mission status for full overview.");

  return parts.join("\n");
}

export function buildCompactionSummary(mission: MissionState): string {
  const active = getActiveFeature(mission);
  const p = progress(mission);
  const g = getAllFeatures(mission);
  const goalProgress = goalTreeProgress(getMissionGoalTree(mission));
  const blocked = g.filter((f) => f.status === "blocked").length;
  const waiting = g.filter((f) => f.status === "waiting").length;
  return [
    `Mission: ${mission.title}  |  ID: ${mission.id}`,
    `Goal: ${mission.goal}`,
    `Goal tree: ${progressBar(goalProgress.done, goalProgress.total, 8)} ${goalProgress.done}/${goalProgress.total} leaf goals (${goalProgress.pct}%)`,
    `Progress: ${p.done}/${p.total} features (${p.pct}%)  |  Status: ${mission.status}`,
    active ? `Active: ${active.id} — ${active.title}` : "Active: none",
    `Blocked/Waiting: ${blocked}/${waiting}`,
    `State: ~/.pi/missions/${mission.id}/`,
    "Resume by loading mission state and continuing the active feature.",
  ].join("\n  ");
}

export function completionSignal(text: string): boolean {
  const lower = text.toLowerCase();
  return ["klaar", "done", "complete", "completed", "voltooid", "tests pass", "tests slagen", "implemented"].some((s) => lower.includes(s));
}

export function featureSummary(feature: Feature): string {
  return `${feature.id} ${feature.status} ${feature.title}`;
}
