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
import type { Component, SelectItem, SelectListTheme, TUI } from "@mariozechner/pi-tui";
import { Box, SelectList, Spacer, Text } from "@mariozechner/pi-tui";
import { getFeatureById, progress } from "./state.js";
import type { Feature, MissionState } from "./types.js";

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
  const lines: string[] = [];
  lines.push(`  ${bar}`);
  lines.push(`  📋 ${feature.id}: ${feature.title}`);
  lines.push(`  Status: ${feature.status}  |  Priority: P${feature.priority}  |  Milestone: ${feature.milestoneId}`);
  if (feature.description) lines.push(`  📝 ${feature.description}`);
  if (feature.dependsOn.length) lines.push(`  🔗 Dependencies: ${feature.dependsOn.join(", ")}`);
  if (feature.notes) lines.push(`  📌 Notes: ${feature.notes}`);
  if (feature.acceptance.length) {
    lines.push("  ✅ Acceptance criteria:");
    for (const ac of feature.acceptance) {
      const mark = ac.verified || ac.waived ? "☑" : "☐";
      const checkHint = ac.checkType === "bash" && ac.checkCommand ? ` → \`${ac.checkCommand}\`` : "";
      lines.push(`     ${mark} ${ac.id}: ${ac.description}${checkHint}`);
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

  constructor(mission: MissionState, tui: TUI, onAction?: (featureId: string) => void) {
    this.mission = mission;
    this.tui = tui;
    this.onAction = onAction;

    const p = progress(mission);
    const statusIco =
      mission.status === "complete" ? "✅"
      : mission.status === "paused" ? "⏸"
      : mission.status === "budget_limited" ? "⚠️"
      : "🎯";

    const items = buildFeatureItems(mission);

    // Header
    const header = new Box(1, 0);
    header.addChild(new Text(`${statusIco} Mission Control — ${mission.title}`));
    header.addChild(new Text(`Progress: ${p.done}/${p.total} features (${p.pct}%)  |  Status: ${mission.status}  |  Tokens: ${mission.tokensUsed.toLocaleString()}`));

    // Filter indicator (shown only when filterChars is non-empty)
    this.filterText = new Text("", 1, 0);

    // Feature list
    this.list = new SelectList(items, Math.min(items.length, 15), selectTheme);
    this.list.onSelectionChange = (item: SelectItem) => this.updateDetail(item);
    this.list.onCancel = () => this.tui.hideOverlay();
    this.list.onSelect = (item: SelectItem) => {
      this.onAction?.(item.value);
      this.tui.hideOverlay();
    };

    // Detail pane — initially shows first feature if available
    this.detailBox = new Box(0, 0);
    if (items.length > 0) {
      const firstFeature = getFeatureById(mission, items[0]!.value);
      if (firstFeature) {
        for (const line of featureDetailLines(firstFeature, this.width)) {
          this.detailBox.addChild(new Text(line));
        }
      }
    }

    // Footer
    const footer = new Box(1, 0);
    footer.addChild(new Text(`Keys: ↑↓ navigate  |  Enter select  |  Esc close  |  Type to filter  |  ${items.length} features`));

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
    const feature = getFeatureById(this.mission, item.value);
    if (!feature) return;
    this.detailBox.clear();
    for (const line of featureDetailLines(feature, this.width)) {
      this.detailBox.addChild(new Text(line));
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

  handleInput(data: string): void {
    // Type-to-filter: intercept printable characters to filter the feature list
    if (data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) <= 126) {
      this.filterChars += data;
      this.list.setFilter(this.filterChars);
      this.updateDetailForCurrentSelection();
      this.updateFilterDisplay();
      return;
    }
    // Backspace — remove last char from filter
    if (data === "\b" || data === "\x7f") {
      this.filterChars = this.filterChars.slice(0, -1);
      this.list.setFilter(this.filterChars);
      this.updateDetailForCurrentSelection();
      this.updateFilterDisplay();
      return;
    }
    // Escape: if filter is active, clear it and stay open.
    // If filter is already empty, forward to SelectList (closes overlay).
    if (data === "\x1b") {
      if (this.filterChars.length > 0) {
        this.filterChars = "";
        this.list.setFilter("");
        this.updateDetailForCurrentSelection();
        this.updateFilterDisplay();
        return;
      }
    }
    // Forward all keyboard input to SelectList for navigation/confirmation
    this.list.handleInput(data);
  }

  /** Sync the detail pane with the currently selected item after filtering. */
  private updateDetailForCurrentSelection(): void {
    const item = this.list.getSelectedItem();
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
): (tui: TUI) => Component & { dispose(): void } {
  return (tui: TUI) => new MissionControl(mission, tui, onAction);
}
