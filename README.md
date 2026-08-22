<div align="center">

<img src="https://raw.githubusercontent.com/GroepOnline/pi-missions/main/docs/images/missions_banner.png" alt="Pi Missions — durable execution tracks for Pi" width="100%">

# @groeponline/pi-missions

**Turn short-lived agent sessions into durable execution tracks.**

---

</div>

`pi-missions` keeps the work alive when a Pi session ends. A mission carries its plan, task queue, state, history, evidence, and handoff context forward, so multi-step implementation can survive restarts, compaction, forks, and interruptions without rebuilding the plan from memory.

[![npm](https://img.shields.io/npm/v/@groeponline/pi-missions.svg)](https://www.npmjs.com/package/@groeponline/pi-missions) [![downloads](https://img.shields.io/npm/dm/@groeponline/pi-missions.svg?label=downloads)](https://www.npmjs.com/package/@groeponline/pi-missions) [![CI](https://github.com/GroepOnline/pi-missions/actions/workflows/ci.yml/badge.svg)](https://github.com/GroepOnline/pi-missions/actions/workflows/ci.yml) [![Pi package](https://img.shields.io/badge/Pi-package-9b59b6.svg)](https://pi.dev/packages/@groeponline/pi-missions) ![License](https://img.shields.io/badge/license-MIT-green.svg)

## Status

The public package is on the `0.3.x` line and is actively maintained as a durable local mission/runtime layer for Pi. The extension entrypoint, state management, mission commands, tools, analytics dashboard, CLI, database repositories, and tests are wired. Integration classes for GitHub/Slack/webhooks are still lightweight scaffolding and should not be advertised as production integrations yet.

Verified in this snapshot:

- `npm run check` passes.
- `npm test` passes in the current CI matrix.
- `npm run build` produces `dist/index.js`, `dist/index.d.ts`, `dist/cli/index.js`, and copied database schema assets.
- `./scripts/smoke-test.sh` confirms the Pi extension exports the default `piMissions` function.
- `node dist/cli/index.js doctor` works on Node.js 22 using `node:sqlite`.

## Requirements

- Node.js `>=22.5.0` for the built-in `node:sqlite` database driver.
- Pi coding agent packages compatible with the peer dependencies in `package.json`.
- Optional: install `better-sqlite3` manually in the host project if you prefer that native SQLite driver. Pi Missions will use it when available and fall back to `node:sqlite` otherwise.

## Quick Start

```bash
# Install the extension
pi install npm:@groeponline/pi-missions

# Start a mission
/mission start "Implement user auth"

# Check progress
/mission status

# Mark features done
/mission done "Login form works, tests pass"
```

## Install and local development

```bash
npm ci
npm run check
npm test
npm run build
./scripts/smoke-test.sh

# Run locally in Pi after build
pi -e ./dist/index.js

# CLI diagnostics
node dist/cli/index.js doctor
```

## Pi slash commands

| Command | Description |
| --- | --- |
| `/mission new <title>` / `/mission start <title>` | Create a new mission. |
| `/mission list` | List saved missions. |
| `/mission load <id>` | Load a mission into the current session. |
| `/mission status` | Show current mission status and progress. |
| `/mission dashboard` | Render the mission dashboard. |
| `/mission metrics` | Show metrics overview. |
| `/mission next` | Advance to the next ready feature. |
| `/mission done [evidence]` | Mark the active feature done with evidence. |
| `/mission block <reason>` | Block the active feature. |
| `/mission pause` / `/mission resume` / `/mission stop` | Control mission execution. |
| `/mission fork <reason>` | Fork the active feature into a separate track. |
| `/mission templates` | List or use built-in templates. |
| `/mission history` | Show mission history. |
| `/mission worker`, `/mission worker-status`, `/mission kill-worker` | Worker controls. |
| `/mission migrate` | Inspect or migrate old mission state. |
| `/mission debug` | Inspect debug information. |

## Agent tools

The extension registers these mission tools for agent workflows:

- `mission_feature_done`
- `mission_next_feature`
- `mission_ask_user`
- `mission_block_self`
- `mission_fork`
- `mission_error_status`
- `mission_retry_error`
- `mission_spawn_worker`
- `mission_worker_status`
- `mission_kill_worker`

## Architecture

```text
src/
├── core/        # Extension runtime, state, migrations, mission transitions
├── commands/    # /mission command registration and handlers
├── tools/       # Agent-facing mission tools
├── engines/     # Autopilot, completion detection, recovery, metrics, workers
├── database/    # SQLite schema and repository layer
├── templates/   # Built-in mission templates
├── ui/          # Dashboard and terminal UI helpers
├── utils/       # Filesystem, context, markdown, logging, feedback helpers
└── cli/         # pi-missions CLI
```

## Database

Pi Missions stores structured data in SQLite. The schema includes missions, milestones, features, acceptance criteria, history, learnings, patterns, predictions, templates, sessions, metrics, plugins, and summary views. The source schema is copied into `dist/database/schema.sql` during build so the packaged CLI can initialize cleanly.

## Package notes

The original native `better-sqlite3` hard dependency was removed from the default install path because it can fail or hang in restricted environments when prebuilt binaries or Node headers are unavailable. Runtime database loading now tries `better-sqlite3` first if the host has installed it, then falls back to Node.js `node:sqlite`.

## State Model

![Pi Missions State Model](https://raw.githubusercontent.com/GroepOnline/pi-missions/main/docs/images/missions_state_model.png)

Mission state is stored locally under `~/.pi/missions/<mission-id>/`:
- `plan.json`: Current mission plan, feature list, and active pointer.
- `plan.json.bak`: Backup copy for recovery.
- `history.jsonl`: Append-style event log for transitions.
- `evidence/`: Completion proof and artifacts.
- `sessions/`: Session attachment and handoff metadata.

## Typical Workflow

![Pi Missions Typical Workflow](https://raw.githubusercontent.com/GroepOnline/pi-missions/main/docs/images/missions_workflow.png)

1. Create a mission with `/mission new <title>`.
2. Break the mission into features or load an existing plan.
3. Advance to the next unblocked feature with `/mission next`.
4. Let the agent work on the current feature.
5. Capture proof with `/mission done [evidence]`.

## License

MIT © GroepOnline
