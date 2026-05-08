# Documentation Plan for Pi-Missions

> Comprehensive plan for updating documentation to reflect the 5 production-grade improvements

---

## Overview

This plan covers 4 documentation tasks to properly document the newly implemented reliability, observability, and data integrity features:

1. **README.md Update** - Add new features to main documentation
2. **User Guide** - Create detailed usage documentation for new systems
3. **CHANGELOG.md** - Document changes and breaking changes
4. **Monitoring Setup** - Metrics export and dashboard configuration

---

## Task 1: README.md Update

### Objective
Update the main README.md to document the 5 new production-grade features while maintaining the current design and structure.

### Changes Required

#### 1.1 Update Key Features Section
**Location:** Lines 23-33

**Add to existing features:**
```markdown
- **Concurrent write protection** (file locking) prevents data corruption
- **Schema validation** ensures data integrity for user input
- **Structured logging** for debugging and observability
- **Graceful degradation** with user-friendly error messages
- **Built-in metrics** for mission success tracking
```

#### 1.2 Add New Architecture Section
**Location:** After "State Model" section (around line 90)

**New section:**
```markdown
## 🏗️ Production-Grade Architecture

### File Locking
- Uses `proper-lockfile` for advisory file locking
- Prevents concurrent write conflicts from auto-save, manual saves, and session shutdown
- Automatic stale lock cleanup on startup
- Configurable timeout (default 10s) and retry logic

### Schema Validation
- Runtime TypeBox validation for all user-provided JSON
- Protects against corrupt data from wizard output and `/mission edit`
- Detailed error messages with path and value information
- Validates: MissionState, Feature, Milestone, HistoryEntry

### Structured Logging
- Lightweight logging system (no external dependencies)
- Log levels: DEBUG, INFO, WARN, ERROR
- Context-aware logging per component
- Configurable via environment variable

### Graceful Degradation
- User-friendly error messages for common failure modes
- Recovery suggestions for file system, lock, JSON, and validation errors
- Automatic error translation from technical to user-friendly format
- Severity-aware UI notifications

### Metrics System
- Tracks mission success rates and performance metrics
- Per-mission metrics: features done/failed, tokens used, completion time
- Aggregated statistics: success rate, average tokens, average completion time
- JSON export for external analysis
```

#### 1.3 Update Development Section
**Location:** Lines 104-108

**Add to development commands:**
```markdown
```bash
npm install
npm run check
npm test
npm run test:coverage  # View test coverage (97%+)
```
```

#### 1.4 Add Troubleshooting Section
**Location:** Before License section (around line 128)

**New section:**
```markdown
## 🔧 Troubleshooting

### File Lock Errors
If you see "File is locked by another process":
- Wait a moment and try again (locks auto-expire after 30s)
- Ensure no other Pi session is using the same mission
- Restart Pi to clear stale locks

### Validation Errors
If wizard output or manual edits fail validation:
- Check that all required fields are present
- Verify field formats (e.g., feature IDs must be F###)
- Use `/mission debug` to inspect the current state

### Logging
To enable debug logging:
```bash
export PI_MISSIONS_LOG_LEVEL=debug
pi -e ./src/index.ts
```

Logs are stored in `~/.pi/missions/logs/pi-missions.log`
```

### Files to Modify
- `README.md` (single file)

### Estimated Time
30-45 minutes

### Success Criteria
- All new features mentioned in README
- Architecture section added with clear explanations
- Troubleshooting section covers common issues
- Existing structure and design preserved
- No broken links or formatting issues

---

## Task 2: User Guide (docs/USER_GUIDE.md)

### Objective
Create a comprehensive user guide explaining how to use the new production-grade features.

### Structure

#### 2.1 Create docs/ Directory
```bash
mkdir -p docs
```

#### 2.2 USER_GUIDE.md Content Outline

