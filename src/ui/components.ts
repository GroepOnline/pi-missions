import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { Feature, MissionState, Milestone } from "../core/types.js";
import { getActiveFeature, getAllFeatures, getMissionPhase, getNextPendingFeature, progress } from "../core/state.js";
import {
  acceptanceProgress, buildMissionBanner, buildMissionHelp,
  clip, dependsOnChain, featureStatusIcon, formatDepChain, missionStatusIcon, pendingAcceptance, progressBar,
} from "../utils/context.js";

function phaseLine(phase: string): string {
  switch (phase) {
    case "planning": return "🔍 Phase: planning — explore, read, clarify. Avoid writes. Read-only bash.";
    case "verification": return "✅ Phase: verification — run checks, capture evidence, report exact gaps.";
    default: return "🔧 Phase: execution — smallest change that satisfies acceptance criteria.";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Mission Control Summary
// ═══════════════════════════════════════════════════════════════════════════

export interface MissionControlSummary {
  active: Feature | null;
  nextFeature: Feature | null;
  blocked: Feature[];
  waiting: Feature[];
  handoff: string;
}

function milestoneProgressBar(milestone: Milestone): string {
  const done = milestone.features.filter(f => f.status === "done").length;
  return progressBar(done, milestone.features.length, 20);
}

function milestoneProgressBarSimple(done: number, total: number, width = 16): string {
  return progressBar(done, total, width);
}

function deriveNextAction(feature: Feature): string {
  if (feature.status === "blocked") {
    return feature.notes ? `Unblock ${feature.id}: ${clip(feature.notes, 72)}` : `Unblock ${feature.id} before continuing`;
  }
  if (feature.status === "waiting") {
    return feature.dependsOn.length
      ? `Wait for ${feature.dependsOn.join(", ")} before resuming ${feature.id}`
      : `Resume ${feature.id} when external dependency clears`;
  }
  const next = pendingAcceptance(feature, "->")[0];
  if (next) return `Finish ${feature.id}: ${clip(next, 72)}`;
  return `Advance ${feature.id}: ${clip(feature.description || feature.title, 72)}`;
}

function deriveHandoffSummary(mission: MissionState, active: Feature | null, next: Feature | null): string {
  const stop = mission.autopilot.lastStopReason;
  const msg = mission.autopilot.lastStopMessage;
  if (stop === "needs_user_decision" && msg) return `Needs user decision: ${clip(msg, 78)}`;
  if (stop === "blocked" && msg) return `Blocked: ${clip(msg, 78)}`;
  if (active?.notes) return `Carry over: ${clip(active.notes, 78)}`;
  if (next) return `After ${active?.id ?? "current"} hand off to ${next.id} ${clip(next.title, 52)}`;
  return "Close out evidence and confirm mission state";
}

export function buildMissionControlSummary(mission: MissionState): MissionControlSummary {
  const active = getActiveFeature(mission);
  const blocked = getAllFeatures(mission).filter(f => f.status === "blocked");
  const waiting = getAllFeatures(mission).filter(f => f.status === "waiting");
  const nextFeature = getNextPendingFeature(mission);
  return { active, nextFeature, blocked, waiting, handoff: deriveHandoffSummary(mission, active, nextFeature) };
}

// ═══════════════════════════════════════════════════════════════════════════
// Footer — compact single-line status
// ═══════════════════════════════════════════════════════════════════════════

export function updateFooter(ctx: ExtensionCommandContext, mission: MissionState | null): void {
  if (!mission) {
    ctx.ui.setStatus("pi-mission", "");
    return;
  }
  const p = progress(mission);
  const active = getActiveFeature(mission);
  const icon = missionStatusIcon(mission.status);
  const a = mission.autopilot;
  const ap = a.enabled
    ? ` · 🤖 ${a.iteration}/${a.maxIterations} np${a.noProgressTurns}/${a.maxNoProgressTurns} f${a.consecutiveFailures}/${a.maxConsecutiveFailures}`
    : " · ⏹ off";
  const line = active
    ? `${icon} ${mission.title} [${p.done}/${p.total} ${p.pct}%] — ${active.id} ${active.title}${ap}`
    : `${icon} ${mission.title} [${p.done}/${p.total} ${p.pct}%]${ap}`;
  ctx.ui.setStatus("pi-mission", line);
}

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard rows — string-based output for TUI and export
// ═══════════════════════════════════════════════════════════════════════════

export function dashboardRows(mission: MissionState): string[] {
  const p = progress(mission);
  const icon = missionStatusIcon(mission.status);
  const s = buildMissionControlSummary(mission);
  const active = s.active;
  const nextAction = active
    ? deriveNextAction(active)
    : s.nextFeature ? `Start ${s.nextFeature.id}: ${clip(s.nextFeature.title, 68)}` : "No runnable feature";
  const acDone = active ? acceptanceProgress(active).done : 0;
  const acTotal = active?.acceptance.length ?? 0;
  const phase = getMissionPhase(mission);

  const rows: string[] = [
    "",
    `  ${icon} ${mission.title}`,
    `     Goal: ${clip(mission.goal || "No goal", 88)}`,
    `     Progress: ${progressBar(p.done, p.total)} ${p.done}/${p.total} — ${p.pct}%`,
    `     Focus: ${active ? `${active.id} [P${active.priority}] ${active.title}` : "None"}`,
    `     Feature progress: ${active ? `${acDone}/${acTotal} AC` : "Waiting"}`,
    `     Blocked/Waiting: ${s.blocked.length} blocked · ${s.waiting.length} waiting`,
    `     Next action: ${nextAction}`,
    `     Handoff: Carry over: ${s.handoff.startsWith("Carry over: ") ? s.handoff.slice(12) : s.handoff}`,
    `     Status: ${mission.status} | Tokens: ${mission.tokensUsed.toLocaleString()} | Autopilot: ${mission.autopilot.enabled ? "ON" : "OFF"} (${mission.autopilot.mode})`,
    "  " + "─".repeat(76),
    `  ${phaseLine(phase)}`,
    "",
  ];

  if (s.blocked.length) {
    for (const f of s.blocked.slice(0, 2)) rows.push(`  ⛔ Blocked: ${f.id} ${f.title} — ${clip(f.notes ?? "No note", 72)}`);
    if (s.blocked.length > 2) rows.push(`  ⛔ +${s.blocked.length - 2} more`);
    rows.push("");
  }
  if (s.waiting.length) {
    for (const f of s.waiting.slice(0, 3)) {
      const chain = dependsOnChain(mission, f);
      const chainStr = chain.length ? ` ${formatDepChain(chain)}` : "";
      const reason = f.dependsOn.length ? `waiting on ${f.dependsOn.join(", ")}` : (f.notes ?? "waiting");
      rows.push(`  ⏳ Waiting: ${f.id} ${f.title} — ${clip(reason, 60)}${chainStr}`);
    }
    if (s.waiting.length > 3) rows.push(`  ⏳ +${s.waiting.length - 3} more waiting features`);
    rows.push("");
  }

  // ── Milestone list: collapse done milestones (show last 2 done fully, rest as single line) ──
  const doneMilestones = mission.milestones.filter(m => m.status === "complete" && m.features.every(f => f.status === "done"));
  const undoneMilestones = mission.milestones.filter(m => m.status !== "complete" || !m.features.every(f => f.status === "done"));

  // Show all non-done + active milestones fully
  for (const m of undoneMilestones) {
    const mDone = m.features.filter(f => f.status === "done").length;
    const mTotal = m.features.length;
    const mi = m.status === "active" ? "➡️" : m.status === "complete" ? "✅" : "•";
    rows.push(`  ${mi} ${m.id}: ${m.title}`);
    rows.push(`     ${milestoneProgressBar(m)} ${mDone}/${mTotal}`);

    const order: Record<string, number> = { active: 0, pending: 1, waiting: 2, blocked: 3, failed: 4, done: 5 };
    const sorted = [...m.features].sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5) || a.priority - b.priority);

    for (const f of sorted) {
      const fi = featureStatusIcon(f.status);
      const deps = f.dependsOn.length ? ` 🔗${f.dependsOn.join(",")}` : "";
      const blocked = f.status === "blocked" && f.notes ? ` ↳ ${f.notes.slice(0, 50)}` : "";
      const failed = f.status === "failed" ? " [failed]" : "";
      const ac = acceptanceProgress(f);
      const badge = f.acceptance.length ? ` [${ac.label} AC]` : "";

      if (f.status === "active") {
        rows.push(`       ${fi} ${f.id} [P${f.priority}] ${f.title}${badge}${deps}`);
        rows.push(`         📝 ${f.description}`);
        const chain = dependsOnChain(mission, f);
        if (chain.length) rows.push(`         🔗 Blocking chain: ${formatDepChain(chain)}`);
        for (const a of pendingAcceptance(f, "->")) rows.push(`         ☐ ${clip(a, 66)}`);
        if (f.startedAt && Date.now() - f.startedAt > 600_000) {
          rows.push(`         Active ${Math.round((Date.now() - f.startedAt) / 60000)}min`);
        }
        if (f.toolCallCount > 50) rows.push(`         ${f.toolCallCount} tool calls`);
        rows.push(`     👉 ${deriveNextAction(f)}`);
        rows.push(`     🤝 ${s.handoff}`);
      } else {
        rows.push(`       ${fi} ${f.id} [P${f.priority}] ${f.title}${badge}${deps}${blocked}${failed}`);
      }
    }
    rows.push("");
  }

  // Collapse done milestones: show count + last 2 with full summary
  if (doneMilestones.length > 0) {
    const showFull = doneMilestones.slice(-2); // last 2 done milestones shown fully
    const collapsed = doneMilestones.slice(0, -2); // rest shown as single line
    if (showFull.length > 1) {
      // Multiple done milestones: show collapsed header, last 2 with progress bar
      rows.push(`  ✅ ${doneMilestones.length} completed milestones (collapsed)`);
      for (const m of showFull) {
        const mDone = m.features.filter(f => f.status === "done").length;
        const mTotal = m.features.length;
        rows.push(`     ${milestoneProgressBarSimple(mDone, mTotal, 16)} ${m.id}: ${m.title} [${mDone}/${mTotal}]`);
      }
      if (collapsed.length > 0) {
        rows.push(`     +${collapsed.length} earlier milestone(s): ${collapsed.map(m => m.id).join(", ")}`);
      }
    } else {
      // Single done milestone: use original format "✅ M01: ... — all X features done"
      const m = showFull[0]!;
      const mTotal = m.features.length;
      rows.push(`  ✅ ${m.id}: ${m.title} — all ${mTotal} features done`);
    }
    rows.push("");
  }

  rows.push("  " + "─".repeat(76));
  rows.push("  /mission run | pause | resume | stop | autopilot | next | done | block | status | dashboard");
  rows.push("");
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════
// Status text — plain text overview for non-UI contexts
// ═══════════════════════════════════════════════════════════════════════════

export function statusText(mission: MissionState): string {
  const p = progress(mission);
  const s = buildMissionControlSummary(mission);
  const active = s.active;
  const lines = [
    `🎯 Mission: ${mission.title}`,
    `ID: ${mission.id}`,
    `Status: ${mission.status}`,
    `Goal: ${mission.goal}`,
    `Progress: ${p.done}/${p.total} (${p.pct}%)`,
    active ? `Active: ${active.id} — ${active.title}` : "Active: none",
    `Blocked/Waiting: ${s.blocked.length}/${s.waiting.length}`,
    `Next action: ${active ? deriveNextAction(active) : s.nextFeature ? `Start ${s.nextFeature.id} — ${s.nextFeature.title}` : "None"}`,
    `Handoff: ${s.handoff}`,
    `Autopilot: ${mission.autopilot.enabled ? "ON" : "OFF"} (${mission.autopilot.mode})`,
    `Iteration: ${mission.autopilot.iteration}/${mission.autopilot.maxIterations}`,
    `Failures: ${mission.autopilot.consecutiveFailures}/${mission.autopilot.maxConsecutiveFailures}`,
    `No-progress: ${mission.autopilot.noProgressTurns}/${mission.autopilot.maxNoProgressTurns}`,
    `Last continuation: ${mission.autopilot.lastContinuationAt ?? "never"}`,
    `Last stop: ${mission.autopilot.lastStopReason ?? "none"}${mission.autopilot.lastStopMessage ? ` - ${mission.autopilot.lastStopMessage}` : ""}`,
    "",
  ];
  for (const m of mission.milestones) {
    const mi = m.status === "complete" ? "✅" : m.status === "active" ? "➡️" : "•";
    const mDone = m.features.filter(f => f.status === "done").length;
    lines.push(`${mi} ${m.id}: ${m.title} [${mDone}/${m.features.length}]`);
    for (const f of m.features) {
      const mark = featureStatusIcon(f.status);
      const blocked = f.status === "blocked" && f.notes ? ` — ${f.notes.slice(0, 50)}` : "";
      lines.push(`  ${mark} ${f.id}: ${f.title} (${f.status})${blocked}`);
    }
  }
  return lines.join("\n");
}
