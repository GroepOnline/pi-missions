# 🚀 Pi Missions

**Persistent mission orchestration for the Pi coding agent**

<div align="center">

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
- **Evidence capture** for completed work  
- **Append-only history** (JSONL) for full audit trail  
- **Session handoff** – attach/detach across sessions  
- **Agent-callable tools** for autonomous progress  
- **Crash-safe writes** (EXDEV-safe temp + rename)

## 🛠️ Quick Start

### Install from GitHub

```bash
pi install git:github.com/OnlineChef/pi-missions
```

### Local development

```bash
git clone https://github.com/OnlineChef/pi-missions.git
cd pi-missions
pi -e ./src/index.ts
```

## 📋 Available Commands

| Command                        | Description                                      |
|--------------------------------|--------------------------------------------------|
| `/mission new <title>`         | Create a new mission                             |
| `/mission list`                | List missions and load one                       |
| `/mission load <id>`           | Load a mission into the current session          |
| `/mission status`              | Show current status & active feature             |
| `/mission dashboard`           | Open the beautiful dashboard widget              |
| `/mission next`                | Advance to the next unblocked feature            |
| `/mission done [evidence]`     | Mark active feature done + attach evidence       |
| `/mission block <reason>`      | Block the current feature                        |
| `/mission pause` / `resume`    | Pause or resume the mission                      |
| `/mission fork <reason>`       | Fork active feature into a new session           |
| `/mission debug [id]`          | Inspect recent history and events                |
| `/mission clear`               | Detach mission from this session                 |

## 🤖 Agent Tools

| Tool                     | Purpose                                              |
|--------------------------|------------------------------------------------------|
| `mission_feature_done`   | Mark the active feature complete with evidence       |
| `mission_next_feature`   | Automatically advance to the next pending feature    |

Use slash commands for manual control. Let the agent call the tools as part of its normal workflow.

## 📁 State Model

All state is stored locally:

```
~/.pi/missions/<mission-id>/
├── plan.json          # Current plan, features, status & active pointer
├── plan.json.bak      # Safe backup copy
├── history.jsonl      # Append-only event log
├── evidence/          # Proof, diffs, logs, artifacts
└── sessions/          # Session attachment & handoff metadata
```

![State Model Diagram](https://raw.githubusercontent.com/OnlineChef/pi-missions/main/assets/state-diagram.png)

## 🔄 Typical Workflow

1. Create mission: `/mission new "Build user authentication system"`
2. Break it into features
3. Let the agent work on the active feature
4. Capture proof: `/mission done "Implemented JWT + tests + coverage"`
5. Move forward: `/mission next`
6. Repeat until mission complete!

![Dashboard Mockup](https://raw.githubusercontent.com/OnlineChef/pi-missions/main/assets/dashboard.png)

## 🧪 Development

```bash
npm install
npm run check
npm test
```

## Design Principles

- **Local-first** — works without any backend  
- **Crash-tolerant** — survives interrupted sessions  
- **Evidence-driven** — "done" only with real proof  
- **Minimal & fast** — optimized for the Pi TUI

## 📄 Repository Layout

```
pi-missions/
├── src/             # Pi extension source (TypeScript)
├── README.md        # This file
├── PLAN.md          # Production implementation plan
├── RESEARCH.md      # Background research & design notes
└── package.json     # Package metadata & Pi extension entrypoint
```

## 📃 License

MIT © OnlineChef

---

<div align="center">

**Made with ❤️ for the Pi coding community**

[Report an issue](https://github.com/OnlineChef/pi-missions/issues) • [Contribute](https://github.com/OnlineChef/pi-missions/pulls)

</div>