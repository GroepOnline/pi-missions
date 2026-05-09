# Pi Missions — Autonomy Levels

Pi Missions implements **three graduated autonomy levels** that control which tools the coding agent may use during each mission phase. The phase is detected automatically from the active feature's title and description.

---

## Phase Detection

The active feature determines the current phase via keyword matching:

| Phase | Keywords (title + description) | Max Tool Calls | Allowed Tools |
|---|---|---|---|
| **Planning** | `clarify`, `plan`, `scope`, `research`, `analyze`, `inspect`, `investigate`, `discover`, `reconnaissance`, `current state` | 30 | read_file, list_directory, glob, code_search, file_picker, researcher, read_subtree + read-only bash¹ |
| **Execution** | Everything else | 120 | All tools (full write access) |
| **Verification** | `verify`, `test`, `summarize` | 60 | read_file, list_directory, glob, code_search, basher, file_picker, read_subtree |

If no active feature exists, the phase defaults to **execution**.

¹ Planning bash: only single read-only commands (`ls`, `pwd`, `grep`, `rg`, `cat`, `sed -n`, `head`, `tail`, `wc`, `find` without destructive flags, `git status/diff/show/log`). Shell chaining (`;`, `|`, `&&`) and newlines are blocked.

---

## Level 1 — Planning (Read-only)

**Goal**: Understand the codebase, gather context, and formulate a plan — without modifying anything.

**What the agent CAN do**:
- Read any file in the repository
- Search code with `grep`/`rg`/`find`
- Explore directory structures
- Browse documentation

**What the agent CANNOT do**:
- Write, delete, or modify files
- Run tests or build commands
- Execute any shell command except read-only bash

**How to advance**: The user or `/mission next` advances to the next feature in the milestone, which should be an execution-phase feature.

---

## Level 2 — Execution (Full access)

**Goal**: Implement the smallest, most coherent change that satisfies the mission goal.

**What the agent CAN do**:
- All tools: read, write, delete, bash, search, browse
- Run builds, tests, linting
- Install packages (npm/pip/cargo)

**Guardrails**:
- Max 120 tool calls per feature before stale detection triggers
- Feature wall-clock limit: 30 minutes (warn at 20 min, critical at 30 min)
- Completion detection: multi-factor analysis at agent_end for auto-advance
- Stuck detection: pattern-based loop detection with self-blocking suggestion

**How to advance**: `/mission done <evidence>` or auto-completion detection.

---

## Level 3 — Verification (Read + Bash)

**Goal**: Run checks, capture evidence, and confirm correctness — no new implementation.

**What the agent CAN do**:
- Read files and search code
- Run test suites and build commands via bash
- Capture evidence with `saveEvidence`

**What the agent CANNOT do**:
- Write or modify files
- Install new packages

**How to advance**: `/mission done <evidence>` when all acceptance criteria are verified.

---

## Feature Lifecycle

```
pending → active → done
           ↘ blocked → pending (auto-unblock when deps resolve)
                     → forked (alternative approach)
```

### State transitions:

| From | To | Trigger |
|---|---|---|
| `pending` | `active` | `/mission next`, `mission_next_feature`, auto-advance |
| `active` | `done` | `/mission done`, `mission_feature_done`, auto-complete |
| `active` | `blocked` | `/mission block`, `mission_block_self`, dep-not-met auto-block |
| `blocked` | `pending` | Auto-unblock when all dependencies are done |
| `active` | `active` (forked) | `/mission fork` creates a fork feature, blocks original |

---

## Context Injection Strategy

To avoid dumping the entire mission into every LLM turn:

| Event | Context injected | Size |
|---|---|---|
| Mission start/load | Full context (banner + brief + help + history) | ~60 lines |
| `before_agent_start` | Lean context (banner + brief only) | ~15 lines |
| Compaction checkpoint | Compaction summary | ~5 lines |

The lean context includes only: mission banner (ID, title, goal, progress, active feature) + feature brief (acceptance criteria, dependencies, phase instruction).

Use `/mission help` for the full commands & tools reference, and `/mission status` for the complete mission overview.

---

## Stale Feature Detection

Two-tier system catches features that run too long:

| Level | Trigger | Action |
|---|---|---|
| **Warn** | Active > 20 minutes | UI notification only |
| **Critical** | Active > 30 minutes OR too many tool calls | Recorded in history, visible in metrics |

Detected at `turn_end` via `detectStaleFeature()`.

---

## Error Recovery

Tool failures trigger the error recovery engine which categorizes errors:

| Category | Action |
|---|---|
| `transient` | Retry allowed, logged |
| `configuration` | Ask user for input |
| `permanent` | Block the feature |
| `system` | Log and continue |

Repeated errors escalate: transient → configuration → permanent.
