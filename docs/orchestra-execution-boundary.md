# pi-missions ↔ Orchestra execution boundary

`pi-missions` is the durable mission authority. `pi-agent-orchestrator` owns one execution-local orchestration.

## Durable ownership stays here

`pi-missions` owns:

- mission and feature state across restarts
- checkpoints, replay and restart recovery
- logical attempt/retry budgets
- durable cancellation intent
- durable evidence and artifact references
- the decision to create a new logical attempt after failure

The Orchestra layer must not become a second durable mission state machine.

## One logical attempt

Every mission-backed Orchestra execution is identified by:

```text
missionId + taskId + attemptId
```

where `taskId` is normally the feature/task identifier.

`buildMissionOrchestraExecutionCorrelation()` adds the canonical deterministic idempotency key required by contract version 1.

Transport retries of the **same** logical attempt reuse the same `attemptId` and idempotency key. A deliberate mission retry allocates a new `attemptId`.

## Child worker propagation

`spawnWorker()` accepts optional `orchestraCorrelation` metadata. When supplied, the metadata is propagated to the child Pi process through transport-only environment variables and returned on `WorkerResult`.

Environment metadata is not canonical durable state. It is only a correlation transport:

- `PI_ORCHESTRA_CONTRACT_VERSION`
- `PI_ORCHESTRA_CALLER`
- `PI_MISSION_ID`
- `PI_MISSION_TASK_ID`
- `PI_MISSION_ATTEMPT_ID`
- `PI_ORCHESTRA_IDEMPOTENCY_KEY`

Mission state remains authoritative after restart.

## Next integration step

CHE-132 introduces `OrchestraRun` / `RunManager` on the orchestrator side. Once that API exists, pi-missions should create one Run per logical attempt and pass this correlation envelope into it. The returned execution outcome is then committed into durable mission state by pi-missions.
