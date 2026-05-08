---
name: pi-missions-e2e-tester
description: run comprehensive end-to-end tests for the pi-missions extension in the pi coding agent. use when asked to test, validate, smoke test, regression test, or certify pi-missions across mission creation, mission commands, mission lifecycle, auto-advance, completion detection, stuck/self-blocking/forking flows, and error recovery. also use when debugging whether the extension loads in pi, whether all mission tools are registered, or whether tmux-based pi sessions behave correctly.
---

# Pi-Missions E2E Tester

## Purpose

Perform production-style end-to-end testing of the `pi-missions` extension from inside the `pi-missions` project directory. Launch Pi in a controlled tmux session, load the extension from `./src/index.ts`, exercise mission commands and mission tools, verify observable behavior, clean up artifacts, and return a structured test report.

## Default Test Context

Use these defaults unless the user gives a different explicit value:

- Project directory: `/home/jan/projects/pi-missions`
- Tmux session: `pi-missions-e2e`
- Extension entrypoint: `./src/index.ts`
- Pi command: `pi -e ./src/index.ts`
- Mission test slug prefix: `e2e-test`
- Cleanup scope: only artifacts containing `e2e`, `e2e-test`, or `pi-missions-e2e`

Never use or request hardcoded API keys. If Pi requires authentication, report the missing authentication state rather than embedding credentials.

## Execution Rules

1. Always work from the `pi-missions` project directory.
2. Always kill an existing `pi-missions-e2e` tmux session before creating a new one.
3. Never create two sessions with the same name.
4. Verify Pi starts and the extension is loaded before running mission tests.
5. Treat captured tmux output as evidence; quote short excerpts only when useful.
6. Clean up tmux sessions and test mission artifacts before finishing.
7. If a step fails, continue with safe diagnostic checks when possible, then report the partial result clearly.
8. Do not mark a test passed unless it was directly observed in command output, tmux capture, filesystem state, or Pi response.

## Preferred Runner Script

A helper script is bundled at `scripts/pi_missions_e2e_runner.sh`. Use it for the deterministic setup, tmux lifecycle, command probing, logging, and cleanup whenever shell access is available.

Typical usage:

```bash
bash scripts/pi_missions_e2e_runner.sh --mode full
```

Useful overrides:

```bash
PROJECT_DIR=/path/to/pi-missions bash scripts/pi_missions_e2e_runner.sh --mode smoke
SESSION_NAME=pi-missions-e2e bash scripts/pi_missions_e2e_runner.sh --mode full --no-cleanup
```

The script writes logs under `/tmp/pi-missions-e2e-*`. After running it, inspect the generated summary and pane captures before writing the final report.

## Manual Workflow

Use this workflow when the runner script is unavailable or insufficient.

### 1. Setup

```bash
cd /home/jan/projects/pi-missions
tmux kill-session -t pi-missions-e2e 2>/dev/null || true
pi list || true
tmux new-session -d -s pi-missions-e2e -c /home/jan/projects/pi-missions
tmux send-keys -t pi-missions-e2e "pi -e ./src/index.ts" Enter
sleep 5
tmux capture-pane -t pi-missions-e2e -p
```

Pass criteria:

- Project directory exists and is used.
- Existing session was killed or was absent.
- New tmux session exists.
- Pi starts without immediate crash.
- Startup output indicates the extension entrypoint or project extension is loaded.

### 2. Extension Verification

Verify these observable signals:

- Extension appears in the Pi extensions section, preferably as `src` or `./src/index.ts`.
- `/mission` command is accepted or appears in completions/help.
- Footer or status UI shows mission context when expected.
- Mission tools are accessible in the Pi session.

The 7 mission tools that must be checked are:

1. `mission_next_feature`
2. `mission_feature_done`
3. `mission_ask_user`
4. `mission_block_self`
5. `mission_fork`
6. `mission_error_status`
7. `mission_retry_error`

If direct tool introspection is unavailable, ask Pi in the session to list the registered pi-missions tools, then validate the answer against this exact list.

### 3. Mission Command Tests

Probe these commands and capture output after each command:

```text
/mission list
/mission status
/mission metrics
/mission next
/mission done
/mission block
/mission fork
/mission debug
/mission dashboard
```

For `/mission new`, test the wizard separately:

```text
/mission new e2e-test E2E comprehensive test
```

Then cancel the wizard with Escape unless the current scenario requires creating a real mission.

Pass criteria:

- Command is recognized.
- Command returns a meaningful response or a valid empty-state message.
- Command does not crash Pi.
- Wizard can be opened and cancelled safely.

### 4. Mission Lifecycle Tests

Create one real mission only after setup and command smoke tests pass.

Verify:

