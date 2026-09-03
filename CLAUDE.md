# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

```bash
npm ci                  # Install dependencies
npm run check           # TypeScript type checking (tsc --noEmit)
npm test                # Run all tests (vitest run)
npm run test:coverage   # Tests with coverage report (uses vitest thresholds)
npm run build           # Build with tsup + copy schema.sql into dist/
npm run bench           # Run benchmarks (vitest bench)
npm run smoke:ci        # Build-artifact smoke test (requires build first)
./scripts/smoke-test.sh # Verify extension exports (requires build first)
node dist/cli/index.js doctor   # CLI diagnostics (Node >=22.5 uses node:sqlite)
```

Tests use Vitest globals; pick by file path with `npx vitest run tests/<file>.test.ts`, or filter by name with `npx vitest run -t "<test name>"`. Benchmarks: `npx vitest bench tests/<file>.bench.ts`.

## What this is

`@groeponline/pi-missions` is a **Pi coding agent extension** that turns short-lived Pi sessions into long-running, durable execution tracks. It provides:

- A mission plan, feature queue, history log, and evidence folder per mission
- Session handoff so work survives restarts/context resets/forks
- A SQLite-backed persistence layer (8 repositories, 13 tables, 3 views)
- A `pi-missions` CLI (`list`, `status`, `analytics`, `doctor`, …)

Mission state lives under `~/.pi/missions/<mission-id>/` with `plan.json` (+ `.bak`), `history.jsonl`, `evidence/`, and `sessions/`. Environment overrides: `PI_MISSIONS_DB_PATH`, `PI_MISSIONS_ROOT`, `PI_MISSIONS_PROJECT_DIR`, `PI_MISSIONS_EXTENSION_PATH`, `PI_WORKER_MODEL` (see `.env.example`).

## Architecture

```text
src/
├── core/           # Extension entrypoint, state, types
│   ├── extension.ts    # Default export piMissions(pi) — registers commands, tools, hooks
│   ├── state.ts        # Mission lifecycle, disk I/O, locking, history
│   └── types.ts        # TypeBox schemas, type definitions, constants
├── database/       # SQLite persistence layer
│   ├── index.ts        # 8 repository classes, dual driver (better-sqlite3 | node:sqlite)
│   └── schema.sql      # DDL for 13 tables + 3 views — canonical schema, do not edit dist copy
├── commands/       # /mission slash command handlers (~27 subcommands)
├── tools/          # 10 agent tools (mission_feature_done, mission_next_feature, …)
├── engines/        # Completion detection, error recovery, autopilot, workers, metrics,
│                   #   learning, pattern recognition — most are singletons
├── ui/             # Dashboard overlay, analytics, status/footer components
├── utils/          # Context builders, markdown, fs helpers, agent detection, logging
├── integrations/   # Execution-boundary adapters (currently Orchestra correlation)
├── templates/      # Built-in mission templates (e.g. /mission templates)
└── cli/            # `pi-missions` CLI entry point (list, status, analytics, doctor)
```

Tests mirror this layout under `tests/` (top-level files + per-layer subdirs), with `tests/e2e/` for full mission-lifecycle and recovery flows and `*.bench.ts` for benchmarks.

## Key Patterns

- **Default export contract**: `src/index.ts` re-exports the default function from `core/extension.ts`. Pi loads `dist/index.js` (see `package.json#pi.extensions`); the smoke tests assert this default export is a function.
- **Singleton engines**: `getCompletionDetector`, `getErrorRecoveryEngine`, `getLearningEngine`, `getPatternRecognitionEngine`, plus module-level `sessionMetrics` and `processAgentEndForAutopilot`. Workers are not a singleton — `src/engines/worker.ts` exposes per-call `spawnWorker`/`killWorker`/`getActiveWorker` rather than a pool.
- **Dual SQLite driver**: `database/index.ts` tries `better-sqlite3` first (optional dep) and falls back to `node:sqlite` (Node >=22.5.0). The SQL `schema_version` table tracks applied migrations. The separate `SCHEMA_VERSION` constant in `src/core/types.ts` is the TypeBox MissionState version, not the SQL migration version.
- **Phase-based tool policies**: Planning = read-only; Execution = full; Verification = read-only + bash. Enforced via `enforceToolPolicy` / `enforceToolMax` in `src/tools/`.
- **Atomic writes & locking**: temp-file + rename for `plan.json`/`history.jsonl`; `proper-lockfile` for concurrent access protection.
- **Session entry discovery**: `latestActiveEntry(entries)` walks session entries in reverse to find `pi-mission-active` markers — handles both native Pi format and the test mock format (`type: 'custom', customType: 'pi-mission-active'`).

## Conventions

- **ESM only**: `"type": "module"`. All internal imports use the `.js` extension even for `.ts` source (NodeNext resolution).
- **TypeScript strict**: `tsconfig.json` has `"strict": true`; `noEmit` (tsup emits). Target ES2022.
- **TypeBox** (`@sinclair/typebox`): runtime validation schemas live in `src/core/types.ts`.
- **Build externals**: `@earendil-works/pi-*`, `typebox`, `@sinclair/typebox`, `proper-lockfile`, `better-sqlite3` are tsup externals — never bundle Pi peer deps.
- **Tests**: Vitest globals; `describe`/`it`/`expect`. Mock the Pi `ExtensionAPI`/`ExtensionContext` for tool/command tests.
- **No `console.log`** in library code — CLI entry point is the exception. Use the shared logger in `src/utils/logger.ts`.
- **Coverage thresholds** (vitest): statements 85, branches 74, functions 86, lines 85. Coverage scope = `src/**/*.ts`, excluding `*.test.ts`.

## Common Pitfalls

- `src/utils/mission-builder.ts` is a **backward-compat shim** — prefer `src/utils/markdown.ts`.
- `src/engines/worker.ts` is the real worker runtime (real `child_process.spawn`, not simulated) — there is no separate `worker-pool.ts` shim.
- Database schema is **copied to `dist/database/schema.sql`** during build via `scripts/copy-build-assets.mjs`. Always edit `src/database/schema.sql`, never the dist copy.
- `src/integrations/` contains execution-boundary adapters such as `orchestra-execution.ts`; do not invent GitHub/Slack/webhook modules that are not present.
- When bumping the schema, DDL changes go in `src/database/schema.sql`; bump `CURRENT_SCHEMA_VERSION` in `src/database/index.ts` and update the migration logic there. The TypeBox `SCHEMA_VERSION` in `src/core/types.ts` is unrelated to SQL migrations.

## Status

Released package with wired entry point, state, commands, tools, dashboard, CLI, repositories, and tests. Treat `package.json` and `CHANGELOG.md` as the version and release-status sources of truth; `FIX_REPORT.md` records snapshot verification details.
