# Pi Missions — Documentation Plan

> Last updated: v0.4 complete — all 4 documentation phases done (10 tools, 522 tests)
> Repository: [OnlineChef/pi-missions](https://github.com/OnlineChef/pi-missions)

---

## Overview

Pi Missions is a native Pi coding agent extension that provides **durable mission orchestration** — turning short-lived Pi sessions into long-running execution tracks that survive restarts, context resets, forks, and interruptions.

**Key architectural shift in v1→v2:** The flat `src/` was reorganized into a modular subdirectory structure (`core/`, `engines/`, `tools/`, `ui/`, `utils/`) to improve separation of concerns, testability, and maintainability.

---

## Repository Layout

```
pi-missions/
├── src/
│   ├── core/              # Extension runtime, state management, types
│   │   ├── extension.ts   # Main entrypoint — registers all hooks & commands
│   │   ├── state.ts       # MissionState CRUD, phase detection, feature transitions
│   │   └── types.ts       # RuntimeState, ToolCallEvent, ToolResultEvent types
│   ├── engines/           # Mission logic engines
│   │   ├── autopilot.ts   # Autonomous feature advancement logic
│   │   ├── completion.ts  # Completion detection from agent output
│   │   ├── metrics.ts     # Session metrics collection
│   │   ├── recovery.ts    # Error recovery engine
│   │   └── worker.ts      # Child process worker spawning
│   ├── tools/             # LLM-callable tools
│   │   └── index.ts       # Tool registration, policy enforcement
│   ├── ui/                # UI components
│   │   ├── components.ts  # Footer, status bar, notifications
│   │   └── dashboard.ts   # Mission Control dashboard widget
│   ├── utils/             # Utilities
│   │   ├── agent-detect.ts # Agent detection utilities
│   │   ├── context.ts     # Context injection (buildMissionContext, buildLeanContext)
│   │   ├── feedback.ts    # Error formatting and severity detection
│   │   ├── fs.ts          # Safe file I/O, path validation, lock management
│   │   ├── logger.ts      # Structured logging
│   │   ├── markdown.ts    # Markdown export, missionFromWizardOutput
│   │   └── mission-builder.ts # Mission creation + dependency normalization
│   ├── commands/          # Command handlers
│   │   ├── index.ts       # Command registration, subcommand router
│   │   └── handlers.ts    # Individual handler implementations
│   └── index.ts           # Re-exports core/extension.js (entrypoint for Pi)
├── tests/                 # Unit tests (vitest)
│   ├── commands.test.ts
│   ├── context.test.ts
│   ├── dashboard.test.ts
│   ├── index.test.ts
│   └── ... (19 test files total, 522 tests)
├── scripts/
│   └── pi_missions_e2e_runner.sh  # End-to-end tmux test runner
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── PLAN.md                # Implementation plan (historical)
├── IMPROVEMENTS.md        # Improvement tracking
├── UI_REFERENCE.md        # UI component reference
└── README.md
```

### Modular Architecture Rationale

| Directory | Purpose | Key exports |
|---|---|---|
| `core/` | Extension lifecycle, mission state | `piMissions`, `RuntimeState`, `getMissionPhase`, `saveMissionSafe` |
| `engines/` | Autonomous behavior | `CompletionDetector`, `ErrorRecoveryEngine`, `SessionMetricsCollector`, `AutopilotEngine` |
| `tools/` | LLM tool policy | `registerMissionTools`, `enforceToolPolicy`, `enforceToolMax` |
| `ui/` | Terminal UI | `updateFooter`, `missionControlOverlay`, `formatFeatureStatus` |
| `utils/` | Pure utilities | `buildMissionContext`, `buildLeanContext`, `missionFromWizardOutput`, `safeRead/write` |
| `commands/` | Slash command handlers | `registerMissionCommand`, `handleNew`, `handleNext`, `handleDone`, etc. |

---

## What to Document

### Phase 1: Core Documentation ✅ COMPLETE

- [x] **Conceptual overview** — what pi-missions is and why it exists
- [x] **Repository layout** — modular architecture (see above)
- [x] **State model** — `~/.pi/missions/<id>/` file layout
- [x] **Command reference** — all `/mission` subcommands (19 commands)
- [x] **Agent tool reference** — all 10 tools (feature_done, next_feature, ask_user, block_self, fork, error_status, retry_error, spawn_worker, worker_status, kill_worker)

### Phase 2: Architecture Deep-Dives ✅ COMPLETE

- [x] **Tool Policy** — phase-based tool restrictions (planning=read-only, execution=write, verification=bash)
- [x] **Completion Detection** — how `engines/completion.ts` analyzes agent output to auto-detect feature completion
- [x] **Error Recovery** — `engines/recovery.ts` error categorization, retry logic, and alerting
- [x] **Session Auto-Restore** — how `session_start` hook reloads mission state from disk
- [x] **Autopilot Mode** — autonomous feature advancement without manual `/mission next`
- [x] **Dependency Normalization** — `missionFromWizardOutput` two-pass ID remapping

### Phase 3: Guides ✅ COMPLETE

- [x] **Quick Start Guide** — install + first mission in 5 minutes
- [x] **Mission Lifecycle** — full workflow from `new` → `done` → `complete`
- [x] **Template Authoring** — how to create custom mission templates
- [x] **Debugging** — using `/mission debug` and `~/.pi/missions/<id>/logs/`
- [x] **Recovery** — what to do when a mission gets stuck or blocked

### Phase 4: API Reference ✅ COMPLETE

- [x] **Extension API** — all Pi extension hooks used by pi-missions (10 hooks + 2 shortcuts)
- [x] **Type Definitions** — `MissionState`, `Feature`, `Milestone`, `AcceptanceCriterion`, all 26 interfaces/types
- [x] **Schema Validation** — TypeBox schemas (CriterionSchema, FeatureSchema, MilestoneSchema, WizardOutputSchema) + `validate()` utility

---

## State Model

```
~/.pi/missions/<mission-id>/
├── plan.json              # MissionState — current plan, features, status
├── plan.json.bak          # Safe backup (EXDEV-safe write via temp+rename)
├── plan.json.lock         # File lock (flock) for concurrent access
├── history.jsonl          # Append-only event log (full audit trail)
├── evidence/              # Proof: test output, diffs, logs, artifacts
│   └── <feature-id>.md
├── sessions/              # Session attachment metadata
│   └── <session-file>.ref
└── logs/                  # Structured debug logs
    └── *.log
```

---

## Command Reference

| Command | Description |
|---|---|
| `/mission start <goal>` | Create a new mission (alias for `/mission new`) |
| `/mission new <title>` | Create a new mission with planning wizard |
| `/mission list` | List all missions in `~/.pi/missions/` |
| `/mission load <id>` | Load a mission into the current session |
| `/mission status` | Show active mission, feature, progress, acceptance criteria |
| `/mission next` | Advance to the next unblocked pending feature |
| `/mission done [evidence]` | Mark active feature done + attach evidence |
| `/mission block <reason>` | Block the current feature |
| `/mission pause` / `resume` | Pause or resume the mission |
| `/mission fork <reason>` | Fork active feature into a linked alternative |
| `/mission dashboard` | Open Mission Control UI widget |
| `/mission metrics` | Show session/mission metrics |
| `/mission debug [id]` | Inspect recent history and events |
| `/mission export [filename]` | Export mission to Markdown report |
| `/mission templates` | List and scaffold built-in templates |
| `/mission clear` | Detach mission from current session |

---

## Mission Lifecycle

```
mission_created
    ↓
planning phase (read-only bash, context injection active)
    ↓ (all features scoped)
status: active
    ↓
feature loop:
    active feature → (tool calls) → completion detection
        ↓ not complete              ↓ complete
        (continue)                  feature_done → auto-advance
                                       ↓
                                 no pending features → mission_complete
                                       ↓
                                 pending features → next feature active
```

### Phase-based Tool Policy

| Phase | Allowed Tools | Max Calls |
|---|---|---|
| `planning` | `read`, `grep`, `find`, `rg`, `cat`, `sed -n`, `head`, `tail`, `wc`, `git status/diff/show/log` | 60 |
| `execution` | `read`, `edit`, `write`, `bash`, `write_file`, `str_replace` | 120 |
| `verification` | `read`, `bash` | 60 |

**Planning bash security:** `isReadOnlyPlanningBash` rejects commands containing `\n`, `\r`, `;`, `|`, `&`, `$`, `<`, `>` to prevent command injection.

---

## Architecture: Key Flows

### Session Auto-Restore Flow

```
pi session_start
    ↓
latestActiveEntry() scans session entries (both native + custom format)
    ↓
loadMissionFromDisk(missionId)
    ↓ (validation token check)
runtime.activeMission = mission
autoBlockBlockedFeatures(mission)
updateFooter(ctx, mission)
pi.setSessionName(`🎯 ${mission.title}`)
scheduleAutoSave(runtime)  ← extracted helper, guards duplicate setInterval
```

### Tool Call Policy Flow

```
tool_call event
    ↓
getMissionPhase(activeMission)  ← recomputed on every call
    ↓
enforceToolPolicy(toolName, phase, input)
    ↓ (blocked?)              ↓ (allowed)
return { block: true }     recordToolCall + check maxToolCalls
                             ↓ (exceeded?)
                           return { block: true }
```

### Completion Detection Flow

```
agent_end event
    ↓
detector.detectCompletion(feature, text)  ← engines/completion.ts
    ↓
appendHistory(mission, { event: completion_detection, ... })
    ↓
suggestedAction:
  auto_done    → completeActiveFeature() + activateNextFeature() + saveMissionSafe()
  suggest_done → runtime.pendingCompletionAction = suggest_done (shown next turn)
  ask_user     → runtime.pendingCompletionAction = ask_user (prompts mission_ask_user)
```

### Dependency Normalization (missionFromWizardOutput)

```
Wizard output: [{milestoneId, features: [{id, dependsOn}]}]
    ↓ Pass 1: Global sequential ID assignment
Build mapping: [
  {oldId: M01.F001, newId: F001, _mi: 0},
  {oldId: M01.F002, newId: F002, _mi: 0},
  {oldId: M02.F001, newId: F003, _mi: 1},
  {oldId: M02.F002, newId: F004, _mi: 1},
]
    ↓ Pass 2: Dependency remapping
For each dependency FOO in feature:
  candidates = all newIds mapped from FOO
  sameMilestone = candidates where _mi === feature's milestone index
  earlier = candidates where _mi < feature's milestone index
  resolved = sameMilestone[0] ?? earlier[0] ?? candidates[0]
  remap dependsOn to resolved.newId
```

---

## Phase 2 Deep-Dives

### 1. Tool Policy Enforcement

**Files**: `src/tools/index.ts` (enforcement), `src/core/state.ts` (phase detection), `src/core/types.ts` (TOOL_POLICIES)

Every tool call the agent makes runs through a two-layer gate before execution:

**Phase Detection** (`getMissionPhase` in `state.ts`):
- Re-computed on every tool call (not cached) so phase changes mid-turn take effect immediately
- Checks the active feature title + description against keyword lists:
  - **Planning**: `clarify`, `plan`, `scope`, `research`, `analyze`, `inspect`, `investigate`, `discover`, `reconnaissance`, `current state`
  - **Verification**: `verify`, `test`, `summarize`
  - **Execution**: everything else (default)
- If mission status is `planning`, overrides to planning phase
- If no active feature, defaults to execution

**Layer 1 — Allowed Tools** (`enforceToolPolicy`):
- Whitelist check: only tools listed in `TOOL_POLICIES[phase].allowedTools` pass
- Special case: `bash` in planning phase is allowed ONLY for single read-only commands via `isReadOnlyPlanningBash()`
- Read-only bash whitelist: `cat`, `grep`, `head`, `ls`, `pwd`, `rg`, `tail`, `wc` + `find` (no -delete/-exec) + `sed -n` (no -i) + `git status/diff/show/log`
- Shell injection prevention: rejects commands containing `;`, `|`, `&`, `$`, `` ` ``, `<`, `>`, newline, carriage return, tab
- User override: `mission_ask_user` response `ALLOW_BASH_IN_PLANNING` sets `userPreferences.allowBashInPlanning = true`

**Layer 2 — Max Tool Calls** (`enforceToolMax`):
- Tracks `phaseToolCallCount` per turn (reset at `before_agent_start`)
- Limits: planning=30, execution=120, verification=60
- Exceeding the limit blocks further tool calls for that phase in this turn

**Tool Policies** (defined in `core/types.ts`):

| Phase | Tools | Max Calls |
|---|---|---|
| planning | read, grep, find, ls, + all mission_* tools (+ read-only bash) | 30 |
| execution | read, write, edit, bash, grep, find, ls, + all mission_* tools | 120 |
| verification | read, bash, grep, find, ls, + all mission_* tools | 60 |

**Edge cases**:
- User manually enables `allowBashInPlanning` → full bash access in planning (use with caution)
- Phase recalculated every call: if a feature title says "Implement X" but agent is reading files, it gets execution phase (full write access)
- Mission tools (`mission_feature_done`, `mission_next_feature`, etc.) are allowed in all three phases

---

### 2. Completion Detection

**File**: `src/engines/completion.ts`

`CompletionDetector` is a long-lived singleton that tracks recent tool calls and text outputs to determine when a feature is likely complete. It fires at `agent_end` in `extension.ts`.

**Four Signal Types**:

| Signal | Detector | Confidence | Trigger |
|---|---|---|---|
| **keyword** | `detectKeywordSignal` | high (2+ hits) / medium (1 hit) | Agent text contains: done, complete, finished, implemented, klaar, voltooid, tests pass, success, working, functional, ready |
| **acceptance** | `detectAcceptanceSignal` | high (100%) / medium (75%+) | Acceptance criteria verified+waived percentage |
| **tool_pattern** | `detectToolPatternSignal` | medium | 70%+ of last 20 tool calls are read operations (signal: agent is verifying, not building) |
| **error_free_streak** | `detectErrorFreeStreakSignal` | medium | Last 5 consecutive tool calls all succeeded |

**Aggregation Logic** (`aggregateSignals`):
- `high` confidence: 2+ high signals, or 1 high + 2+ medium
- `medium` confidence: 1 high, or 2+ medium
- `low` confidence: anything else
- Final `suggestedAction`:
  - **auto_done**: high confidence + all acceptance criteria satisfied → auto-completes feature + auto-advances
  - **suggest_done**: high confidence + partial acceptance (75%+) OR medium confidence + all acceptance → model sees hint next turn
  - **ask_user**: medium confidence → model prompted to call `mission_ask_user`
  - **continue**: low confidence → keep working

**Stuck Detection** (separate from completion):
- **Text loop**: last 5 text outputs have ≤2 unique hashes → `suggestedAction: block_self`
- **Stuck phrases**: 3+ occurrences of "I've been stuck", "need to ask user", "operation aborted" in recent texts
- **Consecutive failures**: last 3 tool calls all failed → `block_self`
- **Repeated tool**: 5 consecutive calls to the same tool → `block_self`
- **High failure rate**: 70%+ of recent calls (≥5 sample) failed → `block_self`

**Memory management**:
- `recordToolCall(tool, success)`: sliding window of 20 tool calls
- `recordTextOutput(text)`: sliding window of 10 text outputs (hashed by first 100 chars)
- `clearToolCallHistory()`: called at `before_agent_start` when feature changes → history doesn't carry over between features

**Edge cases**:
- Text < 20 chars is not recorded (avoids hashing "ok" or "done" as loop signal)
- Acceptance signal only fires if feature has acceptance criteria defined
- `auto_done` only triggers when all acceptance criteria are at 100% — partial criteria still prompt user
- Stuck detection fires at `turn_end` and auto-blocks the feature (stops autopilot too)

---

### 3. Error Recovery

**File**: `src/engines/recovery.ts`

**Categorization** (`categorizeError`):

| Category | Keywords | Fallback Action | Max Retries |
|---|---|---|---|
| `network` | network, connection, timeout, ECONNREFUSED, ENOTFOUND, ETIMEDOUT | retry | 5 |
| `permission` | permission, access denied, EACCES, EPERM | ask_user | 0 |
| `user` | invalid input, validation | ask_user | 0 |
| `transient` | temporary, retry, busy, locked, EAGAIN, EBUSY | retry | 3 |
| `system` | memory, disk, space | degrade | 2 |
| `permanent` | syntax, parse | block | 0 |
| `unknown` | (none matched) | skip | 1 |

**Severity** (`determineSeverity`):
- `critical`: permanent, permission
- `high`: system
- `medium`: network, unknown
- `low`: transient, user

**Retry Utilities**:
- `withRetry(fn, opts)`: async retry with exponential backoff + jitter
- `withRetrySync(fn, opts)`: synchronous version (busy-wait)
- `RetryPresets`: fileIO, network, lock, critical, persistence — pre-configured retry options
- `defaultShouldRetry(error)`: heuristic-based — retries timeouts/network errors, skips syntax/permission errors

**Error Recovery Engine** (`ErrorRecoveryEngine`):
- Maintains `errorRecords` map (UUID → ErrorRecord) and `consecutiveFailures` counter per tool+feature
- `handleError(ctx)` → categorizes, determines severity, checks retry budget, returns `{ action, shouldRetry, retryAfter, record }`
- Escalation: when retry count ≥ maxRetries, falls back to the strategy's `fallbackAction` (ask_user, block, skip, degrade)
- `markResolved(recordId)`: clears retry state and consecutive failures for that context
- Alerting system: `onAlert(callback)` for critical errors, threshold breaches, recovery failures, retry exhaustion

**Graceful Degradation**:
- `withDegradation(primary, fallback)`: tries primary, falls back to degraded implementation on error
- Returns `DegradedResult<T>` with `{ ok, value, degraded, error }`

**Integration** (in `extension.ts`):
- `tool_result` hook: on error, calls `recovery.handleError()` → logs to history, records metrics
- `tool_result` hook: on success, calls `recovery.clearConsecutiveFailures()`
- `before_agent_start`: clears errors for the new active feature
- Error alerts are persisted to `history.jsonl` via the alert callback

**Edge cases**:
- Retry state is keyed by `toolName:errorType:featureId` — same error type for same tool on same feature shares retry budget
- Consecutive failures tracked per `toolName:featureId` — different tools on same feature reset independently
- `clearConsecutiveFailures(toolName?, featureId?)`: can clear for specific tool, specific feature, or all
- Critical errors fire an immediate alert (threshold=1)
- Non-critical errors fire alerts at threshold (3 consecutive) or total count (5 in window)

---

### 4. Session Auto-Restore

**File**: `src/core/extension.ts` (main flow), `src/core/state.ts` (disk I/O)

**Startup Flow** (`session_start` hook):

1. **Reset metrics**: `sessionMetrics.reset()` — fresh session metrics
2. **Scan entries**: `latestActiveEntry(entries)` scans session entries in reverse (most recent first)
3. **Dual format support**: checks both `type: 'pi-mission-active'` (native Pi API) and `type: 'custom', customType: 'pi-mission-active'` (test mocks)
4. **Type-safe extraction**: validates `missionId` is a string, `validationToken` is optional string
5. **Malformed detection**: if entries have the right type but wrong shape, warns user and skips
6. **Validation token check**: if stored token doesn't match mission's current token, warns and skips (prevents stale-session restore)
7. **Auto-block**: `autoBlockBlockedFeatures(mission)` sets features with unmet deps to `waiting` status
8. **UI setup**: `updateFooter()`, `pi.setSessionName()`, `scheduleAutoSave()` (2-min interval)
9. **No entry found**: clean start, no mission loaded

**Auto-Save Timer**:
- `scheduleAutoSave(runtime)`: guards duplicate `setInterval` (checks `runtime.autoSaveInterval`)
- Fires every 2 minutes during active mission
- Uses `saveMissionSafe()` → EXDEV-safe write with lock + backup

**Shutdown Flow** (`session_shutdown` hook):
- `sessionMetrics.endSession()` — records session end time
- Clears auto-save interval
- Links session file to mission via `saveSessionLink()`
- Final `saveMissionSafe()`
- Clears footer: `updateFooter(ctx, null)`

**Validation Token System**:
- Each mission has a `validationToken` (SHA-256 hash) generated at creation
- Stored in session entries alongside `missionId`
- At restore, token must match — prevents loading a mission that was modified externally during the session gap
- Token mismatch → warning notification, no mission loaded

**Edge cases**:
- `reason === "reload"` in `session_start`: bypasses restore (preserves in-memory state)
- Dual entry format: handles both native Pi entries and custom entries — robust against Pi API changes
- Non-existent mission IDs: warns user and returns (mission may have been deleted)
- `isValidMissionId` check: path traversal prevention before any disk access

---

### 5. Autopilot Mode

**File**: `src/engines/autopilot.ts`

Autopilot chains ONE controlled turn at a time — never runs an unbounded loop. Each turn is triggered via `pi.sendUserMessage()`, and the `agent_end` event evaluates whether to continue or stop.

**Start**: `/mission run` enables `mission.autopilot.enabled = true`, calls `triggerContinuation()` which sends the first turn.

**Stop Conditions** (`shouldContinue`):

| Condition | Reason String |
|---|---|
| Autopilot disabled | `disabled` |
| Mission paused | `paused_by_user` |
| Mission blocked | `blocked` |
| Mission complete | `mission_complete` |
| Max iterations reached (default: 25) | `max_iterations` |
| Max consecutive failures (default: 3) | `max_consecutive_failures` |
| Max no-progress turns (default: 3) | `no_progress` |
| Context usage > 90% | `context_limit` |

**Per-Turn Processing** (`processAgentEndForAutopilot`):

1. **Abort detection**: checks for "operation aborted/cancelled" in agent text → increments `noProgressTurns`
2. **Text loop detection**: uses `CompletionDetector.detectTextLoop()` → if stuck in text loop, increments `noProgressTurns` by 2
3. **Ask-user detection**: if agent says it needs to ask the user (but hasn't called `mission_ask_user`), stops autopilot with `needs_user_decision`
4. **Block detection**: if agent mentions blocked/stuck/deadlock/permission/API key, stops autopilot and blocks the feature
5. **Progress tracking**: if agent says "no progress" or "same state", increments counter; otherwise decrements (floor 0)
6. **Error tracking**: if agent mentions "error" or "failed", increments `consecutiveFailures`; otherwise resets to 0
7. **Continuation decision**: calls `shouldContinue()` — if yes, triggers next turn; if no, disables autopilot and logs stop reason

**Ensure Active Feature** (`ensureActiveFeature`):
- If current feature is done or blocked, auto-advances to next pending
- If no pending features remain, marks mission complete
- Updates `activeFeatureId`, `activeMilestoneId`, logs to history

**Edge cases**:
- Autopilot stops immediately if agent wants to ask user (prevents infinite loops asking the same question)
- `noProgressTurns` decrements on progress — a single good turn resets the counter
- `consecutiveFailures` resets on success — only consecutive failures count
- All stop reasons are logged to history via `appendHistory` with `event: autopilot_stopped`
- Autopilot state persists in mission JSON — survives session restarts

---

### 6. Dependency Normalization

**File**: `src/utils/mission-builder.ts` (exported as `missionFromWizardOutput`)

When the planning wizard generates milestones + features from AI output, feature IDs and dependency references need normalization because wizard IDs may overlap across milestones (e.g., both M01 and M02 might have "F001").

**Two-Pass Algorithm**:

**Pass 1 — Global Sequential ID Assignment**:
- Iterates all features across all milestones in wizard order
- Assigns new IDs: `F001`, `F002`, `F003`, ... sequentially
- Builds a `mapping` list: `[{ oldId, newId }]` preserving order
- Also tracks `wizardFeatures` with `_mi` (milestone index) and `_fi` (feature index) for dep resolution

**Pass 2 — Dependency Remapping**:
- For each feature's `dependsOn` list, resolves each dependency ID:
  1. Collect all `newId` candidates for the old ID (handles duplicates)
  2. **Prefer same milestone**: find candidate where the original wizard feature had the same `_mi`
  3. **Prefer earlier milestone**: find candidate where `_mi` is strictly before this feature's milestone
  4. **Fallback**: use the first candidate
- Filters out unresolvable deps (old ID not in mapping)

**Example**:
```
Input:
  M01 (mi=0): FOO dependsOn [BAR], BAR dependsOn []
  M02 (mi=1): BAZ dependsOn [FOO, BAR]

Pass 1 mapping:
  FOO→F001 (_mi=0), BAR→F002 (_mi=0), BAZ→F003 (_mi=1)

Pass 2 resolves:
  F001 dependsOn [F002]  (BAR → candidate F002, same milestone ✓)
  F003 dependsOn [F001, F002]  (FOO → candidate F001, earlier mi ✓; BAR → candidate F002, earlier mi ✓)
```

**Post-processing**: Normalized output is passed to `missionFromWizardOutput` (v2 wizard in `markdown.ts`) which creates the final `MissionState` with milestones, features, acceptance criteria, and proper status initialization.

**Edge cases**:
- Duplicate old IDs: all candidates are collected into `oldToNewSet` — dep resolution picks the best candidate per the heuristic
- Cross-milestone deps: prefer earlier milestones (which execute first), so dep ordering is preserved
- Self-dependency targets: if a feature depends on itself (shouldn't happen), it resolves to itself which would block itself
- IDs not found: filtered out silently (`filter(d => oldToNewSet.has(d))`)

---

## Phase 3 Guides

### 1. Quick Start Guide

Get your first mission running in under 5 minutes.

**Prerequisites**: pi-missions installed as a pi extension. Verify with `/mission help` — you should see the full command list.

#### Step 1: Create a mission

Use the planning wizard for an AI-generated breakdown:
```
/mission new "Add dark mode toggle to settings"
```

Pi will prompt for a goal and constraints, then call the planning wizard. The wizard generates 2+ milestones with 5+ features, each with acceptance criteria. You'll see:
```
✅ Mission created: 3 milestones, 8 features (AI-generated)
```

**Without the wizard** (or if wizard fails): the mission falls back to a structured 3-feature scaffold with scope → implement → verify phases.

**With a template** (9 built-in):
```
/mission templates list                       # See available templates
/mission templates scaffold fix-bug           # Start a bug-fix mission
/mission templates scaffold add-feature       # Start a feature mission
```

#### Step 2: Understand your mission

Check status:
```
/mission status
```

Shows: active feature, progress bar, acceptance criteria, dependencies, next pending feature.

The footer (visible during coding) shows: mission title, active feature, progress, phase.

Open the Mission Control dashboard:
```
/mission dashboard
# or: Ctrl+Shift+M
```

The dashboard shows all milestones, features with status icons, dependencies as a visual tree, acceptance criteria, and allows clicking features to activate them.

#### Step 3: Work through features

The agent automatically sees mission context (active feature, acceptance criteria, progress) before each turn. Just describe what to do:
```
"Read the settings module and document the current theme system"
```

When a feature looks complete, pi-missions auto-detects it or you can manually mark it:
```
/mission done "Added dark theme CSS variables, updated Toggle component"
# or: Ctrl+Shift+D
```

Advance to the next feature:
```
/mission next
```

If a feature is blocked (waiting for a decision, permission, or API key):
```
/mission block "Need design team approval on dark mode color palette"
```

#### Step 4: Finish or hand off

When all features are done, pi-missions marks the mission complete. Export a report:
```
/mission export mission-report.md
```

For long missions, use `/handoff` to start a fresh session:
```
/handoff "Continue dark mode from F005 — Add system preference detection"
```

**Keyboard shortcuts**:
| Shortcut | Action |
|---|---|
| `Ctrl+Shift+M` | Open Mission Control dashboard |
| `Ctrl+Shift+D` | Mark current feature done (with confirmation) |

---

### 2. Mission Lifecycle

A mission progresses through states, phases, and feature transitions.

#### Mission States

```
planning → active → paused / blocked / budget_limited / complete / failed
                ↑________↓
```

| State | Meaning | Entry |
|---|---|---|
| `planning` | Wizard is generating milestones | `/mission new` with wizard prompt |
| `active` | Coding in progress | `/mission new` complete, `/mission resume` |
| `paused` | Temporarily stopped | `/mission pause` |
| `blocked` | Cannot proceed (stuck/deadlock) | Auto-blocked by stuck detection, or manual `/mission block` |
| `budget_limited` | Token budget 80% used | Automatic at 80% of `tokensBudget` |
| `complete` | All features done | Last feature → `/mission done` or auto-complete |
| `failed` | Mission abandoned | Not auto-set; set via feature status propagation |

#### Tool Phases

Every tool call is classified into one of three phases:

| Phase | Keywords that trigger it | Allowed tools | Max calls/turn |
|---|---|---|---|
| `planning` | clarify, plan, scope, research, analyze, inspect, investigate, discover, reconnaissance, "current state" | read, grep, find, ls + read-only bash + mission_* | 30 |
| `execution` | (default) | read, write, edit, bash, grep, find, ls + mission_* | 120 |
| `verification` | verify, test, summarize | read, bash, grep, find, ls + mission_* | 60 |

The phase is re-computed on every tool call (not cached), so it changes mid-turn as the agent shifts from reading to writing to testing.

**Planning bash security**: bash is restricted to single read-only commands. `isReadOnlyPlanningBash()` rejects multi-line commands and any containing `;`, `|`, `&`, `$`, `` ` ``, `<`, `>`, newlines, or tabs. Users can override with `mission_ask_user` → `ALLOW_BASH_IN_PLANNING`.

#### Feature Lifecycle

```
pending → waiting → active → done / blocked / failed
                ↑___________↓ (fork creates alternative)
```

| Status | Meaning | Set by |
|---|---|---|
| `pending` | Not yet started, deps may be unsatisfied | Mission creation |
| `waiting` | Deps not yet met | `autoBlockBlockedFeatures()` on load/restore |
| `active` | Currently being worked on | `/mission next`, dashboard click, autopilot |
| `done` | Complete with evidence | `/mission done`, `Ctrl+Shift+D`, auto_done |
| `blocked` | Cannot proceed | `/mission block`, auto-block (stuck detection) |
| `failed` | Abandoned | Manual via `/mission edit` (not auto-set) |

**Feature auto-advance**: when a feature is marked done:
1. `activateNextFeature()` finds the next pending feature with all deps satisfied
2. If the next feature's deps are unsatisfied, it goes to `waiting` status
3. If no pending features remain, mission is marked `complete`
4. Large features (>50 tool calls or >10 min active) trigger a handoff suggestion

#### Completion Detection Flow

At `agent_end`, the CompletionDetector analyzes the agent's output:

```
agent_end event
    ↓
detector.detectCompletion(feature, text)
    ↓ (analyzes 4 signal types)
confidence: high / medium / low
    ↓
action: auto_done / suggest_done / ask_user / continue
```

**Auto-complete threshold**: high confidence + all acceptance criteria at 100% → feature auto-done + auto-advance.

**Stuck detection** (at `turn_end`):
- Text loop (5 outputs, ≤2 unique hashes) → `block_self`
- 3 consecutive tool failures → `block_self`
- 5 repeated calls to same tool → `block_self`
- 70%+ failure rate in recent calls → `block_self`

When stuck detection fires, the feature is auto-blocked, autopilot is disabled, and the reason is logged to history.

#### Session Lifecycle

```
session_start → auto-restore mission from previous session
    ↓
before_agent_start → phase reset, error clear, context injection
    ↓
tool_call → policy enforcement (phase check + max count)
    ↓
tool_result → error recovery, metrics recording
    ↓
agent_end → completion detection, auto-advance
    ↓
turn_end → stuck detection, token tracking
    ↓
session_shutdown → save state, link session, clear footer
```

**Auto-save**: runs every 2 minutes during active missions via `saveMissionSafe()` (EXDEV-safe temp+rename with lock).

**Auto-restore**: `session_start` scans entries in reverse for the most recent `pi-mission-active` entry. Validates the mission still exists on disk and the validation token matches (prevents stale-session restore). If the token mismatches, warns and skips restore.

---

### 3. Template Authoring

Pi-missions ships with 9 built-in templates. You can add custom templates by modifying the `MISSION_TEMPLATES` array in `src/utils/markdown.ts`.

#### Template Interface

```typescript
export interface MissionTemplate {
  id: string;          // Short kebab-case identifier
  label: string;       // Human-readable name (displayed in UI)
  description: string; // One-line summary
  goal: string;        // Detailed goal (used in planning wizard prompt)
  constraints: string; // Hard rules for the planning wizard
}
```

#### Built-in Templates

| ID | Label | Goal |
|---|---|---|
| `refactor` | Refactor | Improve maintainability without behavior change |
| `fix-bug` | Fix Bug | Root-cause analysis + minimal fix + regression test |
| `add-feature` | Add Feature | Implement new capability per specification |
| `docs` | Document | Produce accurate, verified documentation |
| `investigate` | Investigate | Read-only codebase exploration with evidence |
| `auth` | Auth implementation | Add or refactor authentication |
| `ci-cd` | CI/CD Pipeline | Set up or improve CI/CD |
| `security-audit` | Security Audit | Find vulnerabilities, document findings |
| `performance-opt` | Performance Optimization | Identify bottlenecks, measure before/after |

#### Adding a Custom Template

1. Add an entry to `MISSION_TEMPLATES`:
```typescript
{
  id: "api-migration",
  label: "API Migration",
  description: "Migrate from REST to GraphQL",
  goal: "Migrate existing REST endpoints to GraphQL while maintaining backward compatibility.",
  constraints: "All existing tests must pass. Add a GraphQL test suite. Keep REST endpoints alive for 30-day deprecation period. Document migration path.",
}
```

2. Rebuild the extension. The template appears in:
```
/mission templates list
/mission templates scaffold api-migration "Migrate users API to GraphQL"
```

#### Template Flow

When a template is scaffolded:
1. `createMissionFromTemplate(id, title)` finds the template by ID
2. Falls through to `createStructuredMission(title, goal, constraints)`
3. Creates a 3-feature mission: clarify scope → implement core change → verify and summarize
4. Each feature has one manual acceptance criterion

**For custom templates with custom features**, implement a dedicated builder function (like `missionFromWizardOutput`) and call it from the template handler instead of falling through to `createStructuredMission`.

#### Planning Wizard Integration

Templates provide `goal` and `constraints` fields that feed into the planning wizard prompt:

```
Goal: {goal}
Constraints: {constraints}
```

The wizard parses these and generates 2+ milestones with 5+ features, each with acceptance criteria. If the wizard fails or produces invalid output, the system falls back to the 3-feature scaffold.

---

### 4. Debugging

When something goes wrong, pi-missions provides several inspection tools.

#### `/mission debug [id]`

Shows the last 25 history entries for a mission as a widget:
```
/mission debug              # Debug active mission
/mission debug pim:2026...  # Debug a specific mission
```

Output format:
```
Mission: Add dark mode toggle
Status: active
Active: F003
────────────────────────────────────────────────────────────────
2026-03-10 14:23:01 feature_done     F002    Auto-completed: tests pass
2026-03-10 14:22:45 tool_call        F002    bash: npm test
2026-03-10 14:22:30 error_detected   F002    bash failed: ENOTFOUND
```

#### `/mission history [filter]`

Full history browser with filtering:
```
/mission history                  # All events (last 40)
/mission history F002             # Filter by feature ID
/mission history feature_done     # Filter by event type
/mission history "npm test"       # Full-text search in notes
```

Shows: timestamp, event type, feature ID, note (60 chars). Also prints:
- Features involved
- Event types present
- Path to the full `history.jsonl`
- A `jq` command for replay on the CLI

#### Filesystem Inspection

```bash
# View history (all events, append-only)
cat ~/.pi/missions/<mission-id>/history.jsonl | tail -50

# jq-based replay
jq -r '.event + " " + (.featureId // "")' ~/.pi/missions/<id>/history.jsonl

# View mission state
cat ~/.pi/missions/<mission-id>/plan.json | jq .

# Check schema version
jq .schemaVersion ~/.pi/missions/<mission-id>/plan.json

# View evidence files
ls ~/.pi/missions/<mission-id>/evidence/

# Check session links
ls ~/.pi/missions/<mission-id>/sessions/
```

#### `/mission status`

Shows: mission state, active feature, progress bar, acceptance criteria with verification status, dependencies, next pending feature, token usage.

#### `/mission edit <feature-id>`

Opens the feature as editable JSON (in UI mode) or displays it (in CLI mode). Useful for:
- Waiving acceptance criteria (`"waived": true`)
- Changing feature status
- Editing description or priority
- Validates against `FeatureSchema` before saving

#### `/mission migrate`

Lists all missions with their schema versions:
```
/mission migrate
```

Output:
```
📋 Mission Schema Versions
══════════════════════════════════════════════════════════
✅ pim-20260310-dark-mode-toggle  v3      Add dark mode toggle
⬆️ pim-20260115-refactor-auth    v1      Refactor auth module
❓ pim-20251201-unknown           ?       Unknown
══════════════════════════════════════════════════════════
Current schema: v3
1 mission(s) need migration.
```

Preview a migration:
```
/mission migrate <id>
```

Run migration (creates pre-migration backup):
```
/mission migrate <id> confirm
```

Backup location: `~/.pi/missions/<id>/plan.json.pre-migration-<timestamp>.bak`

#### `/mission metrics`

Cross-mission statistics:
- Total missions, completed missions, success rate
- Average tokens per mission
- Average features per mission
- Average completion time
- Session-level metrics (tool calls, errors, auto-advances, stuck detections)

Also exports full metrics to `~/.pi/missions/metrics-export.json`.

#### Common Debugging Scenarios

| Problem | Diagnostic |
|---|---|
| Feature won't advance | `/mission status` — check if active feature is blocked or deps unsatisfied |
| Mission not loading on restart | Check validation token mismatch in session entries; check `plan.json` exists |
| Tool calls being blocked | Check phase detection (examine active feature title); run `/mission status` |
| Autopilot stopped | `/mission history autopilot_stopped` — inspect `lastStopReason` |
| Stuck detection fired | `/mission history stuck_detected` — see reason and source (text_loop or tool_pattern) |
| Schema migration needed | `/mission migrate` — lists all missions with versions |
| Lock file preventing writes | Delete `~/.pi/missions/<id>/plan.json.lock` (stale lock cleanup) |

---

### 5. Recovery

Missions can get stuck, blocked, or encounter errors. Here's how to recover.

#### Manual Recovery Commands

| Command | When to use |
|---|---|
| `/mission block <reason>` | Feature needs external input (decision, permission, API key) |
| `/mission pause` | Temporarily stop work on this mission |
| `/mission resume` | Continue a paused mission |
| `/mission fork <reason>` | Try an alternative approach while preserving original |
| `/mission edit <feature-id>` | Manually fix feature state, waive criteria, or adjust deps |
| `/mission clear` | Detach mission from current session (state stays on disk) |
| `/mission load <id>` | Re-attach a cleared mission |

#### Automatic Recovery (Error Recovery Engine)

At `tool_result`, when a tool call fails:

1. **Error categorization** (`categorizeError`):
   - `network`: connection, timeout, ECONNREFUSED → retry (max 5)
   - `permission`: EACCES, EPERM → ask_user
   - `transient`: temporary, busy, locked → retry (max 3)
   - `system`: memory, disk, space → degrade (max 2)
   - `permanent`: syntax, parse → block
   - `unknown`: none matched → skip (max 1)

2. **Retry with backoff**: `withRetry()` uses exponential backoff + jitter
3. **Escalation**: when retry count ≥ maxRetries, falls back to the strategy's fallback action (ask_user, block, skip, degrade)
4. **Alerting**: critical errors fire immediate alerts; non-critical errors fire at threshold (3 consecutive) or total count (5 in window)

The error is logged to `history.jsonl` with category, severity, action, and retry count.

#### Stuck Detection Recovery

When auto-blocked (stuck detection fires at `turn_end`):

1. Feature status → `blocked`, mission status → `blocked`
2. Autopilot disabled
3. Reason logged to history (`stuck_detected` event)
4. Notify user with reason

**Recovery steps**:
1. Read the auto-block reason: `/mission history stuck_detected`
2. Inspect the feature: `/mission status`
3. Options:
   - If investigation needed: `/mission fork "Investigate root cause"`
   - If the feature is actually done: `/mission done "<evidence>"`
   - If criteria need adjustment: `/mission edit <feature-id>` → waive or modify
   - If blocking permanently: leave blocked and advance: `/mission next`

#### Forking for Recovery

When a feature is blocked or you want to try a different approach:
```
/mission fork "Try using CSS modules instead of Tailwind for dark mode"
```

Fork creates a copy of the active feature with:
- New ID: `<original-id>-fork-<timestamp>`
- Title: `<original-title> [fork]`
- Linked to parent feature via session references
- Original feature is blocked with fork metadata
- If the Pi `ctx.fork()` API is available, forks the session too

After forking, both the original and fork exist in the milestone. You can switch between them or complete one and discard the other.

#### Schema Migration

If a mission was created with an older schema version:
```
/mission migrate                    # List all with versions
/mission migrate <id>               # Preview migration
/mission migrate <id> confirm       # Execute with backup
```

Migration creates a timestamped backup before writing. If migration fails, restore from the backup:
```bash
cp ~/.pi/missions/<id>/plan.json.pre-migration-*.bak ~/.pi/missions/<id>/plan.json
```

#### State File Corruption

If `plan.json` is corrupted:
1. Check for a backup: `ls ~/.pi/missions/<id>/plan.json.bak`
2. Restore from backup: `cp plan.json.bak plan.json`
3. If no backup, check for pre-migration backup: `ls ~/.pi/missions/<id>/plan.json.pre-migration-*.bak`
4. As last resort, inspect `history.jsonl` to reconstruct state

The system writes via temp+rename (`plan.json.tmp.<rand>` → `plan.json`), so partial writes are never seen. Corruption is extremely unlikely unless the filesystem itself fails.

#### Lock Cleanup

If a stale lock file prevents writes:
```bash
rm ~/.pi/missions/<id>/plan.json.lock
```

The lock uses `proper-lockfile` with a 2-second stale threshold. Stale locks are auto-cleaned on next access.

---

## Phase 4: API Reference

### 4.1 Extension API — Pi Extension Hooks

**File**: `src/core/extension.ts`

Pi-missions registers 10 Pi extension hooks and 2 keyboard shortcuts. All hooks use the typed `hook()` wrapper that casts through `unknown` to safely register runtime-only event names.

#### Hook Registration Utility

```typescript
// Casts through unknown to register events valid at runtime
// but not in the public ExtensionAPI types
export function hook(pi: ExtensionAPI, event: string, handler: PiEventHandler): void
export type PiEventHandler = (...args: unknown[]) => unknown
```

#### Hook Lifecycle Table

| # | Hook | When | Purpose |
|---|------|------|---------|
| 1 | `session_start` | Session begins | Auto-restore mission from previous session's entries |
| 2 | `resources_discover` | Extension discovery | Returns empty skill/prompt/theme paths (no resources to inject) |
| 3 | `session_before_tree` | Before tree display | Injects mission summary into session tree |
| 4 | `before_agent_start` (1) | Before each agent turn | Resets phase, clears errors, resets detector history |
| 5 | `before_agent_start` (2) | Before each agent turn | Injects lean mission context + pending completion hints |
| 6 | `tool_call` | Before each tool call | Enforces tool policy (allowed tools + max calls per phase) |
| 7 | `tool_result` | After each tool result | Records metrics, handles errors via ErrorRecoveryEngine |
| 8 | `turn_end` | After agent completes turn | Stuck detection, token budget tracking, auto-save |
| 9 | `agent_end` | After agent output | Completion detection + auto-advance (or autopilot processing) |
| 10 | `session_before_compact` | Before context compaction | Saves compaction checkpoint to history |
| 11 | `session_shutdown` | Session ends | End metrics, clear auto-save, link session, final save |

#### Keyboard Shortcuts

| Shortcut | Handler | Description |
|---|---|---|
| `Ctrl+Shift+M` | `handleDashboard(ctx, runtime)` | Open Mission Control dashboard |
| `Ctrl+Shift+D` | Inline: mark feature done with confirmation | Mark current feature done |

---

### 4.2 Type Definitions

**File**: `src/core/types.ts`

All 26 types, interfaces, and constants used by pi-missions.

#### Core State Types

```typescript
// Mission state — persisted to plan.json
export interface MissionState {
  schemaVersion: number          // Current: 3
  id: string                     // e.g., "pim-20260310-dark-mode-toggle"
  title: string                  // Human-readable title
  goal: string                   // Mission goal description
  status: MissionStatus          // planning | active | paused | blocked | complete | budget_limited | failed
  milestones: Milestone[]        // Ordered list of milestones
  activeMilestoneId?: string     // Currently active milestone
  activeFeatureId?: string       // Currently active feature
  tokensBudget?: number          // Optional token budget cap
  tokensUsed: number             // Cumulative tokens consumed
  lastContextTokens: number      // Context tokens at last turn_end
  validationToken: string        // SHA-256 token for session validation
  autopilot: MissionAutopilot    // Autopilot configuration + state
  userPreferences?: {            // User-toggled preferences
    allowBashInPlanning?: boolean
  }
  createdAt: number              // Unix ms timestamp
  updatedAt: number              // Unix ms timestamp
}

// Runtime state — in-memory only, never persisted
export interface RuntimeState {
  activeMission: MissionState | null
  autoSaveInterval: ReturnType<typeof setInterval> | null
  phaseToolCallCount: number
  currentPhase: ToolPhase
  lastFeatureId?: string
  pendingCompletionAction?: "auto_done" | "suggest_done" | "continue" | "ask_user"
  pendingCompletionReason?: string
}

// Feature — the unit of work within a milestone
export interface Feature {
  id: string                     // e.g., "F001"
  milestoneId: string            // e.g., "M01"
  title: string
  description: string
  priority: number               // 1-5, lower = higher priority
  dependsOn: string[]            // Feature IDs this depends on
  acceptance: AcceptanceCriterion[]
  status: FeatureStatus          // pending | waiting | active | done | blocked | failed
  sessions: string[]              // Session file references
  completedAt?: number
  startedAt?: number
  maxWallClockMs?: number        // Default: 30 min
  maxToolCalls?: number          // Default: 150
  toolCallCount: number
  notes?: string
  _execFn?: (command: string) => { code: number; stdout: string; stderr?: string }
}

// Milestone — groups related features
export interface Milestone {
  id: string                     // e.g., "M01"
  title: string
  description: string
  status: MilestoneStatus        // pending | active | complete
  features: Feature[]
  dependsOn?: string[]           // Milestone IDs
}

// Acceptance criterion — a verifiable condition
export interface AcceptanceCriterion {
  id: string                     // e.g., "AC001"
  description: string
  checkType: CheckType           // manual | bash | test_file
  checkCommand?: string          // Bash command to run (for bash type)
  evidence?: string              // Captured stdout/output
  verified: boolean
  waived?: boolean               // Skip verification
}

// Autopilot — controls autonomous feature advancement
export interface MissionAutopilot {
  enabled: boolean
  mode: AutopilotMode            // manual | assisted | autopilot
  iteration: number
  maxIterations: number          // Default: 25
  consecutiveFailures: number
  maxConsecutiveFailures: number // Default: 3
  noProgressTurns: number
  maxNoProgressTurns: number     // Default: 3
  maxContextPercent: number      // Default: 85
  startedAt: string
  lastContinuationAt?: string
  lastStopReason?: StopReason
  lastStopMessage?: string
  continueAcrossFeatures: boolean
  requireEvidenceForDone: boolean
}
```

#### Literal Union Types

```typescript
export type MissionStatus =
  | "planning" | "active" | "paused" | "blocked"
  | "complete" | "budget_limited" | "failed"

export type FeatureStatus =
  | "pending" | "waiting" | "active" | "done" | "blocked" | "failed"

export type MilestoneStatus = "pending" | "active" | "complete"

export type CheckType = "manual" | "bash" | "test_file"

export type AutopilotMode = "manual" | "assisted" | "autopilot"

export type StopReason =
  | "mission_complete" | "paused_by_user" | "blocked" | "disabled"
  | "max_iterations" | "max_consecutive_failures" | "context_limit"
  | "no_active_feature" | "needs_user_decision" | "no_progress"
  | "validation_failed" | "error"

export type ToolPhase = "planning" | "execution" | "verification"

export type ErrorCategory =
  | "transient" | "permanent" | "user" | "system"
  | "network" | "permission" | "unknown"

export type ErrorSeverity = "low" | "medium" | "high" | "critical"

export type RecoveryAction =
  | "retry" | "fallback" | "skip" | "block" | "ask_user" | "degrade"

export type CompletionConfidence = "low" | "medium" | "high"

export type AgentSource = "pi" | "devin" | "opencode" | "codex" | "unknown"
```

#### Constants

```typescript
export const SCHEMA_VERSION = 3
export const DEFAULT_FEATURE_MAX_WALL_CLOCK_MS = 30 * 60 * 1000   // 30 min
export const DEFAULT_FEATURE_MAX_TOOL_CALLS = 150
export const STALE_FEATURE_WARN_MS = 20 * 60 * 1000              // 20 min

export const DEFAULT_AUTOPILOT: MissionAutopilot = {
  enabled: false, mode: "manual", iteration: 0,
  maxIterations: 25, consecutiveFailures: 0, maxConsecutiveFailures: 3,
  noProgressTurns: 0, maxNoProgressTurns: 3, maxContextPercent: 85,
  startedAt: "", continueAcrossFeatures: true, requireEvidenceForDone: true,
}
```

#### Tool Policy Types

```typescript
export interface ToolPolicy {
  phase: ToolPhase
  allowedTools: string[]
  maxToolCalls: number
}

export const TOOL_POLICIES: Record<ToolPhase, ToolPolicy> = {
  planning: {
    phase: "planning",
    allowedTools: ["read", "grep", "find", "ls", "mission_..."],
    maxToolCalls: 30,
  },
  execution: {
    phase: "execution",
    allowedTools: ["read", "write", "edit", "bash", "grep", "find", "ls", "mission_..."],
    maxToolCalls: 120,
  },
  verification: {
    phase: "verification",
    allowedTools: ["read", "bash", "grep", "find", "ls", "mission_..."],
    maxToolCalls: 60,
  },
}
```

#### Event & History Types

```typescript
export interface MissionHistoryEntry {
  ts: number                     // Unix seconds
  missionId: string
  event: string                  // e.g., "feature_done", "error_detected", "completion_detection"
  milestoneId?: string
  featureId?: string
  note?: string
  duration_ms?: number
  tokensUsed?: number
  details?: Record<string, unknown>
}

export interface ToolCallEvent {
  toolName: string
  toolCallId?: string
  input?: Record<string, unknown>
}

export interface ToolResultEvent {
  toolName: string
  toolCallId?: string
  input?: Record<string, unknown>
  content?: Array<{ type?: string; text?: string }>
  details?: unknown
  isError: boolean
}

export interface CompletionSignal {
  type: "keyword" | "acceptance" | "tool_pattern" | "error_free_streak" | "user_confirmation"
  confidence: CompletionConfidence
  evidence: string
  timestamp: number
}

export interface CompletionDetectionResult {
  isComplete: boolean
  confidence: CompletionConfidence
  signals: CompletionSignal[]
  suggestedAction: "auto_done" | "suggest_done" | "continue" | "ask_user"
  reason: string
}
```

#### Error Recovery Types

```typescript
export interface ErrorContext {
  toolName?: string
  featureId?: string
  missionId?: string
  timestamp: number
  errorType: string
  errorMessage: string
  stackTrace?: string
}

export interface ErrorRecoveryStrategy {
  category: ErrorCategory
  maxRetries: number
  backoffMs: number
  fallbackAction?: RecoveryAction
  degradeAction?: () => void
}

export interface ErrorRecord {
  id: string
  context: ErrorContext
  category: ErrorCategory
  severity: ErrorSeverity
  retryCount: number
  actionTaken: RecoveryAction
  resolved: boolean
  timestamp: number
}
```

#### Metrics & Alert Types

```typescript
export interface MissionMetrics {
  missionId: string
  created: number
  completed?: number
  totalFeatures: number
  featuresDone: number
  featuresFailed: number
  totalTokensUsed: number
  totalWallClockMs: number
  acceptanceFailures: number
  evidenceHashErrors: number
}

export interface MissionMetricsSummary {
  totalMissions: number
  completedMissions: number
  successRate: number
  averageTokensPerMission: number
  averageFeaturesPerMission: number
  averageCompletionTimeMs: number
}

export interface SessionMetrics {
  sessionId: string
  startTime: number
  endTime?: number
  toolCalls: {
    total: number
    byTool: Record<string, number>
    successful: number
    failed: number
  }
  tokensUsed: number
  featuresCompleted: number
  errors: {
    total: number
    byCategory: Record<string, number>
  }
  autoAdvanceCount: number
  stuckDetectionCount: number
}

export interface StaleFeatureAlert {
  featureId: string
  title: string
  activeMs: number
  maxMs: number
  warnMs: number
  toolCallsUsed: number
  maxToolCalls: number
  level: "warn" | "critical"
}
```

#### Transition Result Types

```typescript
export interface CompleteFeatureOptions {
  evidence: string
  notes?: string
  autoVerify?: boolean
  markAcceptanceVerified?: boolean
  historyNote?: string
  historyDetails?: Record<string, unknown>
}

export type CompleteFeatureResult =
  | { ok: true; feature: Feature; evidenceFile: string; missionComplete: boolean }
  | { ok: false; reason: string; unverifiedBashCount?: number }

export type ActivateNextResult =
  | { ok: true; next: Feature }
  | { ok: false; reason: "active_not_done"; active: Feature }
  | { ok: false; reason: "mission_complete" }
  | { ok: false; reason: "no_unblocked_pending" }
```

#### Utility Types

```typescript
// Graceful degradation wrapper
export interface DegradedResult<T> {
  ok: boolean
  value: T | undefined
  degraded: boolean
  error?: unknown
}

// Retry configuration
export interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  jitterFactor?: number
  shouldRetry?: (error: unknown) => boolean
  operationName?: string
}

// Lock configuration
export type LockOptions = {
  retries?: number
  minTimeout?: number
  maxTimeout?: number
  stale?: number
}

// Session entry validation
export interface ActiveMissionSessionEntry {
  missionId: string
  validationToken?: string
}

export type ActiveMissionSessionEntryResult =
  | { kind: "none" }
  | { kind: "valid"; entry: ActiveMissionSessionEntry }
  | { kind: "invalid"; reason: string; data: unknown }

// Fork context
export interface ForkSessionManager {
  getLeafId?: () => string | null
  getSessionFile?: () => string | undefined
}

export interface ForkReplacementContext {
  sessionManager?: ForkSessionManager
  sendUserMessage?: (message: string) => Promise<unknown>
  ui: { notify: (message: string, severity: string) => void }
}

// Mission context session manager
export interface MissionContextSessionManager {
  appendCustomMessageEntry?: (
    customType: string,
    content: string,
    display: boolean,
    details?: Record<string, unknown>,
  ) => string
}

export interface ContinuationDecision {
  continue: boolean
  reason?: string
}
```

---

### 4.3 Schema Validation

**File**: `src/core/types.ts` (TypeBox schemas + validation utilities)

Pi-missions uses [TypeBox](https://github.com/sinclairzx81/typebox) (`@sinclair/typebox`) for runtime schema validation. Four core schemas validate mission state structure, plus a wizard-specific output schema for AI-generated content.

#### Core Schemas

```typescript
import { Type, type Static } from "@sinclair/typebox"

// CriterionSchema — validates individual acceptance criteria
export const CriterionSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 50 }),
  description: Type.String({ minLength: 1, maxLength: 500 }),
  checkType: Type.Union([
    Type.Literal("manual"),
    Type.Literal("bash"),
    Type.Literal("test_file"),
  ]),
  checkCommand: Type.Optional(Type.String({ maxLength: 1000 })),
  evidence: Type.Optional(Type.String()),
  verified: Type.Boolean(),
  waived: Type.Optional(Type.Boolean()),
})

// FeatureSchema — validates feature structure
// ID pattern: F + 3 digits (F001-F999)
// Milestone ID pattern: M + 2 digits (M01-M99)
export const FeatureSchema = Type.Object({
  id: Type.String({ pattern: "^F[0-9]{3}$" }),
  milestoneId: Type.String({ pattern: "^M[0-9]{2}$" }),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.String({ minLength: 1, maxLength: 2000 }),
  priority: Type.Integer({ minimum: 1, maximum: 5 }),
  dependsOn: Type.Array(Type.String({ pattern: "^F[0-9]{3}$" })),
  acceptance: Type.Array(CriterionSchema, { minItems: 1 }),
  status: Type.Union([
    Type.Literal("pending"), Type.Literal("waiting"),
    Type.Literal("active"), Type.Literal("done"),
    Type.Literal("blocked"), Type.Literal("failed"),
  ]),
  sessions: Type.Array(Type.String()),
  toolCallCount: Type.Integer({ minimum: 0 }),
  startedAt: Type.Optional(Type.Integer()),
  completedAt: Type.Optional(Type.Integer()),
  maxWallClockMs: Type.Optional(Type.Integer({ minimum: 0 })),
  maxToolCalls: Type.Optional(Type.Integer({ minimum: 0 })),
  notes: Type.Optional(Type.String({ maxLength: 1000 })),
})

// MilestoneSchema — validates milestone structure
export const MilestoneSchema = Type.Object({
  id: Type.String({ pattern: "^M[0-9]{2}$" }),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.String({ maxLength: 1000 }),
  status: Type.Union([
    Type.Literal("pending"),
    Type.Literal("active"),
    Type.Literal("complete"),
  ]),
  features: Type.Array(FeatureSchema, { minItems: 1 }),
  dependsOn: Type.Optional(Type.Array(Type.String({ pattern: "^M[0-9]{2}$" }))),
})
```

#### Wizard Output Schema

```typescript
// Lighter schemas for AI-generated wizard output
// IDs are optional (wizard assigns them), additionalProperties: false

export const WizardCriterionSchema = Type.Object({
  id: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
  description: Type.String({ minLength: 1, maxLength: 500 }),
  checkType: Type.Union([
    Type.Literal("manual"),
    Type.Literal("bash"),
    Type.Literal("test_file"),
  ]),
  checkCommand: Type.Optional(Type.String({ maxLength: 1000 })),
}, { additionalProperties: false })

export const WizardFeatureSchema = Type.Object({
  id: Type.Optional(Type.String({ pattern: "^F[0-9]{3}$" })),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.String({ minLength: 1, maxLength: 2000 }),
  priority: Type.Integer({ minimum: 1, maximum: 5 }),
  dependsOn: Type.Array(Type.String({ pattern: "^F[0-9]{3}$" })),
  acceptance: Type.Array(WizardCriterionSchema, { minItems: 1 }),
}, { additionalProperties: false })

export const WizardMilestoneSchema = Type.Object({
  id: Type.Optional(Type.String({ pattern: "^M[0-9]{2}$" })),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.String({ maxLength: 1000 }),
  features: Type.Array(WizardFeatureSchema, { minItems: 1 }),
}, { additionalProperties: false })

export const WizardOutputSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }),
  milestones: Type.Array(WizardMilestoneSchema, { minItems: 2, maxItems: 20 }),
}, { additionalProperties: false })
```

#### Schema-Derived Static Types

```typescript
// Static types inferred from TypeBox schemas
export type AcceptanceCriterionValidated = Static<typeof CriterionSchema>
export type FeatureValidated = Static<typeof FeatureSchema>
export type MilestoneValidated = Static<typeof MilestoneSchema>
export type WizardOutput = Static<typeof WizardOutputSchema>
```

#### Validation Utilities

```typescript
import { Value } from "@sinclair/typebox/value"

export interface ValidationError {
  path: string       // Dot-notation path to the invalid field
  message: string    // Human-readable error message
  value: unknown     // The invalid value
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

// Generic TypeBox schema validator
// Returns { valid: true, errors: [] } or { valid: false, errors: [...] }
export function validate<T extends TSchema>(
  schema: T,
  value: unknown
): ValidationResult

// Formats validation errors into a readable string
// Limits output to first 10 errors, with value previews (truncated at 50 chars)
export function formatValidationErrors(
  errors: ValidationError[]
): string
```

#### Usage Example

```typescript
import { FeatureSchema, validate, formatValidationErrors } from "../core/types.js"

const result = validate(FeatureSchema, incomingFeature)
if (!result.valid) {
  console.error(formatValidationErrors(result.errors))
  // Output:
  // Validation errors:
  //   - /id: Expected string to match '^F[0-9]{3}$'
  //     (value: "feature-1")
  //   - /priority: Expected number to be >= 1
  //     (value: 0)
}
```

#### Schema Validation Flow

```
Input (AI-generated or user-edited JSON)
    ↓
validate(WizardOutputSchema, parsed)
    ↓ (valid)                    ↓ (invalid)
missionFromWizardOutput()      formatValidationErrors()
    ↓                              ↓
MissionState created            Error shown to user
    ↓                         (retry wizard or manual edit)
saveMissionSafe()
```

**Edge cases**:
- `validate()` wraps all errors in try/catch — malformed inputs return `{ valid: false, errors: [{ path: "root", ... }] }`
- `formatValidationErrors()` truncates at 10 errors to avoid flooding the UI
- Wizard schemas use `additionalProperties: false` — AI hallucinated extra fields are rejected
- ID patterns (`^F[0-9]{3}$`, `^M[0-9]{2}$`) enforce consistent naming across milestones
- `checkType: "bash"` allows but doesn't require `checkCommand` — manual criteria skip it

---

## Testing Strategy

### Unit Tests (522 tests, vitest)

```bash
npm run check    # tsc --noEmit
npm test         # vitest run
```

### End-to-End Tests (tmux-based)

```bash
bash scripts/pi_missions_e2e_runner.sh --mode full
```

E2E validates: setup, extension signals, `/mission` commands, mission lifecycle, read-only bash in planning phase, error recovery tools.

---

## Design Principles

1. **Local-first** — no backend required; all state in `~/.pi/missions/`
2. **Crash-tolerant** — EXDEV-safe temp+rename writes, backup restoration
3. **Evidence-driven** — features only marked done with concrete proof
4. **Concurrent-safe** — file locking prevents simultaneous modifications
5. **Phase-aware** — tool policy enforced per mission phase (planning/execution/verification)
6. **Observable** — structured logging, session metrics, history.jsonl audit trail
7. **Resilient** — graceful degradation; error recovery with retry/ask_user/block actions
8. **Autonomous** — optional autopilot mode auto-advances through features