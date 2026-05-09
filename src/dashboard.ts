/**
 * Full-screen Mission Control Dashboard
 *
 * Provides an interactive overlay dashboard for navigating and managing
 * mission features. Uses the Pi TUI component system for keyboard-driven
 * navigation with SelectList for feature browsing.
 *
 * Activated via:
 *   /mission dashboard   → full-screen overlay
 *   ctrl+shift+m         → full-screen overlay (same as /mission dashboard)
 */
import type { Component, SelectItem, TUI } from "@mariozechner/pi-tui";
import { Box, SelectList, Spacer, Text } from "@mariozechner/pi-tui";
import { getFeatureById, progress } from "./state.js";
import type { Feature, MissionState } from "./types.js";
import { sessionMetrics } from "./metrics.js";
import { buildMissionControlSummary } from "./ui.js";

// ── Inline theme type (SelectListTheme may not be exported by pi-tui) ──────
interface SelectListTheme {
  selectedPrefix: (text: string) => string;
  selectedText: (text: string) => string;
  description: (text: string) => string;
  scrollInfo: (text: string) => string;
  noMatch: (text: string) => string;
}

// ────────────────────────────────────────────────────────────────────────────
// Theme for the SelectList — minimal styling
// ────────────────────────────────────────────────────────────────────────────

const selectTheme: SelectListTheme = {
  selectedPrefix: (_text: string): string => "▸ ",
  selectedText: (text: string): string => text,
  description: (text: string): string => `  ${text}`,
  scrollInfo: (text: string): string => text,
  noMatch: (text: string): string => text,
};

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const STATUS_ICONS: Record<string, string> = {
  done: "✅",
  active: "➡️",
  blocked: "⛔",
  failed: "❌",
  pending: "•",
};

function statusIcon(status: string): string {
  return STATUS_ICONS[status] ?? "•";
}

function clip(text: string, max = 72): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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

export function buildFeatureItems(mission: MissionState): SelectItem[] {
  const items: SelectItem[] = [];
  // Add session metrics item at the top
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
  lines.push(`  Throughput: ${metrics.featuresCompleted} features complete  |  ${metrics.toolCalls.total} tool calls  |  ${metrics.tokensUsed} tokens`);
  lines.push(`  Duration: ${duration.toFixed(1)}s  |  Auto-advances: ${metrics.autoAdvanceCount}  |  Stuck detections: ${metrics.stuckDetectionCount}`);
  if (metrics.errors.total > 0) {
    lines.push(`  Error Categories:`);
    for (const [category, count] of Object.entries(metrics.errors.byCategory)) {
      lines.push(`    - ${category}: ${count}`);
    }
  }
  lines.push(`  ${bar}`);
  return lines;
}

// ────────────────────────────────────────────────────────────────────────────
// MissionControl — interactive overlay component
// ────────────────────────────────────────────────────────────────────────────

class MissionControl implements Component {
  private container: Box;
  private list: SelectList;
  private detailBox: Box;
  private mission: MissionState;
  private tui: TUI;
  private onAction?: (featureId: string) => void;
  private filterChars = "";
  private width = 80;
  private filterText: Text;
  private footerText: Text;

  constructor(mission: MissionState, tui: TUI, onAction?: (featureId: string) => void) {
    this.mission = mission;
    this.tui = tui;
    this.onAction = onAction;

    const p = progress(mission);
    const summary = buildMissionControlSummary(mission);
    const statusIco =
      mission.status === "complete" ? "✅"
      : mission.status === "paused" ? "⏸"
      : mission.status === "budget_limited" ? "⚠️"
      : "🎯";

    const items = buildFeatureItems(mission);

    // Header
    const header = new Box(1, 0);
    header.addChild(new Text(`${statusIco} Mission Control — ${mission.title}`));
    header.addChild(new Text(`Goal: ${clip(mission.goal || "No mission goal captured", 88)}`));
    header.addChild(new Text(`Focus: ${summary.active ? `${summary.active.id} ${summary.active.title}` : "No active feature"}  |  Progress: ${p.done}/${p.total} (${p.pct}%)`));
    header.addChild(new Text(`Blocked/Waiting: ${summary.blocked.length}/${summary.waiting.length}  |  Handoff: ${clip(summary.handoff, 76)}`));

    // Filter indicator (shown only when filterChars is non-empty)
    this.filterText = new Text("", 1, 0);

    // Feature list
    this.list = new SelectList(items, Math.min(items.length, 15), selectTheme);
    this.list.onSelectionChange = (item: SelectItem) => this.updateDetail(item);
    this.list.onCancel = () => this.tui.hideOverlay();
    this.list.onSelect = (item: SelectItem) => {
      if (item.value !== "__session_metrics__") {
        this.onAction?.(item.value);
      }
      this.tui.hideOverlay();
    };

    // Detail pane — initially shows first item (session metrics or first feature)
    this.detailBox = new Box(0, 0);
    if (items.length > 0) {
      if (items[0]!.value === "__session_metrics__") {
        for (const line of sessionMetricsLines(this.width)) {
          this.detailBox.addChild(new Text(line));
        }
      } else {
        const firstFeature = getFeatureById(mission, items[0]!.value);
        if (firstFeature) {
          for (const line of featureDetailLines(firstFeature, this.width)) {
            this.detailBox.addChild(new Text(line));
          }
        }
      }
    }

    // Footer — dynamic text updated when filter changes
    this.footerText = new Text(this.footerTextFor(items.length, items.length), 1, 0);
    const footer = new Box(1, 0);
    footer.addChild(this.footerText);

    // Container
    this.container = new Box(1, 1);
    this.container.addChild(header);
    this.container.addChild(this.filterText);
    this.container.addChild(this.list);
    this.container.addChild(new Spacer(1));
    this.container.addChild(this.detailBox);
    this.container.addChild(new Spacer(1));
    this.container.addChild(footer);
  }

