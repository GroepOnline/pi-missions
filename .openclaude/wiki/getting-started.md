# Getting Started

## Prerequisites

- Node.js ≥ 22.5.0
- Pi coding agent ≥ 0.70.5

## Installation

```bash
npm install @groeponline/pi-missions
```

Or load as extension in Pi:

```bash
pi -e ./src/index.ts
```

## First Mission

### Via Pi commands

```
/mission new my-feature Implement dark mode
```

This opens the mission wizard. Follow the prompts to define:
- Mission title and goal
- Milestones (groups of features)
- Features with acceptance criteria

### Via templates

```
/mission new --template refactor
/mission new --template feature
/mission new --template bugfix
```

### Via CLI

```bash
npx pi-missions list
npx pi-missions status <mission-id>
npx pi-missions analytics
```

## Configuration

Environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `PI_MISSIONS_DB_PATH` | `~/.pi/missions/missions.db` | SQLite database path |
| `PI_MISSIONS_LOG_LEVEL` | `info` | Log level (debug/info/warn/error) |
| `PI_MISSIONS_WORKER_MODEL` | — | Default model for worker spawning |

## Typical Workflow

1. `/mission new` — Create mission with wizard
2. `/mission dashboard` — View mission overview
3. `/mission next` — Get next actionable feature
4. Agent works on feature, calls `mission_feature_done` when complete
5. `/mission status` — Check progress
6. Repeat until mission complete

## Autopilot Mode

Enable autonomous execution:

```
/mission autopilot on
```

The agent will:
- Auto-advance to next feature on completion
- Detect stuck patterns and self-block
- Respect token budgets
- Stop on user decisions needed
