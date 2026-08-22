export const ORCHESTRA_EXECUTION_CONTRACT_VERSION = 1 as const;

export interface MissionOrchestraExecutionIdentity {
  missionId: string;
  taskId: string;
  attemptId: string;
}

export interface MissionOrchestraExecutionCorrelation extends MissionOrchestraExecutionIdentity {
  caller: "pi-missions";
  idempotencyKey: string;
}

function keyPart(value: string): string {
  return encodeURIComponent(value.trim());
}

/**
 * Must stay byte-for-byte compatible with
 * @groeponline/pi-agent-orchestrator's CHE-142 v1 contract.
 */
export function buildOrchestraExecutionIdempotencyKey(
  identity: MissionOrchestraExecutionIdentity,
): string {
  return `orchestra:v${ORCHESTRA_EXECUTION_CONTRACT_VERSION}:mission:${keyPart(identity.missionId)}:task:${keyPart(identity.taskId)}:attempt:${keyPart(identity.attemptId)}`;
}

/** Build the correlation envelope for one logical mission execution attempt. */
export function buildMissionOrchestraExecutionCorrelation(
  identity: MissionOrchestraExecutionIdentity,
): MissionOrchestraExecutionCorrelation {
  return {
    caller: "pi-missions",
    ...identity,
    idempotencyKey: buildOrchestraExecutionIdempotencyKey(identity),
  };
}

/**
 * Propagate correlation through a child Pi process without making environment
 * variables the canonical durable state. They are transport metadata only.
 */
export function orchestraCorrelationEnv(
  correlation: MissionOrchestraExecutionCorrelation,
): Record<string, string> {
  return {
    PI_ORCHESTRA_CONTRACT_VERSION: String(ORCHESTRA_EXECUTION_CONTRACT_VERSION),
    PI_ORCHESTRA_CALLER: correlation.caller,
    PI_MISSION_ID: correlation.missionId,
    PI_MISSION_TASK_ID: correlation.taskId,
    PI_MISSION_ATTEMPT_ID: correlation.attemptId,
    PI_ORCHESTRA_IDEMPOTENCY_KEY: correlation.idempotencyKey,
  };
}
