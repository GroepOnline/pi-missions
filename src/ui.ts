import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getActiveFeature, getAllFeatures, getNextPendingFeature, progress } from "./state.js";
import type { Feature, MissionState, Milestone } from "./types.js";

// ────────────────────────────────────────────────────────────────────────────
// Progress bar helper
// ────────────────────────────────────────────────────────────────────────────
function progressBar(done: number, total: number, width = 20): string {
  if (total === 0) return "[░░░░░░░░░░░░░░░░░░░]";
  const filled = Math.round((done / total) * width);
  return "[" + "█".repeat(filled) + "░".repeat(width - filled) + "]";
}

function milestoneProgressBar(milestone: Milestone): string {
  const done = milestone.features.filter((f) => f.status === "done").length;
  return progressBar(done, milestone.features.length, 20);
}

function clip(text: string, max = 88): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function countVerifiedAcceptance(feature: Feature): number {
  return feature.acceptance.filter((ac) => ac.verified || ac.waived).length;
}

function pendingAcceptance(feature: Feature): string[] {
  return feature.acceptance
    .filter((ac) => !ac.verified && !ac.waived)
    .map((ac) => ac.checkType === "bash" && ac.checkCommand ? `${ac.id}: ${ac.description} -> ${ac.checkCommand}` : `${ac.id}: ${ac.description}`);
}

function deriveNextAction(feature: Feature): string {
  if (feature.status === "blocked") {
    return feature.notes ? `Unblock ${feature.id}: ${clip(feature.notes, 72)}` : `Unblock ${feature.id} before continuing`;
  }
  if (feature.status === "waiting") {
    return feature.dependsOn.length ? `Wait for ${feature.dependsOn.join(", ")} before resuming ${feature.id}` : `Resume ${feature.id} when external dependency clears`;
  }
  const nextAcceptance = pendingAcceptance(feature)[0];
  if (nextAcceptance) return `Finish ${feature.id}: ${clip(nextAcceptance, 72)}`;
  return `Advance ${feature.id}: ${clip(feature.description || feature.title, 72)}`;
}

function deriveHandoffSummary(mission: MissionState, active: Feature | null, nextFeature: Feature | null): string {
  const stop = mission.autopilot.lastStopReason;
  const stopMessage = mission.autopilot.lastStopMessage;
  if (stop === "needs_user_decision" && stopMessage) return `Needs user decision: ${clip(stopMessage, 78)}`;
  if (stop === "blocked" && stopMessage) return `Blocked handoff: ${clip(stopMessage, 78)}`;
  if (active?.notes) return `Carry over: ${clip(active.notes, 78)}`;
  if (nextFeature) return `After ${active?.id ?? "current work"} hand off to ${nextFeature.id} ${clip(nextFeature.title, 52)}`;
  return "Close out evidence and confirm mission state";
}

export interface MissionControlSummary {
  active: Feature | null;
  nextFeature: Feature | null;
  blocked: Feature[];
  waiting: Feature[];
  handoff: string;
}

export function buildMissionControlSummary(mission: MissionState): MissionControlSummary {
  const active = getActiveFeature(mission);
  const blocked = getAllFeatures(mission).filter((feature) => feature.status === "blocked");
  const waiting = getAllFeatures(mission).filter((feature) => feature.status === "waiting");
  const nextFeature = getNextPendingFeature(mission);
  return {
    active,
    nextFeature,
    blocked,
    waiting,
    handoff: deriveHandoffSummary(mission, active, nextFeature),
  };
}

function activeFeatureDetails(feature: Feature): string[] {
  const lines: string[] = [];
  // Show description
  if (feature.description) lines.push(`   📝 ${feature.description.slice(0, 80)}${feature.description.length > 80 ? "…" : ""}`);
  // Show unverified acceptance criteria
  const unverified = feature.acceptance.filter((ac) => !ac.verified && !ac.waived);
  if (unverified.length) {
    lines.push("   ✅ Acceptance criteria:");
    for (const ac of unverified) {
      const checkHint = ac.checkType === "bash" && ac.checkCommand ? ` → \`${ac.checkCommand.slice(0, 60)}\`` : "";
      lines.push(`      ☐ ${ac.id}: ${ac.description}${checkHint}`);
    }
  }
  // Show verified criteria count
  const verified = feature.acceptance.filter((ac) => ac.verified || ac.waived).length;
  if (verified > 0 && unverified.length === 0) lines.push(`   ✅ All ${verified} acceptance criteria verified`);
  // Show constraints
  if (feature.dependsOn.length) lines.push(`   🔗 Depends on: ${feature.dependsOn.join(", ")}`);
  // Show stale / tool call warning
  if (feature.startedAt) {
    const elapsedMin = Math.round((Date.now() - feature.startedAt) / 60000);
    const maxMin = Math.round((feature.maxWallClockMs ?? 30 * 60 * 1000) / 60000);
    if (elapsedMin > 15) lines.push(`   ⏱  Active ${elapsedMin}min (max ${maxMin}min)`);
  }
  if (feature.toolCallCount > 100) lines.push(`   🔧 ${feature.toolCallCount} tool calls`);
  return lines;
}