```markdown
# Pi-Missions User Guide

> Complete guide for using Pi-Missions with production-grade reliability features

## Table of Contents
1. Getting Started
2. File Locking System
3. Schema Validation
4. Logging and Debugging
5. Error Handling
6. Metrics and Observability
7. Advanced Configuration
8. Best Practices

---

## 1. Getting Started

### Installation
[Quick installation instructions]

### Basic Workflow
[Typical mission workflow with new features]

---

## 2. File Locking System

### What is File Locking?
File locking prevents data corruption when multiple processes try to write to the same mission file simultaneously.

### How It Works
- Automatic lock acquisition before every save operation
- Lock timeout: 10 seconds (configurable)
- Automatic stale lock cleanup on Pi startup
- Lock release after save completes (even on error)

### Common Scenarios

#### Scenario 1: Auto-save + Manual Save
When the auto-save interval triggers while you manually save:
- First operation acquires lock
- Second operation waits up to 10s
- Both complete safely without corruption

#### Scenario 2: Session Shutdown
When Pi shuts down while auto-save is running:
- Lock prevents partial writes
- Backup file (plan.json.bak) is safe
- Next session recovers from backup

### Troubleshooting Lock Issues

#### "File is locked by another process"
**Cause:** Another Pi session has the lock
**Solution:** 
- Wait 10-30 seconds for lock to expire
- Or restart Pi to clear stale locks

#### Lock timeout after 10s
**Cause:** Lock holder crashed without releasing
**Solution:** 
- Restart Pi (clears stale locks automatically)
- Check `~/.pi/missions/<id>/.lock` file manually

---

## 3. Schema Validation

### What is Schema Validation?
Schema validation ensures that all user-provided data follows the correct structure, preventing corrupt mission state.

### Validated Inputs
- Wizard output (AI-generated mission plans)
- Manual edits via `/mission edit`
- JSON imports

### Validation Rules

#### Feature Schema
- `id`: Must match pattern F### (e.g., F001, F123)
- `milestoneId`: Must match pattern M## (e.g., M01, M12)
- `title`: 1-200 characters
- `description`: 1-2000 characters
- `priority`: Integer 1-5
- `status`: One of pending, active, done, blocked, failed
- `acceptance`: At least 1 criterion required

#### Milestone Schema
- `id`: Must match pattern M## (e.g., M01, M12)
- `title`: 1-200 characters
- `features`: At least 1 feature required
- `status`: One of pending, active, complete

### Error Messages

Example validation error:
```
Validation errors:
  - milestones.0.features.0.id: Expected string to match '^F[0-9]{3}$' but received 'INVALID'
    (value: "INVALID")
  - milestones.0.features.0.acceptance: Expected array to have at least 1 items
    (value: [])
```

### Fixing Validation Errors

#### Invalid Feature ID
**Error:** Feature ID doesn't match F### pattern
**Fix:** Rename to F001, F002, etc.

#### Missing Required Fields
**Error:** Required field missing or empty
**Fix:** Add the missing field with valid value

#### Wrong Array Length
**Error:** Array has too few or too many items
**Fix:** Add/remove items to meet requirements

---

## 4. Logging and Debugging

### Log Levels
- **DEBUG**: Detailed diagnostic information
- **INFO**: General informational messages
- **WARN**: Warning messages for potential issues
- **ERROR**: Error messages for failures

### Enabling Debug Logging

#### Temporary (current session)
```bash
PI_MISSIONS_LOG_LEVEL=debug pi -e ./src/index.ts
```

#### Permanent (shell profile)
Add to `~/.bashrc` or `~/.zshrc`:
```bash
export PI_MISSIONS_LOG_LEVEL=debug
```

### Log Location
Logs are stored in: `~/.pi/missions/logs/pi-missions.log`

### Viewing Logs
```bash
# View last 50 lines
tail -n 50 ~/.pi/missions/logs/pi-missions.log

# Follow logs in real-time
tail -f ~/.pi/missions/logs/pi-missions.log

# Search for errors
grep ERROR ~/.pi/missions/logs/pi-missions.log

