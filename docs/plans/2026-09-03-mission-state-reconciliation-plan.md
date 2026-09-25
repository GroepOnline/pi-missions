---
title: Mission-state reconciliation
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: direct-request
---

# Mission-state reconciliation

## Goal Capsule

Prevent a long-lived parent Pi session from overwriting `plan.json` state persisted by a child worker. Worker completion and worker-launch failures must remain history-only events; fork-session metadata must update the current on-disk mission under the same lock as its write.

## Problem Frame

`saveMissionSafe` atomically writes a supplied `MissionState`, but it cannot make a caller's preceding in-memory snapshot current. The parent runtime retains the snapshot it used to start a child worker. Autosave, `turn_end`, shutdown, worker error callbacks, and fork-session callbacks can later persist that stale snapshot and roll back worker completion.

## Requirements

- **R1:** State updates that load, mutate, and save an existing mission must acquire the mission plan lock before reading current disk state.
- **R2:** Worker failure and finish logging must never rewrite `plan.json` solely to append history.
- **R3:** Lifecycle persistence must not overwrite worker state while a worker is active or after it has exited.
- **R4:** Fork-session metadata must survive concurrent mission updates; session links remain independent reference files.
- **R5:** Regression coverage must prove current disk state is preserved across atomic mutations and worker-related callbacks.

## Scope Boundaries

- Do not redesign mission schema or add a persistent revision field.
- Do not change child process transport, Orchestra correlation, worker scheduling, or lock-library configuration.
- Do not make all command handlers transactional in this change; only callbacks and lifecycle paths concurrent with a worker are in scope.

## High-Level Technical Design

Extract the existing locked plan serialization into an internal helper and expose `updateMissionOnDisk`. The public helper acquires the `plan.json` lock, loads the latest mission under that lock, applies a supplied mutation, saves the mutated fresh state, and returns it. This establishes one read-modify-write boundary for callbacks that operate after asynchronous work.

Every parent lifecycle checkpoint reads the current mission under the plan lock, even when the worker has already exited. The worker-active decision and idle mutation share that lock. Autosave, turn-end, and shutdown never write the captured parent snapshot. Shutdown writes its independent session reference. History remains append-only and does not require a plan save.

`updateMissionOnDisk` validates the loaded mission identity and accepts an optional `shouldPersist(result)` predicate. Lifecycle uses it to avoid writes for active workers, inactive autosave, or the read-only agent-end checkpoint. A missing or mismatched mission is skipped, never recreated from stale state. Idle callbacks must mutate only their supplied current mission and must not recursively save under the same lock. Turn-end token deltas and stuck detection use that supplied mission.

Control mutations must be durable before a checkpoint can refresh them away: `mission_ask_user` atomically persists the autopilot stop before awaiting UI, then applies permission answers to current disk state. Explicit mission load and session restoration persist dependency blocking under the same plan lock. `refreshActiveMission` refreshes the existing session object in place (including removing absent optional fields), so queued same-session checkpoints remain valid. Explicit mission/session activation replaces that object; queued work still detects and skips a genuine switch, including a new session for the same mission ID.

## Implementation Units

### U1. Add a locked mission update primitive

**Goal:** Provide one reusable atomic read-modify-write operation for an existing mission.

**Files:**
- `src/core/state.ts`
- `tests/state.test.ts`

**Approach:**
- Factor the locked serialization body out of `saveMissionSafe` without changing its public behavior.
- Add `updateMissionOnDisk<T>(missionId, mutate)` returning the updated mission and mutation result, or `null` when no current mission exists.
- Load `plan.json` only after acquiring the same `plan.json` lock used by save; run the mutation and serialize before releasing it.
- Characterize that a mutation sees a newer disk state than an older parent snapshot and preserves that state after save.

**Verification:**
- Focused state test proves an atomic update retains a feature completion already persisted on disk while applying a distinct mutation.

### U2. Reconcile worker-adjacent callbacks

**Goal:** Eliminate stale plan rewrites from worker error and fork-session callbacks.

**Files:**
- `src/tools/index.ts`
- `src/commands/handlers.ts`
- relevant existing tool/command tests

**Approach:**
- Keep worker-error reporting history-only; do not call `saveMissionSafe` from its asynchronous callback.
- Replace fork callback load-modify-save sequences with `updateMissionOnDisk`.
- Refresh the in-memory mission object with the returned fresh state where later UI behavior relies on added session metadata.

**Verification:**
- Tool/command regression coverage checks worker errors do not write the stale plan snapshot and fork-session updates use fresh state.

### U3. Make lifecycle persistence worker-safe

**Goal:** Prevent parent autosave, turn-end, and shutdown from rolling worker state back.

**Files:**
- `src/core/extension.ts`
- `src/engines/worker.ts`
- `tests/index.test.ts`
- `tests/engines/worker.test.ts`

**Approach:**
- Gate autosave and end-of-turn plan writes while `isWorkerRunning()` is true; refresh runtime state from disk instead.
- Write shutdown session links as independent session reference files, then avoid persisting the parent plan snapshot while a worker is active.
- Apply idle mutations to current disk state, including after worker completion, while preserving token tracking and completion handling.

**Verification:**
- Hook tests simulate a persisted worker completion and assert lifecycle handling retains it.

## Verification Contract

- Static inspection: all asynchronous worker callbacks and lifecycle paths named above avoid `saveMissionSafe` with a stale parent snapshot.
- Focused regression suites: `tests/state.test.ts`, `tests/tools.test.ts`, `tests/commands.test.ts`, `tests/index.test.ts`, and the two lifecycle-persistence suites.
- Current integration scope permits Node typecheck and pure mocked/JSON-state tests. No SQL artifacts/migrations, native builds, real workers, or services are part of local validation. Cross-platform coverage, build and smoke checks remain CI gates.
- Hygiene: `git diff --check`; retain this versioned plan with the focused implementation.

## Definition of Done

- The atomic update helper locks before loading and persists only the loaded fresh mission.
- Worker error and completion-related callback paths no longer rewrite stale `plan.json` state.
- Autosave, turn-end, and shutdown cannot overwrite active or already-completed worker changes.
- Focused tests cover the new concurrency contract.
- Product files, tests and plan are committed on an isolated branch; push and PR delivery belong to the parent integration lane.

## Deferred to Follow-Up Work

- Convert other ordinary command handlers that operate on in-memory missions into explicit transactional operations only if their own concurrent writers are introduced.
- Consider a future revision/version conflict protocol if multiple interactive parent sessions become a supported write topology.
