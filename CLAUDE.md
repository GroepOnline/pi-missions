# CLAUDE.md — Agent Instructions for pi-missions

## Quick Reference

```bash
npm ci                  # Install dependencies
npm run check           # TypeScript type checking (tsc --noEmit)
npm test                # Run all tests (vitest)
npm run build           # Build with tsup
npm run test:coverage   # Tests with coverage report
npm run bench           # Run benchmarks
./scripts/smoke-test.sh # Verify extension exports
```

## Architecture

```
src/
├── core/           # Extension entrypoint, state management, types
│   ├── extension.ts    # Pi extension registration (commands, tools, hooks)
│   ├── state.ts        # Mission lifecycle, disk I/O, locking, history
│   └── types.ts        # TypeBox schemas, type definitions, constants
├── database/       # SQLite persistence layer
│   ├── index.ts        # 8 repository classes, dual driver support
│   └── schema.sql      # DDL for 13 tables + 3 views
├── commands/       # /mission slash command handlers (27 subcommands)
├── tools/          # 10 agent tools (mission_feature_done, etc.)
├── engines/        # Completion detection, error recovery, autopilot, workers
├── ui/             # Dashboard overlay, analytics, status components
├── utils/          # Context builders, markdown, fs helpers
├── integrations/   # GitHub/Slack/webhook stubs (scaffolding only)
├── templates/      # Mission template manager
└── cli/            # CLI entry point (list, status, analytics, doctor)
```

## Key Patterns

- **Singleton engines**: CompletionDetector, ErrorRecoveryEngine, SessionMetricsCollector, WorkerPool, LearningEngine, PatternRecognitionEngine
- **Dual SQLite driver**: Tries `better-sqlite3` first, falls back to `node:sqlite` (Node >=22.5.0)
- **Schema migrations**: Version tracked in `schema_version` table, currently v3
- **Phase-based tool policies**: Planning=read-only, Execution=full, Verification=read-only+bash
- **Atomic writes**: Temp file + rename for crash safety
- **File locking**: `proper-lockfile` for concurrent access protection

## Conventions

- **ESM only**: `"type": "module"` — all imports use `.js` extension
- **TypeScript strict mode**: `tsconfig.json` has `"strict": true`
- **TypeBox**: Runtime validation schemas in `src/core/types.ts`
- **Tests**: Vitest with `describe`/`it`/`expect`, mocks for Pi ExtensionAPI
- **No console.log** in library code (CLI entry is the exception)

## Testing

- 834+ tests across 29 test files
- Coverage thresholds: statements 85%, branches 82%, functions 88%
- E2E tests in `tests/e2e/` (mission lifecycle, error recovery)
- Benchmarks in `tests/*.bench.ts`

## Common Pitfalls

- `src/utils/mission-builder.ts` is a backward-compat shim — prefer `src/utils/markdown.ts`
- `src/integrations/index.ts` is stub code — do not rely on it
- `src/engines/worker-pool.ts` uses simulated execution — real workers are in `src/engines/worker.ts`
- Database schema is copied to `dist/` during build — edit `src/database/schema.sql`, not the dist copy