# Search for specific mission
grep "missionId: abc123" ~/.pi/missions/logs/pi-missions.log
```

### Log Format
```
[2024-01-15T10:30:45.123Z] [INFO] [pi-missions] Mission saved successfully {"missionId": "abc123"}
```

---

## 5. Error Handling

### Graceful Degradation
Pi-Missions automatically translates technical errors into user-friendly messages with recovery suggestions.

### Common Error Messages

#### File Not Found
```
Could not find required file for: mission plan
💡 Please check that the file exists and you have the correct permissions
```

#### Permission Denied
```
Permission denied for: ~/.pi/missions/abc123/plan.json
💡 Please check file permissions and try again
```

#### File Locked
```
File is locked by another process
💡 Please wait a moment and try again, or ensure no other process is using the file
```

#### Invalid JSON
```
Invalid data format
💡 Please check the data format and try again
```

#### Validation Failed
```
Data validation failed
💡 Please check the data and ensure all required fields are present
```

### Severity Levels
- **info**: Informational message
- **warning**: Non-critical issue (can proceed)
- **error**: Critical issue (operation failed)
- **critical**: System-level failure

---

## 6. Metrics and Observability

### What are Metrics?
Metrics track mission success rates and performance to help you understand how well your missions are progressing.

### Tracked Metrics

#### Per-Mission Metrics
- Total features
- Features done
- Features failed
- Total tokens used
- Total wall clock time
- Acceptance failures
- Evidence hash errors

#### Aggregated Metrics
- Total missions
- Completed missions
- Success rate (0-1)
- Average tokens per mission
- Average features per mission
- Average completion time

### Viewing Metrics

#### Current Implementation
Metrics are currently tracked in-memory during the Pi session.

#### Export Metrics
```typescript
// In your code or via a future command
import { metricsCollector } from "./src/metrics.js";
const json = metricsCollector.toJSON();
console.log(json);
```

### Using Metrics for Improvement

#### Low Success Rate
- Review failed features to identify common blockers
- Improve feature definitions to be more specific
- Add more acceptance criteria

#### High Token Usage
- Break large features into smaller ones
- Improve prompts to be more concise
- Add more context to reduce backtracking

#### Long Completion Time
- Identify slow features (review wall clock time)
- Optimize complex features
- Consider parallelizing independent features

---

## 7. Advanced Configuration

### Lock Configuration
Modify lock timeout and retry behavior in `src/lock.ts`:
```typescript
const DEFAULT_OPTIONS: Required<LockOptions> = {
  timeout: 10000,      // ms to wait for lock
  stale: 30000,        // ms before lock considered stale
  retries: 10,         // number of retry attempts
};
```

### Log Level Configuration
Set via environment variable:
```bash
export PI_MISSIONS_LOG_LEVEL=debug  # or info, warn, error
```

### Auto-save Interval
Modify in `src/index.ts`:
```typescript
const AUTO_SAVE_INTERVAL_MS = 30_000; // 30 seconds
```

---

## 8. Best Practices

### File Locking
- Don't manually edit `plan.json` while Pi is running
- Use `/mission edit` for manual edits (respects locks)
- Restart Pi if you suspect a stale lock

### Schema Validation
- Always use the wizard for complex missions
- Validate JSON structure before manual edits
- Keep feature IDs consistent (F### pattern)

### Logging
- Enable debug logging during development
- Use INFO level for production
- Regularly check logs for warnings

### Error Handling
- Read recovery suggestions carefully
- Check logs for technical details (in dev mode)
- Report validation errors as bugs if data is correct

### Metrics
- Review metrics after each completed mission
- Use metrics to identify improvement areas
- Export metrics regularly for long-term analysis

---

## Additional Resources

- [README.md](../README.md) - Main project documentation
- [IMPROVEMENTS.md](../IMPROVEMENTS.md) - Technical implementation details
- [GitHub Issues](https://github.com/OnlineChef/pi-missions/issues) - Report problems
```

### Files to Create
- `docs/USER_GUIDE.md` (new file)

### Estimated Time
2-3 hours

