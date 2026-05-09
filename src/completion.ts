import type { Feature, MissionState, CompletionSignal, CompletionDetectionResult, CompletionConfidence } from "./types.js";

// ---------------------------------------------------------------------------
// Completion Detection Engine
// ---------------------------------------------------------------------------

/**
 * Multi-factor completion detection engine that analyzes various signals
 * to determine if a feature is likely complete.
 */
export class CompletionDetector {
  private recentToolCalls: Array<{ tool: string; success: boolean; timestamp: number }> = [];
  private recentTextOutputs: Array<{ hash: string; timestamp: number }> = [];
  private readonly MAX_RECENT_TOOLS = 20;
  private readonly MAX_RECENT_TEXTS = 10;
  private readonly ERROR_FREE_STREAK_THRESHOLD = 5;
  private readonly STUCK_FAILURE_THRESHOLD = 3; // Number of consecutive failures to consider stuck
  private readonly STUCK_REPEAT_PATTERN_THRESHOLD = 5; // Number of repeated patterns to consider stuck
  private readonly TEXT_LOOP_SIMILARITY_THRESHOLD = 4; // Similar text outputs in a row = stuck

  /**
   * Record a tool call for pattern analysis
   */
  recordToolCall(tool: string, success: boolean): void {
    this.recentToolCalls.push({ tool, success, timestamp: Date.now() });
    if (this.recentToolCalls.length > this.MAX_RECENT_TOOLS) {
      this.recentToolCalls.shift();
    }
  }

  /**
   * Record a text output for loop detection
   */
  recordTextOutput(text: string): void {
    if (!text || text.length < 20) return;
    // Use a simple hash of first 100 chars to detect near-duplicates
    const hash = text.slice(0, 100).toLowerCase().replace(/\s+/g, " ").trim();
    this.recentTextOutputs.push({ hash, timestamp: Date.now() });
    if (this.recentTextOutputs.length > this.MAX_RECENT_TEXTS) {
      this.recentTextOutputs.shift();
    }
  }

  /**
   * Clear the tool call and text history (e.g., when starting a new feature)
   */
  clearToolCallHistory(): void {
    this.recentToolCalls = [];
    this.recentTextOutputs = [];
  }

  /**
   * Analyze completion signals and determine if the feature is complete
   */
  detectCompletion(feature: Feature, agentText: string): CompletionDetectionResult {
    const signals: CompletionSignal[] = [];
    const now = Date.now();

    // 1. Keyword-based signal (existing logic)
    const keywordSignal = this.detectKeywordSignal(agentText, now);
    if (keywordSignal) signals.push(keywordSignal);

    // 2. Acceptance criteria verification signal
    const acceptanceSignal = this.detectAcceptanceSignal(feature, now);
    if (acceptanceSignal) signals.push(acceptanceSignal);

    // 3. Tool pattern signal
    const toolPatternSignal = this.detectToolPatternSignal(now);
    if (toolPatternSignal) signals.push(toolPatternSignal);

    // 4. Error-free streak signal
    const errorFreeSignal = this.detectErrorFreeStreakSignal(now);
    if (errorFreeSignal) signals.push(errorFreeSignal);

    // Aggregate signals to determine completion
    return this.aggregateSignals(signals, feature);
  }

  /**
   * Detect completion based on keyword patterns in agent text
   */
  private detectKeywordSignal(text: string, now: number): CompletionSignal | null {
    const lower = text.toLowerCase();
    const completionKeywords = [
      "done", "complete", "completed", "finished", "implemented",
      "klaar", "voltooid", "tests pass", "tests slagen", "success",
      "working", "functional", "ready"
    ];

    const found = completionKeywords.filter(kw => lower.includes(kw));
    if (found.length === 0) return null;

    // Higher confidence if multiple keywords are present
    const confidence: CompletionConfidence = found.length >= 2 ? "high" : "medium";

    return {
      type: "keyword",
      confidence,
      evidence: `Found completion keywords: ${found.join(", ")}`,
      timestamp: now
    };
  }

