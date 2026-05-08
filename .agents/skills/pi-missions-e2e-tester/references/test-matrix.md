# Pi-Missions E2E Test Matrix

Use this reference when a run needs deeper phase-by-phase coverage than the smoke workflow.

## Phase 1: Critical Fixes

| Check | Evidence | Pass condition |
| --- | --- | --- |
| Mission ID format | Mission creation output or mission file path | ID matches `pim:<timestamp>:<slug>` |
| Validation token creation | Mission state JSON or Pi output | Token exists for the mission |
| Validation token enforcement | Invalid event/token attempt | Invalid or ghost event is rejected |
| Tool policy | Tool registry/listing output | Mission tools remain available across phases |
| User interaction | `mission_ask_user` invocation | Tool asks for user input without crashing |

## Phase 2: Auto-Advance

| Check | Evidence | Pass condition |
| --- | --- | --- |
| Completion detection | Pi response/log/state | Detection uses multiple criteria |
| Auto-advance | State transition after feature done | Next feature becomes active |
| Auto-complete | Final feature completion | Mission completes only after all criteria pass |
| Stuck detection | Repeated failure/block test | Stuck state is detected and reported |
| Self-blocking | `mission_block_self` result | Blocked state includes reason/context |
| Forking | `mission_fork` result | Fork links back to original mission |

## Phase 3: Error Recovery

| Check | Evidence | Pass condition |
| --- | --- | --- |
| Error categorization | Error status output | Error has actionable category |
| Retry mechanism | Retry output/log | Retry count and backoff are visible |
| Fallback strategies | Non-retryable error output | Fallback/user action is suggested |
| Error statistics | Metrics/status output | Error counts are tracked |
| Error status tool | `mission_error_status` | Current error state is returned |
| Error retry tool | `mission_retry_error` | Retry succeeds or refuses with clear reason |