### Success Criteria
- Comprehensive coverage of all 5 new features
- Clear examples and use cases
- Troubleshooting section for common issues
- Best practices section
- Links to related documentation

---

## Task 3: CHANGELOG.md

### Objective
Create a CHANGELOG.md to document all changes, including breaking changes from the async conversion.

### Structure

```markdown
# Changelog

All notable changes to Pi-Missions will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- File locking mechanism using `proper-lockfile` to prevent concurrent write conflicts
- Schema validation for user-provided JSON using TypeBox
- Structured logging system with configurable log levels
- Graceful degradation with user-friendly error messages
- Metrics system for tracking mission success rates and performance
- Lock cleanup on Pi startup to clear stale locks from crashes
- Validation error formatting with path and value information
- Error translation layer for common failure modes

### Changed
- **BREAKING**: `saveMissionSafe()` converted from synchronous to asynchronous
- All call sites to `saveMissionSafe()` updated to use `await`
- Auto-save interval now uses async save operations
- Session shutdown uses async save with lock protection

### Fixed
- Race condition in concurrent file writes (auto-save + manual saves)
- Potential data corruption from multiple simultaneous writes
- Silent error handling with no logging visibility
- Unhelpful error messages for common failure scenarios

### Security
- Added schema validation to prevent corrupt data injection
- File locking prevents unauthorized concurrent modifications

### Testing
- Added 69 new tests for new functionality
- Total test coverage: 370 tests passing
- New test suites: lock.test.ts, validation.test.ts, logger.test.ts, feedback.test.ts, metrics.test.ts

### Dependencies
- Added `proper-lockfile@4.1.2`
- Added `@sinclair/typebox@0.31.28`
- Added `@types/proper-lockfile@4.1.2`

## [0.1.0] - 2024-XX-XX

### Added
- Initial release of Pi-Missions
- Persistent mission orchestration for Pi coding agent
- Mission creation, loading, and management commands
- Feature queue with status tracking (pending → active → blocked → done)
- Evidence capture for completed work
- Append-only history (JSONL) for full audit trail
- Session handoff across multiple Pi sessions
- Agent-callable tools for autonomous progress
- Crash-safe writes with temp file strategy
- Dashboard widget for mission visualization
- Keyboard shortcuts for navigation
- Planning wizard for AI-assisted mission breakdown
- Mission forking for parallel execution
- Template system for reusable mission structures

### Commands
- `/mission new <title>` - Create new mission
- `/mission list` - List and load missions
- `/mission load <id>` - Load mission into session
- `/mission status` - Show current status
- `/mission dashboard` - Open dashboard widget
- `/mission next` - Advance to next feature
- `/mission done [evidence]` - Mark feature complete
- `/mission block <reason>` - Block current feature
- `/mission pause` / `resume` - Pause/resume mission
- `/mission fork <reason>` - Fork active feature
- `/mission debug [id]` - Inspect history
- `/mission clear` - Detach mission from session

### Tools
- `mission_feature_done` - Mark feature complete with evidence
- `mission_next_feature` - Auto-advance to next feature

### Testing
- Initial test suite with 301 tests
- 97.22% statement coverage
- Benchmark suites for performance testing
```

### Files to Create
- `CHANGELOG.md` (new file)

### Estimated Time
30 minutes

### Success Criteria
- Clear indication of breaking change (async conversion)
- All new features listed in "Added" section
- Dependencies documented
- Test coverage statistics included
- Follows Keep a Changelog format

---

## Task 4: Monitoring Setup

### Objective
Implement metrics export functionality and provide guidance for setting up monitoring dashboards.

### Subtasks

#### 4.1 Add Metrics Export Command
**File:** `src/commands.ts`

