import { Type } from "@sinclair/typebox";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Feature, ForkSessionManager, ForkReplacementContext, MissionContextSessionManager, MissionState, RuntimeState, ToolPhase } from "../core/types.js";
import { TOOL_POLICIES } from "../core/types.js";
import {
  activateNextFeature, appendHistory, autoUnblockResolved,
  completeActiveFeature, getActiveFeature, getFeatureById, getMilestoneById,
  getNextPendingFeature, loadMissionFromDisk, saveMissionSafe,
} from "../core/state.js";
import { getCompletionDetector } from "../engines/completion.js";
import { getErrorRecoveryEngine } from "../engines/recovery.js";
import { spawnWorker, killWorker, isWorkerRunning, getActiveWorker } from "../engines/worker.js";
import { updateFooter } from "../ui/components.js";

// ═══════════════════════════════════════════════════════════════════════════
// Planning bash guard — read-only commands allowed in planning phase
// ═══════════════════════════════════════════════════════════════════════════

export const PLANNING_RO_BASH = new Set([
  "cat", "grep", "head", "ls", "pwd", "rg", "tail", "wc",
]);

function firstWord(cmd: string): string {
  const m = cmd.trim().match(/^([A-Za-z0-9_.-]+)/);
  return m?.[1] ?? "";
}

function hasOpt(cmd: string, opt: string): boolean {
  const escaped = opt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(cmd);
}

function isReadOnlyFind(cmd: string): boolean {
  return /^find(?:\s|$)/.test(cmd) && !/\s-(?:delete|exec|execdir|ok|okdir|fls|fprint|fprint0|fprintf)(?:\s|$)/.test(cmd);
}

function isReadOnlySed(cmd: string): boolean {
  return /^sed\s+-n(?:\s|$)/.test(cmd) && !hasOpt(cmd, "-i") && !hasOpt(cmd, "--in-place");
}

