/**
 * Full-screen Mission Control Dashboard
 *
 * Provides an interactive overlay dashboard for navigating and managing
 * mission features. Uses the Pi TUI component system with a static
 * render layout — no SelectList dependency.
 *
 * Activated via:
 *   /mission dashboard   → full-screen overlay
 *   ctrl+shift+m         → full-screen overlay
 */
import type { Component, TUI } from "@mariozechner/pi-tui";
import { progress } from "./state.js";
import type { Feature, Milestone, MissionState } from "./types.js";
import { sessionMetrics } from "./metrics.js";
import { buildMissionControlSummary } from "./ui.js";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const STATUS_ICONS: Record<string, string> = {
  done: "✅",
  active: "➡️",
  blocked: "⛔",
  failed: "❌",
  pending: "•",
  waiting: "⏳",
};

function statusIcon(status: string): string {
  return STATUS_ICONS[status] ?? "•";
}

function clip(text: string, max = 72): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function progressBar(done: number, total: number, width = 16): string {
  if (total === 0) return "[" + "░".repeat(width) + "]";
  const filled = Math.round((done / total) * width);
  return "[" + "█".repeat(filled) + "░".repeat(width - filled) + "]";
}

function pendingAcceptance(feature: Feature): string[] {
  return feature.acceptance
    .filter((ac) => !ac.verified && !ac.waived)
    .map((ac) => ac.checkType === "bash" && ac.checkCommand ? `${ac.id}: ${ac.description} → ${ac.checkCommand}` : `${ac.id}: ${ac.description}`);
}

function featureNextAction(feature: Feature): string {
  if (feature.status === "blocked") return feature.notes ? `Unblock: ${clip(feature.notes)}` : "Unblock this feature before continuing";
  if (feature.status === "waiting") return feature.dependsOn.length ? `Wait for ${feature.dependsOn.join(", ")}` : "Wait for external dependency";
  const nextAcceptance = pendingAcceptance(feature)[0];
  if (nextAcceptance) return `Finish acceptance: ${clip(nextAcceptance)}`;
  return `Advance implementation: ${clip(feature.description || feature.title)}`;
}

export function featureLabel(f: Feature): string {
  const acDone = f.acceptance.filter((ac) => ac.verified || ac.waived).length;
  const acBadge = f.acceptance.length ? ` [${acDone}/${f.acceptance.length} AC]` : "";
  return `${statusIcon(f.status)} ${f.id} [P${f.priority}] ${f.title}${acBadge}`;
}

export function featureDescription(f: Feature, milestoneId: string): string {
  const deps = f.dependsOn.length ? ` 🔗${f.dependsOn.join(",")}` : "";
  const desc = f.description.slice(0, 70);
  return `${milestoneId}: ${desc}${deps}`;
}

export function buildFeatureItems(mission: MissionState): { value: string; label: string; description: string }[] {
  const items: { value: string; label: string; description: string }[] = [];
  items.push({
    value: "__session_metrics__",
    label: "📊 Session Metrics",
    description: "View current session performance metrics",
  });
  for (const milestone of mission.milestones) {
    for (const feature of milestone.features) {
      items.push({
        value: feature.id,
        label: featureLabel(feature),
        description: featureDescription(feature, milestone.id),
      });
    }
  }
  return items;
}

export function featureDetailLines(feature: Feature, width: number): string[] {
  const barW = Math.min(width - 4, 72);
  const bar = "─".repeat(barW > 0 ? barW : 40);
  const verified = feature.acceptance.filter((ac) => ac.verified || ac.waived).length;
  const remainingAcceptance = pendingAcceptance(feature);
  const lines: string[] = [];
  lines.push(`  ${bar}`);
  lines.push(`  📋 ${feature.id}: ${feature.title}`);
  lines.push(`  Status: ${feature.status}  |  Priority: P${feature.priority}  |  Milestone: ${feature.milestoneId}`);
  if (feature.description) lines.push(`  📝 ${feature.description}`);
  lines.push(`  🎯 Next action: ${featureNextAction(feature)}`);
  lines.push(`  📈 Acceptance progress: ${verified}/${feature.acceptance.length}`);
  if (feature.dependsOn.length) lines.push(`  🔗 Dependencies: ${feature.dependsOn.join(", ")}`);
  if (feature.notes) lines.push(`  📌 Notes: ${feature.notes}`);
  if (feature.acceptance.length) {
    lines.push(`  ✅ Acceptance criteria (${remainingAcceptance.length} remaining):`);
    for (const ac of feature.acceptance) {
      const mark = ac.verified || ac.waived ? "☑" : "☐";
      const checkHint = ac.checkType === "bash" && ac.checkCommand ? ` → \`${ac.checkCommand}\`` : "";
      lines.push(`     ${mark} ${ac.id}: ${ac.description}${checkHint}`);
    }
  }
  lines.push(`  ${bar}`);
  return lines;
}

