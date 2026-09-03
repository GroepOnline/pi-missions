import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMission } from "../../src/core/state.js";

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mockSpawn }));

vi.mock("../../src/core/state.js", async () => {
  const actual = await vi.importActual("../../src/core/state.js");
  return {
    ...(actual as object),
    appendHistory: vi.fn(),
    loadMissionFromDisk: vi.fn(),
    getFeatureById: (actual as any).getFeatureById,
  };
});

import { spawnWorker, type WorkerResult } from "../../src/engines/worker.js";
import { loadMissionFromDisk } from "../../src/core/state.js";
import { buildMissionOrchestraExecutionCorrelation } from "../../src/integrations/orchestra-execution.js";

function fakeChildProcess(): ChildProcess & { emitClose(code: number | null, signal: string | null): void } {
  const emitter = new EventEmitter() as any;
  emitter.stdin = null;
  emitter.stdout = new EventEmitter();
  emitter.stderr = new EventEmitter();
  emitter.kill = vi.fn();
  emitter.pid = 12345;
  emitter.emitClose = (code: number | null, signal: string | null) => emitter.emit("close", code, signal);
  return emitter as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadMissionFromDisk).mockImplementation((id) => ({ id } as any);
});

describe("mission worker Orchestra correlation", () => {
  it("propagates correlation into child transport env and result metadata", async () => {
    const mission = createMission("Correlation", "Verify transport metadata");
    const feature = mission.milestones[0]!.features[0]!;
    feature.status = "active";

    const correlation = buildMissionOrchestraExecutionCorrelation({
      missionId: mission.id,
      taskId: feature.id,
      attemptId: "attempt-1",
    });

    const child = fakeChildProcess();
    mockSpawn.mockReturnValue(child);

    const pending = spawnWorker(mission, {
      featureId: feature.id,
      timeoutMs: 5_000,
      orchestraCorrelation: correlation,
    });

    const spawnOptions = mockSpawn.mock.calls[0]![2] as { env: Record<string, string | undefined> };
    expect(spawnOptions.env.PI_MISSION_ID).toBe(mission.id);
    expect(spawnOptions.env.PI_MISSION_TASK_ID).toBe(feature.id);
    expect(spawnOptions.env.PI_MISSION_ATTEMPT_ID).toBe("attempt-1");
    expect(spawnOptions.env.PI_ORCHESTRA_IDEMPOTENCY_KEY).toBe(correlation.idempotencyKey);

    child.emitClose(0, null);
    const result = await pending as WorkerResult;
    expect(result.orchestraCorrelation).toEqual(correlation);
  });
});