// ────────────────────────────────────────────────────────────────────────────
// Footer — compact single-line status
// ────────────────────────────────────────────────────────────────────────────
export function updateFooter(ctx: ExtensionContext, mission: MissionState | null): void {
  if (!mission) {
    ctx.ui.setStatus("pi-mission", "");
    return;
  }
  const p = progress(mission);
  const active = getActiveFeature(mission);
  const icon = mission.status === "paused" ? "⏸" : mission.status === "blocked" ? "⛔" : mission.status === "budget_limited" ? "⚠️" : mission.status === "complete" ? "✅" : "🎯";
  const a = mission.autopilot;
  const autopilot = a.enabled ? ` · Autopilot ON · iter ${a.iteration}/${a.maxIterations} · no-progress ${a.noProgressTurns}/${a.maxNoProgressTurns} · failures ${a.consecutiveFailures}/${a.maxConsecutiveFailures}` : " · Autopilot OFF";
  ctx.ui.setStatus("pi-mission", `${icon} ${mission.title} [${p.done}/${p.total} ${p.pct}%]${active ? ` — ${active.id} ${active.title}` : ""}${autopilot}`);
}

// ────────────────────────────────────────────────────────────────────────────
// Factory Droid–style mission control dashboard
// ────────────────────────────────────────────────────────────────────────────
export function dashboardRows(mission: MissionState): string[] {
  const p = progress(mission);
  const statusIcon = mission.status === "complete" ? "✅" : mission.status === "paused" ? "⏸" : mission.status === "budget_limited" ? "⚠️" : "🎯";
  const summary = buildMissionControlSummary(mission);
  const active = summary.active;
  const nextAction = active ? deriveNextAction(active) : summary.nextFeature ? `Start ${summary.nextFeature.id}: ${clip(summary.nextFeature.title, 68)}` : "No runnable feature queued";
  const activeAcceptanceDone = active ? countVerifiedAcceptance(active) : 0;
  const activeAcceptanceTotal = active?.acceptance.length ?? 0;

  const rows: string[] = [
    "",
    `  ${statusIcon} ${mission.title}`,
    `     Goal: ${clip(mission.goal || "No mission goal captured", 88)}`,
    `     Progress: ${progressBar(p.done, p.total)} ${p.done}/${p.total} features — ${p.pct}%`,
    `     Focus: ${active ? `${active.id} [P${active.priority}] ${active.title}` : "No active feature"}`,
    `     Feature progress: ${active ? `${activeAcceptanceDone}/${activeAcceptanceTotal} acceptance checks complete` : "Waiting for next runnable feature"}`,
    `     Blocked/Waiting: ${summary.blocked.length} blocked · ${summary.waiting.length} waiting`,
    `     Next action: ${nextAction}`,
    `     Handoff: ${summary.handoff}`,
    `     Status: ${mission.status} | Tokens: ${mission.tokensUsed.toLocaleString()} | Autopilot: ${mission.autopilot.enabled ? "ON" : "OFF"} (${mission.autopilot.mode})`,
    "  " + "─".repeat(76),
    "",
  ];

  if (summary.blocked.length) {
    for (const feature of summary.blocked.slice(0, 2)) {
      rows.push(`  ⛔ Blocked: ${feature.id} ${feature.title} — ${clip(feature.notes ?? "No blocker note", 72)}`);
    }
    if (summary.blocked.length > 2) rows.push(`  ⛔ +${summary.blocked.length - 2} more blocked features`);
    rows.push("");
  }

  if (summary.waiting.length) {
    for (const feature of summary.waiting.slice(0, 2)) {
      const waitReason = feature.dependsOn.length ? `waiting on ${feature.dependsOn.join(", ")}` : (feature.notes ?? "waiting");
      rows.push(`  ⏳ Waiting: ${feature.id} ${feature.title} — ${clip(waitReason, 72)}`);
    }
    if (summary.waiting.length > 2) rows.push(`  ⏳ +${summary.waiting.length - 2} more waiting features`);
    rows.push("");
  }

  // Milestones
  for (const milestone of mission.milestones) {
    const mDone = milestone.features.filter((f) => f.status === "done").length;
    const mTotal = milestone.features.length;
    const mPct = mTotal ? Math.round((mDone / mTotal) * 100) : 0;

    // Collapsed: skip fully-done milestones (just show summary line)
    if (milestone.status === "complete" && mDone === mTotal) {
      rows.push(`  ✅ ${milestone.id}: ${milestone.title} — all ${mTotal} features done`);
      continue;
    }

    const msIcon = milestone.status === "active" ? "➡️" : milestone.status === "complete" ? "✅" : "•";
    rows.push(`  ${msIcon} ${milestone.id}: ${milestone.title}`);
    rows.push(`     ${milestoneProgressBar(milestone)} ${mDone}/${mTotal} — ${mPct}%`);

    // Sort: active first, then pending, blocked, failed, done last
    const order: Record<string, number> = { active: 0, pending: 1, waiting: 2, blocked: 3, failed: 4, done: 5 };
    const sorted = [...milestone.features].sort(
      (a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5) || a.priority - b.priority
    );

    for (const feature of sorted) {
      const fIcon = feature.status === "done" ? "✅" : feature.status === "active" ? "➡️" : feature.status === "waiting" ? "⏳" : feature.status === "blocked" ? "⛔" : feature.status === "failed" ? "❌" : "•";
      const deps = feature.dependsOn.length ? ` 🔗${feature.dependsOn.join(",")}` : "";
      const blocked = feature.status === "blocked" && feature.notes ? ` ↳ ${feature.notes.slice(0, 50)}` : "";
      const failedTag = feature.status === "failed" ? " [failed]" : "";
      const verifiedCount = feature.acceptance.filter((ac) => ac.verified || ac.waived).length;
      const acBadge = feature.acceptance.length ? ` [${verifiedCount}/${feature.acceptance.length} AC]` : "";

      // Active feature — expand with details
      if (feature.status === "active") {
        rows.push(`       ${fIcon} ${feature.id} [P${feature.priority}] ${feature.title}${acBadge}${deps}`);
        const details = activeFeatureDetails(feature);
        for (const d of details) rows.push(d);
        rows.push(`   👉 Next action: ${deriveNextAction(feature)}`);
        rows.push(`   🤝 Handoff: ${summary.handoff}`);
      } else {
        rows.push(`       ${fIcon} ${feature.id} [P${feature.priority}] ${feature.title}${acBadge}${deps}${blocked}${failedTag}`);
      }
    }
    rows.push("");
  }

  // Quick reference footer
  rows.push("  " + "─".repeat(76));
  rows.push(`  Commands: /mission run | pause | resume | stop | autopilot | next | done | block | status | dashboard`);
  rows.push("");
  return rows;
}

