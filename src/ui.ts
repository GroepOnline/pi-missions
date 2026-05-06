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
    `🎯 ${mission.title}`,
    `ID: ${mission.id}`,
    `Status: ${mission.status} | Progress: ${p.done}/${p.total} (${p.pct}%) | Tokens: ${mission.tokensUsed}`,
    "─".repeat(80),
  ];
  for (const milestone of mission.milestones) {
    rows.push(`## ${milestone.id} ${milestone.status} — ${milestone.title}`);
    for (const feature of milestone.features) {
      const mark = feature.status === "done" ? "✅" : feature.status === "active" ? "➡️" : feature.status === "blocked" ? "⛔" : "•";
      rows.push(`${mark} ${feature.id} [P${feature.priority}] ${feature.status.padEnd(8)} ${feature.title}`);
    }
  }
  return rows;
}

export function statusText(mission: MissionState): string {
  const p = progress(mission);
  const active = getActiveFeature(mission);
  return [
    `🎯 Mission: ${mission.title}`,
    `ID: ${mission.id}`,
    `Status: ${mission.status}`,
    `Progress: ${p.done}/${p.total} (${p.pct}%)`,
    active ? `Active: ${active.id} — ${active.title}` : "Active: none",
    "",
    ...getAllFeatures(mission).map((f) => `${f.status === "done" ? "✅" : f.status === "active" ? "➡️" : "•"} ${f.id}: ${f.title} (${f.status})`),
  ].join("\n");
}
