# pi-missions Improvements

> Tracking implementation progress for v0.3 and v0.4 items.

---

## v0.3 — Dashboard & Planning Wizard ✅ COMPLETE

| Priority | Item | Status | Notes |
|---|---|---|---|
| 🔴 P0 | **Factory Droid Dashboard**: milestone progress bars, feature hierarchy, acceptance criteria inline, active feature detail block | ✅ Done | Phase line, done-milestone collapse, dependsOn blocking chain viz |
| 🔴 P0 | **Planning Wizard AI-generation**: `/mission new` → AI generates milestones + features via `pi.sendUserMessage()` + JSON parse | ✅ Done | Implemented in `handleNew` |
| 🟡 P1 | **Milestone auto-complete**: when all features in a milestone are done, set `milestone.status = 'complete'` | ✅ Done | `autoCompleteMilestones()` in `state.ts` — called in `completeActiveFeature` |
| 🟡 P1 | **More templates**: expand `MISSION_TEMPLATES` from 3 to 8+ | ✅ Done | 9 templates: refactor, fix-bug, add-feature, docs, investigate, auth, ci-cd, security-audit, performance-opt |

---

## v0.4 — Orchestrator & Polish ⬜ NOT STARTED

| Priority | Item | Status | Notes |
|---|---|---|---|
| 🟡 P1 | **`dependsOn` blokkering visualisatie** in dashboard | ✅ Done | `dependsOnChain()` + `formatDepChain()` show blocking chain |
| 🟡 P1 | **`session_before_compact` checkpoint** with mission summary | ✅ Done | Hook in extension.ts fires `compactionCheckpoint()` on every compact |
| 🟡 P1 | **`/handoff` suggestie** after large features | ⬜ | Suggest `/handoff` after feature done |
| 🟡 P2 | **`agent-runtime` worker spawning** via `pi.exec()` | ⬜ | Orchestrator spawns workers |
| 🟡 P2 | **`/mission edit <feature-id>`** with `ctx.ui.editor()` | ✅ Done | Already implemented in `handleEdit`
| 🟡 P2 | **History replay** via `history.jsonl` analysis | ⬜ | `jq` based replay |
| 🟡 P2 | **`pi.setLabel(entryId, featureTitle)`** for /tree navigatie | ⬜ | Label entries in /tree |
| 🟡 P3 | **Project-local `.pi/extensions/pi-missions/`** support | ⬜ | Per-project extension installs |
| 🟡 P3 | **Mission schema migration UI** | ⬜ | Guide users through schema upgrades |

---

## Completed Details

### ✅ Factory Droid Dashboard (v0.3)
- `phaseLine()` in `components.ts` — shows current tool phase in dashboard
- `dashboardRows()` — collapse done milestones (1=line, 2+=header+last 2+earlier summary)
- Active feature detail block shows `🔗 Blocking chain: 🔗 F001(•) → F002(⏳) Scope`
- Waiting features show full blocking chain after the wait reason
- Interactive MissionControl overlay shows chain in detail pane

### ✅ Milestone auto-complete
- `autoCompleteMilestones()` in `src/core/state.ts`
- Called in `completeActiveFeature()` after feature done
- When all features in a milestone are `done`, sets `milestone.status = 'complete'`

### ✅ Planning Wizard AI-generation
- `handleNew()` in `src/commands/handlers.ts`
- Uses `pi.sendUserMessage()` with structured prompt
- Parses JSON response with `WizardOutputSchema` validation
- Falls back to structured scaffold on failure

### ✅ dependsOn blocking chain visualization
- `dependsOnChain(mission, feature)` in `src/utils/context.ts` — recursive trace, skips done deps, cycle-safe via visited set
- `formatDepChain(chain)` in `src/utils/context.ts` — compact visual: "🔗 F001(•) Plan → F002(⛔) Scope"
- Used in `dashboardRows()` (components.ts) and `MissionControl` overlay (dashboard.ts)

### ✅ session_before_compact checkpoint
- `hook(pi, 'session_before_compact', async () => compactionCheckpoint(pi, runtime))` in extension.ts
- `compactionCheckpoint()` appends `pi-mission-compaction-checkpoint` entry with mission summary

### ✅ Mission templates (9 total)
`refactor`, `fix-bug`, `add-feature`, `docs`, `investigate`, `auth`, `ci-cd`, `security-audit`, `performance-opt`