export function sessionMetricsLines(width: number): string[] {
  const metrics = sessionMetrics.getMetrics();
  const barW = Math.min(width - 4, 72);
  const bar = "─".repeat(barW > 0 ? barW : 40);
  const lines: string[] = [];
  lines.push(`  ${bar}`);
  lines.push(`  📊 Session Metrics`);
  const duration = metrics.endTime ? (metrics.endTime - metrics.startTime) / 1000 : (Date.now() - metrics.startTime) / 1000;
  const successRate = metrics.toolCalls.total === 0 ? 100 : (metrics.toolCalls.successful / metrics.toolCalls.total) * 100;
  lines.push(`  Session: ${metrics.sessionId}`);
  lines.push(`  Health: ${metrics.errors.total === 0 ? "clean" : `${metrics.errors.total} errors`}  |  Tool success: ${successRate.toFixed(1)}%`);
  lines.push(`  Throughput: ${metrics.featuresCompleted} features  |  ${metrics.toolCalls.total} tool calls  |  ${metrics.tokensUsed} tokens`);
  lines.push(`  Duration: ${duration.toFixed(1)}s  |  Auto-advances: ${metrics.autoAdvanceCount}  |  Stuck: ${metrics.stuckDetectionCount}`);
  if (metrics.errors.total > 0) {
    lines.push(`  Error categories:`);
    for (const [category, count] of Object.entries(metrics.errors.byCategory)) {
      lines.push(`    - ${category}: ${count}`);
    }
  }
  lines.push(`  ${bar}`);
  return lines;
}

// ────────────────────────────────────────────────────────────────────────────
// Render helpers
// ────────────────────────────────────────────────────────────────────────────

function milestoneSection(milestone: Milestone, activeFeatureId: string | undefined, width: number): string[] {
  const lines: string[] = [];
  const mDone = milestone.features.filter((f) => f.status === "done").length;
  const mTotal = milestone.features.length;
  const msIcon = milestone.status === "complete" ? "✅" : milestone.status === "active" ? "➡️" : "•";

  // Collapsed: fully-done milestones get one summary line
  if (milestone.status === "complete" && mDone === mTotal) {
    lines.push(`  ${msIcon} ${milestone.id}: ${milestone.title} — all ${mTotal} features done`);
    return lines;
  }

  // Expanded milestone
  lines.push(`  ${msIcon} ${milestone.id}: ${milestone.title}  ${progressBar(mDone, mTotal, 12)} ${mDone}/${mTotal}`);

  const order: Record<string, number> = { active: 0, pending: 1, waiting: 2, blocked: 3, failed: 4, done: 5 };
  const sorted = [...milestone.features].sort(
    (a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5) || a.priority - b.priority,
  );

  for (const feature of sorted) {
    const icon = statusIcon(feature.status);
    const deps = feature.dependsOn.length ? ` 🔗${feature.dependsOn.join(",")}` : "";
    const blocked = feature.status === "blocked" && feature.notes ? `  ↳ ${clip(feature.notes, 44)}` : "";
    const verified = feature.acceptance.filter((ac) => ac.verified || ac.waived).length;
    const acBadge = feature.acceptance.length ? ` [${verified}/${feature.acceptance.length} AC]` : "";

    if (feature.id === activeFeatureId) {
      // Active feature — full detail
      lines.push(`    ${icon} ${feature.id} [P${feature.priority}] ${feature.title}${acBadge}${deps}`);
      if (feature.description) lines.push(`      📝 ${feature.description}`);
      lines.push(`      🎯 ${featureNextAction(feature)}`);
      const unverified = pendingAcceptance(feature);
      for (const ac of unverified) {
        lines.push(`      ☐ ${clip(ac, 66)}`);
      }
      if (feature.startedAt) {
        const elapsedMin = Math.round((Date.now() - feature.startedAt) / 60000);
        if (elapsedMin > 10) lines.push(`      ⏱  Active ${elapsedMin}min`);
      }
      if (feature.toolCallCount > 50) lines.push(`      🔧 ${feature.toolCallCount} tool calls`);
    } else {
      lines.push(`    ${icon} ${feature.id} [P${feature.priority}] ${feature.title}${acBadge}${deps}${blocked}`);
    }
  }
  return lines;
}