**Add new command handler:**
```typescript
export async function handleMetrics(ctx: ExtensionCommandContext, runtime: RuntimeState): Promise<void> {
  const summary = getMetricsSummary();
  
  const report = [
    "📊 Mission Metrics Summary",
    "=" .repeat(40),
    `Total Missions: ${summary.totalMissions}`,
    `Completed Missions: ${summary.completedMissions}`,
    `Success Rate: ${(summary.successRate * 100).toFixed(1)}%`,
    `Average Tokens/Mission: ${summary.averageTokensPerMission.toFixed(0)}`,
    `Average Features/Mission: ${summary.averageFeaturesPerMission.toFixed(1)}`,
    `Avg Completion Time: ${(summary.averageCompletionTimeMs / 1000 / 60).toFixed(1)} min`,
  ].join("\n");
  
  ctx.ui.notify(report, "info");
  
  // Also export to file
  const metricsDir = path.join(os.homedir(), ".pi", "missions");
  const metricsFile = path.join(metricsDir, "metrics-export.json");
  fs.writeFileSync(metricsFile, metricsCollector.toJSON(), "utf-8");
  ctx.ui.notify(`Metrics exported to: ${metricsFile}`, "info");
}
```

#### 4.2 Register Metrics Command
**File:** `src/index.ts`

**Add to command registration:**
```typescript
pi.on("command:/mission metrics", handleMetrics);
```

#### 4.3 Update README Commands Table
**File:** `README.md`

**Add to commands table:**
```markdown
| `/mission metrics`            | Show mission metrics and export to JSON |
```

#### 4.4 Create Monitoring Guide
**File:** `docs/MONITORING.md`

**Content:**
```markdown
# Pi-Missions Monitoring Guide

> Setting up metrics collection and visualization for Pi-Missions

## Overview

Pi-Missions includes a built-in metrics system that tracks mission success rates, token usage, and performance metrics. This guide shows you how to export and visualize these metrics.

## Exporting Metrics

### Via Command
Use the `/mission metrics` command to view and export metrics:

```bash
/mission metrics
```

This displays:
- Total missions created
- Completed missions
- Success rate percentage
- Average tokens per mission
- Average features per mission
- Average completion time

And exports to: `~/.pi/missions/metrics-export.json`

### Via Code
Export metrics programmatically:

```typescript
import { metricsCollector } from "./src/metrics.js";

// Get all metrics as JSON
const json = metricsCollector.toJSON();
console.log(json);

// Get summary statistics
const summary = metricsCollector.getSummary();
console.log(`Success rate: ${summary.successRate * 100}%`);
```

## Metrics Format

### Exported JSON Structure
```json
[
  {
    "missionId": "abc123",
    "created": 1705317600000,
    "completed": 1705404000000,
    "totalFeatures": 15,
    "featuresDone": 14,
    "featuresFailed": 1,
    "totalTokensUsed": 125000,
    "totalWallClockMs": 86400000,
    "acceptanceFailures": 3,
    "evidenceHashErrors": 0
  }
]
```

### Summary Structure
```json
{
  "totalMissions": 10,
  "completedMissions": 8,
  "successRate": 0.8,
  "averageTokensPerMission": 120000,
  "averageFeaturesPerMission": 12.5,
  "averageCompletionTimeMs": 72000000
}
```

## Setting Up Dashboards

### Option 1: Grafana (Recommended)

#### Prerequisites
- Grafana installed (https://grafana.com/docs/grafana/latest/installation/)
- PostgreSQL or other database for metrics storage

#### Setup Steps

1. **Create a PostgreSQL database**
```sql
CREATE DATABASE pi_missions_metrics;
```

2. **Create metrics table**
```sql
CREATE TABLE mission_metrics (
  id SERIAL PRIMARY KEY,
  mission_id VARCHAR(255) UNIQUE NOT NULL,
  created TIMESTAMP NOT NULL,
  completed TIMESTAMP,
  total_features INTEGER NOT NULL,
  features_done INTEGER NOT NULL,
  features_failed INTEGER NOT NULL,
  total_tokens_used BIGINT NOT NULL,
  total_wall_clock_ms BIGINT NOT NULL,
  acceptance_failures INTEGER NOT NULL,
  evidence_hash_errors INTEGER NOT NULL
);
```

3. **Create import script**
Create `scripts/import-metrics.js`:
```javascript
const fs = require('fs');
const { Client } = require('pg');

