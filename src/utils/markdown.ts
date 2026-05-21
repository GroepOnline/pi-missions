import { Type } from "@sinclair/typebox";
import type { Feature, Milestone, MissionState } from "../core/types.js";
import { SCHEMA_VERSION, type WizardOutput } from "../core/types.js";
import { createMissionId, createValidationToken } from "./fs.js";
import {
  acceptanceProgress, featureStatusIcon, missionStatusIcon,
  progressBar, clip,
} from "./context.js";
import { getActiveFeature, getAllFeatures, progress, readHistory } from "../core/state.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { missionDirSafe } from "./fs.js";

// ═══════════════════════════════════════════════════════════════════════════
// Mission templates
// ═══════════════════════════════════════════════════════════════════════════

export interface MissionTemplate {
  id: string;
  label: string;
  description: string;
  goal: string;
  constraints: string;
}

export const MISSION_TEMPLATES: MissionTemplate[] = [
  {
    id: "refactor", label: "Refactor", description: "Safely refactor legacy code",
    goal: "Refactor a module or subsystem to improve maintainability without changing behavior.",
    constraints: "Existing tests must pass. No behavior changes. Keep the public API compatible.",
  },
  {
    id: "fix-bug", label: "Fix Bug", description: "Investigate and fix a bug",
    goal: "Identify the root cause of a reported bug and apply the minimal fix.",
    constraints: "Add a regression test. Do not refactor unrelated code. Verify the fix with evidence.",
  },
  {
    id: "add-feature", label: "Add Feature", description: "Implement a new feature",
    goal: "Implement a new capability or endpoint according to the specification.",
    constraints: "Add tests for the new functionality. Keep changes minimal and focused.",
  },
  {
    id: "docs", label: "Document", description: "Generate or update documentation",
    goal: "Produce accurate, verified documentation for a module, API, or workflow.",
    constraints: "Docs must be accurate and reflect current behavior. No stub or TODO content. Rendered output must be verified.",
  },
  {
    id: "investigate", label: "Investigate", description: "Research and analyze a codebase question",
    goal: "Answer a technical question about the codebase through exploration.",
    constraints: "Read-only exploration. No code changes. Provide evidence from the codebase.",
  },
  {
    id: "auth", label: "Auth implementation", description: "Implement authentication in a codebase",
    goal: "Add or refactor authentication in a codebase.",
    constraints: "Implement secure auth patterns. Add tests. Verify with evidence.",
  },
  {
    id: "ci-cd", label: "CI/CD Pipeline", description: "Set up or improve CI/CD pipeline",
    goal: "Implement or improve CI/CD pipeline.",
    constraints: "Ensure robust pipeline configuration. Verify with test runs.",
  },
  {
    id: "security-audit", label: "Security Audit", description: "Find and fix security vulnerabilities",
    goal: "Identify security vulnerabilities in a module, API, or workflow and document findings.",
    constraints: "Do not make permanent changes without explicit user approval. Document all findings with evidence. Prioritize critical/high severity issues.",
  },
  {
    id: "performance-opt", label: "Performance Optimization", description: "Improve performance of existing code",
    goal: "Identify and eliminate performance bottlenecks in a module or subsystem.",
    constraints: "Measure before and after. Do not degrade correctness or readability. Target meaningful improvements (≥20% speedup or ≥50% memory reduction).",
  },
];

export function createMissionFromTemplate(templateId: string, title: string): MissionState | null {
  const t = MISSION_TEMPLATES.find(t => t.id === templateId);
  if (!t) return null;
  return createStructuredMission(title || t.label, t.goal, t.constraints);
}

// ═══════════════════════════════════════════════════════════════════════════
// Mission builder
// ═══════════════════════════════════════════════════════════════════════════

export function createStructuredMission(title: string, goal: string, constraints: string): MissionState {
  const id = createMissionId(title);
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id, title, goal,
    status: "active",
    activeMilestoneId: "M01", activeFeatureId: "F001",
    tokensUsed: 0, lastContextTokens: 0,
    validationToken: createValidationToken(),
    autopilot: {
      enabled: false, mode: "manual", iteration: 0, maxIterations: 25,
      consecutiveFailures: 0, maxConsecutiveFailures: 3,
      noProgressTurns: 0, maxNoProgressTurns: 3, maxContextPercent: 85,
      startedAt: new Date(now).toISOString(), continueAcrossFeatures: true,
      requireEvidenceForDone: true,
    },
    createdAt: now, updatedAt: now,
    milestones: [
      {
        id: "M01", title: "Plan and execute",
        description: constraints ? `Constraints: ${constraints}` : "Initial execution milestone",
        status: "active",
        features: [
          { id: "F001", milestoneId: "M01", title: "Clarify scope and current state", description: "Read the repository, identify relevant files, constraints, and existing behavior.", priority: 1, dependsOn: [], status: "active", sessions: [], toolCallCount: 0, startedAt: now, acceptance: [{ id: "AC001", description: "Relevant files and constraints documented", checkType: "manual", verified: false }] },
          { id: "F002", milestoneId: "M01", title: "Implement the core change", description: "Make the smallest coherent implementation that satisfies the mission goal.", priority: 2, dependsOn: ["F001"], status: "pending", sessions: [], toolCallCount: 0, acceptance: [{ id: "AC001", description: "Implementation matches mission goal", checkType: "manual", verified: false }] },
          { id: "F003", milestoneId: "M01", title: "Verify and summarize", description: "Run relevant checks, capture evidence, and summarize results.", priority: 3, dependsOn: ["F002"], status: "pending", sessions: [], toolCallCount: 0, acceptance: [{ id: "AC001", description: "Verification evidence saved", checkType: "manual", verified: false }] },
        ],
      },
    ],
  };
}

