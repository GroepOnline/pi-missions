// Re-export dashboard + internal functions needed by tests
import { missionControlOverlay as mco } from "./ui/dashboard.js";
import type { MissionState } from "./core/types.js";
import { acceptanceProgress, clip, featureStatusIcon, pendingAcceptance } from "./utils/context.js";
import type { Feature } from "./core/types.js";

export function missionControlOverlay(mission: MissionState, onSelect?: (featureId: string) => void) {
  // Cast: pi-tui Component type doesn't expose dispose, but v2 MissionControl has it
  return mco(mission, onSelect) as (tui: unknown) => { render(w: number): string[]; handleInput(d: string): boolean; dispose(): void; invalidate(): void };
}

// Internal test helpers — re-exported from the dashboard module
export {
  featureLabel,
  featureDescription,
  featureNextAction,
  buildFeatureItems,
  sessionMetricsLines,
} from "./ui/dashboard.js";

// ── featureDetailLines ───────────────────────────────────────────────────

export function featureDetailLines(feature: Feature, width: number): string[] {
  const bar = "─".repeat(Math.min(width - 2, 78));
  const ac = acceptanceProgress(feature);
  const lines: string[] = [bar];

  lines.push(`📋 ${feature.id} — ${feature.title}`);
  lines.push(`   Status: ${feature.status}   Priority: P${feature.priority}   Milestone: ${feature.milestoneId}`);

  const pending = pendingAcceptance(feature, "→");
  const nextAction = pending[0] ? `Finish: ${clip(pending[0], 72)}` : `Advance: ${clip(feature.description || feature.title, 72)}`;
  lines.push(`🎯 Next action: ${nextAction}`);
  lines.push(`📈 Acceptance progress: ${ac.done}/${feature.acceptance.length}`);

  if (feature.description) lines.push(`📝 ${clip(feature.description, 72)}`);
  if (feature.dependsOn.length) lines.push(`🔗 Depends on: ${feature.dependsOn.join(", ")}`);
  if (feature.notes) lines.push(`📌 Note: ${clip(feature.notes, 72)}`);

  if (feature.acceptance.length) {
    lines.push("✅ Acceptance criteria");
    for (const a of feature.acceptance) {
      const done = a.verified || a.waived;
      const icon = done ? "☑" : "☐";
      let line = `  ${icon} ${a.id}: ${a.description}`;
      if (a.checkType === "bash" && a.checkCommand && !a.verified) line += ` → ${a.checkCommand}`;
      lines.push(line);
    }
  }

  lines.push(bar);
  return lines;
}
