import { describe, expect, it } from "vitest";
import {
  buildMissionOrchestraExecutionCorrelation,
  buildOrchestraExecutionIdempotencyKey,
  orchestraCorrelationEnv,
} from "../../src/integrations/orchestra-execution.js";

describe("pi-missions -> Orchestra execution correlation", () => {
  it("keeps the same key for a transport retry of the same logical attempt", () => {
    const identity = { missionId: "m-1", taskId: "F001", attemptId: "a-1" };

    expect(buildOrchestraExecutionIdempotencyKey(identity))
      .toBe(buildOrchestraExecutionIdempotencyKey(identity));
  });

  it("changes the key when pi-missions starts a new logical attempt", () => {
    const base = { missionId: "m-1", taskId: "F001" };

    expect(buildOrchestraExecutionIdempotencyKey({ ...base, attemptId: "a-1" }))
      .not.toBe(buildOrchestraExecutionIdempotencyKey({ ...base, attemptId: "a-2" }));
  });

  it("encodes task identifiers safely and matches the v1 key shape", () => {
    expect(buildOrchestraExecutionIdempotencyKey({
      missionId: "mission 1",
      taskId: "feature/auth",
      attemptId: "1",
    })).toBe("orchestra:v1:mission:mission%201:task:feature%2Fauth:attempt:1");
  });

  it("serializes correlation as transport-only child process env", () => {
    const correlation = buildMissionOrchestraExecutionCorrelation({
      missionId: "m-1",
      taskId: "F001",
      attemptId: "a-1",
    });

    expect(orchestraCorrelationEnv(correlation)).toEqual({
      PI_ORCHESTRA_CONTRACT_VERSION: "1",
      PI_ORCHESTRA_CALLER: "pi-missions",
      PI_MISSION_ID: "m-1",
      PI_MISSION_TASK_ID: "F001",
      PI_MISSION_ATTEMPT_ID: "a-1",
      PI_ORCHESTRA_IDEMPOTENCY_KEY: correlation.idempotencyKey,
    });
  });
});
