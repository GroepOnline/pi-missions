import type {
  CompletionConfidence,
  CompletionDetectionResult,
  CompletionSignal,
  Feature,
} from "../core/types.js";

// ═══════════════════════════════════════════════════════════════════════════
// Completion Detection Engine
// ═══════════════════════════════════════════════════════════════════════════

const MAX_RECENT_TOOLS = 20;
const MAX_RECENT_TEXTS = 10;
const ERROR_FREE_STREAK_THRESHOLD = 5;
const STUCK_FAILURE_THRESHOLD = 3;
const STUCK_REPEAT_PATTERN_THRESHOLD = 5;
const TEXT_LOOP_SIMILARITY_THRESHOLD = 4;

export class CompletionDetector {
  private recentToolCalls: Array<{ tool: string; success: boolean; timestamp: number }> = [];
  private recentTextOutputs: Array<{ hash: string; timestamp: number }> = [];

  recordToolCall(tool: string, success: boolean): void {
    this.recentToolCalls.push({ tool, success, timestamp: Date.now() });
    if (this.recentToolCalls.length > MAX_RECENT_TOOLS) this.recentToolCalls.shift();
  }

  recordTextOutput(text: string): void {
    if (!text || text.length < 20) return;
    const hash = text.slice(0, 100).toLowerCase().replace(/\s+/g, " ").trim();
    this.recentTextOutputs.push({ hash, timestamp: Date.now() });
    if (this.recentTextOutputs.length > MAX_RECENT_TEXTS) this.recentTextOutputs.shift();
  }

  clearToolCallHistory(): void {
    this.recentToolCalls = [];
    this.recentTextOutputs = [];
  }

  // ── Completion detection ────────────────────────────────────────────────

  detectCompletion(feature: Feature, agentText: string): CompletionDetectionResult {
    const signals: CompletionSignal[] = [];
    const now = Date.now();

    const kw = this.detectKeywordSignal(agentText, now);
    if (kw) signals.push(kw);

    const ac = this.detectAcceptanceSignal(feature, now);
    if (ac) signals.push(ac);

    const tp = this.detectToolPatternSignal(now);
    if (tp) signals.push(tp);

    const ef = this.detectErrorFreeStreakSignal(now);
    if (ef) signals.push(ef);

    return this.aggregateSignals(signals, feature);
  }

  private detectKeywordSignal(text: string, now: number): CompletionSignal | null {
    const lower = text.toLowerCase();
    const keywords = [
      "done", "complete", "completed", "finished", "implemented",
      "klaar", "voltooid", "tests pass", "tests slagen", "success",
      "working", "functional", "ready",
    ];
    const found = keywords.filter(kw => lower.includes(kw));
    if (found.length === 0) return null;
    const confidence: CompletionConfidence = found.length >= 2 ? "high" : "medium";
    return { type: "keyword", confidence, evidence: `Found completion keywords: ${found.join(", ")}`, timestamp: now };
  }

  private detectAcceptanceSignal(feature: Feature, now: number): CompletionSignal | null {
    if (feature.acceptance.length === 0) return null;
    const verified = feature.acceptance.filter(ac => ac.verified).length;
    const waived = feature.acceptance.filter(ac => ac.waived).length;
    const satisfied = verified + waived;
    const total = feature.acceptance.length;
    const pct = (satisfied / total) * 100;
    if (pct === 100) {
      return { type: "acceptance", confidence: "high", evidence: `All ${total} acceptance criteria satisfied (${verified} verified, ${waived} waived)`, timestamp: now };
    }
    if (pct >= 75) {
      return { type: "acceptance", confidence: "medium", evidence: `${satisfied}/${total} criteria satisfied (${pct.toFixed(0)}%)`, timestamp: now };
    }
    return null;
  }

  private detectToolPatternSignal(now: number): CompletionSignal | null {
    if (this.recentToolCalls.length < 3) return null;
    const reads = this.recentToolCalls.filter(tc => tc.tool === "read").length;
    const pct = (reads / this.recentToolCalls.length) * 100;
    if (pct >= 70) {
      return { type: "tool_pattern", confidence: "medium", evidence: `${pct.toFixed(0)}% of recent ${this.recentToolCalls.length} tool calls were read operations`, timestamp: now };
    }
    return null;
  }

  private detectErrorFreeStreakSignal(now: number): CompletionSignal | null {
    if (this.recentToolCalls.length < ERROR_FREE_STREAK_THRESHOLD) return null;
    const recent = this.recentToolCalls.slice(-ERROR_FREE_STREAK_THRESHOLD);
    if (recent.every(tc => tc.success)) {
      return { type: "error_free_streak", confidence: "medium", evidence: `Last ${ERROR_FREE_STREAK_THRESHOLD} tool calls successful`, timestamp: now };
    }
    return null;
  }

  // ── Stuck detection ─────────────────────────────────────────────────────

