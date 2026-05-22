import { describe, expect, it } from "vitest";
import { compactionCheckpoint } from "../../src/commands/index.js";
import { createMission } from "../../src/core/state.js";
import type { RuntimeState } from "../../src/core/types.js";

function runtimeFixture(missionOverride: Partial<ReturnType<typeof createMission>> = {}): RuntimeState {
  return {
    activeMission: { ...createMission("Tree mission", "Goal"), ...missionOverride },
    autoSaveInterval: null,
    phaseToolCallCount: 0,
    currentPhase: "execution",
    lastFeatureId: undefined,
  };
}

describe("compactionCheckpoint", () => {
  it("does nothing when no mission is active", () => {
    const mockPi = { appendEntry: () => { throw new Error("should not be called"); } };
    expect(() =>
      compactionCheckpoint(mockPi as any, { activeMission: null, autoSaveInterval: null, phaseToolCallCount: 0, currentPhase: "execution", lastFeatureId: undefined })
    ).not.toThrow();
  });

  it("calls appendEntry with mission id when active", () => {
    const calls: any[] = [];
    const mockPi = { appendEntry: (...args: any[]) => { calls.push(args); } };
    const rt = runtimeFixture();
    compactionCheckpoint(mockPi as any, rt);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe("pi-mission-compaction-checkpoint");
    expect(calls[0]![1].missionId).toBe(rt.activeMission!.id);
  });
});
