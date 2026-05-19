# Pi Missions Autopilot Engine

This build adds a bounded Codex `/goal`-style continuation runtime.

## Flow

```text
/mission run
-> enable mission.autopilot
-> ensure one active runnable feature
-> send one follow-up turn
-> agent_end
-> evaluate progress/completion/blockers
-> update state and UI
-> send exactly one next follow-up turn or stop
```

The engine never runs an unbounded loop inside the extension. It chains one controlled turn at a time.

## Stop conditions

- mission complete
- user pause/stop
- blocker
- no active runnable feature
- max iterations
- max consecutive failures
- max no-progress turns
- context usage limit
- user decision needed
- runtime error

## Main files

- `src/engines/autopilot.ts`
- `src/core/types.ts`
- `src/commands/index.ts`
- `src/index.ts`
- `src/tools/index.ts`
- `src/ui/components.ts`
- `tests/autopilot.test.ts`
