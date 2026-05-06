# Pi Missions

Persistent mission orchestration for the Pi coding agent.

`pi-missions` turns short-lived Pi sessions into long-running execution tracks. It gives an agent a durable mission plan, feature queue, history log, evidence folder, and session handoff layer so multi-step work can survive restarts, context resets, forks, and interruptions.

The extension is inspired by Factory Droid Missions and Codex-style goal tracking, but is implemented as a native Pi package with local-first state and simple slash commands.

## What this repository provides

- Long-running missions for Pi coding sessions.
- Durable task state under `~/.pi/missions/<mission-id>/`.
- A feature queue with `pending`, `active`, `blocked`, and `done` style progression.
- Evidence capture for completed work.
- Mission history in append-friendly JSONL.
- Session attach/detach support so a mission can move across Pi sessions.
- Agent-callable tools for advancing or completing work programmatically.
- EXDEV-safe persistence using temp files next to the target before rename.

## Installation

### Local development

```bash
pi -e ./src/index.ts
```

### Install from a local checkout

```bash
pi install /home/joep/projects/pi-missions
```

### Install from GitHub

```bash
pi install git:github.com/GroepChef/pi-missions
```

The package exports `./src/index.ts` and declares itself as a Pi extension through the `pi.extensions` field in `package.json`.

## Commands

```text
/mission new <title>       Create a mission
/mission list              List and load missions
/mission load <id>         Load a mission into the current session
/mission status            Show current mission status
/mission dashboard         Show dashboard widget
/mission next              Advance to the next unblocked feature
/mission done [evidence]   Mark the active feature done
/mission block <reason>    Block the active feature
/mission pause             Pause the current mission
/mission resume            Resume the current mission
/mission edit <feature>    Edit feature JSON
/mission fork <reason>     Fork the active feature into a new session
/mission debug [id]        Show recent history and events
/mission clear             Detach the mission from this session
```

## Agent tools

The extension exposes two LLM-facing tools:

| Tool | Purpose |
|---|---|
| `mission_feature_done` | Mark the active feature complete with evidence. |
| `mission_next_feature` | Advance to the next pending or unblocked feature. |

Use the slash commands for manual control and the tools when an agent should update the mission state as part of its normal workflow.

## State model

Mission state is stored locally:

```text
~/.pi/missions/<mission-id>/
├── plan.json
├── plan.json.bak
├── history.jsonl
├── evidence/
└── sessions/
```

| File or directory | Role |
|---|---|
| `plan.json` | Current mission plan, feature list, status, and active pointer. |
| `plan.json.bak` | Backup copy for recovery. |
| `history.jsonl` | Append-style event log for auditing state transitions. |
| `evidence/` | Proof, notes, diffs, logs, and completion artifacts. |
| `sessions/` | Session attachment and handoff metadata. |

Writes are designed to be safe across filesystem boundaries: temporary files are written next to the target file and then renamed on the same filesystem.

## Typical workflow

```text
1. Create a mission with `/mission new <title>`.
2. Break the mission into features or load an existing plan.
3. Use `/mission status` to inspect the active feature.
4. Let the agent work on the current feature.
5. Store proof with `/mission done [evidence]`.
6. Move forward with `/mission next`.
7. Use `/mission block <reason>` when external input is needed.
8. Resume later with `/mission load <id>`.
```

## Development

```bash
npm install
npm run check
npm test
```

Available scripts:

| Script | Purpose |
|---|---|
| `npm run check` | Run TypeScript type checking with `tsc --noEmit`. |
| `npm test` | Run the Vitest test suite. |

## Repository layout

```text
pi-missions/
├── src/             # Pi extension source
├── README.md        # Project documentation
├── PLAN.md          # Production implementation plan
├── RESEARCH.md      # Background research and design notes
└── package.json     # Package metadata and Pi extension entrypoint
```

## Design principles

- Local-first state: missions should work without a hosted backend.
- Crash-tolerant writes: mission state should survive interrupted sessions.
- Agent-readable structure: plan and history should be easy for tools and LLMs to inspect.
- Minimal command surface: common operations should stay fast from the Pi TUI.
- Evidence-driven completion: features should be marked done with proof, not just intent.

## Status

This package is versioned as `0.1.0`. Treat the state format and command surface as early-stage until the production plan is finalized.

## License

MIT