  /**
   * Detect completion based on acceptance criteria verification
   */
  private detectAcceptanceSignal(feature: Feature, now: number): CompletionSignal | null {
    if (feature.acceptance.length === 0) return null;

    const verifiedCount = feature.acceptance.filter(ac => ac.verified).length;
    const waivedCount = feature.acceptance.filter(ac => ac.waived).length;
    const total = feature.acceptance.length;
    const satisfiedCount = verifiedCount + waivedCount;
    const percentage = (satisfiedCount / total) * 100;

    if (percentage === 100) {
      return {
        type: "acceptance",
        confidence: "high",
        evidence: `All ${total} acceptance criteria satisfied (${verifiedCount} verified, ${waivedCount} waived)`,
        timestamp: now
      };
    }

    if (percentage >= 75) {
      return {
        type: "acceptance",
        confidence: "medium",
        evidence: `${satisfiedCount}/${total} acceptance criteria satisfied (${percentage.toFixed(0)}%)`,
        timestamp: now
      };
    }

    return null;
  }

  /**
   * Detect completion based on tool call patterns
   */
  private detectToolPatternSignal(now: number): CompletionSignal | null {
    if (this.recentToolCalls.length < 3) return null;

    // Pattern: recent calls are mostly read operations (suggesting verification)
    const recentReads = this.recentToolCalls.filter(tc => tc.tool === "read").length;
    const readPercentage = (recentReads / this.recentToolCalls.length) * 100;

    if (readPercentage >= 70) {
      return {
        type: "tool_pattern",
        confidence: "medium",
        evidence: `${readPercentage.toFixed(0)}% of recent ${this.recentToolCalls.length} tool calls were read operations (suggesting verification phase)`,
        timestamp: now
      };
    }

    return null;
  }

  /**
   * Detect completion based on error-free streak
   */
  private detectErrorFreeStreakSignal(now: number): CompletionSignal | null {
    if (this.recentToolCalls.length < this.ERROR_FREE_STREAK_THRESHOLD) return null;

    // Check last N tool calls for errors
    const recentCalls = this.recentToolCalls.slice(-this.ERROR_FREE_STREAK_THRESHOLD);
    const allSuccessful = recentCalls.every(tc => tc.success);

    if (allSuccessful) {
      return {
        type: "error_free_streak",
        confidence: "medium",
        evidence: `Last ${this.ERROR_FREE_STREAK_THRESHOLD} tool calls were successful (error-free streak)`,
        timestamp: now
      };
    }

    return null;
  }

  /**
   * Detect if the agent is stuck in a text loop (repeating near-identical outputs)
   */
  detectTextLoop(): { isStuck: boolean; reason: string; suggestedAction: "continue" | "block_self" } {
    if (this.recentTextOutputs.length < this.TEXT_LOOP_SIMILARITY_THRESHOLD) {
      return { isStuck: false, reason: "Insufficient text history", suggestedAction: "continue" };
    }

    const recent = this.recentTextOutputs.slice(-this.TEXT_LOOP_SIMILARITY_THRESHOLD);

    // Check if all recent text outputs have the same hash (near-identical)
    const uniqueHashes = new Set(recent.map(t => t.hash));
    if (uniqueHashes.size <= 2) {
      return {
        isStuck: true,
        reason: `Text loop detected: ${uniqueHashes.size} unique outputs in last ${this.TEXT_LOOP_SIMILARITY_THRESHOLD} turns`,
        suggestedAction: "block_self"
      };
    }

    // Check for explicit stuck phrases in recent outputs
    const stuckPhrases = [
      "i've been stuck in a loop",
      "i need to ask the user directly",
      "actually, let me just provide a final summary",
      "operation aborted",
    ];
    let stuckPhraseCount = 0;
    for (const t of recent) {
      for (const phrase of stuckPhrases) {
        if (t.hash.includes(phrase)) {
          stuckPhraseCount++;
          break;
        }
      }
    }
    if (stuckPhraseCount >= 3) {
      return {
        isStuck: true,
        reason: `Stuck phrases detected in ${stuckPhraseCount}/${this.TEXT_LOOP_SIMILARITY_THRESHOLD} recent turns`,
        suggestedAction: "block_self"
      };
    }

    return { isStuck: false, reason: "No text loop detected", suggestedAction: "continue" };
  }

