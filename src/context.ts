import { getActiveFeature, getAllFeatures, progress } from "./state.js";
import type { Feature, MissionState } from "./types.js";

export function buildMissionContext(mission: MissionState): string {
  const active = getActiveFeature(mission);
  const p = progress(mission);
  const doneRecent = getAllFeatures(mission).filter((f) => f.status === "done").slice(-5);
  const pendingCount = getAllFeatures(mission).filter((f) => f.status === "pending").length;

  const lines = [
    `## Active Mission: ${mission.title}`,
    `Mission ID: ${mission.id}`,
    `Goal: ${mission.goal}`,
    `Progress: ${p.done}/${p.total} features (${p.pct}%)`,
    `Status: ${mission.status}`,
  ];

  if (active) {
    lines.push("", `### Current Feature: ${active.id} — ${active.title}`, active.description);
    lines.push("", "Acceptance criteria:");
    for (const ac of active.acceptance) lines.push(`- [${ac.verified || ac.waived ? "x" : " "}] ${ac.id}: ${ac.description}`);
    if (active.dependsOn.length) lines.push(`Dependencies: ${active.dependsOn.join(", ")}`);
  }

  if (doneRecent.length) {
    lines.push("", "### Recently completed");
    for (const f of doneRecent) lines.push(`- ✅ ${f.id}: ${f.title}`);
  }
  if (pendingCount) lines.push("", `(${pendingCount} pending features omitted; use /mission status for full overview.)`);
  lines.push("", "Mission rule: work only on the active feature unless the user or /mission next changes it.");
  return lines.join("\n");
}

export function buildCompactionSummary(mission: MissionState): string {
  const active = getActiveFeature(mission);
  const p = progress(mission);
  return [
    `Mission: ${mission.title}`,
    `Mission ID: ${mission.id}`,
    `Goal: ${mission.goal}`,
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