// ────────────────────────────────────────────────────────────────────────────
// MissionControl — interactive overlay component
// ────────────────────────────────────────────────────────────────────────────

class MissionControl implements Component {
  private mission: MissionState;
  private tui: TUI;
  private onAction?: (featureId: string) => void;
  private selectedIdx = 0;
  private flatItems: { value: string; label: string; description: string }[] = [];
  private filter = "";
  private searchMode = false;
  private width = 80;

  constructor(mission: MissionState, tui: TUI, onAction?: (featureId: string) => void) {
    this.mission = mission;
    this.tui = tui;
    this.onAction = onAction;
    this.flatItems = buildFeatureItems(mission);
  }

  private visibleItems(): { value: string; label: string; description: string }[] {
    if (!this.filter) return this.flatItems;
    const q = this.filter.toLowerCase();
    return this.flatItems.filter((item) => item.value !== "__session_metrics__" && `${item.value} ${item.label} ${item.description}`.toLowerCase().includes(q));
  }

  private clampSelection(): void {
    const visible = this.visibleItems();
    this.selectedIdx = Math.max(0, Math.min(this.selectedIdx, Math.max(visible.length - 1, 0)));
  }

  private renderDashboardLines(): string[] {
    const p = progress(this.mission);
    const summary = buildMissionControlSummary(this.mission);
    const visible = this.visibleItems();
    const selectedValue = visible[this.selectedIdx]?.value;
    const statusIco =
      this.mission.status === "complete" ? "✅"
      : this.mission.status === "paused" ? "⏸"
      : this.mission.status === "budget_limited" ? "⚠️"
      : "🎯";

    const lines: string[] = [
      `${statusIco} Mission Control — ${this.mission.title}`,
      `  Goal: ${clip(this.mission.goal || "No mission goal captured", 88)}`,
      `  Focus: ${summary.active ? `${summary.active.id} ${summary.active.title}` : "No active feature"}  |  Progress: ${p.done}/${p.total} (${p.pct}%)`,
      `  Blocked/Waiting: ${summary.blocked.length}/${summary.waiting.length}  |  Handoff: ${clip(summary.handoff, 76)}`,
    ];
    if (summary.active) lines.push(`  Next: ${featureNextAction(summary.active)}`);
    if (this.filter) lines.push(`  Filter: ${this.filter}  (${visible.length}/${Math.max(this.flatItems.length - 1, 0)} features)`);
    else lines.push(`  Filter: / to search`);

    if (!this.filter) {
      lines.push("", `${selectedValue === "__session_metrics__" ? "→" : " "} 📊 Session Metrics`);
      for (const line of sessionMetricsLines(this.width).slice(2, -1)) lines.push(`  ${line.trimStart()}`);
    }

    lines.push("", `  Milestones  ${progressBar(p.done, p.total, 12)} ${p.done}/${p.total} (${p.pct}%)`, "");

    if (this.filter && visible.length === 0) {
      lines.push(`  No matching features for "${this.filter}"`, "");
    }

    for (const milestone of this.mission.milestones) {
      const mDone = milestone.features.filter((f) => f.status === "done").length;
      const mTotal = milestone.features.length;
      const msIcon = milestone.status === "complete" ? "✅" : milestone.status === "active" ? "➡️" : "•";
      const order: Record<string, number> = { active: 0, pending: 1, waiting: 2, blocked: 3, failed: 4, done: 5 };
      const sorted = [...milestone.features].sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5) || a.priority - b.priority);
      const shownFeatures = this.filter ? sorted.filter((feature) => visible.some((item) => item.value === feature.id)) : sorted;
      if (!shownFeatures.length) continue;