  /**
   * Detect if the agent is stuck (consecutive failures or repeated patterns)
   */
  detectStuck(): { isStuck: boolean; reason: string; suggestedAction: "continue" | "block_self" } {
    if (this.recentToolCalls.length < this.STUCK_FAILURE_THRESHOLD) {
      return { isStuck: false, reason: "Insufficient tool call history", suggestedAction: "continue" };
    }

    // Check for consecutive failures
    const recentCalls = this.recentToolCalls.slice(-this.STUCK_FAILURE_THRESHOLD);
    const consecutiveFailures = recentCalls.every(tc => !tc.success);

    if (consecutiveFailures) {
      return {
        isStuck: true,
        reason: `${this.STUCK_FAILURE_THRESHOLD} consecutive tool call failures detected`,
        suggestedAction: "block_self"
      };
    }

    // Check for repeated patterns (same tool called repeatedly)
    const lastFiveCalls = this.recentToolCalls.slice(-this.STUCK_REPEAT_PATTERN_THRESHOLD);
    if (lastFiveCalls.length >= this.STUCK_REPEAT_PATTERN_THRESHOLD) {
      const uniqueTools = new Set(lastFiveCalls.map(tc => tc.tool));
      if (uniqueTools.size === 1) {
        const repeatedTool = lastFiveCalls[0].tool;
        return {
          isStuck: true,
          reason: `${this.STUCK_REPEAT_PATTERN_THRESHOLD} consecutive calls to '${repeatedTool}' detected (possible loop)`,
          suggestedAction: "block_self"
        };
      }
    }

    // Check for high failure rate in recent calls
    const recentTenCalls = this.recentToolCalls.slice(-10);
    if (recentTenCalls.length >= 5) {
      const failureCount = recentTenCalls.filter(tc => !tc.success).length;
      const failureRate = failureCount / recentTenCalls.length;
      if (failureRate >= 0.7) {
        return {
          isStuck: true,
          reason: `High failure rate: ${failureCount}/${recentTenCalls.length} recent tool calls failed (${(failureRate * 100).toFixed(0)}%)`,
          suggestedAction: "block_self"
        };
      }
    }

    return { isStuck: false, reason: "No stuck pattern detected", suggestedAction: "continue" };
  }

  /**
   * Aggregate all signals to determine completion status
   */
  private aggregateSignals(signals: CompletionSignal[], feature: Feature): CompletionDetectionResult {
    if (signals.length === 0) {
      return {
        isComplete: false,
        confidence: "low",
        signals: [],
        suggestedAction: "continue",
        reason: "No completion signals detected"
      };
    }

    // Calculate weighted confidence
    const highConfidenceCount = signals.filter(s => s.confidence === "high").length;
    const mediumConfidenceCount = signals.filter(s => s.confidence === "medium").length;

    let overallConfidence: CompletionConfidence;
    if (highConfidenceCount >= 2 || (highConfidenceCount === 1 && mediumConfidenceCount >= 2)) {
      overallConfidence = "high";
    } else if (highConfidenceCount === 1 || mediumConfidenceCount >= 2) {
      overallConfidence = "medium";
    } else {
      overallConfidence = "low";
    }

    // Determine suggested action based on confidence and acceptance criteria
    const acceptancePercentage = feature.acceptance.length > 0
      ? (feature.acceptance.filter(ac => ac.verified || ac.waived).length / feature.acceptance.length) * 100
      : 0;

    let suggestedAction: "auto_done" | "suggest_done" | "continue" | "ask_user";
    let reason: string;

    if (overallConfidence === "high" && acceptancePercentage >= 100) {
      suggestedAction = "auto_done";
      reason = "High confidence with all acceptance criteria satisfied - safe to auto-complete";
    } else if (overallConfidence === "high" && acceptancePercentage >= 75) {
      suggestedAction = "suggest_done";
      reason = "High confidence but some acceptance criteria not verified - suggest completion to user";
    } else if (overallConfidence === "medium" && acceptancePercentage >= 100) {
      suggestedAction = "suggest_done";
      reason = "Medium confidence with all acceptance criteria satisfied - suggest completion to user";
    } else if (overallConfidence === "medium") {
      suggestedAction = "ask_user";
      reason = "Medium confidence - ask user if feature is complete";
    } else {
      suggestedAction = "continue";
      reason = "Low confidence - continue working";
    }

    return {
      isComplete: suggestedAction === "auto_done" || suggestedAction === "suggest_done",
      confidence: overallConfidence,
      signals,
      suggestedAction,
      reason
    };
  }
}

// Global completion detector instance
let globalDetector: CompletionDetector | null = null;

export function getCompletionDetector(): CompletionDetector {
  if (!globalDetector) {
    globalDetector = new CompletionDetector();
  }
  return globalDetector;
}

export function resetCompletionDetector(): void {
  globalDetector = null;
}
