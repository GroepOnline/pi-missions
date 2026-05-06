# pi-missions

Long-running **Missions** for the pi coding agent: persistent, cross-session task orchestration inspired by Factory.ai Droid Missions and Codex `/goal`, but implemented as a native pi extension.

## Install

```bash
# Local development
pi -e ./src/index.ts

# Install as a pi package from a local checkout
pi install /home/joep/projects/pi-missions

# GitHub package install (after publishing)
pi install git:github.com/GroepChef/pi-missions
```

## Commands

```text
/mission new <title>       Create a mission
/mission list              List and load missions
/mission load <id>         Load a mission into the current session
/mission status            Show current mission status
/mission dashboard         Show dashboard widget
/mission next              Advance to next unblocked feature
/mission done [evidence]   Mark active feature done
/mission block <reason>    Block active feature
/mission pause|resume      Pause/resume mission
/mission edit <feature>    Edit feature JSON
/mission fork <reason>     Fork active feature into a new session
/mission debug [id]        Show recent history/events
/mission clear             Detach mission from this session
```

## LLM tools

- `mission_feature_done` — mark active feature complete with evidence
- `mission_next_feature` — advance to next pending feature

## State

State is stored under:

```text
~/.pi/missions/<mission-id>/
  plan.json
  plan.json.bak
  history.jsonl
  evidence/
  sessions/
```

Writes are EXDEV-safe: temp files are written next to the target and renamed on the same filesystem.

## Development

```bash
npm run check
npm test
```

See [`PLAN.md`](./PLAN.md) for the full production-grade implementation plan and [`RESEARCH.md`](./RESEARCH.md) for background research.