const client = new Client({
  host: 'localhost',
  database: 'pi_missions_metrics',
  user: 'your_user',
  password: 'your_password',
});

async function importMetrics() {
  await client.connect();
  
  const metrics = JSON.parse(fs.readFileSync('/home/user/.pi/missions/metrics-export.json', 'utf-8'));
  
  for (const metric of metrics) {
    await client.query(`
      INSERT INTO mission_metrics 
      (mission_id, created, completed, total_features, features_done, features_failed, 
       total_tokens_used, total_wall_clock_ms, acceptance_failures, evidence_hash_errors)
      VALUES ($1, to_timestamp($2 / 1000), $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (mission_id) DO UPDATE SET
        completed = EXCLUDED.completed,
        features_done = EXCLUDED.features_done,
        features_failed = EXCLUDED.features_failed,
        total_tokens_used = EXCLUDED.total_tokens_used,
        total_wall_clock_ms = EXCLUDED.total_wall_clock_ms,
        acceptance_failures = EXCLUDED.acceptance_failures,
        evidence_hash_errors = EXCLUDED.evidence_hash_errors
    `, [
      metric.missionId,
      metric.created,
      metric.completed ? new Date(metric.completed).toISOString() : null,
      metric.totalFeatures,
      metric.featuresDone,
      metric.featuresFailed,
      metric.totalTokensUsed,
      metric.totalWallClockMs,
      metric.acceptanceFailures,
      metric.evidenceHashErrors
    ]);
  }
  
  await client.end();
  console.log('Metrics imported successfully');
}

importMetrics().catch(console.error);
```

4. **Import metrics**
```bash
node scripts/import-metrics.js
```

5. **Create Grafana dashboard**
- Add PostgreSQL data source in Grafana
- Create panels for:
  - Success rate over time
  - Tokens per mission
  - Features completed vs failed
  - Average completion time

#### Example Grafana Queries

**Success Rate:**
```sql
SELECT 
  date_trunc('day', created) as time,
  COUNT(*) as total,
  SUM(CASE WHEN completed IS NOT NULL THEN 1 ELSE 0 END) as completed,
  SUM(CASE WHEN completed IS NOT NULL THEN 1 ELSE 0 END)::float / COUNT(*) as success_rate
FROM mission_metrics
GROUP BY date_trunc('day', created)
ORDER BY time;
```

**Tokens per Mission:**
```sql
SELECT 
  mission_id,
  total_tokens_used
FROM mission_metrics
ORDER BY created DESC
LIMIT 20;
```

### Option 2: Simple CSV Export

For quick analysis without a database:

```bash
# Convert JSON to CSV
node -e "
const data = require('/home/user/.pi/missions/metrics-export.json');
const headers = Object.keys(data[0]).join(',');
const rows = data.map(row => Object.values(row).join(','));
console.log(headers);
console.log(rows.join('\n'));
" > metrics.csv
```

Open in Excel, Google Sheets, or any CSV viewer.

### Option 3: Python Analysis

Create `scripts/analyze-metrics.py`:
```python
#!/usr/bin/env python3
import json
import sys
from datetime import datetime

def analyze_metrics(metrics_file):
    with open(metrics_file) as f:
        metrics = json.load(f)
    
    total = len(metrics)
    completed = [m for m in metrics if m.get('completed')]
    success_rate = len(completed) / total if total > 0 else 0
    
    avg_tokens = sum(m['totalTokensUsed'] for m in metrics) / total if total > 0 else 0
    avg_time = sum(
        (m['completed'] - m['created']) / 1000 / 60 
        for m in completed
    ) / len(completed) if completed else 0
    
    print(f"Total Missions: {total}")
    print(f"Completed: {len(completed)}")
    print(f"Success Rate: {success_rate * 100:.1f}%")
    print(f"Avg Tokens/Mission: {avg_tokens:.0f}")
    print(f"Avg Completion Time: {avg_time:.1f} minutes")

