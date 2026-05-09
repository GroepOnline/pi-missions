# Pi Missions — Documentation Plan

> Last updated: v1→v2 refactoring
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
│   │   └── recovery.ts    # Error recovery engine
│   ├── tools/             # LLM-callable tools
│   │   └── index.ts       # Tool registration, policy enforcement
│   ├── ui/                # UI components
│   │   ├── components.ts  # Footer, status bar, notifications
│   │   └── dashboard.ts   # Mission Control dashboard widget
│   ├── utils/             # Utilities
│   │   ├── context.ts     # Context injection (buildMissionContext, buildLeanContext)
│   │   ├── fs.ts          # Safe file I/O, path validation, lock management
│   │   └── markdown.ts    # Markdown export, missionFromWizardOutput
│   ├── commands/          # Command handlers
│   │   ├── index.ts       # Command registration, subcommand router
│   │   └── handlers.ts    # Individual handler implementations
│   ├── index.ts           # Re-exports core/extension.js (entrypoint for Pi)
│   ├── commands.ts        # Legacy (absorbed into commands/)
│   ├── completion.ts      # Legacy (absorbed into engines/)
│   ├── context.ts         # Legacy (absorbed into utils/)
│   ├── dashboard.ts       # Legacy (absorbed into ui/)
│   ├── feedback.ts        # Error formatting and severity detection
│   ├── lock.ts            # File locking for concurrent access protection
│   ├── logger.ts          # Structured logging
│   ├── metrics.ts         # Legacy metrics (absorbed into engines/)
│   ├── schemas.ts         # JSON schema definitions for validation
│   ├── state.ts           # Legacy state (absorbed into core/)
│   ├── tools.ts           # Legacy tools (absorbed into tools/)
│   ├── types.ts           # Shared type definitions
│   ├── ui.ts              # Legacy UI (absorbed into ui/)
│   ├── validation.ts      # Input validation utilities
│   ├── autopilot.ts       # Standalone autopilot mode
│   ├── export.ts          # Markdown/JSON export
│   ├── mission-builder.ts # Mission creation from templates
│   ├── templates.ts       # Built-in mission templates
│   ├── transitions.ts     # Feature state transitions
│   ├── agent-detect.ts    # Agent detection utilities
│   └── recovery.ts        # Legacy recovery (absorbed into engines/)
├── tests/                 # Unit tests (vitest)
│   ├── commands.test.ts
│   ├── context.test.ts
│   ├── dashboard.test.ts
│   ├── index.test.ts
│   └── ... (18 test files total, 470 tests)
├── scripts/
│   └── pi_missions_e2e_runner.sh  # End-to-end tmux test runner
├── assets/                # Banner, state diagram, dashboard mockup
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

### Phase 1: Core Documentation ✅

- [x] **Conceptual overview** — what pi-missions is and why it exists
- [x] **Repository layout** — modular architecture (see above)
- [x] **State model** — `~/.pi/missions/<id>/` file layout
- [x] **Command reference** — all `/mission` subcommands
- [x] **Agent tool reference** — `mission_feature_done`, `mission_next_feature`, etc.

### Phase 2: Architecture Deep-Dives ⬜

- [ ] **Tool Policy** — phase-based tool restrictions (planning=read-only, execution=write, verification=bash)
- [ ] **Completion Detection** — how `engines/completion.ts` analyzes agent output to auto-detect feature completion
- [ ] **Error Recovery** — `engines/recovery.ts` error categorization, retry logic, and alerting
- [ ] **Session Auto-Restore** — how `session_start` hook reloads mission state from disk
- [ ] **Autopilot Mode** — autonomous feature advancement without manual `/mission next`
- [ ] **Dependency Normalization** — `missionFromWizardOutput` two-pass ID remapping

### Phase 3: Guides ⬜

- [ ] **Quick Start Guide** — install + first mission in 5 minutes
- [ ] **Mission Lifecycle** — full workflow from `new` → `done` → `complete`
- [ ] **Template Authoring** — how to create custom mission templates
- [ ] **Debugging** — using `/mission debug` and `~/.pi/missions/<id>/logs/`
- [ ] **Recovery** — what to do when a mission gets stuck or blocked

### Phase 4: API Reference ⬜

- [ ] **Extension API** — all Pi extension hooks used by pi-missions
- [ ] **Type Definitions** — `MissionState`, `Feature`, `Milestone`, `AcceptanceCriterion` types
- [ ] **Schema Validation** — `schemas.ts` JSON schema for mission state integrity

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

## Type Reference

```typescript
// core/types.ts
interface RuntimeState {
  activeMission: MissionState | null;
  autoSaveInterval: NodeJS.Timer | null;
  currentPhase: ToolPhase;
  phaseToolCallCount: number;
  lastFeatureId: string | undefined;
  pendingCompletionAction?: string;
  pendingCompletionReason?: string;
}

// core/state.ts
type ToolPhase = 'planning' | 'execution' | 'verification';
function getMissionPhase(mission: MissionState): ToolPhase;
```

---

## Testing Strategy

### Unit Tests (470 tests, vitest)

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