import type { Component, TUI } from "@mariozechner/pi-tui";
import type { Feature, MissionState } from "../core/types.js";
import { getFeatureById, progress } from "../core/state.js";
import { acceptanceProgress, clip, dependsOnChain, featureStatusIcon, formatDepChain, missionStatusIcon, pendingAcceptance, progressBar } from "../utils/context.js";
import { sessionMetrics } from "../engines/metrics.js";
import { buildMissionControlSummary, updateFooter } from "./components.js";

// ═══════════════════════════════════════════════════════════════════════════
// Feature label/description for the picker
// ═══════════════════════════════════════════════════════════════════════════

export function featureNextAction(feature: Feature): string {
  if (feature.status === "blocked") return feature.notes ? `Unblock: ${clip(feature.notes)}` : "Unblock before continuing";
  if (feature.status === "waiting") return feature.dependsOn.length ? `Wait for ${feature.dependsOn.join(", ")}` : "Wait for external dependency";
  const next = pendingAcceptance(feature)[0];
  if (next) return `Finish: ${clip(next)}`;
  return `Advance: ${clip(feature.description || feature.title)}`;
}

export function featureLabel(f: Feature): string {
  const ac = acceptanceProgress(f);
  const badge = f.acceptance.length ? ` [${ac.label} AC]` : "";
  return `${featureStatusIcon(f.status)} ${f.id} [P${f.priority}] ${f.title}${badge}`;
}

export function featureDescription(f: Feature, milestoneId: string): string {
  const deps = f.dependsOn.length ? ` 🔗${f.dependsOn.join(",")}` : "";
  return `${milestoneId}: ${f.description.slice(0, 70)}${deps}`;
}

export function buildFeatureItems(mission: MissionState): Array<{ value: string; label: string; description: string }> {
  const items: Array<{ value: string; label: string; description: string }> = [{
    value: "__session_metrics__", label: "📊 Session Metrics", description: "View current session performance metrics",
  }];
  for (const m of mission.milestones) {
    for (const f of m.features) {
      items.push({ value: f.id, label: featureLabel(f), description: featureDescription(f, m.id) });
    }
  }
  return items;
}

export function sessionMetricsLines(width: number): string[] {
  const m = sessionMetrics.getMetrics();
  const barW = Math.min(width - 4, 72);
  const bar = "─".repeat(barW > 0 ? barW : 40);
  const duration = m.endTime ? (m.endTime - m.startTime) / 1000 : (Date.now() - m.startTime) / 1000;
  const successRate = m.toolCalls.total === 0 ? 100 : (m.toolCalls.successful / m.toolCalls.total) * 100;
  const lines = [bar, "  📊 Session Metrics"];
  lines.push(`  Session: ${m.sessionId}`);
  lines.push(`  Health: ${m.errors.total === 0 ? "clean" : `${m.errors.total} errors`}  |  Tool success: ${successRate.toFixed(1)}%`);
  lines.push(`  Throughput: ${m.featuresCompleted} features  |  ${m.toolCalls.total} tool calls  |  ${m.tokensUsed} tokens`);
  lines.push(`  Duration: ${duration.toFixed(1)}s  |  Auto-advances: ${m.autoAdvanceCount}  |  Stuck: ${m.stuckDetectionCount}`);
  if (m.errors.total > 0) {
    lines.push("  Error categories:");
    for (const [cat, count] of Object.entries(m.errors.byCategory)) lines.push(`    - ${cat}: ${count}`);
  }
  lines.push(bar);
  return lines;
}

// ═══════════════════════════════════════════════════════════════════════════
// MissionControl — interactive overlay component
// ═══════════════════════════════════════════════════════════════════════════

class MissionControl implements Component {
  private mission: MissionState;
  private tui: TUI;
  private onAction?: (featureId: string) => void;
  private selectedIdx = 0;
  private flatItems: Array<{ value: string; label: string; description: string }> = [];
  private filter = "";
  private searchMode = false;
  private width = 80;

  constructor(mission: MissionState, tui: TUI, onAction?: (featureId: string) => void) {
    this.mission = mission;
    this.tui = tui;
    this.onAction = onAction;
    this.flatItems = buildFeatureItems(mission);
  }

  private visibleItems(): Array<{ value: string; label: string; description: string }> {
    if (!this.filter) return this.flatItems;
    const q = this.filter.toLowerCase();
    return this.flatItems.filter(
      item =>      item.value !== "__session_metrics__" && `${item.value} ${item.label} ${item.description}`.toLowerCase().includes(q),
    );
  }

  private clampSelection(): void {
    const visible = this.visibleItems();
    this.selectedIdx = Math.max(0, Math.min(this.selectedIdx, Math.max(visible.length - 1, 0)));
  }

