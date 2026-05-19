# 🚀 Pi Missions

**Intelligent mission orchestration for the Pi coding agent**

<div align="center">

> **Turn short-lived Pi sessions into durable, long-running execution tracks with AI-powered planning, learning, and parallel execution.**

[![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)](https://github.com/OnlineChef/pi-missions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-834%20passing-brightgreen.svg)](https://github.com/OnlineChef/pi-missions)
[![Pi Extension](https://img.shields.io/badge/Pi-Extension-9b59b6.svg)](https://github.com/OnlineChef/pi-missions)

</div>

## ✨ What is Pi Missions?

<p align="center">
  <img src="./assets/readme/pi-missions-feature-map.svg" alt="Pi Missions feature system showing planning, learning, workers, analytics and integrations" width="100%" />
</p>


`pi-missions` is a **professional-grade mission orchestration platform** for the Pi coding agent. It provides:

- 🧠 **AI-Powered Planning** — Intelligent mission decomposition with risk analysis
- 📚 **Learning System** — Learns from past missions to improve future planning
- ⚡ **Parallel Execution** — Multiple workers with dependency scheduling
- 📊 **Rich Analytics** — Dashboard with charts, trends, and insights
- 🔗 **Integrations** — GitHub, Slack, and webhook support
- 🛠️ **CLI Tool** — Standalone command-line interface
- 📦 **Template Marketplace** — Community templates for common workflows

## 🚀 Quick Start

<p align="center">
  <img src="./assets/readme/pi-missions-quickstart-flow.svg" alt="Quick start flow from install to smoke test" width="100%" />
</p>


### Install

```bash
# From GitHub
pi install git:github.com/OnlineChef/pi-missions

# From npm
pi install npm:@devctx/pi-missions@0.2.0
```

### Local Development

```bash
git clone https://github.com/OnlineChef/pi-missions.git
cd pi-missions
npm install
npm run build
pi -e ./dist/index.js
```

### Run Tests

```bash
npm test                    # Run all 834 tests
npm run build               # Build to dist/
./scripts/smoke-test.sh     # Verify extension loads
```

## 📋 Commands

<p align="center">
  <img src="./assets/readme/pi-missions-command-reference.svg" alt="Grouped Pi Missions slash command reference" width="100%" />
</p>


| Command | Description |
|---------|-------------|
| `/mission new <title>` | Create a new mission with AI planning |
| `/mission list` | List all missions |
| `/mission load <id>` | Load a mission into current session |
| `/mission status` | Show current status & progress |
| `/mission dashboard` | Open rich analytics dashboard |
| `/mission next` | Advance to next feature |
| `/mission done [evidence]` | Mark feature done with evidence |
| `/mission block <reason>` | Block current feature |
| `/mission pause` / `resume` | Pause or resume mission |
| `/mission fork <reason>` | Fork feature into new session |
| `/mission templates` | List mission templates |
| `/mission analytics` | Show analytics overview |
| `/mission history` | View mission history |
| `/mission debug` | Inspect debug info |

## 🤖 Agent Tools

<p align="center">
  <img src="./assets/readme/pi-missions-mission-lifecycle.svg" alt="Mission lifecycle from new mission to analytics with recovery paths" width="100%" />
</p>


| Tool | Purpose |
|------|---------|
| `mission_feature_done` | Mark feature complete with evidence |
| `mission_next_feature` | Advance to next pending feature |
| `mission_ask_user` | Ask for clarification |
| `mission_block_self` | Self-block when stuck |
| `mission_fork` | Fork into alternative approach |
| `mission_spawn_worker` | Spawn worker for parallel execution |
| `mission_worker_status` | Check worker status |
| `mission_kill_worker` | Kill runaway worker |

## 🏗️ Architecture

<p align="center">
  <img src="./assets/readme/pi-missions-architecture-overview.svg" alt="Architecture overview of interface orchestration persistence and integration layers" width="100%" />
</p>


```
src/
├── core/              # Extension runtime, state management
├── engines/           # AI engines (learning, patterns, workers)
├── database/          # SQLite database with 12 tables
├── integrations/      # GitHub, Slack, webhooks
├── cli/               # Standalone CLI tool
├── templates/         # Template marketplace
├── tools/             # LLM tools
├── ui/                # Dashboard & components
├── utils/             # Utilities
└── commands/          # Slash commands
```

## 📊 Features

### 🧠 Intelligence
- **Pattern Recognition** — Detects success/failure patterns
- **Learning System** — Learns from completed missions
- **Predictions** — Estimates success probability and duration
- **Smart Recommendations** — AI-powered suggestions

### ⚡ Parallel Execution
- **Worker Pool** — Multiple concurrent workers
- **Dependency Scheduling** — Automatic dependency resolution
- **Resource Monitoring** — CPU, memory, token tracking
- **Load Balancing** — Optimal work distribution

### 📈 Analytics
- **Rich Dashboard** — Charts, progress bars, trends
- **Mission Metrics** — Tokens, time, success rates
- **Feature Analytics** — Duration, tool calls, errors
- **Team Performance** — Cross-mission insights

### 🔗 Integrations
- **GitHub** — Create issues, comments, PRs
- **Slack** — Notifications, daily summaries
- **Webhooks** — Custom event notifications
- **CI/CD** — Trigger workflows

### 🛠️ Developer Experience
- **CLI Tool** — `pi-missions list`, `status`, `analytics`
- **Templates** — Community marketplace
- **SDK** — Programmatic access
- **Plugin System** — Custom extensions

## 📁 Database Schema

SQLite database with 12 tables:

| Table | Purpose |
|-------|---------|
| `missions` | Mission state and metadata |
| `milestones` | Milestone organization |
| `features` | Feature tracking |
| `history` | Append-only event log |
| `learnings` | AI insights and patterns |
| `patterns` | Detected patterns |
| `predictions` | Success predictions |
| `templates` | Mission templates |
| `sessions` | Session tracking |
| `metrics` | Performance metrics |
| `plugins` | Plugin registry |

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific test suite
npm test -- tests/database.test.ts
npm test -- tests/learning.test.ts

# Run with coverage
npm run test:coverage

# Run benchmarks
npm run bench
```

**Test Coverage:**
- 834 tests passing
- 29 test suites
- Unit tests, integration tests, E2E tests

## 📦 Building

```bash
# Build for production
npm run build

# Type check
npm run check

# Smoke test
./scripts/smoke-test.sh

# Create package
npm pack
```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PI_MISSIONS_DB_PATH` | Database file path | `~/.pi/missions/database` |
| `PI_MISSIONS_EXTENSION_PATH` | Extension entry point | Auto-detected |
| `PI_WORKER_MODEL` | Model for workers | `auto` |
| `PI_PATH` | Path to pi binary | `pi` |

## 📈 Performance

<p align="center">
  <img src="./assets/readme/pi-missions-performance-snapshot.svg" alt="Performance and reliability metrics including tests build time workers memory and database tables" width="100%" />
</p>


| Metric | Value |
|--------|-------|
| Tests | 834 passing |
| Build time | ~20s |
| Database | SQLite (WAL mode) |
| Workers | Up to 10 parallel |
| Memory | ~50MB base |

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Run `npm test`
6. Submit a pull request

## 📄 License

MIT © OnlineChef

---

<div align="center">

**Made with ❤️ for the Pi coding community**

[Report an issue](https://github.com/OnlineChef/pi-missions/issues) • [Contribute](https://github.com/OnlineChef/pi-missions/pulls)

</div>
