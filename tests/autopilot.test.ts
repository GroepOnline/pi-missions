import { describe, expect, it, vi } from "vitest";
import { buildAutopilotContinuationPrompt, ensureActiveFeature, processAgentEndForAutopilot, shouldContinueMission, triggerMissionContinuation } from "../src/autopilot.js";
import { createMission, getActiveFeature, getFeatureById } from "../src/state.js";

function ctx() {
  return {
    ui: { setStatus: vi.fn(), notify: vi.fn() },
    getContextUsage: () => ({ percent: 10 }),
  } as any;
}

describe("autopilot engine", () => {
  it("does not continue when disabled", () => {
    const m = createMission("A", "B");
    expect(shouldContinueMission(m).continue).toBe(false);
  });

  it("does not continue when paused", () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.status = "paused";
    expect(shouldContinueMission(m).reason).toBe("paused_by_user");
  });

  it("does not continue when blocked", () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.status = "blocked";
    expect(shouldContinueMission(m).reason).toBe("blocked");
  });

  it("does not continue when complete", () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.status = "complete";
    expect(shouldContinueMission(m).reason).toBe("mission_complete");
  });

  it("stops at max iterations", () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.autopilot.iteration = m.autopilot.maxIterations;
    expect(shouldContinueMission(m).reason).toBe("max_iterations");
  });

  it("stops at max consecutive failures", () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.autopilot.consecutiveFailures = m.autopilot.maxConsecutiveFailures;
    expect(shouldContinueMission(m).reason).toBe("max_consecutive_failures");
  });

  it("stops at max no-progress turns", () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.autopilot.noProgressTurns = m.autopilot.maxNoProgressTurns;
    expect(shouldContinueMission(m).reason).toBe("no_progress");
  });

  it("continues with active feature and valid budgets", () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    expect(shouldContinueMission(m, ctx()).continue).toBe(true);
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
    const prompt = buildAutopilotContinuationPrompt(m);
    expect(prompt).toContain("Enterprise mission");
    expect(prompt).toContain("F001");
    expect(prompt).toContain("After this turn");
  });

  it("sends follow-up when allowed", async () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    const pi = { sendUserMessage: vi.fn().mockResolvedValue(undefined) } as any;
    await triggerMissionContinuation(pi, ctx(), m);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
  });

  it("does not send follow-up when paused", async () => {
    const m = createMission("A", "B");
    m.autopilot.enabled = true;
    m.status = "paused";
    const pi = { sendUserMessage: vi.fn().mockResolvedValue(undefined) } as any;
    await triggerMissionContinuation(pi, ctx(), m);
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
    const runtime = { activeMission: m, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution" as const, lastFeatureId: undefined };
    const pi = { sendUserMessage: vi.fn().mockResolvedValue(undefined) } as any;
    const event = { messages: [{ content: [{ type: "text", text: "blocked: need API key" }] }] };
    await processAgentEndForAutopilot(pi, ctx(), event, runtime);
    expect(m.autopilot.enabled).toBe(false);
    expect(m.autopilot.lastStopReason).toBe("blocked");
    expect(getFeatureById(m, "F001")!.status).toBe("blocked");
  });
});