  private renderDashboardLines(): string[] {
    const p = progress(this.mission);
    const s = buildMissionControlSummary(this.mission);
    const visible = this.visibleItems();
    const selectedValue = visible[this.selectedIdx]?.value;
    const icon = missionStatusIcon(this.mission.status);

    const lines: string[] = [
      `${icon} Mission Control — ${this.mission.title}`,
      `  Goal: ${clip(this.mission.goal || "No goal", 88)}`,
      `  Focus: ${s.active ? `${s.active.id} ${s.active.title}` : "None"}  |  Progress: ${p.done}/${p.total} (${p.pct}%)`,
      `  Blocked/Waiting: ${s.blocked.length}/${s.waiting.length}  |  Handoff: ${clip(s.handoff, 76)}`,
    ];
    if (s.active) lines.push(`  Next: ${featureNextAction(s.active)}`);
    lines.push(this.filter ? `  Filter: ${this.filter}  (${visible.length} features)` : "  / to search", "");
    lines.push("  Milestones  " + progressBar(p.done, p.total, 12) + ` ${p.done}/${p.total} (${p.pct}%)`, "");

    if (this.filter && visible.length === 0) {
      lines.push(`  No matching features for "${this.filter}"`, "");
    }

    // Render Session Metrics as first selectable item
    const smItem = this.flatItems[0];
    if (smItem && smItem.value === "__session_metrics__" && !this.filter) {
      const smSel = smItem.value === selectedValue;
      const smPrefix = smSel ? "→" : " ";
      lines.push(`${smPrefix}   ${smItem.label}`, "");
      if (smSel) {
        lines.push(...sessionMetricsLines(this.width));
        lines.push("");
      }
    }

    for (const m of this.mission.milestones) {
      const mDone = m.features.filter(f => f.status === "done").length;
      const mTotal = m.features.length;
      const msIcon = m.status === "complete" ? "✅" : m.status === "active" ? "➡️" : "•";
      const order: Record<string, number> = { active: 0, pending: 1, waiting: 2, blocked: 3, failed: 4, done: 5 };
      const sorted = [...m.features].sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5) || a.priority - b.priority);
      const shown = this.filter ? sorted.filter(f => visible.some(v => v.value === f.id)) : sorted;
      if (!shown.length) continue;

      lines.push(`  ${msIcon} ${m.id}: ${m.title}  ${progressBar(mDone, mTotal, 12)} ${mDone}/${mTotal}`);
      for (const f of shown) {
        const sel = f.id === selectedValue;
        const prefix = sel ? "→" : " ";
        const ac = acceptanceProgress(f);
        const badge = f.acceptance.length ? ` [${ac.label} AC]` : "";
        const deps = f.dependsOn.length ? ` 🔗${f.dependsOn.join(",")}` : "";
        lines.push(`${prefix}   ${featureStatusIcon(f.status)} ${f.id} [P${f.priority}] ${f.title}${badge}${deps}`);

        if (sel || f.id === this.mission.activeFeatureId) {
          lines.push(`      ${f.id}: ${f.title}`);
          if (f.description) lines.push(`      ${clip(f.description, 88)}`);
          const chain = dependsOnChain(this.mission, f);
          if (chain.length) lines.push(`      🔗 Chain: ${formatDepChain(chain)}`);
          lines.push(`      AC: ${ac.label}${f.dependsOn.length ? `  |  deps: ${f.dependsOn.join(", ")}` : ""}`);
          lines.push(`      Next: ${featureNextAction(f)}`);
          for (const a of pendingAcceptance(f).slice(0, 4)) lines.push(`      ☐ ${clip(a, 82)}`);
          if (f.startedAt && Date.now() - f.startedAt > 600_000) {
            lines.push(`      Active ${Math.round((Date.now() - f.startedAt) / 60000)}min`);
          }
          if (f.toolCallCount > 50) lines.push(`      ${f.toolCallCount} tool calls`);
          if (f.notes) lines.push(`      Note: ${clip(f.notes, 82)}`);
        }
      }
      lines.push("");
    }

    lines.push("  Keys: ↑↓/j/k navigate  |  Enter select  |  / search  |  Backspace/Ctrl+U clear  |  Esc close");
    return lines;
  }

  // ── Component interface ────────────────────────────────────────────────

  render(width: number): string[] {
    this.width = width;
    return this.renderDashboardLines();
  }

  invalidate(): void { /* stateless render */ }

  handleInput(data: string): boolean {
    if (data === "/") {
      this.searchMode = true; this.filter = ""; this.selectedIdx = 0;
      this.tui.requestRender(); return true;
    }
    if (this.searchMode && data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) <= 126) {
      this.filter += data; this.selectedIdx = 0; this.clampSelection();
      this.tui.requestRender(); return true;
    }
    if (data === "\b" || data === "\x7f") {
      if (this.filter) { this.filter = this.filter.slice(0, -1); this.selectedIdx = 0; this.clampSelection(); }
      this.tui.requestRender(); return true;
    }
    if (data === "\x15") { this.filter = ""; this.searchMode = false; this.selectedIdx = 0; this.tui.requestRender(); return true; }
    if (data === "\x1b[B" || data === "j") {
      this.selectedIdx = Math.min(this.selectedIdx + 1, Math.max(this.visibleItems().length - 1, 0));
      this.tui.requestRender(); return true;
    }
    if (data === "\x1b[A" || data === "k") {
      this.selectedIdx = Math.max(this.selectedIdx - 1, 0);
      this.tui.requestRender(); return true;
    }
    if (data === "\r" || data === "\n") {
      const item = this.visibleItems()[this.selectedIdx];
      if (item &&      item.value !== "__session_metrics__") { this.onAction?.(item.value); this.tui.hideOverlay(); }
      return true;
    }
    if (data === "\x1b") {
      if (this.filter || this.searchMode) { this.filter = ""; this.searchMode = false; this.selectedIdx = 0; this.tui.requestRender(); return true; }
      this.tui.hideOverlay(); return true;
    }
    return false;
  }

  dispose(): void { /* no resources */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// Factory
// ═══════════════════════════════════════════════════════════════════════════

export function missionControlOverlay(
  mission: MissionState,
  onAction?: (featureId: string) => void,
): (tui: TUI) => Component {
  return (tui: TUI) => new MissionControl(mission, tui, onAction);
}
