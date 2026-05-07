import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getActiveFeature, getAllFeatures, progress } from "./state.js";
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
  const icon = mission.status === "paused" ? "⏸" : mission.status === "budget_limited" ? "⚠️" : mission.status === "complete" ? "✅" : "🎯";
  ctx.ui.setStatus("pi-mission", `${icon} ${mission.title} [${p.done}/${p.total} ${p.pct}%]${active ? ` — ${active.title}` : ""}`);
}

// ────────────────────────────────────────────────────────────────────────────
// Factory Droid–style mission control dashboard
// ────────────────────────────────────────────────────────────────────────────
export function dashboardRows(mission: MissionState): string[] {
  const p = progress(mission);
  const statusIcon = mission.status === "complete" ? "✅" : mission.status === "paused" ? "⏸" : mission.status === "budget_limited" ? "⚠️" : "🎯";

  const rows: string[] = [
    "",
    `  ${statusIcon} ${mission.title}`,
    `     ${progressBar(p.done, p.total)} ${p.done}/${p.total} features — ${p.pct}%`, 
    `     ID: ${mission.id} | Status: ${mission.status} | Tokens: ${mission.tokensUsed.toLocaleString()}`,
    "  " + "─".repeat(76),
    "",
  ];

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
    const order: Record<string, number> = { active: 0, pending: 1, blocked: 2, failed: 3, done: 4 };
    const sorted = [...milestone.features].sort(
      (a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5) || a.priority - b.priority
    );

    for (const feature of sorted) {
      const fIcon = feature.status === "done" ? "✅" : feature.status === "active" ? "➡️" : feature.status === "blocked" ? "⛔" : feature.status === "failed" ? "❌" : "•";
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
      } else {
        rows.push(`       ${fIcon} ${feature.id} [P${feature.priority}] ${feature.title}${acBadge}${deps}${blocked}${failedTag}`);
      }
    }
    rows.push("");
  }

  // Quick reference footer
  rows.push("  " + "─".repeat(76));
  rows.push(`  Commands: /mission next | done | block | pause | resume | status | dashboard | export`);
  rows.push("");
  return rows;
}

export function statusText(mission: MissionState): string {
  const p = progress(mission);
  const active = getActiveFeature(mission);
  const lines = [
    `🎯 Mission: ${mission.title}`,
    `ID: ${mission.id}`,
    `Status: ${mission.status}`,
    `Progress: ${p.done}/${p.total} (${p.pct}%)`,
    active ? `Active: ${active.id} — ${active.title}` : "Active: none",
    "",
  ];

  for (const milestone of mission.milestones) {
    const mi = milestone.status === "complete" ? "✅" : milestone.status === "active" ? "➡️" : "•";
    const mDone = milestone.features.filter((f) => f.status === "done").length;
    lines.push(`${mi} ${milestone.id}: ${milestone.title} [${mDone}/${milestone.features.length}]`);
    for (const feature of milestone.features) {
      const mark = feature.status === "done" ? "✅" : feature.status === "active" ? "➡️" : feature.status === "blocked" ? "⛔" : "•";
      const blocked = feature.status === "blocked" && feature.notes ? ` — ${feature.notes.slice(0, 50)}` : "";
      lines.push(`  ${mark} ${feature.id}: ${feature.title} (${feature.status})${blocked}`);
    }
  }
  return lines.join("\n");
}
