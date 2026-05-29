# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in pi-missions, please report it responsibly:

1. **Do NOT open a public GitHub issue.**
2. Email security reports to the maintainers (see README.md for contact info).
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will acknowledge receipt within 48 hours and aim to provide a fix within 7 days.

## Security Measures

### SQL Injection Prevention
- All database queries use parameterized statements (`?` placeholders).
- Column names in UPDATE queries are validated against a runtime whitelist.
- No raw user input is interpolated into SQL strings.

### Path Traversal Protection
- Mission IDs are sanitized via `sanitizeMissionId()` which strips non-alphanumeric characters (except `-` and `_`).
- File operations are restricted to the configured `MISSIONS_ROOT` directory.

### Tool Policy Enforcement
- Planning phase: read-only bash access only.
- Execution phase: full tool access.
- Verification phase: read-only bash + file read access.
- Tool calls are counted and budget-limited per feature.

### File Locking
- Concurrent mission access is protected by `proper-lockfile`.
- Atomic writes use temp-file + rename pattern to prevent corruption.

### Dependency Security
- Only two runtime dependencies: `@sinclair/typebox` (schema validation) and `proper-lockfile` (file locking).
- Optional `better-sqlite3` is a native module; falls back to built-in `node:sqlite` when unavailable.
- Run `npm audit` regularly to check for known vulnerabilities.

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `PI_MISSIONS_DB_PATH` | Custom database path | `~/.pi/missions/database` |
| `PI_MISSIONS_ROOT` | Custom missions storage root | `~/.pi/missions` |
| `PI_WORKER_MODEL` | Override worker model | (inherited) |

Never commit `.env` files or expose these values in logs.
