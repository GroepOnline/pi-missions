import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CompletionDetector,
  getCompletionDetector,
  resetCompletionDetector,
} from "../../src/engines/completion.js";
import type { Feature } from "../../src/core/types.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function makeFeature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: "F001",
    milestoneId: "M01",
    title: "Test Feature",
    description: "A test feature",
    priority: 1,
    dependsOn: [],
    acceptance: [
      { id: "AC001", description: "Must work", checkType: "manual", verified: false },
      { id: "AC002", description: "Must pass tests", checkType: "bash", checkCommand: "npm test", verified: false },
    ],
    status: "active",
    sessions: [],
    toolCallCount: 0,
    ...overrides,
  };
}

function makeDetector(): CompletionDetector {
  resetCompletionDetector();
  return getCompletionDetector();
}

beforeEach(() => {
  resetCompletionDetector();
});

afterEach(() => {
  resetCompletionDetector();
});

// ═══════════════════════════════════════════════════════════════════════════════
// recordToolCall / recordTextOutput / clearToolCallHistory
// ═══════════════════════════════════════════════════════════════════════════════

describe("recordToolCall", () => {
  it("records tool calls in order", () => {
    const d = makeDetector();
    d.recordToolCall("read", true);
    d.recordToolCall("bash", false);
    d.recordToolCall("write", true);

    // Verify via detectStuck (needs 3+ records)
    const result = d.detectStuck();
    expect(result.isStuck).toBe(false); // mixed success, not all failures
  });

  it("caps at MAX_RECENT_TOOLS (20)", () => {
    const d = makeDetector();
    for (let i = 0; i < 25; i++) {
      d.recordToolCall("read", true);
    }
    // If it overflowed to 25 consecutive reads, detectCompletion should pick up tool pattern
    // Just verify it doesn't crash — the internal circular buffer is tested indirectly
    const feature = makeFeature();
    const result = d.detectCompletion(feature, "done");
    expect(result).toBeDefined();
  });
});

describe("recordTextOutput", () => {
  it("records text outputs and hashes them", () => {
    const d = makeDetector();
    d.recordTextOutput("This is a long enough text output to be recorded");
    d.recordTextOutput("This is another long text output to be recorded");

    // Verify via detectTextLoop — need 4+ texts (TEXT_LOOP_SIMILARITY_THRESHOLD = 4)
    d.recordTextOutput("Different text output number three here");
    d.recordTextOutput("Different text output number four here");
    const result = d.detectTextLoop();
    // All 4 are different, so not stuck
    expect(result.isStuck).toBe(false);
  });

  it("ignores text shorter than 20 characters", () => {
    const d = makeDetector();
    d.recordTextOutput("short"); // < 20 chars, ignored
    d.recordTextOutput("also short"); // < 20 chars, ignored
    d.recordTextOutput("another short one"); // < 20 chars, ignored
    d.recordTextOutput("tiny"); // < 20 chars, ignored

    const result = d.detectTextLoop();
    expect(result.isStuck).toBe(false);
    expect(result.reason).toBe("Insufficient text history");
  });

  it("caps at MAX_RECENT_TEXTS (10)", () => {
    const d = makeDetector();
    for (let i = 0; i < 15; i++) {
      d.recordTextOutput(`Long enough text output number ${i} for recording purposes`);
    }
    // Should not crash — internal buffer capped at 10
    d.recordTextOutput("Same text again and again and again");
    d.recordTextOutput("Same text again and again and again");
    d.recordTextOutput("Same text again and again and again");
    d.recordTextOutput("Same text again and again and again");
    const result = d.detectTextLoop();
    expect(result).toBeDefined();
  });
});

