# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.12] - 2026-09-05

### Fixed
- generate session ids with crypto.randomUUID (#19)
## [0.3.11] - 2026-09-05

### Fixed
- persist history onto fresh mission state (#18)

### Documentation
- disambiguate schema_version from SCHEMA_VERSION (#12)
## [0.3.10] - 2026-08-30

### Maintenance
- prove durable mission fallback path (#17)
## [0.3.9] - 2026-08-30

### Documentation
- rebuild package story and release notes (#15)
## [0.3.8] - 2026-08-30

## [0.3.7] - 2026-08-30

### Fixed
- Removed the unrunnable `chef-linear-notion-sync` workflow caller (`GRO-1360`, #14) instead of shipping a repository workflow that could not execute with its local capabilities.

## [0.3.6] - 2026-08-28

### Maintenance
- Added the standard ignore block for OS metadata, Xcode output, editor-local state, and local environment files.

## [0.3.5] - 2026-08-23

### Added
- Added a Pi package contract verifier covering package identity, catalog discovery metadata, shipped files, registry targeting, and Pi peer dependency rules.

### Fixed
- Hardened package resource-path validation, including containment checks and protection against in-root symlink cycles.

## [0.3.4] - 2026-08-22

### Changed
- Refreshed the public package status and Pi catalog metadata.
- Aligned lockfile package-version metadata with the published package version.

## [0.3.3] - 2026-08-22

### Maintenance
- Release metadata only; no runtime or source-code changes were introduced between `v0.3.2` and `v0.3.3`.

## [0.3.2] - 2026-08-22

### Maintenance
- Release metadata only; no runtime or source-code changes were introduced between `v0.3.1` and `v0.3.2`.

## [0.3.1] - 2026-08-22

### CI
- Updated GitHub Actions that still depended on the deprecated Node 20 action runtime to their current major versions.

## [0.3.0] - 2026-08-22

### Added
- Added the Orchestra execution-correlation contract (`CHE-142`) so spawned workers can carry and report orchestration execution context.
- Added worker and integration tests for Orchestra correlation behavior and documented the execution boundary.

## [0.2.1] - 2026-08-22

### Security
- Cleared all high-severity npm audit findings present in the previous release line.

### Changed
- Widened the Pi peer ranges to include the current `0.85.x` line (`<0.86.0`).
- Added a weekly peer-range drift workflow that opens an issue when the latest Pi release falls outside the declared compatibility range.

## [0.2.0] - 2026-08-22

### Added
- Release flow: `scripts/release.mjs` (auto bump from conventional commit subjects, CHANGELOG roll, annotated tag), idempotent `scripts/npm-publish.sh`, idempotent `scripts/github-release.sh`, and `.github/workflows/release.yml` that cuts the tag and publishes on merge to main.
- `npm run verify:package` catalog contract: package identity, discovery keywords, shipped files, npmjs registry, and the pi peer range.

### Changed
- Publishes to npmjs.org as a public package instead of GitHub Packages, so `pi install npm:@groeponline/pi-missions` works and the pi.dev catalog card resolves.
- Pi peer ranges widened to `>=0.74.0 <0.85.0`; `^0.74.0` pinned a single 0.x minor and failed installs on pi 0.84.
- `pi.image` points at the repository banner for the catalog card.

## [0.1.3] - 2026-05-29

### Changed
- Migrated package scope from `@devctx/pi-missions` to `@groeponline/pi-missions`.
- Added `publishConfig` for GitHub Packages.
- Updated test count badges: 834 → 892.
- Added license badge to README.
- Updated wiki references.

## [0.1.2] - 2026-05-29

### Changed
- Migrated peer dependencies from `@mariozechner/pi-*` to `@earendil-works/pi-*` scope.
- Optimized hot-path array allocations and iterations in state management.
- Hardened database initialization with dual driver detection (better-sqlite3 / node:sqlite).
- Added CI smoke test script for build artifact verification.
- Improved schema path resolution for ESM and packaged builds.

### Fixed
- SQL injection prevention via column name whitelist validation in update methods.
- Coverage thresholds adjusted to match current test coverage levels.

## [0.1.1] - 2026-05-22

### Fixed
- Fixed strict TypeScript errors around feature token accounting and test fixtures.
- Hardened SQLite initialization for ESM and packaged builds.
- Removed the default native SQLite install path; database loading now uses an optional `better-sqlite3` driver when present or Node.js `node:sqlite` otherwise.
- Added a real CLI build entry and package `bin` mapping.
- Copied database schema assets into `dist/` during build.
- Updated README and CI to match the implemented feature set.

## [0.1.0] - 2026-05-19

### Added

#### Core Features
- **Long-running missions** across multiple Pi sessions
- **Durable local state** in `~/.pi/missions/<mission-id>/`
- **Smart feature queue** (`pending` → `active` → `blocked` → `done`)
- **Phase-aware tool policy** — read-only bash in planning, full access in execution
- **Evidence capture** for completed work
- **Append-only history** (JSONL) for full audit trail
- **Session handoff** – attach/detach across sessions

#### Commands (19 total)
- `/mission start <goal>` — Create a new mission (alias for `/mission new`)
- `/mission new <title>` — Create a new mission with planning wizard
- `/mission list` — List all missions
- `/mission load <id>` — Load a mission into the current session
- `/mission status` — Show current status & active feature
- `/mission dashboard` — Open Mission Control dashboard widget
- `/mission next` — Advance to the next unblocked feature
- `/mission done [evidence]` — Mark active feature done + attach evidence
- `/mission block <reason>` — Block the current feature
- `/mission pause` / `resume` — Pause or resume the mission
- `/mission fork <reason>` — Fork active feature into a new session
- `/mission debug [id]` — Inspect recent history and events
- `/mission metrics` — Show mission/session metrics
- `/mission export [filename]` — Export mission to Markdown report
- `/mission templates` — List and use mission templates
- `/mission clear` — Detach mission from this session
- `/mission edit <feature-id>` — Edit a feature
- `/mission history [feature_id|event|search]` — View mission history
- `/mission migrate [id]` — Migrate mission schema

#### Agent Tools (10 total)
- `mission_feature_done` — Mark the active feature complete with evidence
- `mission_next_feature` — Automatically advance to the next pending feature
- `mission_ask_user` — Ask for clarification when a safe assumption isn't enough
- `mission_block_self` — Self-block when stuck instead of looping
- `mission_fork` — Split a risky or parallel approach into a linked fork
- `mission_error_status` — Inspect error recovery state
- `mission_retry_error` — Retry a recorded error
- `mission_spawn_worker` — Spawn a child pi process to work on a feature autonomously
- `mission_worker_status` — Check running worker process status
- `mission_kill_worker` — Kill a runaway worker process

#### Engines
- **Autopilot** — Autonomous feature advancement
- **Completion Detection** — Auto-detects feature completion from agent output
- **Error Recovery** — Retry/ask_user/block on tool failures
- **Metrics** — Session metrics collection
- **Worker** — Child process worker spawning

#### UI
- **Factory Droid Dashboard** — Milestone progress bars, feature hierarchy, acceptance criteria inline
- **Phase line** — Shows current tool phase in dashboard
- **Footer status** — `🎯 title [done/total %] — active feature`

#### Safety & Reliability
- **Crash-safe writes** (EXDEV-safe temp + rename)
- **File locking** — Prevents concurrent modification conflicts
- **Schema validation** — Ensures data integrity with TypeBox schemas
- **Structured logging** — Detailed debug logs for troubleshooting
- **Graceful degradation** — Continues working with degraded functionality when errors occur
- **Stuck detection** — Auto-blocks features when agent is stuck

#### Templates (9 total)
- `refactor`, `fix-bug`, `add-feature`, `docs`, `investigate`, `auth`, `ci-cd`, `security-audit`, `performance-opt`

#### Documentation
- Comprehensive README with architecture overview
- Detailed implementation plan (PLAN.md)
- Documentation plan (DOCUMENTATION_PLAN.md)
- Improvement tracking (IMPROVEMENTS.md)
- UI reference (UI_REFERENCE.md)

#### Testing
- 522 unit tests across 19 test files
- End-to-end test runner script
- TypeScript type checking
- Vitest for testing and benchmarking

### Changed
- N/A (initial release)

### Deprecated
- N/A (initial release)

### Removed
- N/A (initial release)

### Fixed
- N/A (initial release)

### Security
- Path traversal protection via `sanitizeMissionId()`
- Tool whitelist per phase (planning=read-only, execution=write)
- Budget exhaustion protection via `maxToolCallsPerFeature` and `tokensBudget`
