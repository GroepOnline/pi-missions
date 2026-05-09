import type { Feature, FeatureStatus, MissionState } from "./types.js";

export function clip(text: string, max = 88): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function progressBar(done: number, total: number, width = 16): string {
  if (total === 0) return `[${"░".repeat(width)}]`;
  const ratio = Math.max(0, Math.min(1, done / total));
  const filled = Math.round(ratio * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

export function featureStatusIcon(status: FeatureStatus | string): string {
  switch (status) {
    case "done": return "✅";
    case "active": return "➡️";
    case "blocked": return "⛔";
    case "failed": return "❌";
    case "waiting": return "⏳";
    case "pending":
    default: return "•";
  }
}

export function missionStatusIcon(status: MissionState["status"] | string): string {
  switch (status) {
    case "complete": return "✅";
    case "paused": return "⏸";
    case "blocked": return "⛔";
    case "budget_limited": return "⚠️";
    default: return "🎯";
  }
}

export function acceptanceProgress(feature: Feature): { done: number; total: number; label: string } {
  const done = feature.acceptance.filter((ac) => ac.verified || ac.waived).length;
  const total = feature.acceptance.length;
  return { done, total, label: `${done}/${total}` };
}

export function pendingAcceptance(feature: Feature, arrow = "→"): string[] {
  return feature.acceptance
    .filter((ac) => !ac.verified && !ac.waived)
    .map((ac) => ac.checkType === "bash" && ac.checkCommand ? `${ac.id}: ${ac.description} ${arrow} ${ac.checkCommand}` : `${ac.id}: ${ac.description}`);
}
