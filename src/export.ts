import * as fs from "node:fs";
import * as path from "node:path";
import type { MissionHistoryEntry, MissionState } from "./types.js";
import { getMissionGoalTree, goalTreeProgress, renderGoalTree } from "./mission-builder.js";
import { getAllFeatures, missionDirSafe, progress, readHistory } from "./state.js";
import { logger } from "./logger.js";
import { buildMissionControlSummary } from "./ui.js";

/** Generate a structured markdown mission report. */
export function exportMarkdown(mission: MissionState): string {
  const p = progress(mission);
  const allFeatures = getAllFeatures(mission);
  const goalTree = getMissionGoalTree(mission);
  const goalProgress = goalTreeProgress(goalTree);
  const summary = buildMissionControlSummary(mission);
  const evidenceDir = path.join(missionDirSafe(mission.id), "evidence");
  const evidenceItems = allFeatures.flatMap((feature) => {
    const evidenceFile = path.join(evidenceDir, `${feature.id}.md`);
    return fs.existsSync(evidenceFile) ? [{ feature, evidenceFile }] : [];
  });
  let history: MissionHistoryEntry[] = [];
  try {
    history = readHistory(mission.id).slice(-50);
  } catch (error) {
    logger.warn("state", "Failed to read history for export", { missionId: mission.id, error: error instanceof Error ? error.message : String(error) });
  }

  const lines: string[] = [
    `# Mission Report: ${mission.title}`,
    "",
    "## Executive Summary",
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
    "### Active & Blocked",
    "",
    `- **Active feature**: ${summary.active ? `\`${summary.active.id}\` ${summary.active.title}` : "None"}`,
    `- **Blocked features**: ${summary.blocked.length}`,
    `- **Waiting features**: ${summary.waiting.length}`,
    `- **Next runnable**: ${summary.nextFeature ? `\`${summary.nextFeature.id}\` ${summary.nextFeature.title}` : "None"}`,
    `- **Handoff**: ${summary.handoff}`,
    "",
    "### Next Action",
    "",
    summary.active
      ? `Continue \`${summary.active.id}\` — ${summary.active.title}.`
      : summary.nextFeature
        ? `Start \`${summary.nextFeature.id}\` — ${summary.nextFeature.title}.`
        : "No runnable feature is queued.",
    "",
    "### Blockers",
    "",
    summary.blocked.length || summary.waiting.length
      ? [
          ...summary.blocked.map((feature) => `- ⛔ \`${feature.id}\` ${feature.title}: ${feature.notes ?? "No blocker note"}`),
          ...summary.waiting.map((feature) => `- ⏳ \`${feature.id}\` ${feature.title}: waiting on ${feature.dependsOn.join(", ") || "external dependency"}`),
        ].join("\n")
      : "- None",
    "",
    "### Evidence Index",
    "",
    evidenceItems.length
      ? evidenceItems.map(({ feature }) => `- \`${feature.id}\` ${feature.title}`).join("\n")
      : "- No evidence files saved yet",
    "",
    "---",
    "",
  ];

  lines.push("## Goal Tree", "", ...renderGoalTree(goalTree, 20), "", "---", "");

  for (const m of mission.milestones) {
    const ms = m.status === "complete" ? "✅" : m.status === "active" ? "➡️" : "•";
    const mDone = m.features.filter((f) => f.status === "done").length;
    lines.push(`## ${ms} Milestone: ${m.title}`, "", m.description, "");
    lines.push(`| ID | Status | Priority | AC Progress | Dependencies |`, `|----|--------|----------|------------|--------------|`);
    for (const f of m.features) {
      const icon = f.status === "done" ? "✅" : f.status === "active" ? "➡️" : f.status === "blocked" ? "⛔" : "•";
      const acDone = f.acceptance.filter((ac) => ac.verified || ac.waived).length;
      const acTotal = f.acceptance.length;
      const deps = f.dependsOn.length ? f.dependsOn.join(", ") : "—";
      lines.push(`| ${icon} \`${f.id}\` | ${f.status} | P${f.priority} | ${acDone}/${acTotal} | ${deps} |`);
    }
    lines.push("");

    for (const f of m.features) {
      if (f.status === "done" || f.status === "active") {
        lines.push(`### ${f.id}: ${f.title}`, "", f.description || "", "");
        if (f.acceptance.length) {
          lines.push("**Acceptance criteria:**", "");
          for (const ac of f.acceptance) {
            const mark = ac.verified || ac.waived ? "x" : " ";
            lines.push(`- [${mark}] ${ac.id}: ${ac.description}`);
          }
          lines.push("");
        }
        if (f.dependsOn.length) lines.push(`**Dependencies:** ${f.dependsOn.join(", ")}`, "");
        if (f.notes) lines.push(`**Notes:** ${f.notes}`, "");
        if (f.completedAt) lines.push(`**Completed:** ${new Date(f.completedAt).toISOString()}`, "");
        const evidenceFile = path.join(evidenceDir, `${f.id}.md`);
        if (fs.existsSync(evidenceFile)) {
          const content = fs.readFileSync(evidenceFile, "utf-8").slice(0, 2000);
          lines.push("<details>", "<summary>Evidence</summary>", "", content, "", "</details>", "");
        }
        lines.push("---", "");
      }
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
