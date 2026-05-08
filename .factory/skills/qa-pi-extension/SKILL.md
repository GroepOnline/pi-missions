---
name: qa-pi-extension
description: >
  QA tests for the pi-missions Pi extension. Runs the existing e2e test suite
  via tmux-based Pi sessions to verify commands, tools, and autopilot functionality.
---

# QA: pi-missions Extension

This sub-skill leverages the existing comprehensive e2e testing infrastructure.

## Test Tool

Uses `tuistory` (via the `pi-missions-e2e-tester` skill) for TUI testing in tmux.

## Available Test Flows

The existing `pi-missions-e2e-tester` skill provides these flows:

### Smoke Mode (fast)
- Pi startup and extension load
- `/mission` command availability
- Basic command execution

### Full Mode (comprehensive)
- Mission creation with wizard
- Mission lifecycle (create → active → done → complete)
- Autopilot execution (`/mission run`, `/mission stop`)
- Mission commands: list, status, metrics, debug, dashboard
- Mission tools: `mission_feature_done`, `mission_next_feature`, `mission_ask_user`, `mission_block_self`, `mission_fork`
- Error recovery flows

## Running Tests

Invoke this skill:

```
Use the qa-pi-extension skill to run e2e tests.
```

This skill delegates to `pi-missions-e2e-tester` which handles tmux session management and Pi startup.

## Known Failure Modes

1. **Pi not installed** - Requires `pi` CLI in PATH
2. **Tmux not available** - Requires `tmux` for session management
3. **Port conflicts** - If another Pi session is running
4. **Stale locks** - Previous crashed sessions may leave lock files

## Cleanup

The e2e skill automatically cleans up:
- Tmux sessions
- Test mission artifacts (`~/.pi/missions/*e2e*`)
- Log files in `/tmp/`

## Expected Results

| Test | Expected |
|------|----------|
| Extension load | Pi starts, extension appears in startup |
| /mission help | Shows all subcommands |
| /mission new | Creates mission with wizard |
| Autopilot tools | All 7 tools registered |
| E2E runtime | ~16-20 seconds for full mode |