export function isReadOnlyPlanningBash(input: Record<string, unknown> | undefined): boolean {
  const cmd = typeof input?.command === "string" ? input.command.trim() : "";
  if (!cmd) return false;
  if (/[;&|`$<>\n\r\t]/.test(cmd)) return false;
  const w = firstWord(cmd);
  if (PLANNING_RO_BASH.has(w)) return true;
  // Require that the command doesn't contain a built-in tool that escapes bash like -exec or -e "eval"
  // But allow quotes for grep/rg/find.
  // Actually, we must use word tokenization or just block specific substrings entirely.
  // The vulnerability is that quotes bypass the regex checking flags.
  // Let's strip all quotes and backslashes before checking for bad flags.
  const strippedCmd = cmd.replace(/['"\\]/g, "");
  if (w === "find") return isReadOnlyFind(strippedCmd);
  if (w === "sed") return isReadOnlySed(strippedCmd);
  if (w === "git") return /^git\s+(?:status|diff|show|log)(?:\s|$)/.test(cmd);
  return false;
}

export function toolResultErrorMessage(event: { toolName: string; content?: Array<{ type?: string; text?: string }> }): string {
  const text = event.content
    ?.filter(c => c?.type === "text" && typeof c.text === "string")
    .map(c => c.text).join("\n").trim();
  return text || `Tool '${event.toolName}' failed`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Fork helpers (inline — consolidated from fork-utils.ts)
// ═══════════════════════════════════════════════════════════════════════════

export function cloneFeatureForFork(feature: Feature, id: string, title: string, notes: string): Feature {
  const acLen = feature.acceptance.length;
  const newAcceptance = new Array(acLen);
  for (let i = 0; i < acLen; i++) {
    const ac = feature.acceptance[i];
    newAcceptance[i] = { ...ac, verified: false, evidence: undefined };
  }
  return {
    ...feature, id, title, status: "active", notes,
    completedAt: undefined, dependsOn: [...feature.dependsOn], sessions: [...feature.sessions],
    acceptance: newAcceptance,
  };
}

export function appendForkNote(existing: string | undefined, entries: string[]): string {
  const filtered = entries.filter(Boolean);
  return existing ? `${existing}\n\n${filtered.join("\n")}` : filtered.join("\n");
}

export function pushSessionRef(feature: Feature, ref: string | undefined): void {
  if (ref) feature.sessions.push(ref);
}

export function buildForkKickoffMessage(
  missionTitle: string, source: Feature, forked: Feature, reason: string,
  subtask: string | undefined, parentSessionFile: string | undefined,
): string {
  const lines = [
    `## Forked Mission: ${missionTitle}`,
    `Source: ${source.id} — ${source.title}`,
    `Fork: ${forked.id} — ${forked.title}`,
    `Reason: ${reason}`,
  ];    if (subtask) lines.push(`Subtask: ${subtask}`);
  if (parentSessionFile) lines.push(`Parent session: ${parentSessionFile}`);
  lines.push(
    "", `Active fork feature: ${forked.id} — ${forked.title}`,
    "Continue mission: work ONLY on the forked feature. When complete:",
    `1. Call mission_feature_done with evidence.`,
    `2. The original ${source.id} is blocked — the user will resolve it.`,
  );
  return lines.join("\n");
}

export function buildManualForkHandoff(
  missionTitle: string, source: Feature, forked: Feature, reason: string,
  parentLeafId: string | null, parentSessionFile: string | undefined,
): string {
  const lines = [
    `🔀 Manual fork handoff for ${missionTitle}:`,
    `   Source: ${source.id} — ${source.title}`,
    `   Fork: ${forked.id} — ${forked.title}`,
    `   Reason: ${reason}`,
  ];
  if (parentLeafId) lines.push(`   Parent leaf: ${parentLeafId}`);
  if (parentSessionFile) lines.push(`   Parent session: ${parentSessionFile}`);
  lines.push(
    "", "Action: open or clone a new Pi session and load this mission via /mission load <id>.",
    `Focus on: ${forked.id} — ${forked.title}`,
  );
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// Inject mission context
// ═══════════════════════════════════════════════════════════════════════════

export function injectMissionContext(pi: ExtensionAPI, ctx: ExtensionCommandContext, mission: MissionState, reason: string, content: string): void {
  const details = { missionId: mission.id, reason, injectedAt: Date.now() };
  const sm = ctx.sessionManager as MissionContextSessionManager;
  if (typeof sm.appendCustomMessageEntry === "function") {
    sm.appendCustomMessageEntry("pi-mission-context", content, false, details);
  }
  pi.appendEntry("pi-mission-context", { ...details, content });
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool policy enforcement (for use by extension.ts)
// ═══════════════════════════════════════════════════════════════════════════

export function enforceToolPolicy(
  toolName: string,
  phase: ToolPhase,
  input: Record<string, unknown> | undefined,
  allowBashInPlanning: boolean,
  toolCallCount: number,
): { blocked: true; reason: string } | { blocked: false } {
  const policy = TOOL_POLICIES[phase];
  if (policy.allowedTools.includes(toolName)) return { blocked: false };

  const allowedBash = phase === "planning" && toolName === "bash" && (allowBashInPlanning || isReadOnlyPlanningBash(input));
  if (allowedBash) return { blocked: false };

  if (phase === "planning" && toolName === "bash") {
    return { blocked: true, reason: "Tool 'bash' is only allowed in planning phase for single read-only commands: pwd, ls, find, grep, rg, cat, sed -n, head, tail, wc, git status/diff/show/log." };
  }
  return { blocked: true, reason: `'${toolName}' not allowed in ${phase}. Allowed: ${policy.allowedTools.join(", ")}` };
}

export function enforceToolMax(phase: ToolPhase, count: number): { blocked: true; reason: string } | { blocked: false } {
  const max = TOOL_POLICIES[phase].maxToolCalls;
  if (count > max) return { blocked: true, reason: `Max tool calls (${max}) exceeded for ${phase} phase.` };
  return { blocked: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool registration
// ═══════════════════════════════════════════════════════════════════════════

export function registerMissionTools(_pi: ExtensionAPI, runtime: RuntimeState): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pi = _pi as unknown as { registerTool: (def: Record<string, unknown>) => void };
  // ── mission_feature_done ──────────────────────────────────────────────

  pi.registerTool({
    name: "mission_feature_done",
    label: "Mission Feature Done",
    description: "Mark the active mission feature as done with evidence.",
    promptSnippet: "Mark the active mission feature as done with evidence",
    promptGuidelines: ["Use only after all acceptance criteria are satisfied and evidence is available."],
    parameters: Type.Object({
      evidence: Type.String({ description: "Completion evidence" }),
      notes: Type.Optional(Type.String({ description: "Optional notes" })),
    }),
    async execute(_id: string, params: Record<string, unknown>, _sig: unknown, _upd: unknown, ctx: ExtensionCommandContext) {
      const m = runtime.activeMission;
      const f = m ? getActiveFeature(m) : null;
      if (!m || !f) return { isError: true, content: [{ type: "text", text: "No active mission feature." }], details: {} };

      const result = completeActiveFeature(m, {
        evidence: String(params.evidence ?? ""),
        notes: typeof params.notes === "string" ? params.notes : undefined,
      });
      if (!result.ok) return { isError: true, content: [{ type: "text", text: `${result.reason}\nUse /mission edit to waive criteria.` }], details: {} };

      await saveMissionSafe(m);
      updateFooter(ctx, m);
      return { content: [{ type: "text", text: `✅ Feature ${result.feature.id} done. Evidence: ${result.evidenceFile}` }], details: { featureId: result.feature.id, evidenceFile: result.evidenceFile }, isError: false };
    },
  });

  // ── mission_next_feature ──────────────────────────────────────────────

  pi.registerTool({
    name: "mission_next_feature",
    label: "Next Feature",
    description: "Advance to the next pending mission feature.",
    parameters: Type.Object({}),
    async execute(_id: string, _p: unknown, _sig: unknown, _upd: unknown, ctx: ExtensionCommandContext) {
      const m = runtime.activeMission;
      if (!m) return { isError: true, content: [{ type: "text", text: "No active mission." }], details: {} };

      const result = activateNextFeature(m);
      if (!result.ok) {
        if (result.reason === "active_not_done") {
          return { isError: true, content: [{ type: "text", text: `Active feature not done yet: ${result.active.id} — ${result.active.title}. Use mission_feature_done or /mission block.` }], details: {} };
        }
        if (result.reason === "mission_complete") {
          await saveMissionSafe(m); updateFooter(ctx, m);
          return { content: [{ type: "text", text: "🎉 Mission complete." }], details: { missionId: m.id }, isError: false };
        }
        return { isError: true, content: [{ type: "text", text: "No unblocked pending feature found." }], details: {} };
      }

      await saveMissionSafe(m); updateFooter(ctx, m);
      return { content: [{ type: "text", text: `➡️ Active feature: ${result.next.id} — ${result.next.title}\n${result.next.description}` }], details: { feature: result.next }, isError: false };
    },
  });

  // ── mission_ask_user ──────────────────────────────────────────────────

  pi.registerTool({
    name: "mission_ask_user",
    label: "Ask User",
    description: "Ask the user a question during mission execution.",
    promptSnippet: "Ask the user a question",
    promptGuidelines: [
      "Use when you need user input to proceed.",
      "Use 'confirm' for yes/no, 'select' for choices, 'input' for text.",
      "Always provide a sensible default.",
    ],
    parameters: Type.Object({
      question: Type.String({ description: "The question to ask" }),
      questionType: Type.Optional(Type.String({ description: "input, confirm, or select", enum: ["input", "confirm", "select"] })),
      options: Type.Optional(Type.Array(Type.String({ description: "Options for select" }))),
      defaultValue: Type.Optional(Type.String({ description: "Default value" })),
      context: Type.Optional(Type.String({ description: "Additional context" })),
    }),
    async execute(_id: string, params: Record<string, unknown>, _sig: unknown, _upd: unknown, ctx: ExtensionCommandContext) {
      const m = runtime.activeMission;
      if (!m) throw new Error("No active mission.");
      const f = getActiveFeature(m);

      m.autopilot.enabled = false;
      m.autopilot.lastStopReason = "needs_user_decision";
      m.autopilot.lastStopMessage = String(params.question ?? "");

      appendHistory(m, { event: "user_asked", featureId: f?.id, note: `Q: ${params.question}`, details: { questionType: params.questionType, options: params.options, defaultValue: params.defaultValue } });

      const qType = String(params.questionType ?? "input");
      const dflt = typeof params.defaultValue === "string" ? params.defaultValue : null;
      let answer: string | null = null;
      let source = "no_ui";

      if (ctx.hasUI) {
        try {
          switch (qType) {
            case "confirm":
              answer = await ctx.ui.confirm(String(params.question ?? ""), String(params.context ?? "")) ? "yes" : "no";
              break;
            case "select": {
              const opts = Array.isArray(params.options) ? params.options.map(String) : [];
              if (!opts.length) throw new Error("Select requires options");
              const choice = await ctx.ui.select(String(params.question ?? ""), opts);
              answer = choice || dflt || null;
              break;
            }
            default:
              answer = await ctx.ui.input(String(params.question ?? ""), String(params.context ?? "")) || dflt || null;
          }
          source = "ui";
        } catch { answer = dflt; source = "default"; }
      } else {
        answer = dflt || "[No UI available]";
      }

      if (f) appendHistory(m, { event: "user_answered", featureId: f.id, note: `A: ${answer}`, details: { answer, answerSource: source, questionType: qType } });
      if (answer === "ALLOW_BASH_IN_PLANNING") {
        m.userPreferences = m.userPreferences ?? {};
        m.userPreferences.allowBashInPlanning = true;
        await saveMissionSafe(m);
      }

      return { content: [{ type: "text", text: `User answered: ${answer}${source !== "ui" ? ` (via ${source})` : ""}` }], details: { question: params.question, answer, answerSource: source }, isError: false };
    },
  });

  // ── mission_block_self ────────────────────────────────────────────────

  pi.registerTool({
    name: "mission_block_self",
    label: "Block Self",
    description: "Block the current feature when stuck.",
    promptSnippet: "Block the current feature",
    promptGuidelines: ["Use when stuck. Provide a clear reason."],
    parameters: Type.Object({
      reason: Type.String({ description: "Reason for blocking" }),
      context: Type.Optional(Type.String({ description: "Additional context" })),
    }),
    async execute(_id: string, params: Record<string, unknown>, _sig: unknown, _upd: unknown, ctx: ExtensionCommandContext) {
      const m = runtime.activeMission;
      const f = m ? getActiveFeature(m) : null;
      if (!m || !f) throw new Error("No active feature.");

      f.status = "blocked";
      f.notes = `Self-blocked: ${params.reason}${params.context ? `\n\nContext: ${params.context}` : ""}`;
      m.status = "blocked";
      m.autopilot.enabled = false;
      m.autopilot.lastStopReason = "blocked";
      m.autopilot.lastStopMessage = String(params.reason ?? "");
      appendHistory(m, { event: "feature_blocked", featureId: f.id, note: String(params.reason ?? ""), details: { context: params.context, self: true } });

      autoUnblockResolved(m);
      const next = getNextPendingFeature(m);
      if (next) {
        next.status = "active"; m.status = "active"; m.activeFeatureId = next.id; m.activeMilestoneId = next.milestoneId;
        m.autopilot.lastStopReason = undefined; m.autopilot.lastStopMessage = undefined;
        appendHistory(m, { event: "feature_active", featureId: next.id, note: "Auto-advanced after self-block" });
        await saveMissionSafe(m); updateFooter(ctx, m);
        return { content: [{ type: "text", text: `🚫 Self-blocked ${f.id}: ${params.reason}\n➡️ Auto-advanced to ${next.id} — ${next.title}` }], details: { featureId: f.id, nextFeatureId: next.id }, isError: false };
      }
      await saveMissionSafe(m); updateFooter(ctx, m);
      throw new Error(`Self-blocked ${f.id}: ${params.reason}. No pending features available.`);
    },
  });

  // ── mission_fork ──────────────────────────────────────────────────────

  pi.registerTool({
    name: "mission_fork",
    label: "Fork Feature",
    description: "Fork the current feature into a separate session.",
    promptSnippet: "Fork the current feature",
    promptGuidelines: ["Use for parallel work or isolation. Provide a clear reason."],
    parameters: Type.Object({
      reason: Type.String({ description: "Reason for forking" }),
      subtask: Type.Optional(Type.String({ description: "Specific subtask" })),
    }),
    async execute(_id: string, params: Record<string, unknown>, _sig: unknown, _upd: unknown, ctx: ExtensionCommandContext) {
      const m = runtime.activeMission;
      const f = m ? getActiveFeature(m) : null;
      if (!m || !f) throw new Error("No active feature.");

      const sm = ctx.sessionManager as ForkSessionManager;
      const reason = String(params.reason ?? "Alternative approach");
      const parentLeafId = sm.getLeafId?.() ?? null;
      const parentSessionFile = sm.getSessionFile?.();
      const createdAt = new Date().toISOString();
      const forked = cloneFeatureForFork(f, `${f.id}-fork-${Date.now()}`, `${f.title} [fork]`, `Fork: ${reason}${params.subtask ? ` (${params.subtask})` : ""}`);
      const milestone = getMilestoneById(m, f.milestoneId);
      if (!milestone) return { isError: true, content: [{ type: "text", text: "Milestone not found." }], details: {} };

      f.status = "blocked";
      f.notes = appendForkNote(f.notes, [`Forked at ${createdAt}`, `Fork: ${forked.id}`, `Reason: ${reason}`, params.subtask ? `Subtask: ${params.subtask}` : "", parentLeafId ? `Leaf: ${parentLeafId}` : "", parentSessionFile ? `Session: ${parentSessionFile}` : ""]);
      pushSessionRef(f, `fork:${forked.id}`); pushSessionRef(f, parentLeafId ? `leaf:${parentLeafId}` : undefined); pushSessionRef(f, parentSessionFile ? `session:${parentSessionFile}` : undefined);

      forked.notes = appendForkNote(forked.notes, [`Fork source: ${f.id}`, `Created: ${createdAt}`, `Reason: ${reason}`, params.subtask ? `Subtask: ${params.subtask}` : "", parentSessionFile ? `Parent session: ${parentSessionFile}` : ""]);
      pushSessionRef(forked, `parent-feature:${f.id}`); pushSessionRef(forked, parentLeafId ? `parent-leaf:${parentLeafId}` : undefined); pushSessionRef(forked, parentSessionFile ? `parent-session:${parentSessionFile}` : undefined);

      milestone.features.push(forked);
      m.activeFeatureId = forked.id; m.activeMilestoneId = forked.milestoneId; m.status = "active";
      appendHistory(m, { event: "feature_forked", featureId: f.id, note: reason, details: { subtask: params.subtask, self: true, forkedFeatureId: forked.id, parentLeafId, parentSessionFile, forkApiAvailable: typeof ctx.fork === "function" } });
      await saveMissionSafe(m);

      const kickoff = buildForkKickoffMessage(m.title, f, forked, reason, typeof params.subtask === "string" ? params.subtask : undefined, parentSessionFile);
      const manual = buildManualForkHandoff(m.title, f, forked, reason, parentLeafId, parentSessionFile);

      if (parentLeafId && typeof ctx.fork === "function") {
        const result = await ctx.fork(parentLeafId, {
          position: "at",
          withSession: async (fc) => {
            const fcCtx = fc as unknown as ForkReplacementContext;
            const fsf = (fc.sessionManager as ForkSessionManager | undefined)?.getSessionFile?.();
            const pm = loadMissionFromDisk(m.id);
            const pf = pm ? getFeatureById(pm, forked.id) : null;
            if (pm && pf) {
              pushSessionRef(pf, fsf ? `session:${fsf}` : undefined);
              appendHistory(pm, { event: "feature_fork_session_created", featureId: forked.id, note: reason, details: { sourceFeatureId: f.id, subtask: params.subtask, forkSessionFile: fsf, parentLeafId, self: true } });
              await saveMissionSafe(pm);
            }
            if (typeof fc.sendUserMessage === "function") await fc.sendUserMessage(kickoff);
            else fc.ui.notify(`🌿 Fork active: ${forked.title}\n\n${kickoff}`, "info");
          },
        });
        if (!result?.cancelled) {
          return { content: [{ type: "text", text: `🔀 Forked ${f.id} into ${forked.id} — started a dedicated Pi session\n\n${kickoff}` }], details: { featureId: f.id, forkedFeatureId: forked.id, reason, subtask: params.subtask, mode: "fork_api" }, isError: false };
        }
      }

      return { content: [{ type: "text", text: `${manual}\n\nKickoff prompt:\n${kickoff}` }], details: { featureId: f.id, forkedFeatureId: forked.id, reason, subtask: params.subtask, mode: "manual" }, isError: false };
    },
  });

  // ── mission_error_status ──────────────────────────────────────────────

  pi.registerTool({
    name: "mission_error_status",
    label: "Error Status",
    description: "View error recovery statistics.",
    promptSnippet: "View error status",
    promptGuidelines: ["Check what errors occurred and their recovery status."],
    parameters: Type.Object({
      scope: Type.Optional(Type.String({ description: "'feature' or 'mission'", enum: ["feature", "mission"] })),
    }),
    async execute(_id: string, params: Record<string, unknown>, _sig: unknown, _upd: unknown, _ctx: ExtensionCommandContext) {
      const m = runtime.activeMission;
      if (!m) throw new Error("No active mission.");
      const f = getActiveFeature(m);
      const recovery = getErrorRecoveryEngine();
      const scope = String(params.scope ?? "feature");
      const errors = scope === "feature" && f ? recovery.getErrorsForFeature(f.id) : recovery.getErrorsForMission(m.id);
      const stats = recovery.getStats();

      if (!errors.length) {
        return { content: [{ type: "text", text: `✅ No errors for ${scope === "feature" ? `feature ${f?.id}` : "mission"}.\n\nTotal: ${stats.total}, resolved: ${stats.resolved}` }], details: { scope, errorCount: 0, stats }, isError: false };
      }

      const lines = [
        `📋 Error Status (${scope})`,
        `Total: ${errors.length}, Resolved: ${errors.filter(e => e.resolved).length}`,
        "", "Recent:",
        ...errors.slice(-5).map(e => `- [${e.resolved ? "✓" : "✗"}] ${e.context.toolName ?? "?"}: ${e.context.errorMessage.slice(0, 50)}`),
        "", "By category:", ...Object.entries(stats.byCategory).map(([k, v]) => `- ${k}: ${v}`),
        "", "By severity:", ...Object.entries(stats.bySeverity).map(([k, v]) => `- ${k}: ${v}`),
      ];
      return { content: [{ type: "text", text: lines.join("\n") }], details: { scope, errors, stats }, isError: false };
    },
  });

  // ── mission_spawn_worker ─────────────────────────────────────────────

  pi.registerTool({
    name: "mission_spawn_worker",
    label: "Spawn Worker",
    description: "Spawn a worker subprocess to autonomously execute a feature.",
    promptSnippet: "Spawn a worker to execute a feature autonomously",
    promptGuidelines: [
      "Use for large features that need focused execution.",
      "The worker runs in a separate pi process with the feature context.",
      "Only one worker runs at a time. Check status with mission_worker_status.",
    ],
    parameters: Type.Object({
      featureId: Type.Optional(Type.String({ description: "Feature ID (defaults to active feature)" })),
      customPrompt: Type.Optional(Type.String({ description: "Custom instructions for the worker" })),
      model: Type.Optional(Type.String({ description: "Model override (default: auto)" })),
    }),
    async execute(_id: string, params: Record<string, unknown>, _sig: unknown, _upd: unknown, _ctx: ExtensionCommandContext) {
      const m = runtime.activeMission;
      const f = m ? getActiveFeature(m) : null;
      if (!m || !f) throw new Error("No active mission feature.");

      const featureId = typeof params.featureId === "string" ? params.featureId : f.id;
      const feat = getFeatureById(m, featureId);
      if (!feat) throw new Error(`Feature not found: ${featureId}`);

      if (isWorkerRunning()) {
        const aw = getActiveWorker();
        return {
          isError: true,
          content: [{ type: "text", text: `Worker already running for ${aw?.featureId}. Use mission_worker_status to check.` }],
          details: { running: true, featureId: aw?.featureId },
        };
      }

      // Mark the feature as active
      feat.status = "active";
      m.activeFeatureId = feat.id;
      m.activeMilestoneId = feat.milestoneId;
      m.status = "active";

      appendHistory(m, {
        event: "worker_spawned",
        featureId: feat.id,
        note: `Spawning worker for ${feat.id} — ${feat.title}`,
        details: { model: params.model, hasCustomPrompt: !!params.customPrompt },
      });

      await saveMissionSafe(m);

      // Spawn async — don't await, return immediately
      spawnWorker(m, {
        featureId: feat.id,
        customPrompt: typeof params.customPrompt === "string" ? params.customPrompt : undefined,
        model: typeof params.model === "string" ? params.model : undefined,
      }).then((result) => {
        if ("error" in result) {
          appendHistory(m, { event: "worker_error", featureId: feat.id, note: result.error });
          saveMissionSafe(m).catch(() => {});
        }
      }).catch(() => {});

      return {
        content: [{
          type: "text",
          text: `🚀 Worker spawned for ${feat.id} — ${feat.title}\n\nThe worker runs autonomously in a separate process. Results are logged to history.\nCheck status: /mission worker-status`,
        }],
        details: { featureId: feat.id, mode: "async" },
        isError: false,
      };
    },
  });

  // ── mission_worker_status ─────────────────────────────────────────────

  pi.registerTool({
    name: "mission_worker_status",
    label: "Worker Status",
    description: "Check the status of the currently running worker.",
    promptSnippet: "Check worker status",
    promptGuidelines: ["Check if a worker is running and its progress."],
    parameters: Type.Object({}),
    async execute(_id: string, _p: unknown, _sig: unknown, _upd: unknown, _ctx: ExtensionCommandContext) {
      const aw = getActiveWorker();
      if (!aw) {
        return { content: [{ type: "text", text: "No worker running." }], details: { running: false }, isError: false };
      }

      const elapsed = Math.round((Date.now() - aw.startedAt) / 1000);
      const lines = [
        `🔧 Worker Status`,
        `Feature: ${aw.featureId}`,
        `Status: ${aw.status}`,
        `Running: ${elapsed}s`,
      ];

      if (aw.result) {
        lines.push(
          "", "## Last Result",
          `Exit: ${aw.result.exitCode}${aw.result.signal ? ` (${aw.result.signal})` : ""}`,
          `Duration: ${Math.round(aw.result.durationMs / 1000)}s`,
          `Stdout: ${aw.result.stdout.slice(0, 500)}`,
          aw.result.stderr ? `Stderr: ${aw.result.stderr.slice(0, 300)}` : "",
        );
      }

      return { content: [{ type: "text", text: lines.filter(Boolean).join("\n") }], details: { running: true, featureId: aw.featureId, status: aw.status, elapsedMs: Date.now() - aw.startedAt }, isError: false };
    },
  });

  // ── mission_kill_worker ───────────────────────────────────────────────

  pi.registerTool({
    name: "mission_kill_worker",
    label: "Kill Worker",
    description: "Kill the currently running worker process.",
    promptSnippet: "Kill running worker",
    promptGuidelines: ["Use to stop a runaway or stuck worker."],
    parameters: Type.Object({}),
    async execute(_id: string, _p: unknown, _sig: unknown, _upd: unknown, _ctx: ExtensionCommandContext) {
      const killed = killWorker();
      if (!killed) {
        return { content: [{ type: "text", text: "No worker running to kill." }], details: { killed: false }, isError: false };
      }
      return { content: [{ type: "text", text: "🛑 Worker killed." }], details: { killed: true }, isError: false };
    },
  });

  // ── mission_retry_error ───────────────────────────────────────────────

  pi.registerTool({
    name: "mission_retry_error",
    label: "Retry Error",
    description: "Retry a failed operation or clear errors.",
    promptSnippet: "Retry failed operation",
    promptGuidelines: ["Clear error state to allow retry after fixing the root cause."],
    parameters: Type.Object({
      errorId: Type.Optional(Type.String({ description: "Error ID to retry" })),
    }),
    async execute(_id: string, params: Record<string, unknown>, _sig: unknown, _upd: unknown, _ctx: ExtensionCommandContext) {
      const m = runtime.activeMission;
      const f = m ? getActiveFeature(m) : null;
      if (!m || !f) throw new Error("No active feature.");
      const recovery = getErrorRecoveryEngine();

      if (typeof params.errorId === "string" && params.errorId) {
        recovery.markResolved(params.errorId);
        appendHistory(m, { event: "error_resolved", featureId: f.id, note: `Resolved ${params.errorId}` });
        return { content: [{ type: "text", text: `✅ Error ${params.errorId} resolved.` }], details: { errorId: params.errorId }, isError: false };
      }

      recovery.clearErrorsForFeature(f.id);
      appendHistory(m, { event: "errors_cleared", featureId: f.id, note: "Cleared all errors" });
      return { content: [{ type: "text", text: `✅ Cleared all errors for ${f.id}.` }], details: { featureId: f.id }, isError: false };
    },
  });
}
