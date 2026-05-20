import type { Feature, MissionState } from "../core/types.js";
import { getActiveFeature, getAllFeatures, getMissionPhase, progress } from "../core/state.js";

// ═══════════════════════════════════════════════════════════════════════════
// UI Primitives (inline — tiny helpers, not worth a separate file)
// ═══════════════════════════════════════════════════════════════════════════

export function clip(text: string, max = 88): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function progressBar(done: number, total: number, width = 16): string {
  if (total === 0) return `[${"░".repeat(width)}]`;
  const ratio = Math.max(0, Math.min(1, done / total));
  const filled = Math.round(ratio * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

export function featureStatusIcon(status: string): string {
  switch (status) {
    case "done": return "✅";
    case "active": return "➡️";
    case "blocked": return "⛔";
    case "failed": return "❌";
    case "waiting": return "⏳";
    default: return "•";
  }
}

export function missionStatusIcon(status: string): string {
  switch (status) {
    case "complete": return "✅";
    case "paused": return "⏸";
    case "blocked": return "⛔";
    case "budget_limited": return "⚠️";
    default: return "🎯";
  }
}

export function acceptanceProgress(feature: Feature): { done: number; total: number; label: string } {
  const done = feature.acceptance.filter(ac => ac.verified || ac.waived).length;
  return { done, total: feature.acceptance.length, label: `${done}/${feature.acceptance.length}` };
}

export function pendingAcceptance(feature: Feature, arrow = "→"): string[] {
  return feature.acceptance
    .filter(ac => !ac.verified && !ac.waived)
    .map(ac => ac.checkType === "bash" && ac.checkCommand
      ? `${ac.id}: ${ac.description} ${arrow} ${ac.checkCommand}`
      : `${ac.id}: ${ac.description}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase line
// ═══════════════════════════════════════════════════════════════════════════

function phaseLine(phase: string): string {
  switch (phase) {
    case "planning": return "🔍 Phase: planning — explore, read, clarify. Avoid writes. Read-only bash.";
    case "verification": return "✅ Phase: verification — run checks, capture evidence, report exact gaps.";
    default: return "🔧 Phase: execution — smallest change that satisfies acceptance criteria.";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Layer 1: Mission banner (~6 lines)
// ═══════════════════════════════════════════════════════════════════════════

export function buildMissionBanner(mission: MissionState): string {
  const active = getActiveFeature(mission);
  const p = progress(mission);
  const phase = getMissionPhase(mission);
  const bar = progressBar(p.done, p.total);

  const lines = [
    "## Pi Missions Extension — Active",
    `Mission: ${mission.title}  |  Goal: ${mission.goal}`,
    `  ${bar} ${p.done}/${p.total} leaf goals (${p.pct}%) — ${p.done}/${p.total} features`,
    `  Status: ${mission.status}  |  Phase: ${phase}`,
    `  State: ~/.pi/missions/${mission.id}/`,
  ];

  if (active) {
    lines.push("", `  ▶ ${active.id}: ${active.title} [${phase}]`, `  ${active.description}`);
  } else {
    lines.push("", "  No active feature.");
  }
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// Layer 2: Feature brief (~8-12 lines)
// ═══════════════════════════════════════════════════════════════════════════

export function buildFeatureBrief(mission: MissionState, feature: Feature, tokenBudget = 250): string {
  const phase = getMissionPhase(mission);
  const allFeatures = getAllFeatures(mission);
  const pendingCount = allFeatures.filter(f => f.status === "pending").length;
  const blockedCount = allFeatures.filter(f => f.status === "blocked").length;

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

  // Goal path
  const milestoneTitle = mission.milestones.find(m => m.id === feature.milestoneId)?.title ?? "";
  add(`Goal path: ${milestoneTitle} > ${feature.title}`);
  add("");

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

  // Phase instruction
  add("");
  add(phaseLine(phase));

  // Counts
  if (pendingCount) add(`📋 ${pendingCount} pending feature(s) queued.`);
  if (blockedCount) add(`⛔ ${blockedCount} blocked feature(s).`);

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// Layer 3: Mission help — full commands/tools reference
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// Composed contexts
// ═══════════════════════════════════════════════════════════════════════════

/** Full context: banner + brief + help. Used on mission start/load. ~400 tokens */
export function buildMissionContext(mission: MissionState): string {
  const active = getActiveFeature(mission);
  const banner = buildMissionBanner(mission);
  const brief = active ? buildFeatureBrief(mission, active, 300) : "";
  const help = buildMissionHelp();

  const allFeatures = getAllFeatures(mission);
  const doneRecent = allFeatures.filter(f => f.status === "done").slice(-3);

  const parts = [banner];
  if (brief) parts.push("", brief);
  parts.push("", help);

  // Always show Goal Tree section
  parts.push("", `### Goal Tree`);
  if (active) parts.push(`▶ ${active.title}`);
  if (doneRecent.length) {
    const recent = doneRecent.map(f => `✅ ${f.id} ${f.title}`).join("  |  ");
    if (recent) parts.push(`### Recently completed: ${recent}`);
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

  parts.push(
    "",
    "Goal tree:",
    active ? `▶ ${active.id} ${active.title}` : "",
    "",
    "Use /mission status for full overview.",
    "",
    "**Tools**: mission_feature_done, mission_next_feature, mission_ask_user, mission_block_self, mission_fork, mission_error_status, mission_retry_error",
  );

  return parts.join("\n");
}

export function buildCompactionSummary(mission: MissionState): string {
  const active = getActiveFeature(mission);
  const p = progress(mission);
  const g = getAllFeatures(mission);
  const blocked = g.filter(f => f.status === "blocked").length;
  const waiting = g.filter(f => f.status === "waiting").length;

  return [
    `Mission: ${mission.title}  |  ID: ${mission.id}`,
    `Goal: ${mission.goal}`,
    `Progress: ${p.done}/${p.total} features (${p.pct}%)  |  ${p.done}/${p.total} leaf goals (${p.pct}%)  |  Status: ${mission.status}`,
    active ? `Active: ${active.id} — ${active.title}` : "Active: none",
    `Blocked/Waiting: ${blocked}/${waiting}`,
    `State: ~/.pi/missions/${mission.id}/`,
    "Resume by loading mission state and continuing the active feature.",
  ].join("\n  ");
}

export function completionSignal(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return [
    "klaar", "done", "complete", "completed", "voltooid",
    "tests pass", "tests slagen", "implemented",
  ].some(s => lower.includes(s));
}

// ═══════════════════════════════════════════════════════════════════════════════════
// Dependency chain helpers — for blocking chain visualization in dashboard
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * Returns the full upstream dependency chain for a feature.
 * Recursively traces dependsOn to find all features blocking this one.
 * Skips done dependencies since they're already satisfied.
 * Returns chain from immediate dep → root.
 */
export function dependsOnChain(mission: MissionState, feature: Feature): Array<{ id: string; status: string; title: string }> {
  const chain: Array<{ id: string; status: string; title: string }> = [];
  const visited = new Set<string>();

  function trace(fId: string): void {
    if (visited.has(fId)) return;
    visited.add(fId);
    const f = mission.milestones.flatMap(m => m.features).find(f => f.id === fId);
    if (!f) return;
    if (f.status === "done") return; // Skip satisfied deps
    chain.push({ id: f.id, status: f.status, title: f.title });
    for (const depId of f.dependsOn) {
      const dep = mission.milestones.flatMap(m => m.features).find(f => f.id === depId);
      if (!dep || dep.status === "done") continue;
      trace(depId);
    }
  }

  for (const depId of feature.dependsOn) trace(depId);
  return chain;
}

/**
 * Formats a dependency chain as a compact visual string.
 * E.g.: "🔗 F001(•) Plan → F002(⏳) Scope → F003(⛔) Blocked"
 */
export function formatDepChain(chain: Array<{ id: string; status: string; title?: string }>): string {
  if (!chain.length) return "";
  const statusIcon: Record<string, string> = {
    pending: "•", waiting: "⏳", blocked: "⛔", active: "➡️", done: "✅", failed: "❌",
  };
  const parts = chain.map(n => {
    const icon = statusIcon[n.status] ?? "•";
    const label = n.title ? ` ${clip(n.title, 20)}` : "";
    return `${n.id}(${icon}${label})`;
  });
  return `🔗 ${parts.join(" → ")}`;
}

export function featureSummary(feature: Feature): string {
  return `${feature.id} ${feature.status} ${feature.title}`;
}
