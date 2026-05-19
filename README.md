# 🚀 Pi Missions

**Persistent mission orchestration for the Pi coding agent**

<div align=\"center\">

![Pi Missions Hero Banner](https://raw.githubusercontent.com/OnlineChef/pi-missions/main/assets/hero-banner.png)

> **Turn short-lived Pi sessions into durable, long-running execution tracks.**

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://github.com/OnlineChef/pi-missions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Pi Extension](https://img.shields.io/badge/Pi-Extension-9b59b6.svg)](https://github.com/OnlineChef/pi-missions)

</div>

## ✨ What is Pi Missions?

`pi-missions` gives your Pi coding agent a **durable mission plan** that survives restarts, context resets, forks, and interruptions.

Inspired by Factory Droid Missions and Codex-style goal tracking, but built as a **native Pi package** with local-first state and simple slash commands.

## 🚀 Key Features

- **Long-running missions** across multiple Pi sessions
- **Durable local state** in `~/.pi/missions/<mission-id>/`
- **Smart feature queue** (`pending` → `active` → `blocked` → `done`)
- **Phase-aware tool policy** — read-only bash in planning, full access in execution
- **Autonomous execution** — optional autopilot mode auto-advances through features
- **Evidence capture** for completed work
- **Append-only history** (JSONL) for full audit trail
- **Session handoff** – attach/detach across sessions
- **Agent-callable tools** for autonomous progress
- **Completion detection** — auto-detects feature completion from agent output
- **Error recovery** — retry/ask_user/block on tool failures
- **Crash-safe writes** (EXDEV-safe temp + rename)
- **File locking** – prevents concurrent modification conflicts
- **Schema validation** – ensures data integrity with JSON schema
- **Structured logging** – detailed debug logs for troubleshooting
- **Session metrics** – track tokens, time, and progress per session
- **Graceful degradation** – continues working with degraded functionality when errors occur
- **Mission templates** – pre-defined mission structures for common workflows

## 🛠️ Quick Start

### Install from GitHub

```bash
pi install git:github.com/OnlineChef/pi-missions
```

### Install from npm

```bash
pi install npm:@devctx/pi-missions@0.1.0
```

### Local development

```bash
git clone https://github.com/OnlineChef/pi-missions.git
cd pi-missions
npm install
npm run build
pi -e ./dist/index.js
```

### Run smoke test

```bash
npm run build
./scripts/smoke-test.sh
```

## 📁 Architecture

Pi Missions uses a **modular architecture** to separate concerns:

```
src/
├── core/              # Extension runtime, state management
│   ├── extension.ts   # Main entrypoint — registers all Pi hooks
│   ├── state.ts       # MissionState CRUD, phase detection, transitions
│   └── types.ts       # RuntimeState, event types
├── engines/           # Autonomous behavior engines
│   ├── autopilot.ts   # Autonomous feature advancement
│   ├── completion.ts  # Completion detection from agent output
│   ├── metrics.ts     # Session metrics collection
│   └── recovery.ts    # Error recovery with retry/ask_user/block
├── tools/             # LLM-callable mission tools
│   └── index.ts       # Tool registration, policy enforcement
├── ui/                # Terminal UI components
│   ├── components.ts  # Footer, status bar, notifications
│   └── dashboard.ts   # Mission Control dashboard widget
├── utils/             # Pure utilities
│   ├── context.ts     # Context injection (LLM prompt enrichment)
│   ├── fs.ts          # Safe file I/O, locking, path validation
│   └── markdown.ts    # Markdown export, missionFromWizardOutput
├── commands/          # Slash command handlers
│   ├── index.ts       # Command registration, subcommand router
│   └── handlers.ts    # Individual handler implementations
└── index.ts           # Entrypoint (re-exports core/extension.js)
```

For a detailed architecture breakdown, see [DOCUMENTATION_PLAN.md](./DOCUMENTATION_PLAN.md).

## 📋 Available Commands

| Command | Description |
|---|---|
| `/mission start <goal>` | Create a new mission (alias for `/mission new`) |
| `/mission new <title>` | Create a new mission with planning wizard |
| `/mission list` | List all missions |
| `/mission load <id>` | Load a mission into the current session |
| `/mission status` | Show current status & active feature |
| `/mission dashboard` | Open Mission Control dashboard widget |
| `/mission next` | Advance to the next unblocked feature |
| `/mission done [evidence]` | Mark active feature done + attach evidence |
| `/mission block <reason>` | Block the current feature |
| `/mission pause` / `resume` | Pause or resume the mission |
| `/mission fork <reason>` | Fork active feature into a new session |
| `/mission debug [id]` | Inspect recent history and events |
| `/mission metrics` | Show mission/session metrics |
| `/mission export [filename]` | Export mission to Markdown report |
| `/mission templates` | List and use mission templates |
| `/mission clear` | Detach mission from this session |

## 🤖 Agent Tools

| Tool | Purpose |
|---|---|
| `mission_feature_done` | Mark the active feature complete with evidence |
| `mission_next_feature` | Automatically advance to the next pending feature |
| `mission_ask_user` | Ask for clarification when a safe assumption isn't enough |
| `mission_block_self` | Self-block when stuck instead of looping |
| `mission_fork` | Split a risky or parallel approach into a linked fork |
| `mission_error_status` | Inspect error recovery state |
| `mission_retry_error` | Retry a recorded error |
| `mission_spawn_worker` | Spawn a child pi process to work on a feature autonomously |
| `mission_worker_status` | Check running worker process status |
| `mission_kill_worker` | Kill a runaway worker process |

## 🔄 Phase-Based Tool Policy

Tools are restricted based on the current mission phase:

| Phase | Trigger | Allowed Tools | Max Calls |
|---|---|---|---|
| `planning` | Feature title contains: clarify, plan, scope, research, analyze, inspect, discover | `read`, `grep`, `find`, `rg`, `cat`, `sed -n`, `head`, `tail`, `wc`, `git status/diff/show/log` | 60 |
| `execution` | Implementation features | All tools including `bash`, `edit`, `write` | 120 |
| `verification` | Feature title contains: verify, test, summarize | `read`, `bash` | 60 |

**Planning bash security:** Only single read-only commands are allowed (`pwd`, `ls`, `find`, `grep`, `rg`, `cat`, `sed -n`, `head`, `tail`, `wc`, `git status/diff/show/log`). Commands containing `;`, `&`, `|`, `` `$ ``, `<`, `>`, newline (`\n`), carriage return (`\r`), or tab (`\t`) are blocked to prevent command injection.

## 📁 State Model

All state is stored locally in `~/.pi/missions/<mission-id>/`:

```
~/.pi/missions/<mission-id>/
├── plan.json          # Current plan, features, status & active pointer
├── plan.json.bak      # Safe backup copy
├── plan.json.lock     # File lock for concurrent access protection
├── history.jsonl      # Append-only event log (full audit trail)
├── evidence/          # Proof: test output, diffs, logs, artifacts
│   └── <feature-id>.md
├── sessions/          # Session attachment metadata
│   └── <session-file>.ref
└── logs/              # Structured debug logs
```

## 🔄 Typical Workflow

1. **Create mission:** `/mission new \"Build user authentication system\"`
2. **Plan:** AI generates milestones + features from your goal (planning phase = read-only)
3. **Implement:** Agent works on active feature (execution phase = full tool access)
4. **Detect completion:** `agent_end` hook analyzes output and auto-completes when done
5. **Auto-advance:** Optional autopilot mode moves to next feature automatically
6. **Verify:** Test/summarize features run verification checks (verification phase)
7. **Repeat** until mission complete!

## 🧪 Development

```bash
npm install
npm run build     # Build TypeScript to dist/
npm run check     # TypeScript type check
npm test          # Unit tests (522 tests)
./scripts/smoke-test.sh  # Verify extension loads
bash scripts/pi_missions_e2e_runner.sh --mode full  # E2E tests in tmux
```

## Design Principles

- **Local-first** — works without any backend
- **Crash-tolerant** — survives interrupted sessions (EXDEV-safe temp + rename)
- **Evidence-driven** — \"done\" only with real proof
- **Phase-aware** — tool restrictions enforced per mission phase
- **Minimal & fast** — optimized for the Pi TUI
- **Concurrent-safe** — file locking prevents conflicts
- **Validated** — schema validation ensures data integrity
- **Observable** — structured logging and metrics for debugging
- **Resilient** — graceful degradation when errors occur
- **Autonomous** — optional autopilot mode for hands-free advancement

## 📄 Repository Layout

```
pi-missions/
├── src/                   # Source code (modular structure)
│   ├── core/              # Extension runtime
│   ├── engines/           # Autonomous engines
│   ├── tools/             # LLM tools
│   ├── ui/                # UI components
│   ├── utils/             # Utilities
│   └── commands/          # Command handlers
├── tests/                 # Unit tests (19 files, 522 tests)
│   └── e2e/               # End-to-end tests
├── scripts/
│   └── pi_missions_e2e_runner.sh  # tmux E2E runner
├── assets/                # Hero banner, diagrams
├── DOCUMENTATION_PLAN.md  # Architecture docs
├── IMPROVEMENTS.md        # Improvement tracking
├── UI_REFERENCE.md        # UI component reference
└── package.json
```

## 📃 License

MIT © OnlineChef

---

<div align=\"center\">

**Made with ❤️ for the Pi coding community**

[Report an issue](https://github.com/OnlineChef/pi-missions/issues) • [Contribute](https://github.com/OnlineChef/pi-missions/pulls)

</div>