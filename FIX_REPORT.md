# Fix Report

This snapshot hardens the uploaded `pi-missions` project into a cleaner `0.1.1` release candidate.

## Fixed

- TypeScript strict-mode errors are fixed.
- Feature-level token accounting is represented in the `Feature` type and TypeBox schema.
- Test fixtures now include required mission schema/version fields.
- SQLite initialization no longer depends on `__dirname` in an ESM package.
- Database loading tries a manually installed `better-sqlite3` first and falls back to Node.js `node:sqlite`.
- The default install path no longer installs native `better-sqlite3`, avoiding native build/header failures in restricted environments.
- Database schema assets are copied into `dist/database/schema.sql` during build.
- CLI build output is generated at `dist/cli/index.js`, with a package `bin` mapping for `pi-missions`.
- README and CI now match the implemented feature set instead of claiming unfinished marketplace/integration features.

## Verified

The following commands passed on Node.js 22.16.0:

```bash
npm ci
npm run check
npm test
npm run build
./scripts/smoke-test.sh
PI_MISSIONS_DB_PATH=/tmp/pi-missions-perfect-cli/test.db node dist/cli/index.js doctor
npm pack --dry-run
```

Test result: 29 test files passed, 834 tests passed.

## Not verified

A live Pi end-to-end tmux run was not executed because the `pi` binary is not available in this environment.
