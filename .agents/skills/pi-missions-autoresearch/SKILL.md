---
name: pi-missions-autoresearch
description: run benchmark-driven optimization loops on pi-missions using the autoresearch-skill framework. use when asked to optimize, benchmark, profile, or improve performance of pi-missions code, database queries, or test execution. combines pi-missions mission orchestration with autoresearch's iterative optimization loop.
---

# Pi-Missions Autoresearch

## Purpose

Run benchmark-driven optimization loops on the pi-missions codebase using the autoresearch-skill framework. This skill combines pi-missions' mission orchestration with autoresearch's iterative optimization approach to systematically improve performance, reduce memory usage, and optimize database queries.

## When to Use

- User asks to optimize pi-missions performance
- User asks to benchmark pi-missions code
- User asks to profile database queries
- User asks to reduce memory usage or CPU time
- User asks to run optimization loops on pi-missions

## Prerequisites

1. Both `pi-missions` and `autoresearch-skill` must be installed
2. Node.js >= 22.5.0 with `--experimental-sqlite` support
3. Vitest benchmarks must be available (`npm run bench`)

## Workflow

### 1. Setup Optimization Mission

Create a pi-mission for the optimization task:

```bash
cd /home/jan/OrgChefgroep/pi-missions
/mission new "Optimize pi-missions performance" --template refactor
```

### 2. Identify Optimization Targets

Run benchmarks to identify bottlenecks:

```bash
npm run bench
```

Key benchmark files:
- `tests/state.bench.ts` — Mission state operations
- `tests/commands.bench.ts` — Command handler performance
- `tests/context.bench.ts` — Context building performance
- `tests/dashboard.bench.ts` — Dashboard rendering performance

### 3. Run Autoresearch Loop

Use the autoresearch-skill to iteratively optimize:

```bash
# In a Pi session with autoresearch-skill loaded:
/optimize <target-function-or-module>
```

The autoresearch loop will:
1. Measure baseline performance
2. Identify optimization opportunities
3. Apply changes
4. Re-measure to verify improvement
5. Repeat until target is met

### 4. Database Optimization

For SQLite query optimization:

```bash
# Enable query logging
export PI_MISSIONS_DB_PATH=/tmp/pi-missions-test.db

# Run with query analysis
node --experimental-sqlite -e "
  const db = require('better-sqlite3')('/tmp/pi-missions-test.db');
  db.pragma('optimize');
  console.log(db.pragma('compile_options'));
"
```

Key areas to optimize:
- Repository query patterns in `src/database/index.ts`
- Index usage for `features` and `history` tables
- Batch operations for bulk inserts

### 5. Memory Optimization

Profile memory usage:

```bash
node --experimental-sqlite --inspect src/cli/index.js analytics
```

Focus areas:
- Mission state object creation in `src/core/state.ts`
- Context building in `src/utils/context.ts`
- Dashboard rendering in `src/ui/dashboard.ts`

### 6. Verify Improvements

After optimization:

```bash
npm run bench              # Verify benchmark improvements
npm test                   # Ensure all tests still pass
npm run test:coverage      # Maintain coverage thresholds
```

## Optimization Targets

### High-Impact Areas

1. **State Management** (`src/core/state.ts`)
   - `loadMissionFromDisk()` — JSON parsing overhead
   - `saveMissionSafe()` — Atomic write performance
   - `getAllFeatures()` — Array allocation in hot paths

2. **Database Layer** (`src/database/index.ts`)
   - Repository query patterns
   - Connection pooling (if applicable)
   - Batch operations

3. **Context Building** (`src/utils/context.ts`)
   - `buildLeanContext()` — String concatenation
   - `buildMissionContext()` — Template rendering

4. **Dashboard** (`src/ui/dashboard.ts`)
   - Component rendering
   - State updates

### Benchmark Baselines

Current benchmark baselines (from `npm run bench`):

| Operation | Target |
|-----------|--------|
| createMission | < 1ms |
| loadMissionFromDisk | < 5ms |
| saveMissionSafe | < 10ms |
| buildLeanContext | < 2ms |
| Dashboard render | < 16ms |

## Integration with Autoresearch-Skill

The autoresearch-skill provides:

1. **Iterative optimization loop** — automatically applies and reverts changes
2. **Benchmark-driven validation** — ensures optimizations actually improve performance
3. **Rollback on regression** — reverts changes that cause test failures or performance drops

To use with pi-missions:

```bash
# Load both extensions in Pi
pi -e ./pi-missions/dist/index.js -e ./autoresearch-skill/dist/index.js

# Then in the Pi session:
/optimize src/core/state.ts --benchmark tests/state.bench.ts
```

## Reporting

After optimization, generate a performance report:

```bash
npm run bench -- --reporter=json > benchmark-results.json
```

Include in the mission:
- Before/after benchmark comparison
- Memory usage comparison
- Test results (must all pass)
- Coverage report (must meet thresholds)

## Cleanup

After optimization loop:

```bash
/mission done
```

The mission will auto-complete when all acceptance criteria are met.