if __name__ == '__main__':
    analyze_metrics(sys.argv[1] if len(sys.argv) > 1 else '~/.pi/missions/metrics-export.json')
```

Run:
```bash
python3 scripts/analyze-metrics.py
```

## Automated Metrics Collection

### Cron Job for Regular Exports

Add to crontab (`crontab -e`):
```bash
# Export metrics every hour
0 * * * * /usr/local/bin/pi -e "/home/user/projects/pi-missions/src/index.ts" --export-metrics
```

Note: This requires adding a `--export-metrics` CLI flag to the extension.

### Webhook Integration

For real-time metrics push to external services:

```typescript
// Add to src/metrics.ts
export async function pushMetricsToWebhook(webhookUrl: string): Promise<void> {
  const metrics = metricsCollector.getAllMetrics();
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metrics),
  });
  
  if (!response.ok) {
    throw new Error(`Webhook push failed: ${response.statusText}`);
  }
}
```

## Metrics Best Practices

1. **Export Regularly**: Export metrics after each completed mission
2. **Trend Analysis**: Look for trends in success rate over time
3. **Identify Bottlenecks**: High token usage or long completion times indicate optimization opportunities
4. **Compare Features**: Analyze which types of features succeed or fail most often
5. **Set Benchmarks**: Establish baseline metrics and track improvements

## Troubleshooting

### No Metrics Showing
- Ensure missions have been completed (metrics only record completed missions)
- Check that the metrics collector is being called in your code

### Incorrect Success Rate
- Verify that completed timestamps are being set correctly
- Check for missions that are stuck in intermediate states

### High Token Usage
- Review feature definitions for complexity
- Consider breaking large features into smaller ones
- Optimize prompts to be more concise

## Additional Resources

- [Grafana Documentation](https://grafana.com/docs/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [User Guide](USER_GUIDE.md) - General usage documentation
```

### Files to Create
- `docs/MONITORING.md` (new file)
- `scripts/import-metrics.js` (optional, for database import)
- `scripts/analyze-metrics.py` (optional, for Python analysis)

### Files to Modify
- `src/commands.ts` (add handleMetrics function)
- `src/index.ts` (register /mission metrics command)
- `README.md` (add metrics command to table)

### Estimated Time
2-3 hours

### Success Criteria
- `/mission metrics` command works and displays summary
- Metrics export to JSON file successfully
- Monitoring guide covers multiple setup options (Grafana, CSV, Python)
- Clear examples for each option
- Troubleshooting section included

---

## Implementation Order

Recommended order to complete these tasks:

1. **Task 3: CHANGELOG.md** (30 min) - Quick win, documents what was done
2. **Task 1: README.md Update** (45 min) - Updates main documentation
3. **Task 2: User Guide** (2-3 hours) - Comprehensive user documentation
4. **Task 4: Monitoring Setup** (2-3 hours) - Advanced feature implementation

**Total Estimated Time: 5-7 hours**

---

## Verification Checklist

After completing all tasks:

- [ ] README.md mentions all 5 new features
- [ ] README.md has architecture section
- [ ] README.md has troubleshooting section
- [ ] docs/USER_GUIDE.md exists and is comprehensive
- [ ] CHANGELOG.md follows Keep a Changelog format
- [ ] CHANGELOG.md clearly marks breaking change
- [ ] `/mission metrics` command works
- [ ] Metrics export to JSON file works
- [ ] docs/MONITORING.md provides multiple setup options
- [ ] All documentation links work
- [ ] No broken formatting or markdown errors
- [ ] Code examples are tested and working

---

## Next Steps After Documentation

Once documentation is complete, consider:

1. **API Documentation**: Generate API docs for TypeScript modules
2. **Video Tutorial**: Create a walkthrough video for new features
3. **Blog Post**: Write about the production-grade improvements
4. **Community Feedback**: Share with users and gather feedback
5. **Documentation Site**: Deploy a static documentation site (e.g., Docusaurus)