  detectTextLoop(): { isStuck: boolean; reason: string; suggestedAction: "continue" | "block_self" } {
    if (this.recentTextOutputs.length < TEXT_LOOP_SIMILARITY_THRESHOLD) {
      return { isStuck: false, reason: "Insufficient text history", suggestedAction: "continue" };
    }
    const recent = this.recentTextOutputs.slice(-TEXT_LOOP_SIMILARITY_THRESHOLD);
    const unique = new Set(recent.map(t => t.hash));
    if (unique.size <= 2) {
      return { isStuck: true, reason: `Text loop: ${unique.size} unique outputs in last ${TEXT_LOOP_SIMILARITY_THRESHOLD} turns`, suggestedAction: "block_self" };
    }
    const stuckPhrases = [
      "i've been stuck in a loop", "i need to ask the user directly",
      "actually, let me just provide a final summary", "operation aborted",
    ];
    let count = 0;
    for (const t of recent) {
      if (stuckPhrases.some(p => t.hash.includes(p))) count++;
    }
    if (count >= 3) {
      return { isStuck: true, reason: `Stuck phrases in ${count}/${TEXT_LOOP_SIMILARITY_THRESHOLD} recent turns`, suggestedAction: "block_self" };
    }
    return { isStuck: false, reason: "No text loop detected", suggestedAction: "continue" };
  }

  detectStuck(): { isStuck: boolean; reason: string; suggestedAction: "continue" | "block_self" } {
    if (this.recentToolCalls.length < STUCK_FAILURE_THRESHOLD) {
      return { isStuck: false, reason: "Insufficient tool call history", suggestedAction: "continue" };
    }
    // Consecutive failures
    const recent = this.recentToolCalls.slice(-STUCK_FAILURE_THRESHOLD);
    if (recent.every(tc => !tc.success)) {
      return { isStuck: true, reason: `${STUCK_FAILURE_THRESHOLD} consecutive failures`, suggestedAction: "block_self" };
    }
    // Repeated tool pattern
    const last5 = this.recentToolCalls.slice(-STUCK_REPEAT_PATTERN_THRESHOLD);
    if (last5.length >= STUCK_REPEAT_PATTERN_THRESHOLD) {
      const uniqueTools = new Set(last5.map(tc => tc.tool));
      if (uniqueTools.size === 1) {
        return { isStuck: true, reason: `${STUCK_REPEAT_PATTERN_THRESHOLD} consecutive calls to '${last5[0].tool}'`, suggestedAction: "block_self" };
      }
    }
    // High failure rate
    const recent10 = this.recentToolCalls.slice(-10);
    if (recent10.length >= 5) {
      const failures = recent10.filter(tc => !tc.success).length;
      if (failures / recent10.length >= 0.7) {
        return { isStuck: true, reason: `High failure rate: ${failures}/${recent10.length} recent calls`, suggestedAction: "block_self" };
      }
    }
    return { isStuck: false, reason: "No stuck pattern", suggestedAction: "continue" };
  }

  // ── Aggregation ─────────────────────────────────────────────────────────

  private aggregateSignals(signals: CompletionSignal[], feature: Feature): CompletionDetectionResult {
    if (signals.length === 0) {
      return { isComplete: false, confidence: "low", signals: [], suggestedAction: "continue", reason: "No completion signals" };
    }
    const high = signals.filter(s => s.confidence === "high").length;
    const medium = signals.filter(s => s.confidence === "medium").length;
    let confidence: CompletionConfidence;
    if (high >= 2 || (high === 1 && medium >= 2)) confidence = "high";
    else if (high === 1 || medium >= 2) confidence = "medium";
    else confidence = "low";

    const acPct = feature.acceptance.length > 0
      ? (feature.acceptance.filter(ac => ac.verified || ac.waived).length / feature.acceptance.length) * 100
      : 0;

    let suggestedAction: CompletionDetectionResult["suggestedAction"];
    let reason: string;
    if (confidence === "high" && acPct >= 100) {
      suggestedAction = "auto_done"; reason = "High confidence, all acceptance criteria satisfied";
    } else if (confidence === "high" && acPct >= 75) {
      suggestedAction = "suggest_done"; reason = "High confidence but some acceptance unverified";
    } else if (confidence === "medium" && acPct >= 100) {
      suggestedAction = "suggest_done"; reason = "Medium confidence, all acceptance satisfied";
    } else if (confidence === "medium") {
      suggestedAction = "ask_user"; reason = "Medium confidence — ask user";
    } else {
      suggestedAction = "continue"; reason = "Low confidence — continue";
    }
    return {
      isComplete: suggestedAction === "auto_done" || suggestedAction === "suggest_done",
      confidence, signals, suggestedAction, reason,
    };
  }
}

// Singleton
let globalDetector: CompletionDetector | null = null;

export function getCompletionDetector(): CompletionDetector {
  if (!globalDetector) globalDetector = new CompletionDetector();
  return globalDetector;
}

export function resetCompletionDetector(): void {
  globalDetector = null;
}
