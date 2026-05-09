# pi-missions Improvements

> Tracking implementation progress for v0.3 and v0.4 items.

---

## v0.3 — Dashboard & Planning Wizard ✅ IN PROGRESS

| Priority | Item | Status | Notes |
|---|---|---|---|
| 🔴 P0 | **Factory Droid Dashboard**: milestone progress bars, feature hierarchy, acceptance criteria inline, active feature detail block | 🟡 Partial | Most done; missing: collapse-done milestones, phase line, color hints |
| 🔴 P0 | **Planning Wizard AI-generation**: `/mission new` → AI generates milestones + features via `pi.sendUserMessage()` + JSON parse | ✅ Done | Implemented in `handleNew` |
| 🟡 P1 | **Milestone auto-complete**: when all features in a milestone are done, set `milestone.status = 'complete'` | ✅ Done | `autoCompleteMilestones()` in `state.ts` — called in `completeActiveFeature` |
| 🟡 P1 | **More templates**: expand `MISSION_TEMPLATES` from 3 to 8+ (add: bug-fix, test-coverage, security-audit, docs-update, performance-opt, api-design) | 🟡 Partial | Has 7 templates; need 2 more: `security-audit`, `performance-opt` |

---

## v0.4 — Orchestrator & Polish ⬜ NOT STARTED

| Priority | Item | Status | Notes |
|---|---|---|---|
| 🟡 P1 | **`dependsOn` blokkering visualisatie** in dashboard | ⬜ | Show blocking chain in dashboard |
| 🟡 P1 | **`session_before_compact` checkpoint** with mission summary | ⬜ | Already planned in PLAN.md, needs implementation |
| 🟡 P1 | **`/handoff` suggestie** after large features | ⬜ | Suggest `/handoff` after feature done |
| 🟡 P2 | **`agent-runtime` worker spawning** via `pi.exec()` | ⬜ | Orchestrator spawns workers |
| 🟡 P2 | **`/mission edit <feature-id>`** with `ctx.ui.editor()` | ⬜ | JSON editor for feature editing |
| 🟡 P2 | **History replay** via `history.jsonl` analysis | ⬜ | `jq` based replay |
| 🟡 P2 | **`pi.setLabel(entryId, featureTitle)`** for /tree navigatie | ⬜ | Label entries in /tree |
| 🟡 P3 | **Project-local `.pi/extensions/pi-missions/`** support | ⬜ | Per-project extension installs |
| 🟡 P3 | **Mission schema migration UI** | ⬜ | Guide users through schema upgrades |

---

## Completed Details

### ✅ Milestone auto-complete
- `autoCompleteMilestones()` in `src/core/state.ts`
- Called in `completeActiveFeature()` after feature done
- When all features in a milestone are `done`, sets `milestone.status = 'complete'`

### ✅ Planning Wizard AI-generation
- `handleNew()` in `src/commands/handlers.ts`
- Uses `pi.sendUserMessage()` with structured prompt
- Parses JSON response with `WizardOutputSchema` validation
- Falls back to structured scaffold on failure

### 🟡 Factory Droid Dashboard (remaining gaps)
- ✅ Milestone progress bars (`milestoneProgressBar()`)
- ✅ Feature hierarchy with status icons
- ✅ Acceptance criteria inline for active feature
- ✅ Active feature detail block
- ❌ **Collapse done milestones**: by default show last 2 done milestones collapsed
- ❌ **Phase line**: show current phase (planning/execution/verification) in dashboard
- ❌ **Status-based color indicators**: done=green, active=yellow, blocked=red

### 🟡 Templates (need 2 more)
Current: `refactor`, `fix-bug`, `add-feature`, `docs`, `investigate`, `auth`, `ci-cd` (7)
Needed: `security-audit`, `performance-opt`