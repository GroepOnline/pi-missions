import * as fs from "node:fs";
import * as path from "node:path";
import type { MissionHistoryEntry, MissionState } from "./types.js";
import { getMissionGoalTree, goalTreeProgress, renderGoalTree } from "./mission-builder.js";
import { missionDirSafe, progress, readHistory } from "./state.js";
import { logger } from "./logger.js";
import { buildMissionControlSummary } from "./ui.js";

/** Generate a markdown report for a mission including evidence, history, and feature details. */
export function exportMarkdown(mission: MissionState): string {
  const p = progress(mission);
  const goalTree = getMissionGoalTree(mission);
  const goalProgress = goalTreeProgress(goalTree);
  const summary = buildMissionControlSummary(mission);
  let history: MissionHistoryEntry[] = [];
  try {
    history = readHistory(mission.id).slice(-50);
  } catch (error) {
    logger.warn("state", "Failed to read history for export", { missionId: mission.id, error: error instanceof Error ? error.message : String(error) });
  }

  const lines: string[] = [
    `# Mission Report: ${mission.title}`,
    "",
    `- **ID**: \`${mission.id}\``,
    `- **Status**: ${mission.status}`,
    `- **Goal**: ${mission.goal}`,
    `- **Goal tree**: ${goalProgress.done}/${goalProgress.total} leaf goals (${goalProgress.pct}%)`,
    `- **Progress**: ${p.done}/${p.total} (${p.pct}%)`,
    `- **Tokens used**: ${mission.tokensUsed}`,
    `- **Created**: ${new Date(mission.createdAt).toISOString()}`,
    `- **Updated**: ${new Date(mission.updatedAt).toISOString()}`,
    "",
    "## Mission Control Handoff",
    "",
    `- **Active feature**: ${summary.active ? `\`${summary.active.id}\` ${summary.active.title}` : "None"}`,
    `- **Blocked features**: ${summary.blocked.length}`,
    `- **Waiting features**: ${summary.waiting.length}`,
    `- **Next runnable feature**: ${summary.nextFeature ? `\`${summary.nextFeature.id}\` ${summary.nextFeature.title}` : "None"}`,
    `- **Handoff summary**: ${summary.handoff}`,
    "",
    "---",
    "",
  ];

  lines.push("## Goal Tree", "", ...renderGoalTree(goalTree, 20), "", "---", "");

  for (const m of mission.milestones) {
    const ms = m.status === "complete" ? "✅" : m.status === "active" ? "➡️" : "•";
    lines.push(`## ${ms} Milestone: ${m.title}`, "", m.description, "");
    for (const f of m.features) {
      const icon = f.status === "done" ? "✅" : f.status === "active" ? "➡️" : f.status === "blocked" ? "⛔" : "•";
      lines.push(`### ${icon} ${f.id}: ${f.title} (P${f.priority})`, "", f.description, "");
      if (f.acceptance.length) {
        lines.push("**Acceptance criteria:**", "");
        for (const ac of f.acceptance) lines.push(`- [${ac.verified || ac.waived ? "x" : " "}] ${ac.id}: ${ac.description}`);
        lines.push("");
      }
      if (f.dependsOn.length) lines.push(`**Dependencies:** ${f.dependsOn.join(", ")}`, "");
      if (f.notes) lines.push(`**Notes:** ${f.notes}`, "");
      if (f.completedAt) lines.push(`**Completed:** ${new Date(f.completedAt).toISOString()}`, "");
      const evidenceDir = path.join(missionDirSafe(mission.id), "evidence");
      const evidenceFile = path.join(evidenceDir, `${f.id}.md`);
      if (fs.existsSync(evidenceFile)) {
        const content = fs.readFileSync(evidenceFile, "utf-8").slice(0, 2000);
        lines.push("<details>", "<summary>Evidence</summary>", "", content, "", "</details>", "");
      }
      lines.push("---", "");
    }
  }

  if (history.length) {
    lines.push("## Recent History", "");
    for (const h of history) {
      const ts = new Date(h.ts * 1000).toISOString();
      lines.push(`- \`${ts}\` **${h.event}** ${h.featureId ?? ""} ${h.note ?? ""}`);
    }
  }

  return lines.join("\n");
}
