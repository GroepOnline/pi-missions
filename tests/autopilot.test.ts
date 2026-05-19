import { afterEach, describe, expect, it, vi } from "vitest";
import { buildContinuationPrompt, ensureActiveFeature, processAgentEndForAutopilot, shouldContinue, triggerContinuation } from "../src/engines/autopilot.js";
import { createMission, getActiveFeature, getFeatureById } from "../src/core/state.js";
import { getCompletionDetector } from "../src/engines/completion.js";
import * as stateModule from "../src/core/state.js";

function ctx() {
  return {
    ui: { setStatus: vi.fn(), notify: vi.fn() },
    getContextUsage: () => ({ percent: 10 }),
  } as any;
}

function makeRuntime(m?: ReturnType<typeof createMission>) {
  return {
    activeMission: m ?? null,
    autoSaveInterval: null,
    phaseToolCallCount: 0,
    currentPhase: "execution" as const,
    lastFeatureId: undefined,
  } as any;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("autopilot engine", () => {
  it("does not continue when disabled", () => {
    const m = createMission("A", "B");
    expect(shouldContinue(m).continue).toBe(false);
  });

  it("does not continue when paused", () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.status = "paused";
    expect(shouldContinue(m).reason).toBe("paused_by_user");
  });

  it("does not continue when blocked", () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.status = "blocked";
    expect(shouldContinue(m).reason).toBe("blocked");
  });

  it("does not continue when complete", () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.status = "complete";
    expect(shouldContinue(m).reason).toBe("mission_complete");
  });

  it("stops at max iterations", () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.autopilot.iteration = m.autopilot.maxIterations;
    expect(shouldContinue(m).reason).toBe("max_iterations");
  });

  it("stops at max consecutive failures", () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.autopilot.consecutiveFailures = m.autopilot.maxConsecutiveFailures;
    expect(shouldContinue(m).reason).toBe("max_consecutive_failures");
  });

  it("stops at max no-progress turns", () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.autopilot.noProgressTurns = m.autopilot.maxNoProgressTurns;
    expect(shouldContinue(m).reason).toBe("no_progress");
  });

  it("continues with active feature and valid budgets", () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    expect(shouldContinue(m, ctx()).continue).toBe(true);
  });

  it("activates first runnable feature", () => {
    const m = createMission("A", "B");
    getActiveFeature(m)!.status = "done";
    m.activeFeatureId = undefined;
    const next = ensureActiveFeature(m);
    expect(next?.id).toBe("F002");
    expect(next?.status).toBe("active");
  });

  it("sets mission complete when all features are done", () => {
    const m = createMission("A", "B");
    for (const f of m.milestones[0]!.features) f.status = "done";
    m.activeFeatureId = undefined;
    expect(ensureActiveFeature(m)).toBeNull();
    expect(m.status).toBe("complete");
  });

  it("builds a bounded continuation prompt", () => {
    const m = createMission("Enterprise mission", "Ship runtime");
    const prompt = buildContinuationPrompt(m);
    expect(prompt).toContain("Enterprise mission");
    expect(prompt).toContain("F001");
    expect(prompt).toContain("After this turn");
  });

  it("sends follow-up when allowed", async () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    const pi = { sendUserMessage: vi.fn().mockResolvedValue(undefined) } as any;
    await triggerContinuation(pi, ctx(), m);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
  });

  it("does not send follow-up when paused", async () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.status = "paused";
    const pi = { sendUserMessage: vi.fn().mockResolvedValue(undefined) } as any;
    await triggerContinuation(pi, ctx(), m);
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
  });

  it("agent_end triggers follow-up when autopilot remains active", async () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    const runtime = { activeMission: m, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution" as const, lastFeatureId: undefined };
    const pi = { sendUserMessage: vi.fn().mockResolvedValue(undefined) } as any;
    const event = { messages: [{ content: [{ type: "text", text: "Updated files and made progress." }] }] };
    await processAgentEndForAutopilot(pi, ctx(), event, runtime);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
  });

  it("agent_end stops on blocker", async () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    const runtime = makeRuntime(m);
    const pi = { sendUserMessage: vi.fn().mockResolvedValue(undefined) } as any;
    const event = { messages: [{ content: [{ type: "text", text: "blocked: need API key" }] }] };
    await processAgentEndForAutopilot(pi, ctx(), event, runtime);
    expect(m.autopilot.enabled).toBe(false);
    expect(m.autopilot.lastStopReason).toBe("blocked");
    expect(getFeatureById(m, "F001")!.status).toBe("blocked");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// shouldContinue — context limit
// ═══════════════════════════════════════════════════════════════════════════

describe("shouldContinue — context limit", () => {
  it("stops when context usage exceeds maxContextPercent", () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    const highUsageCtx = { ...ctx(), getContextUsage: () => ({ percent: 90 }) };
    expect(shouldContinue(m, highUsageCtx).reason).toBe("context_limit");
  });

  it("continues when context usage is under maxContextPercent", () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    const lowUsageCtx = { ...ctx(), getContextUsage: () => ({ percent: 50 }) };
    expect(shouldContinue(m, lowUsageCtx).continue).toBe(true);
  });

  it("continues when ctx is undefined (no context usage info)", () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    expect(shouldContinue(m, undefined).continue).toBe(true);
  });

  it("continues when getContextUsage returns undefined percent", () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    const noPctCtx = { ...ctx(), getContextUsage: () => ({ percent: undefined }) };
    expect(shouldContinue(m, noPctCtx).continue).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ensureActiveFeature — edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("ensureActiveFeature — edge cases", () => {
  it("returns active feature immediately when already active", () => {
    const m = createMission("A", "B");
    const feat = getActiveFeature(m)!;
    feat.status = "active";
    const result = ensureActiveFeature(m);
    expect(result).toBe(feat);
    expect(result!.status).toBe("active");
  });

  it("activates next feature when current one is pending (not active)", () => {
    const m = createMission("A", "B");
    getActiveFeature(m)!.status = "pending";
    m.activeFeatureId = undefined;
    const next = ensureActiveFeature(m);
    expect(next?.id).toBe("F001");
    expect(next?.status).toBe("active");
  });

  it("does not reactivate an already-done feature", () => {
    const m = createMission("A", "B");
    getActiveFeature(m)!.status = "done";
    m.activeFeatureId = undefined;
    const next = ensureActiveFeature(m);
    expect(next?.id).toBe("F002");
    expect(next?.status).toBe("active");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// processAgentEndForAutopilot — early returns & detection branches
// ═══════════════════════════════════════════════════════════════════════════

describe("processAgentEndForAutopilot", () => {
  function makePi() {
    return { sendUserMessage: vi.fn().mockResolvedValue(undefined) } as any;
  }

  it("returns early when no active mission", async () => {
    const pi = makePi();
    const c = ctx();
    const runtime = { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution" as const, lastFeatureId: undefined } as any;
    await processAgentEndForAutopilot(pi, c, { messages: [] }, runtime);
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
  });

  it("returns early when autopilot is not enabled", async () => {
    const m = createMission("A", "B");
    // default: autopilot.enabled = false
    const pi = makePi();
    const runtime = makeRuntime(m);
    await processAgentEndForAutopilot(pi, ctx(), { messages: [] }, runtime);
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
  });

  it("increments noProgressTurns for aborted + no progress combined", async () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.autopilot.noProgressTurns = 0;
    const runtime = makeRuntime(m);
    const pi = makePi();
    // wasAborted +1, !madeProgress +1 = 2. Avoid madeProgress decrement with "no progress".
    const event = { messages: [{ content: [{ type: "text", text: "Operation aborted. No progress." }] }] };
    await processAgentEndForAutopilot(pi, ctx(), event, runtime);
    expect(m.autopilot.noProgressTurns).toBe(2);
  });

  it("increments noProgressTurns for cancelled + no progress combined", async () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.autopilot.noProgressTurns = 0;
    const runtime = makeRuntime(m);
    const pi = makePi();
    const event = { messages: [{ content: [{ type: "text", text: "Operation cancelled. Same state." }] }] };
    await processAgentEndForAutopilot(pi, ctx(), event, runtime);
    expect(m.autopilot.noProgressTurns).toBe(2);
  });

  it("increments noProgressTurns by 2 for text loop (progress check doesn't cancel it)", async () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.autopilot.noProgressTurns = 0;
    const runtime = makeRuntime(m);
    const pi = makePi();
    vi.spyOn(getCompletionDetector(), "detectTextLoop").mockReturnValue({
      isStuck: true, suggestedAction: "block_self", reason: "Repeated output pattern",
    });
    // Text that triggers "no progress" avoids the madeProgress decrement
    const event = { messages: [{ content: [{ type: "text", text: "No progress. Same state as before." }] }] };
    await processAgentEndForAutopilot(pi, ctx(), event, runtime);
    // textLoop +2, aborted false, madeProgress false (contains "no progress") → +1, total: 3
    // Wait: inTextLoop→+2, wasAborted→0, !madeProgress → +1 → = 3
    expect(m.autopilot.noProgressTurns).toBe(3);
  });

  it("adds both aborted and text loop noProgressTurns together", async () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.autopilot.noProgressTurns = 0;
    const runtime = makeRuntime(m);
    const pi = makePi();
    vi.spyOn(getCompletionDetector(), "detectTextLoop").mockReturnValue({
      isStuck: true, suggestedAction: "block_self", reason: "Repeated output pattern",
    });
    // Text triggers both "aborted" and avoids madeProgress decrement
    const event = { messages: [{ content: [{ type: "text", text: "Operation aborted. No progress." }] }] };
    await processAgentEndForAutopilot(pi, ctx(), event, runtime);
    // inTextLoop +2, wasAborted +1, !madeProgress (contains "no progress") +1 = 4
    expect(m.autopilot.noProgressTurns).toBe(4);
  });

  it("stops autopilot when model wants to ask user", async () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    const runtime = makeRuntime(m);
    const pi = makePi();
    const event = { messages: [{ content: [{ type: "text", text: "I need to ask the user about the design choice." }] }] };
    await processAgentEndForAutopilot(pi, ctx(), event, runtime);
    expect(m.autopilot.enabled).toBe(false);
    expect(m.autopilot.lastStopReason).toBe("needs_user_decision");
  });

  it("does not false-trigger wantsToAskUser when mission_ask_user is in text", async () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.autopilot.noProgressTurns = 0;
    const runtime = makeRuntime(m);
    const pi = makePi();
    const event = { messages: [{ content: [{ type: "text", text: "I need to ask the user, so I'll call mission_ask_user." }] }] };
    await processAgentEndForAutopilot(pi, ctx(), event, runtime);
    // Should NOT stop autopilot — contains mission_ask_user
    expect(m.autopilot.enabled).toBe(true);
    expect(m.autopilot.lastStopReason).not.toBe("needs_user_decision");
  });

  it("stops autopilot when blocked via feature status", async () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    getActiveFeature(m)!.status = "blocked";
    const runtime = makeRuntime(m);
    const pi = makePi();
    const event = { messages: [{ content: [{ type: "text", text: "Working on things." }] }] };
    await processAgentEndForAutopilot(pi, ctx(), event, runtime);
    expect(m.autopilot.enabled).toBe(false);
    expect(m.autopilot.lastStopReason).toBe("blocked");
  });

  it("increments consecutiveFailures when text contains error", async () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.autopilot.consecutiveFailures = 0;
    const runtime = makeRuntime(m);
    const pi = makePi();
    const event = { messages: [{ content: [{ type: "text", text: "Encountered an error during execution." }] }] };
    await processAgentEndForAutopilot(pi, ctx(), event, runtime);
    expect(m.autopilot.consecutiveFailures).toBe(1);
  });

  it("resets consecutiveFailures on success (no error text)", async () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.autopilot.consecutiveFailures = 2;
    const runtime = makeRuntime(m);
    const pi = makePi();
    const event = { messages: [{ content: [{ type: "text", text: "Successfully completed the task." }] }] };
    await processAgentEndForAutopilot(pi, ctx(), event, runtime);
    expect(m.autopilot.consecutiveFailures).toBe(0);
  });

  it("increments noProgressTurns when text says no progress", async () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.autopilot.noProgressTurns = 0;
    const runtime = makeRuntime(m);
    const pi = makePi();
    const event = { messages: [{ content: [{ type: "text", text: "No progress made this turn." }] }] };
    await processAgentEndForAutopilot(pi, ctx(), event, runtime);
    expect(m.autopilot.noProgressTurns).toBe(1);
  });

  it("decrements noProgressTurns when progress is made (min 0)", async () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.autopilot.noProgressTurns = 2;
    const runtime = makeRuntime(m);
    const pi = makePi();
    const event = { messages: [{ content: [{ type: "text", text: "Implemented the feature successfully." }] }] };
    await processAgentEndForAutopilot(pi, ctx(), event, runtime);
    expect(m.autopilot.noProgressTurns).toBe(1);
  });

  it("does not go below zero when decrementing noProgressTurns", async () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.autopilot.noProgressTurns = 0;
    const runtime = makeRuntime(m);
    const pi = makePi();
    const event = { messages: [{ content: [{ type: "text", text: "Great progress on the implementation." }] }] };
    await processAgentEndForAutopilot(pi, ctx(), event, runtime);
    expect(m.autopilot.noProgressTurns).toBe(0);
  });

  it("disables autopilot when shouldContinue returns false after errors", async () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    // Start at 2 so that hasError increments to 3 (max)
    m.autopilot.consecutiveFailures = 2;
    const runtime = makeRuntime(m);
    const pi = makePi();
    const event = { messages: [{ content: [{ type: "text", text: "Task failed with an error." }] }] };
    await processAgentEndForAutopilot(pi, ctx(), event, runtime);
    expect(m.autopilot.enabled).toBe(false);
    expect(m.autopilot.lastStopReason).toBe("max_consecutive_failures");
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
  });

  it("handles empty messages array", async () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.autopilot.consecutiveFailures = 1;
    const runtime = makeRuntime(m);
    const pi = makePi();
    const event = { messages: [] };
    await processAgentEndForAutopilot(pi, ctx(), event, runtime);
    // No error text, so consecutiveFailures resets to 0
    expect(m.autopilot.consecutiveFailures).toBe(0);
  });

  it("handles messages with string content (non-array)", async () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    const runtime = makeRuntime(m);
    const pi = makePi();
    const event = { messages: [{ content: "Plain string content" }] };
    await processAgentEndForAutopilot(pi, ctx(), event, runtime);
    // Should not throw — flatMap on non-array returns empty, but string is iterable
    // so it would yield characters. But the filter checks c?.type === "text",
    // which won't match string characters. So text is empty.
    // Should continue since no stop conditions triggered.
    expect(m.autopilot.enabled).toBe(true);
  });
});