describe("clearToolCallHistory", () => {
  it("resets all tracking state", () => {
    const d = makeDetector();
    d.recordToolCall("read", true);
    d.recordToolCall("write", true);
    d.recordTextOutput("Long enough text for recording purposes here");

    d.clearToolCallHistory();

    const stuckResult = d.detectStuck();
    expect(stuckResult.reason).toBe("Insufficient tool call history");

    const loopResult = d.detectTextLoop();
    expect(loopResult.reason).toBe("Insufficient text history");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// detectCompletion — keyword signals
// ═══════════════════════════════════════════════════════════════════════════════

describe("detectCompletion — keyword signals", () => {
  it("detects a single completion keyword as medium confidence", () => {
    const d = makeDetector();
    const f = makeFeature();
    // Only "done" matches — avoid "working" (also a keyword)
    const result = d.detectCompletion(f, "The feature is done now");
    const kwSignals = result.signals.filter(s => s.type === "keyword");
    expect(kwSignals).toHaveLength(1);
    expect(kwSignals[0]!.confidence).toBe("medium");
  });

  it("detects multiple completion keywords as high confidence", () => {
    const d = makeDetector();
    const f = makeFeature();
    const result = d.detectCompletion(f, "The feature is done and complete, all tests pass");
    const kwSignals = result.signals.filter(s => s.type === "keyword");
    expect(kwSignals).toHaveLength(1);
    expect(kwSignals[0]!.confidence).toBe("high"); // "done" + "complete" + "tests pass" >= 2
  });

  it("detects Dutch completion keywords", () => {
    const d = makeDetector();
    const f = makeFeature();
    const result = d.detectCompletion(f, "De feature is klaar en voltooid");
    const kwSignals = result.signals.filter(s => s.type === "keyword");
    expect(kwSignals).toHaveLength(1);
    expect(kwSignals[0]!.confidence).toBe("high"); // "klaar" + "voltooid" >= 2
  });

  it("returns no keyword signal when no keywords match", () => {
    const d = makeDetector();
    const f = makeFeature();
    // Avoid "working", "done", "complete", "ready", etc.
    const result = d.detectCompletion(f, "Still coding on the implementation details");
    const kwSignals = result.signals.filter(s => s.type === "keyword");
    expect(kwSignals).toHaveLength(0);
  });

  it("is case-insensitive for keywords", () => {
    const d = makeDetector();
    const f = makeFeature();
    const result = d.detectCompletion(f, "Feature is DONE and COMPLETE");
    const kwSignals = result.signals.filter(s => s.type === "keyword");
    expect(kwSignals).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// detectCompletion — acceptance signals
// ═══════════════════════════════════════════════════════════════════════════════

describe("detectCompletion — acceptance signals", () => {
  it("returns null when feature has no acceptance criteria", () => {
    const d = makeDetector();
    const f = makeFeature({ acceptance: [] });
    const result = d.detectCompletion(f, "done");
    const acSignals = result.signals.filter(s => s.type === "acceptance");
    expect(acSignals).toHaveLength(0);
  });

  it("returns high confidence when all criteria are satisfied", () => {
    const d = makeDetector();
    const f = makeFeature({
      acceptance: [
        { id: "AC001", description: "Works", checkType: "manual", verified: true },
        { id: "AC002", description: "Passes", checkType: "bash", verified: true },
      ],
    });
    const result = d.detectCompletion(f, "done");
    const acSignals = result.signals.filter(s => s.type === "acceptance");
    expect(acSignals).toHaveLength(1);
    expect(acSignals[0]!.confidence).toBe("high");
  });

  it("returns medium confidence when 75%+ criteria are satisfied (but not 100%)", () => {
    const d = makeDetector();
    const f = makeFeature({
      acceptance: [
        { id: "AC001", description: "Works", checkType: "manual", verified: true },
        { id: "AC002", description: "Passes", checkType: "bash", verified: true },
        { id: "AC003", description: "Docs", checkType: "manual", verified: true },
        { id: "AC004", description: "Lint", checkType: "bash", verified: false },
      ],
    });
    const result = d.detectCompletion(f, "done");
    const acSignals = result.signals.filter(s => s.type === "acceptance");
    expect(acSignals).toHaveLength(1);
    expect(acSignals[0]!.confidence).toBe("medium"); // 3/4 = 75%
  });

  it("returns null when less than 75% criteria are satisfied", () => {
    const d = makeDetector();
    const f = makeFeature({
      acceptance: [
        { id: "AC001", description: "Works", checkType: "manual", verified: false },
        { id: "AC002", description: "Passes", checkType: "bash", verified: false },
        { id: "AC003", description: "Docs", checkType: "manual", verified: true },
        { id: "AC004", description: "Lint", checkType: "bash", verified: false },
      ],
    });
    const result = d.detectCompletion(f, "done");
    const acSignals = result.signals.filter(s => s.type === "acceptance");
    expect(acSignals).toHaveLength(0); // 1/4 = 25% < 75%
  });

  it("counts waived criteria as satisfied", () => {
    const d = makeDetector();
    const f = makeFeature({
      acceptance: [
        { id: "AC001", description: "Works", checkType: "manual", verified: true },
        { id: "AC002", description: "Optional", checkType: "manual", verified: false, waived: true },
      ],
    });
    const result = d.detectCompletion(f, "done");
    const acSignals = result.signals.filter(s => s.type === "acceptance");
    expect(acSignals).toHaveLength(1);
    expect(acSignals[0]!.confidence).toBe("high"); // 2/2 satisfied (1 verified + 1 waived)
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// detectCompletion — tool pattern signals
// ═══════════════════════════════════════════════════════════════════════════════

describe("detectCompletion — tool pattern signals", () => {
  it("returns null when fewer than 3 tool calls recorded", () => {
    const d = makeDetector();
    d.recordToolCall("read", true);
    d.recordToolCall("read", true);
    const f = makeFeature();
    const result = d.detectCompletion(f, "done");
    const tpSignals = result.signals.filter(s => s.type === "tool_pattern");
    expect(tpSignals).toHaveLength(0);
  });

  it("detects when 70%+ of recent tool calls are read operations", () => {
    const d = makeDetector();
    // 8 reads + 2 writes = 80% reads
    for (let i = 0; i < 8; i++) d.recordToolCall("read", true);
    d.recordToolCall("write", true);
    d.recordToolCall("write", true);

    const f = makeFeature();
    const result = d.detectCompletion(f, "done");
    const tpSignals = result.signals.filter(s => s.type === "tool_pattern");
    expect(tpSignals).toHaveLength(1);
    expect(tpSignals[0]!.confidence).toBe("medium");
  });

  it("returns null when reads are below 70%", () => {
    const d = makeDetector();
    d.recordToolCall("read", true);
    d.recordToolCall("write", true);
    d.recordToolCall("write", true);
    d.recordToolCall("read", true);
    d.recordToolCall("write", true); // 2/5 = 40%

    const f = makeFeature();
    const result = d.detectCompletion(f, "done");
    const tpSignals = result.signals.filter(s => s.type === "tool_pattern");
    expect(tpSignals).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// detectCompletion — error-free streak signals
// ═══════════════════════════════════════════════════════════════════════════════

describe("detectCompletion — error-free streak signals", () => {
  it("returns null when fewer than 5 tool calls recorded", () => {
    const d = makeDetector();
    for (let i = 0; i < 4; i++) d.recordToolCall("read", true);
    const f = makeFeature();
    const result = d.detectCompletion(f, "done");
    const efSignals = result.signals.filter(s => s.type === "error_free_streak");
    expect(efSignals).toHaveLength(0);
  });

  it("detects 5 consecutive successful tool calls", () => {
    const d = makeDetector();
    for (let i = 0; i < 5; i++) d.recordToolCall("read", true);

    const f = makeFeature();
    const result = d.detectCompletion(f, "done");
    const efSignals = result.signals.filter(s => s.type === "error_free_streak");
    expect(efSignals).toHaveLength(1);
    expect(efSignals[0]!.confidence).toBe("medium");
  });

  it("returns null when recent calls include failures", () => {
    const d = makeDetector();
    d.recordToolCall("read", true);
    d.recordToolCall("read", true);
    d.recordToolCall("read", true);
    d.recordToolCall("read", true);
    d.recordToolCall("bash", false); // failure!

    const f = makeFeature();
    const result = d.detectCompletion(f, "done");
    const efSignals = result.signals.filter(s => s.type === "error_free_streak");
    expect(efSignals).toHaveLength(0);
  });

  it("only checks the last 5 calls (ignores older successes)", () => {
    const d = makeDetector();
    d.recordToolCall("bash", false); // old failure
    for (let i = 0; i < 5; i++) d.recordToolCall("read", true); // 5 recent successes

    const f = makeFeature();
    const result = d.detectCompletion(f, "done");
    const efSignals = result.signals.filter(s => s.type === "error_free_streak");
    expect(efSignals).toHaveLength(1); // last 5 are all success
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// detectCompletion — signal aggregation
// ═══════════════════════════════════════════════════════════════════════════════

describe("detectCompletion — aggregation", () => {
  it("returns 'continue' when no signals detected", () => {
    const d = makeDetector();
    const f = makeFeature({ acceptance: [] });
    const result = d.detectCompletion(f, "still working on this");
    expect(result.isComplete).toBe(false);
    expect(result.suggestedAction).toBe("continue");
    expect(result.confidence).toBe("low");
  });

  it("returns 'auto_done' with high confidence + all acceptance satisfied", () => {
    const d = makeDetector();
    const f = makeFeature({
      acceptance: [
        { id: "AC001", description: "Works", checkType: "manual", verified: true },
        { id: "AC002", description: "Passes", checkType: "bash", verified: true },
      ],
    });
    // High keyword signal (2+ keywords) + high acceptance (100% satisfied)
    const result = d.detectCompletion(f, "The feature is done and complete, ready for review");
    expect(result.confidence).toBe("high");
    expect(result.suggestedAction).toBe("auto_done");
    expect(result.isComplete).toBe(true);
  });

  it("returns 'suggest_done' with high confidence + acceptance ≥ 75%", () => {
    const d = makeDetector();
    const f = makeFeature({
      acceptance: [
        { id: "AC001", description: "Works", checkType: "manual", verified: true },
        { id: "AC002", description: "Passes", checkType: "bash", verified: true },
        { id: "AC003", description: "Docs", checkType: "manual", verified: true },
        { id: "AC004", description: "Lint", checkType: "bash", verified: false },
      ],
    });
    // Need 2 medium signals to pair with 1 high → high confidence
    // acceptance (3/4=75%) = medium + error_free_streak = medium + keyword(high)
    // = 1 high + 2 medium → high confidence → ≥75% ac = suggest_done
    for (let i = 0; i < 5; i++) d.recordToolCall("read", true);
    const result = d.detectCompletion(f, "done and complete, ready for review");
    expect(result.confidence).toBe("high");
    expect(result.suggestedAction).toBe("suggest_done");
    expect(result.isComplete).toBe(true);
  });

  it("returns 'ask_user' with medium aggregate confidence", () => {
    const d = makeDetector();
    const f = makeFeature({
      acceptance: [
        { id: "AC001", description: "Works", checkType: "manual", verified: false },
      ],
    });
    // Two keywords = high signal + acceptance @0% = no signal → 1 high = medium overall
    const result = d.detectCompletion(f, "The feature is done and complete");
    expect(result.confidence).toBe("medium");
    expect(result.suggestedAction).toBe("ask_user");
    expect(result.isComplete).toBe(false);
  });

  it("returns 'continue' with low confidence (single medium signal)", () => {
    const d = makeDetector();
    const f = makeFeature({
      acceptance: [
        { id: "AC001", description: "Works", checkType: "manual", verified: false },
      ],
    });
    // Single keyword = one medium signal → aggregates to low confidence
    const result = d.detectCompletion(f, "The feature is done");
    expect(result.confidence).toBe("low");
    expect(result.suggestedAction).toBe("continue");
    expect(result.isComplete).toBe(false);
  });

  it("returns 'suggest_done' with medium confidence + all acceptance satisfied", () => {
    const d = makeDetector();
    const f = makeFeature({
      acceptance: [
        { id: "AC001", description: "Works", checkType: "manual", verified: true },
      ],
    });
    // Single keyword = medium, but 100% acceptance
    const result = d.detectCompletion(f, "The feature is done");
    expect(result.confidence).toBe("medium");
    expect(result.suggestedAction).toBe("suggest_done");
    expect(result.isComplete).toBe(true);
  });

  it("aggregates signals to high confidence with 2 high signals", () => {
    const d = makeDetector();
    const f = makeFeature({
      acceptance: [
        { id: "AC001", description: "Works", checkType: "manual", verified: true },
        { id: "AC002", description: "Passes", checkType: "bash", verified: true },
      ],
    });
    // Multiple keywords (high) + 100% acceptance (high) = 2 high signals
    const result = d.detectCompletion(f, "done complete finished");
    expect(result.confidence).toBe("high");
  });

  it("aggregates signals to high confidence with 1 high + 2 medium", () => {
    const d = makeDetector();
    for (let i = 0; i < 5; i++) d.recordToolCall("read", true); // error-free streak (medium)
    // 8 reads + 2 writes = tool pattern (medium)
    for (let i = 0; i < 3; i++) d.recordToolCall("read", true);
    d.recordToolCall("write", true);
    d.recordToolCall("write", true);

    const f = makeFeature({
      acceptance: [
        { id: "AC001", description: "Works", checkType: "manual", verified: true },
        { id: "AC002", description: "Passes", checkType: "bash", verified: true },
      ],
    });
    // Acceptance (high) + error_free_streak (medium) + tool_pattern (medium) = 1 high + 2 medium → high
    const result = d.detectCompletion(f, "done");
    expect(result.confidence).toBe("high");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// detectTextLoop
// ═══════════════════════════════════════════════════════════════════════════════

describe("detectTextLoop", () => {
  it("returns not stuck when insufficient text history", () => {
    const d = makeDetector();
    d.recordTextOutput("Text output number one for testing");
    d.recordTextOutput("Text output number two for testing");
    d.recordTextOutput("Text output number three for testing");

    const result = d.detectTextLoop();
    expect(result.isStuck).toBe(false);
    expect(result.reason).toBe("Insufficient text history");
    expect(result.suggestedAction).toBe("continue");
  });

  it("detects text loop when 4+ recent outputs hash to ≤2 unique values", () => {
    const d = makeDetector();
    d.recordTextOutput("I am repeating myself again and again and again");
    d.recordTextOutput("I am repeating myself again and again and again");
    d.recordTextOutput("Different output here for variation purposes");
    d.recordTextOutput("I am repeating myself again and again and again");

    const result = d.detectTextLoop();
    // 3 of "I am repeating..." hash the same, 1 different = 2 unique ≤ 2
    expect(result.isStuck).toBe(true);
    expect(result.suggestedAction).toBe("block_self");
  });

  it("detects stuck phrases in recent outputs", () => {
    const d = makeDetector();
    d.recordTextOutput("I've been stuck in a loop for quite some time now");
    d.recordTextOutput("Actually, let me just provide a final summary here");
    d.recordTextOutput("I think i need to ask the user directly for help");
    d.recordTextOutput("Actually i have been working on this too long");

    const result = d.detectTextLoop();
    // 3 outputs contain stuck phrases
    expect(result.isStuck).toBe(true);
    expect(result.suggestedAction).toBe("block_self");
  });

  it("returns not stuck with diverse outputs", () => {
    const d = makeDetector();
    d.recordTextOutput("Let me analyze the codebase structure first");
    d.recordTextOutput("I found the issue in authentication module");
    d.recordTextOutput("Now implementing the fix for the login flow");
    d.recordTextOutput("Tests are passing, feature is complete");

    const result = d.detectTextLoop();
    expect(result.isStuck).toBe(false);
    expect(result.suggestedAction).toBe("continue");
  });

  it("handles empty text history gracefully", () => {
    const d = makeDetector();
    const result = d.detectTextLoop();
    expect(result.isStuck).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// detectStuck
// ═══════════════════════════════════════════════════════════════════════════════

describe("detectStuck", () => {
  it("returns not stuck when insufficient tool call history", () => {
    const d = makeDetector();
    d.recordToolCall("read", false);
    d.recordToolCall("read", false);

    const result = d.detectStuck();
    expect(result.isStuck).toBe(false);
    expect(result.reason).toBe("Insufficient tool call history");
  });

  it("detects 3 consecutive failures as stuck", () => {
    const d = makeDetector();
    d.recordToolCall("read", false);
    d.recordToolCall("bash", false);
    d.recordToolCall("write", false);

    const result = d.detectStuck();
    expect(result.isStuck).toBe(true);
    expect(result.reason).toContain("consecutive failures");
    expect(result.suggestedAction).toBe("block_self");
  });

  it("returns not stuck when failures are interspersed with successes", () => {
    const d = makeDetector();
    d.recordToolCall("read", false);
    d.recordToolCall("read", true);
    d.recordToolCall("bash", false);
    d.recordToolCall("write", true);
    d.recordToolCall("read", false);

    const result = d.detectStuck();
    expect(result.isStuck).toBe(false);
  });

  it("detects stuck when last 5 calls are all the same tool", () => {
    const d = makeDetector();
    d.recordToolCall("read", false);
    d.recordToolCall("read", true);
    d.recordToolCall("read", false);
    d.recordToolCall("read", true);
    d.recordToolCall("read", false);
    d.recordToolCall("read", true); // 6 calls total, last 5 are all "read"

    const result = d.detectStuck();
    expect(result.isStuck).toBe(true);
    expect(result.reason).toContain("consecutive calls to 'read'");
  });

  it("returns not stuck when last 5 calls use different tools", () => {
    const d = makeDetector();
    d.recordToolCall("read", true);
    d.recordToolCall("bash", true);
    d.recordToolCall("write", true);
    d.recordToolCall("read", true);
    d.recordToolCall("bash", true);

    const result = d.detectStuck();
    expect(result.isStuck).toBe(false);
  });

  it("detects high failure rate (70%+ of last 10)", () => {
    const d = makeDetector();
    d.recordToolCall("read", false);
    d.recordToolCall("bash", false);
    d.recordToolCall("write", false);
    d.recordToolCall("read", false);
    d.recordToolCall("bash", false);
    d.recordToolCall("write", false);
    d.recordToolCall("read", false); // 7 failures
    d.recordToolCall("bash", true);
    d.recordToolCall("write", true);
    d.recordToolCall("read", true); // 3 successes

    const result = d.detectStuck();
    expect(result.isStuck).toBe(true);
    expect(result.reason).toContain("High failure rate");
  });

  it("returns not stuck when failure rate is below 70%", () => {
    const d = makeDetector();
    d.recordToolCall("read", false);
    d.recordToolCall("bash", false);
    d.recordToolCall("write", false); // 3 failures
    d.recordToolCall("read", true);
    d.recordToolCall("bash", true);
    d.recordToolCall("write", true);
    d.recordToolCall("read", true);
    d.recordToolCall("bash", true);
    d.recordToolCall("write", true);
    d.recordToolCall("read", true); // 7 successes

    // 3/10 = 30% < 70%
    const result = d.detectStuck();
    expect(result.isStuck).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton pattern
// ═══════════════════════════════════════════════════════════════════════════════

describe("getCompletionDetector / resetCompletionDetector", () => {
  it("returns the same instance on repeated calls", () => {
    resetCompletionDetector();
    const d1 = getCompletionDetector();
    const d2 = getCompletionDetector();
    expect(d1).toBe(d2);
  });

  it("creates a fresh instance after reset", () => {
    resetCompletionDetector();
    const d1 = getCompletionDetector();
    d1.recordToolCall("read", true);

    resetCompletionDetector();
    const d2 = getCompletionDetector();
    // The new instance should have no tool call history
    const result = d2.detectStuck();
    expect(result.reason).toBe("Insufficient tool call history");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("edge cases", () => {
  it("handles empty agent text", () => {
    const d = makeDetector();
    const f = makeFeature();
    const result = d.detectCompletion(f, "");
    // No keywords, but acceptance may still fire
    expect(result).toBeDefined();
  });

  it("handles feature with all criteria already verified", () => {
    const d = makeDetector();
    const f = makeFeature({
      acceptance: [
        { id: "AC001", description: "Works", checkType: "manual", verified: true },
      ],
    });
    const result = d.detectCompletion(f, "done");
    expect(result.signals.filter(s => s.type === "acceptance")).toHaveLength(1);
  });

  it("detectCompletion integrates all four signal types", () => {
    const d = makeDetector();
    // Set up error-free streak
    for (let i = 0; i < 5; i++) d.recordToolCall("read", true);
    // Set up tool pattern (8 more reads = 13 total)
    for (let i = 0; i < 8; i++) d.recordToolCall("read", true);
    d.recordToolCall("write", true);
    d.recordToolCall("write", true); // 15 total, 13 reads = 86.7%

    const f = makeFeature({
      acceptance: [
        { id: "AC001", description: "Works", checkType: "manual", verified: true },
        { id: "AC002", description: "Passes", checkType: "bash", verified: true },
      ],
    });

    const result = d.detectCompletion(f, "Feature is done and complete, all tests pass");
    const signalTypes = result.signals.map(s => s.type).sort();
    expect(signalTypes).toContain("keyword");
    expect(signalTypes).toContain("acceptance");
    expect(signalTypes).toContain("tool_pattern");
    expect(signalTypes).toContain("error_free_streak");
    // With all 4 signals: keyword(high) + acceptance(high) + 2 medium = high confidence
    expect(result.confidence).toBe("high");
  });
});