export function missionFromWizardOutput(raw: WizardOutput, title: string, goal: string): MissionState | null {
  const milestones = raw.milestones || [];
  if (milestones.length < 2) return null;

  const id = createMissionId(title);
  const now = Date.now();

  // ── Pass 1: Reassign global sequential feature IDs ───────────────────────
  // Build per-feature mapping: (oldId → newId)
  const mapping: Array<{ oldId: string; newId: string }> = [];
  let counter = 0;
  const intermediate = milestones.map((m, mi) => ({
    ...m,        features: (m.features || []).map((f) => {
      const newId = `F${String(++counter).padStart(3, "0")}`;
      mapping.push({ oldId: f.id as string, newId });
      return { ...f, id: newId, dependsOn: [] as string[] };
    }),
  }));

  // ── Build lookups ─────────────────────────────────────────────────────────
  // oldId → set of newIds (may be multiple if old IDs were duplicated)
  const oldToNewSet = new Map<string, string[]>();
  for (const { oldId, newId } of mapping) {
    const arr = oldToNewSet.get(oldId) || [];
    arr.push(newId);
    oldToNewSet.set(oldId, arr);
  }

  // Wizard features flat list with original milestone/index for dep resolution
  const wizardFeatures = milestones.flatMap((wm, mi) =>
    wm.features.map((wf) => ({ ...wf, _mi: mi }))
  );

  // ── Pass 2: Remap dependencies using 1:1 mapping index ───────────────────
  let mapIdx = 0;
  for (let mi = 0; mi < intermediate.length; mi++) {
    const m = intermediate[mi]!;
    for (let fi = 0; fi < m.features.length; fi++) {
      const f = m.features[fi]!;
      mapIdx++;
      const orig = wizardFeatures[mapIdx - 1];
      if (!orig) continue;

      f.dependsOn = (orig.dependsOn || [])
        .filter((d: string) => oldToNewSet.has(d))
        .map((d: string) => {
          const candidates = oldToNewSet.get(d)!;
          // Resolve each candidate to its wizard feature via the 1:1 mapping index
          const resolveMilestone = (cid: string): number | undefined => {
            const idx = mapping.findIndex(me => me.newId === cid);
            return idx >= 0 ? wizardFeatures[idx]?._mi : undefined;
          };
          // Prefer candidate in the same original milestone
          const sameMilestone = candidates.find(cid => resolveMilestone(cid) === orig._mi);
          if (sameMilestone) return sameMilestone;
          // Next, prefer strictly earlier milestone candidates
          const earlier = candidates.find(cid => {
            const mi = resolveMilestone(cid);
            return mi !== undefined && mi < (orig._mi ?? 99);
          });
          if (earlier) return earlier;
          // Fallback to first candidate (will be validated later)
          return candidates[0]!;
        });
    }
  }

  // ── Build final migrated milestones ───────────────────────────────────────
  const migrated: Milestone[] = intermediate.map((m, mi) => {
    const milestoneId: string = (m.id ?? `M${String(mi + 1).padStart(2, "0")}`) as string;
    return {
      id: milestoneId,
      title: m.title,
      description: m.description || "",
      status: mi === 0 ? "active" : "pending" as Milestone["status"],
      dependsOn: mi > 0 ? [milestones[mi - 1].id || `M${String(mi).padStart(2, "0")}`] : undefined,
      features: m.features.map((f, fi) => {
        const fid: string = f.id as string;
        return {
          id: fid,
          milestoneId,
          title: f.title,
          description: f.description || "",
          priority: f.priority || 1,
          dependsOn: f.dependsOn,
          status: mi === 0 && fi === 0 ? "active" : "pending" as Feature["status"],
          sessions: [],
          toolCallCount: 0,
          acceptance: (f.acceptance || []).map((ac, ai) => ({
            id: ac.id || `AC${String(ai + 1).padStart(3, "0")}`,
            description: ac.description,
            checkType: ac.checkType || "manual",
            checkCommand: ac.checkCommand,
            verified: false,
          })),
        };
      }),
    };
  });

  const displayTitle = raw.title || title;
  return {
    schemaVersion: SCHEMA_VERSION, id, title: displayTitle, goal,
    status: "active", activeMilestoneId: migrated[0].id,
    activeFeatureId: migrated[0].features[0]?.id || "F001",
    tokensUsed: 0, lastContextTokens: 0, validationToken: createValidationToken(),
    autopilot: {
      enabled: false, mode: "manual", iteration: 0, maxIterations: 25,
      consecutiveFailures: 0, maxConsecutiveFailures: 3,
      noProgressTurns: 0, maxNoProgressTurns: 3, maxContextPercent: 85,
      startedAt: new Date(now).toISOString(), continueAcrossFeatures: true,
      requireEvidenceForDone: true,
    },
    createdAt: now, updatedAt: now, milestones: migrated,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Export helpers
// ═══════════════════════════════════════════════════════════════════════════


export function exportMarkdown(mission: MissionState): string {
  const p = progress(mission);
  const active = getActiveFeature(mission);
  const all = getAllFeatures(mission);
  const done = all.filter(f => f.status === "done");
  const lines = [
    `# Mission Report: ${mission.title}`,
    "",
    `- **Goal**: ${mission.goal}`,
    `- **Status**: ${mission.status}`,
    `- **Goal tree**: ${p.done}/${p.total} leaf goals (${p.pct}%)`,
    `- **Progress**: ${p.done}/${p.total} (${p.pct}%)`,
    `- **Tokens used**: ${mission.tokensUsed.toLocaleString()}`,
    `- **Created**: ${new Date(mission.createdAt).toISOString()}`,
    "",
    "## Executive Summary",
    "",
    active ? `**Active feature**: ${active.id} — ${active.title} [${active.status}]` : "**Active feature**: none",
    `**Handoff**: ${mission.autopilot.lastStopReason ?? "none"}${mission.autopilot.lastStopMessage ? ` - ${mission.autopilot.lastStopMessage}` : ""}`,
    "",
    "## Goal Tree",
    "",
  ];

  for (const m of mission.milestones) {
    const mDone = m.features.filter(f => f.status === "done").length;      lines.push(`## ${m.id}: ${m.title}`,
      `Status: ${m.status} | Progress: ${mDone}/${m.features.length}`,
      m.description ? `\n${m.description}\n` : "",
      `**Acceptance criteria:**`,
    );

    for (const f of m.features) {
      const icon = featureStatusIcon(f.status);
      const ac = acceptanceProgress(f);
      lines.push(`### ${f.id}: ${f.title}`,
        `- **Status**: ${f.status} | **Priority**: P${f.priority}`,
        `- **Acceptance**: ${ac.label}`,
        f.dependsOn.length ? `- **Dependencies**: ${f.dependsOn.join(", ")}` : "",
        f.notes ? `- **Notes**: ${f.notes}` : "",
        f.description ? `\n${f.description}\n` : "",
      );

      for (const a of f.acceptance) {
        const mark = a.verified || a.waived ? "✓" : "☐";
        const waived = a.waived ? " (waived)" : "";
        const cmd = a.checkCommand ? ` \`${a.checkCommand}\`` : "";
        lines.push(`- [${mark}] ${a.id}: ${a.description}${cmd}${waived}`);
      }
      lines.push("");
    }
  }

  // Evidence section
  if (done.length) {
    lines.push("", "## Evidence");
    for (const f of done) {
      const evidenceFile = path.join(missionDirSafe(mission.id), "evidence", `${f.id}.md`);
      if (fs.existsSync(evidenceFile)) {
        const evidence = fs.readFileSync(evidenceFile, "utf-8");
        lines.push(`### ${f.id}: ${f.title}`, "", evidence.trim(), "");
      }
    }
  }

  // History section
  const history = readHistory(mission.id);
  if (history.length) {
    lines.push("## Recent History");
    for (const h of history.slice(-10)) {
      const ts = new Date(h.ts * 1000).toISOString();
      lines.push(`- \`${ts}\` ${h.event}${h.featureId ? ` (${h.featureId})` : ""}${h.note ? ` - ${h.note}` : ""}`);
    }
    lines.push("");
  }

  // Next runnable
  const nextRunnable = getActiveFeature(mission) ?? getAllFeatures(mission).find(f => f.status === "pending" || f.status === "waiting");
  if (nextRunnable) {
    lines.push(`**Next runnable**: ${nextRunnable.id} — ${nextRunnable.title}`);
  }

  lines.push("---", `Generated by pi-missions at ${new Date().toISOString()}`);
  return lines.join("\n");
}
