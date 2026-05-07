import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getActiveFeature, getAllFeatures, progress } from "./state.js";
import type { MissionState } from "./types.js";

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

export function dashboardRows(mission: MissionState): string[] {
  const p = progress(mission);
  const rows = [
    `${mission.status === "complete" ? "✅" : "🎯"} ${mission.title}`,
    `ID: ${mission.id}`,
    `Status: ${mission.status} | Progress: ${p.done}/${p.total} (${p.pct}%) | Tokens: ${mission.tokensUsed}`,
    "─".repeat(80),
  ];

  for (const milestone of mission.milestones) {
    const mi = milestone.status === "complete" ? "✅" : milestone.status === "active" ? "➡️" : "•";
    const mDone = milestone.features.filter((f) => f.status === "done").length;
    const mTotal = milestone.features.length;
    rows.push(`## ${mi} ${milestone.id}: ${milestone.title} [${mDone}/${mTotal}]`);
    
    // Sort by priority then status
    const sorted = [...milestone.features].sort((a, b) => {
      const order = { active: 0, pending: 1, blocked: 2, done: 3, failed: 4 };
      return (order[a.status] ?? 5) - (order[b.status] ?? 5) || a.priority - b.priority;
    });
    
    for (const feature of sorted) {
      const mark = feature.status === "done" ? "✅" : feature.status === "active" ? "➡️" : feature.status === "blocked" ? "⛔" : "•";
      const deps = feature.dependsOn.length ? ` (deps: ${feature.dependsOn.join(", ")})` : "";
      const note = feature.notes ? ` — ${feature.notes.slice(0, 40)}` : "";
      rows.push(`  ${mark} ${feature.id} [P${feature.priority}] ${feature.status.padEnd(8)} ${feature.title}${deps}${note}`);
    }
  }
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