  private updateDetail(item: SelectItem): void {
    this.detailBox.clear();
    if (item.value === "__session_metrics__") {
      for (const line of sessionMetricsLines(this.width)) {
        this.detailBox.addChild(new Text(line));
      }
    } else {
      const feature = getFeatureById(this.mission, item.value);
      if (!feature) return;
      for (const line of featureDetailLines(feature, this.width)) {
        this.detailBox.addChild(new Text(line));
      }
    }
    this.detailBox.invalidate();
    this.tui.requestRender();
  }

  // ── Component interface ──────────────────────────────────────────────────

  render(width: number): string[] {
    this.width = width;
    return this.container.render(width);
  }

  invalidate(): void {
    this.container.invalidate();
  }

  private updateFilterDisplay(): void {
    if (this.filterChars) {
      this.filterText.setText(`🔍 Filter: ${this.filterChars}`);
    } else {
      this.filterText.setText("");
    }
    this.container.invalidate();
    // Note: updateDetailForCurrentSelection() already calls requestRender()
    // when invoked alongside this method in handleInput.
  }

  private footerTextFor(filtered: number, total: number): string {
    if (this.filterChars) {
      return `Keys: ↑↓ navigate  |  Enter select  |  Esc close  |  Ctrl+U clear filter  |  Ctrl+W delete word  |  Type to filter  |  ${filtered}/${total} features`;
    }
    return `Keys: ↑↓ navigate  |  Enter select  |  Esc close  |  Ctrl+U clear filter  |  Ctrl+W delete word  |  Type to filter  |  ${total} features`;
  }

  private updateFooter(): void {
    const listAny = this.list as any;
    this.footerText.setText(
      this.footerTextFor(listAny.filteredItems.length, listAny.items.length),
    );
  }

  handleInput(data: string): boolean {
    // Type-to-filter: intercept printable characters to filter the feature list
    if (data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) <= 126) {
      this.filterChars += data;
      (this.list as any).setFilter(this.filterChars);
      this.updateDetailForCurrentSelection();
      this.updateFilterDisplay();
      this.updateFooter();
      return true;
    }
    // Backspace — remove last char from filter
    if (data === "\b" || data === "\x7f") {
      this.filterChars = this.filterChars.slice(0, -1);
      (this.list as any).setFilter(this.filterChars);
      this.updateDetailForCurrentSelection();
      this.updateFilterDisplay();
      this.updateFooter();
      return true;
    }
    // Ctrl+W — delete word backward from filter
    if (data === "\x17") {
      this.filterChars = this.deleteWordBackward(this.filterChars);
      (this.list as any).setFilter(this.filterChars);
      this.updateDetailForCurrentSelection();
      this.updateFilterDisplay();
      this.updateFooter();
      return true;
    }
    // Ctrl+U — clear filter in one keystroke (always stays open)
    if (data === "\x15") {
      this.filterChars = "";
      (this.list as any).setFilter("");
      this.updateDetailForCurrentSelection();
      this.updateFilterDisplay();
      this.updateFooter();
      return true;
    }
    // Escape: if filter is active, clear it and stay open.
    // If filter is already empty, forward to SelectList (closes overlay).
    if (data === "\x1b") {
      if (this.filterChars.length > 0) {
        this.filterChars = "";
        (this.list as any).setFilter("");
        this.updateDetailForCurrentSelection();
        this.updateFilterDisplay();
        this.updateFooter();
        return true;
      }
    }
    // Forward all keyboard input to SelectList for navigation/confirmation
    return (this.list as any).handleInput(data);
  }

  /** Remove the last word (and any trailing spaces) from a string. */
  private deleteWordBackward(s: string): string {
    // Strip trailing spaces
    let t = s;
    while (t.length > 0 && t[t.length - 1] === " ") {
      t = t.slice(0, -1);
    }
    // Find preceding space; if none, delete entire string
    const lastSpace = t.lastIndexOf(" ");
    return lastSpace === -1 ? "" : t.slice(0, lastSpace);
  }

  /** Sync the detail pane with the currently selected item after filtering. */
  private updateDetailForCurrentSelection(): void {
    const item = (this.list as any).getSelectedItem();
    if (item) {
      this.updateDetail(item);
      this.invalidate();
    }
  }

  dispose(): void {
    this.container.clear();
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