- Mission ID format matches `pim:<timestamp>:<slug>`.
- Mission contains or references a validation token.
- Ghost mission events are rejected or ignored.
- Mission can move from created to in-progress to completed.
- Mission list/status reflect the state transition.
- Mission artifacts are written only under the expected mission storage path.

Use a slug beginning with `e2e-test` so cleanup can safely identify artifacts.

### 5. Auto-Advance Tests

Verify these behaviors through Pi responses, mission state, and logs:

- Completion detection uses multiple factors rather than a single brittle signal.
- `mission_feature_done` advances the active feature when appropriate.
- `mission_next_feature` returns the correct next actionable feature.
- Auto-complete only completes the mission when all completion criteria are satisfied.
- Stuck-pattern detection identifies blocked or repeated failure states.
- `mission_block_self` records a self-block with useful reason/context.
- `mission_fork` creates a linked fork rather than corrupting the original mission.

### 6. Error Recovery Tests

Verify:

- Errors are categorized into actionable classes.
- Retryable errors expose retry state and backoff information.
- Non-retryable errors suggest fallback or user action.
- Error statistics are tracked.
- `mission_error_status` returns current error state.
- `mission_retry_error` retries or refuses retry with a clear reason.

When no natural error exists, create a safe artificial failure such as an invalid mission reference or invalid event token. Never damage non-test missions.

## Evidence Standards

Use this evidence hierarchy:

1. Direct Pi output or command response.
2. Mission files/state under the test mission ID.
3. Extension logs or captured tmux pane output.
4. Source-code inspection only when runtime evidence is unavailable.

A checkbox may be marked passed only when supported by evidence. Use `partial` or `not verified` when evidence is incomplete.

## Cleanup

Always attempt cleanup, even after failures:

```bash
tmux send-keys -t pi-missions-e2e C-d 2>/dev/null || true
sleep 1
tmux kill-session -t pi-missions-e2e 2>/dev/null || true
find "$HOME/.pi/missions" -maxdepth 3 \( -iname '*e2e*' -o -iname '*pi-missions-e2e*' \) -print -exec rm -rf {} + 2>/dev/null || true
```

Only remove test artifacts that clearly match the E2E naming convention. Never delete arbitrary mission state.

## Report Format

Return this structure exactly, replacing each checkbox with `[x]`, `[ ]`, or `[partial]`.

```markdown
## Pi-Missions E2E Test Report

### Environment
- Directory: /home/jan/projects/pi-missions
- Pi version: {version or not detected}
- Extension: ./src/index.ts
- tmux session: pi-missions-e2e
- Log directory: {path if generated}

### Phase 1: Setup
- [ ] Navigated to project directory
- [ ] Killed existing tmux session
- [ ] Checked installed Pi packages/extensions
- [ ] Started tmux session
- [ ] Started Pi with extension
- [ ] Pi startup successful

### Phase 2: Extension Verification
- [ ] Extension loaded: src or ./src/index.ts
- [ ] Mission command available
- [ ] All 7 mission tools registered
- [ ] Session name set correctly
- [ ] Footer/status UI displayed

### Phase 3: Mission Commands
- [ ] /mission new works
- [ ] /mission list works
- [ ] /mission status works
- [ ] /mission metrics works
- [ ] /mission next works
- [ ] /mission done works
- [ ] /mission block works
- [ ] /mission fork works
- [ ] /mission debug works
- [ ] /mission dashboard works

### Phase 4: Advanced Features
- [ ] Mission ID format: pim:<timestamp>:<slug>
- [ ] Validation tokens created and validated
- [ ] Ghost mission event prevention works
- [ ] Completion detection works
- [ ] Auto-advance works
- [ ] Auto-complete works
- [ ] Stuck detection works
- [ ] Self-blocking works
- [ ] Forking works
- [ ] Error recovery tools work
- [ ] Error categorization works
- [ ] Retry mechanism works

### Phase 5: Cleanup
- [ ] Pi exited cleanly
- [ ] Tmux session killed
- [ ] Test artifacts cleaned

### Test Results
- Total checks: {number}
- Passed: {number}
- Partial: {number}
- Failed: {number}
- Not verified: {number}
- Success rate: {percentage}%

### Evidence Summary
{short bullets with relevant command output, mission IDs, and log paths}

### Issues Found
{risk-ranked list; write "None observed" if none}

### Recommendations
{specific next actions; write "No changes recommended" if clean}
```

## Failure Handling

- If Pi does not start, verify the project directory, `pi` binary availability, and extension entrypoint. Stop functional testing, run cleanup, and report setup failure.
- If the extension does not load, inspect `package.json`, `src/index.ts`, and startup errors. Do not run lifecycle tests against an unloaded extension.
- If the wizard hangs, send Escape first, then Ctrl+C only if Escape fails.
- If commands are missing, capture `/help` or command completion output before reporting.
- If cleanup fails, report exactly which artifact or session remained.