export function statusText(mission: MissionState): string {
  const p = progress(mission);
  const summary = buildMissionControlSummary(mission);
  const active = summary.active;
  const lines = [
    `🎯 Mission: ${mission.title}`,
    `ID: ${mission.id}`,
    `Status: ${mission.status}`,
    `Goal: ${mission.goal}`,
    `Progress: ${p.done}/${p.total} (${p.pct}%)`,
    active ? `Active: ${active.id} — ${active.title}` : "Active: none",
    `Blocked/Waiting: ${summary.blocked.length}/${summary.waiting.length}`,
    `Next action: ${active ? deriveNextAction(active) : summary.nextFeature ? `Start ${summary.nextFeature.id} — ${summary.nextFeature.title}` : "None"}`,
    `Handoff: ${summary.handoff}`,
    `Autopilot: ${mission.autopilot.enabled ? "ON" : "OFF"} (${mission.autopilot.mode})`,
    `Iteration: ${mission.autopilot.iteration}/${mission.autopilot.maxIterations}`,
    `Failures: ${mission.autopilot.consecutiveFailures}/${mission.autopilot.maxConsecutiveFailures}`,
    `No-progress: ${mission.autopilot.noProgressTurns}/${mission.autopilot.maxNoProgressTurns}`,
    `Last continuation: ${mission.autopilot.lastContinuationAt ?? "never"}`,
    `Last stop: ${mission.autopilot.lastStopReason ?? "none"}${mission.autopilot.lastStopMessage ? ` - ${mission.autopilot.lastStopMessage}` : ""}`,
    "",
  ];

  for (const milestone of mission.milestones) {
    const mi = milestone.status === "complete" ? "✅" : milestone.status === "active" ? "➡️" : "•";
    const mDone = milestone.features.filter((f) => f.status === "done").length;
    lines.push(`${mi} ${milestone.id}: ${milestone.title} [${mDone}/${milestone.features.length}]`);
    for (const feature of milestone.features) {
      const mark = feature.status === "done" ? "✅" : feature.status === "active" ? "➡️" : feature.status === "waiting" ? "⏳" : feature.status === "blocked" ? "⛔" : "•";
      const blocked = feature.status === "blocked" && feature.notes ? ` — ${feature.notes.slice(0, 50)}` : "";
      lines.push(`  ${mark} ${feature.id}: ${feature.title} (${feature.status})${blocked}`);
    }
  }
  return lines.join("\n");
}