      lines.push(`  ${msIcon} ${milestone.id}: ${milestone.title}  ${progressBar(mDone, mTotal, 12)} ${mDone}/${mTotal}`);
      for (const feature of shownFeatures) {
        const selected = feature.id === selectedValue;
        const prefix = selected ? "→" : " ";
        const verified = feature.acceptance.filter((ac) => ac.verified || ac.waived).length;
        const acBadge = feature.acceptance.length ? ` [${verified}/${feature.acceptance.length} AC]` : "";
        const deps = feature.dependsOn.length ? ` 🔗${feature.dependsOn.join(",")}` : "";
        lines.push(`${prefix}   ${statusIcon(feature.status)} ${feature.id} [P${feature.priority}] ${feature.title}${acBadge}${deps}`);

        if (selected || feature.id === this.mission.activeFeatureId) {
          lines.push(`      ${feature.id}: ${feature.title}`);
          if (feature.description) lines.push(`      ${clip(feature.description, 88)}`);
          lines.push(`      AC: ${verified}/${feature.acceptance.length}${feature.dependsOn.length ? `  |  deps: ${feature.dependsOn.join(", ")}` : ""}${feature.sessions.length ? `  |  sessions: ${feature.sessions.length}` : ""}`);
          lines.push(`      Next: ${featureNextAction(feature)}`);
          for (const ac of pendingAcceptance(feature).slice(0, 4)) lines.push(`      ☐ ${clip(ac, 82)}`);
          if (feature.startedAt) {
            const elapsedMin = Math.round((Date.now() - feature.startedAt) / 60000);
            if (elapsedMin > 10) lines.push(`      Active ${elapsedMin}min`);
          }
          if (feature.toolCallCount > 50) lines.push(`      ${feature.toolCallCount} tool calls`);
          if (feature.notes) lines.push(`      Note: ${clip(feature.notes, 82)}`);
        }
      }
      lines.push("");
    }

    lines.push("  Keys: ↑↓/j/k navigate  |  Enter select  |  / search  |  Backspace/Ctrl+U clear  |  Esc close");
    return lines;
  }

  // ── Component interface ──────────────────────────────────────────────────

  render(width: number): string[] {
    this.width = width;
    return this.renderDashboardLines();
  }

  invalidate(): void {
    // Plain renderer: state changes are reflected on the next render call.
  }

  handleInput(data: string): boolean {
    if (data === "/") {
      this.searchMode = true;
      this.filter = "";
      this.selectedIdx = 0;
      this.tui.requestRender();
      return true;
    }
    if (this.searchMode && data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) <= 126) {
      this.filter += data;
      this.selectedIdx = 0;
      this.clampSelection();
      this.tui.requestRender();
      return true;
    }
    if (data === "\b" || data === "\x7f") {
      if (this.filter) {
        this.filter = this.filter.slice(0, -1);
        this.selectedIdx = 0;
        this.clampSelection();
        this.tui.requestRender();
        return true;
      }
      return true;
    }
    if (data === "\x15") {
      this.filter = "";
      this.searchMode = false;
      this.selectedIdx = 0;
      this.tui.requestRender();
      return true;
    }
    if (data === "\x1b[B" || data === "j") {
      this.clampSelection();
      this.selectedIdx = Math.min(this.selectedIdx + 1, Math.max(this.visibleItems().length - 1, 0));
      this.invalidate();
      this.tui.requestRender();
      return true;
    }
    if (data === "\x1b[A" || data === "k") {
      this.selectedIdx = Math.max(this.selectedIdx - 1, 0);
      this.invalidate();
      this.tui.requestRender();
      return true;
    }
    if (data === "\r" || data === "\n") {
      const item = this.visibleItems()[this.selectedIdx];
      if (item && item.value !== "__session_metrics__") {
        this.onAction?.(item.value);
        this.tui.hideOverlay();
        return true;
      }
      return true;
    }
    if (data === "\x1b") {
      if (this.filter || this.searchMode) {
        this.filter = "";
        this.searchMode = false;
        this.selectedIdx = 0;
        this.tui.requestRender();
        return true;
      }
      this.tui.hideOverlay();
      return true;
    }
    return false;
  }

  dispose(): void {
    // No resources to release.
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Factory — for ctx.ui.custom()
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create a Mission Control overlay component factory.
 * Used with `ctx.ui.custom(missionControlOverlay(mission), { overlay: true })`.
 */
export function missionControlOverlay(
  mission: MissionState,
  onAction?: (featureId: string) => void,
): (tui: TUI) => any {
  return (tui: TUI) => new MissionControl(mission, tui, onAction);
}
