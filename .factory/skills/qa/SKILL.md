---
name: qa
description: >
  Run QA tests for pi-missions. Analyzes git diff to determine affected areas,
  runs the existing e2e test suite with tmux-based Pi sessions, and generates
  a standardized report. Use when testing PRs or validating changes.
---

# QA Orchestrator

**SCOPE: This skill performs functional QA only -- verifying that the Pi extension actually works by loading it in Pi and exercising commands. Do NOT run unit tests, linting, or typecheck. Those are handled by npm scripts.**

## Step 1: Load Configuration

Read `.factory/skills/qa/config.yaml` for test configuration.

## Step 2: Analyze Git Diff

Run `git diff` to determine what changed. Map changed files using path_patterns:

- `src/**/*.ts` → pi-extension app
- `tests/**/*.ts` → pi-extension app

Files NOT matching any path pattern (docs, .factory, .github) = NOT associated with any app. Skip testing for these.

## Step 3: Run QA Tests

Invoke the sub-skill for the affected app:

```
Use the qa-pi-extension skill to run e2e tests for the pi-extension app.
```

The qa-pi-extension skill delegates to the existing `pi-missions-e2e-tester` infrastructure:
1. Start Pi in a tmux session
2. Load the extension from `./src/index.ts`
3. Exercise all mission commands
4. Verify tools are registered
5. Clean up test artifacts

## Step 4: Evidence Capture

The e2e skill captures tmux output and generates a summary. Include key evidence in the QA report:

- Extension loaded confirmation
- Command test results (passed/failed)
- Tool registration status
- Any error messages

## Step 5: Generate Report

Generate the report at `./qa-results/report.md` using `.factory/skills/qa/REPORT-TEMPLATE.md`.

Result values: ✅ PASS, ❌ FAIL, 🚫 BLOCKED, ⚠️ FLAKY, ❓ INCONCLUSIVE

## Step 6: Handle Failures

If the e2e test fails:
1. Report as BLOCKED with the specific error
2. Include remediation steps
3. Check for new failure patterns that should be added to the skill

## Step 7: Suggest Skill Updates

After generating the report, check if any BLOCKED or FAIL results revealed new testing insights. If so, suggest updates to the `pi-missions-e2e-tester` skill.

Format:

## Suggested Skill Updates (N issues found)

| # | Severity | File | Issue | Fix Prompt |
|---|----------|------|-------|------------|
| 1 | 🔴/🟡/🔵 | skill | description | fix instructions |
