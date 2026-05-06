# pi-missions — Research & Design

> Onderzoek: Factory.ai Droid Missions + Codex /goal → implementatie als pi extensie  
> Datum: 2026-05-06

---

## 1. Factory.ai Droid — Missions

### Wat is een Mission?
Een Mission is **geen lange prompt** — het is een volledig gestructureerd multi-agent orchestratie framework. Het splitst een groot doel op in Milestones → Features → Workers, met validatie-criteria en handoff-protokol.

### Kern-artefacten (datastructuur)

| Bestand | Rol |
|---|---|
| `mission.md` | Het high-level doel (plain text, door gebruiker + Orchestrator opgesteld) |
| `features.json` | De execution plan — array van Feature objecten |
| `validation-contract.md` | Mission-level TDD — testbare assertions met Evidence Requirements (VAL-AUTH-001 etc.) |
| `AGENTS.md` | Project coding standards, conventions, architectural boundaries |
| `.factory/services.yaml` | Dev servers, databases, infra die workers nodig hebben |
| `.factory/skills/` | Procedurele instructies per worker-type (frontend-implementer etc.) |

### Feature object structuur
```json
{
  "id": "feature-001",
  "title": "Implement OAuth login",
  "description": "...",
  "fulfills": ["VAL-AUTH-001", "VAL-AUTH-002"],
  "status": "pending | in_progress | completed | failed"
}
```

### Mission Lifecycle
1. **Planning** — `/mission` commando → collaboratieve planning session → genereert `mission.md` + `features.json`
2. **Worker Design** — Orchestrator definieert Skills per worker-type
3. **Execution (Mission Control)** — Orchestrator assignt eerste `pending` feature aan Worker
4. **Handoff & Validatie** — Worker levert code + evidence, Orchestrator checkt tegen `validation-contract.md`
5. **Fix loop** — Als handoff faalt: Orchestrator maakt "Fix Feature", re-assignt

### Key Design Principles (Factory)
- **Orchestrator schrijft NOOIT code** — alleen delegeren
- **Workers** kunnen geen vragen stellen aan user, geen sub-agents spawnen
- **User kan pauzeren** om Orchestrator te redirecten
- **Parallelisme** mogelijk maar rate-limit afhankelijk

---

## 2. OpenAI Codex CLI — /goal (v0.128.0)

### Wat is /goal?
`/goal` is een **persistent thread-level state machine** in Codex CLI (geïntroduceerd in v0.128.0). Het verschil met een gewone prompt: **een prompt is input, een goal is state**.

### TUI commands
```
/goal <objective>     # Maak/vervang goal
/goal                 # Toon huidige goal summary
/goal clear           # Verwijder goal
/goal pause           # Pauzeer
/goal resume          # Hervat gepauzeerde goal
```

### Interne architectuur (5 PRs)

**PR #18073 — Persistence**
- `goals` feature flag
- `thread_goals` state table
- Goal states: `active | paused | budget_limited | complete`
- Token usage + elapsed time tracking
- `goal_id`-based stale update protection

**PR #18074 — App-server API**
```
thread/goal/get
thread/goal/set  
thread/goal/clear
# Notifications:
thread/goal/updated
thread/goal/cleared
```
- Resume/snapshot wiring → reconnecting clients zien huidige goal state

**PR #18075 — Model tools** (beperkt!)
```
get_goal      # Model mag goal ophalen
create_goal   # Alleen als er geen goal bestaat
update_goal   # Alleen goal completion markeren
```
> Pause/resume/clear/budget blijven USER/RUNTIME controlled — model heeft geen brede controle

**PR #18076 — Core Runtime**
- Continuation turns (auto-continue als agent idle)
- Budget-limit = soft stop → wrap-up steering, niet abrupt stoppen
- Interrupt pause behavior
- Resume auto-reactivation
- Suppression van repeated continuation zonder tool calls

**PR #18077 — TUI**
- Summary rendering + footer/statusline indicators
- Token budget display
- Goal notification handling
- Confirmation bij vervangen bestaande goal

### /goal vs. vergelijkbare concepten
| | Planning | Resume | Compaction | /goal |
|---|---|---|---|---|
| Wat | Stap-voor-stap plan | Sessie hervatten | Context samenvatten | Duurzaam doel |
| State | Tijdelijk | Thread-level | In-place | Persistent |
| Controle | AI | Runtime | Runtime | User + Runtime |

---

## 3. Design: `pi-missions` extensie

### Core Insight
Beide systemen hebben dezelfde kern:  
**Doel → State → Continuation → Validation → Control**

De pi extensie API heeft precies de bouwstenen:
- `pi.appendEntry()` → persistente state in sessie
- `session_start` → state herstellen bij herstart  
- `pi.registerCommand()` → `/mission` TUI commands
- `ctx.ui.setWidget()` → mission status in footer
- `pi.sendUserMessage()` → continuation turns triggeren
- `before_agent_start` → mission context injecteren in system prompt
- `session_shutdown` → state opslaan bij exit

---

### Architectuur

```
~/.pi/missions/
  <mission-id>/
    mission.md          # Doel + context
    features.json       # Task list met statussen
    validation.md       # Acceptance criteria
    state.json          # Runtime state (huidige feature, stats)
    sessions/           # Welke pi sessies hebben aan deze mission gewerkt
      session-abc.jsonl.ref
```

### Feature JSON schema
```typescript
interface Feature {
  id: string;           // "F001"
  title: string;
  description: string;
  acceptance: string[]; // Testbare criteria
  status: "pending" | "active" | "done" | "blocked" | "failed";
  sessionFile?: string; // Welke pi sessie deed dit
  completedAt?: number;
  notes?: string;       // Blocker info of resultaat
}

interface MissionState {
  id: string;
  title: string;
  goal: string;
  status: "planning" | "active" | "paused" | "complete" | "budget_limited";
  features: Feature[];
  activeFeatureId?: string;
  tokensBudget?: number;
  tokensUsed: number;
  createdAt: number;
  updatedAt: number;
}
```

---

### TUI Commands

```
/mission new <title>          # Nieuwe mission starten (interactieve planning wizard)
/mission list                 # Overzicht van alle missions
/mission load <id>            # Laad mission in huidige sessie
/mission status               # Toon huidige mission + voortgang
/mission next                 # Ga naar volgende pending feature
/mission done                 # Markeer huidige feature als done
/mission block <reason>       # Markeer als geblokkeerd
/mission pause                # Pauzeer mission
/mission resume               # Hervat gepauzeerde mission
/mission clear                # Ontkoppel mission van sessie (niet verwijderen)
```

### Extension API mapping

```typescript
export default function(pi: ExtensionAPI) {
  let activeMission: MissionState | null = null;

  // --- State herstel bij session start ---
  pi.on("session_start", async (_event, ctx) => {
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && entry.customType === "pi-mission-active") {
        activeMission = await loadMissionFromDisk(entry.data.missionId);
        updateStatusBar(ctx, activeMission);
      }
    }
  });

  // --- Injecteer mission context in elke turn ---
  pi.on("before_agent_start", async (_event, ctx) => {
    if (!activeMission) return;
    const feature = getActiveFeature(activeMission);
    return {
      message: {
        customType: "pi-mission-context",
        content: buildMissionContext(activeMission, feature),
        display: true,
      }
    };
  });

  // --- Auto-continuation na elke turn ---
  pi.on("agent_end", async (_event, ctx) => {
    if (!activeMission || activeMission.status !== "active") return;
    // Check of feature klaar is (via LLM summary of markers)
    // Zo ja: sla op, stuur /mission next als follow-up
  });

  // --- Commands ---
  pi.registerCommand("mission", {
    description: "Mission management: new, list, load, status, next, done, block, pause, resume",
    handler: async (args, ctx) => {
      const [sub, ...rest] = (args ?? "").split(" ");
      switch (sub) {
        case "new":    return handleMissionNew(rest.join(" "), ctx, pi);
        case "list":   return handleMissionList(ctx);
        case "load":   return handleMissionLoad(rest[0], ctx, pi);
        case "status": return handleMissionStatus(ctx, activeMission);
        case "next":   return handleMissionNext(ctx, pi, activeMission);
        case "done":   return handleFeatureDone(ctx, pi, activeMission);
        case "block":  return handleFeatureBlock(rest.join(" "), ctx, pi, activeMission);
        case "pause":  return handleMissionPause(ctx, pi, activeMission);
        case "resume": return handleMissionResume(ctx, pi, activeMission);
        case "clear":  return handleMissionClear(ctx, pi);
      }
    }
  });

  // --- Footer widget: mission progress bar ---
  function updateStatusBar(ctx: ExtensionContext, mission: MissionState | null) {
    if (!mission) {
      ctx.ui.setStatus("pi-mission", "");
      return;
    }
    const done = mission.features.filter(f => f.status === "done").length;
    const total = mission.features.length;
    const pct = Math.round((done / total) * 100);
    const active = getActiveFeature(mission);
    ctx.ui.setStatus("pi-mission", 
      `🎯 ${mission.title} [${done}/${total} ${pct}%]${active ? ` — ${active.title}` : ""}`
    );
  }
}
```

### Mission Planning Wizard

Bij `/mission new <title>` start een interactieve wizard:

```typescript
async function handleMissionNew(title: string, ctx, pi) {
  // 1. Vraag naar het doel
  const goal = await ctx.ui.input("Mission doel", "Wat wil je bereiken?");
  
  // 2. Laat AI de features genereren
  await ctx.waitForIdle();
  pi.sendUserMessage(
    `Analyseer dit mission doel en maak een features.json met concrete subtaken:
     
     Titel: ${title}
     Doel: ${goal}
     
     Maak een array van features met id, title, description, acceptance criteria.
     Output ALLEEN de JSON, geen markdown.`,
    { deliverAs: "followUp" }
  );
  
  // 3. Na AI response: parse features, sla op, activeer mission
  // (via agent_end hook + tool_result interceptie)
}
```

### Cross-session continuïteit

Mission state leeft op disk (`~/.pi/missions/<id>/`), niet alleen in sessie:

```typescript
// Bij session_shutdown: update missie met laatste sessie info
pi.on("session_shutdown", async (_event, ctx) => {
  if (!activeMission) return;
  activeMission.updatedAt = Date.now();
  // Link sessie file aan mission
  const sessionFile = ctx.sessionManager.getSessionFile();
  if (sessionFile) {
    await linkSessionToMission(activeMission.id, sessionFile);
  }
  await saveMissionToDisk(activeMission);
});
```

### Budget/token awareness

```typescript
// Na elke turn: update token usage
pi.on("turn_end", async (_event, ctx) => {
  if (!activeMission) return;
  const usage = ctx.getContextUsage();
  if (usage) {
    activeMission.tokensUsed += usage.tokens;
    // Budget warning bij 80%
    if (activeMission.tokensBudget && 
        activeMission.tokensUsed > activeMission.tokensBudget * 0.8) {
      ctx.ui.notify("⚠️ Mission budget 80% gebruikt", "warning");
    }
  }
});
```

---

## 4. Implementatie Plan

### MVP (v0.1)
- [ ] `/mission new` → interactieve wizard + AI feature generatie
- [ ] `/mission status` → toon voortgang in TUI
- [ ] `/mission done` → feature afsluiten
- [ ] Footer widget met progress bar
- [ ] State persistentie op disk (`~/.pi/missions/`)
- [ ] Cross-session: `/mission load <id>` om verder te gaan

### v0.2 — Smart continuation
- [ ] Auto-inject mission context in `before_agent_start`  
- [ ] `agent_end` hook → detecteer completion, suggereer `/mission done`
- [ ] Token budget tracking + waarschuwingen

### v0.3 — Orchestrator mode (Factory-stijl)
- [ ] Aparte Orchestrator sessie die Workers spawnt via `pi.exec()`
- [ ] Handoff protocol: Worker → Orchestrator review → volgende feature
- [ ] `validation-contract.md` support

### v0.4 — Codex /goal-stijl continuation
- [ ] Auto-continuation turns (na `agent_end` zonder tool calls)
- [ ] Soft budget-limit met wrap-up steering
- [ ] Pause/resume met state machine (`active | paused | budget_limited | complete`)

---

## 5. Bestanden om te maken

```
~/.pi/agent/extensions/pi-missions/
  index.ts            # Main extension
  commands.ts         # Command handlers
  state.ts            # MissionState types + disk I/O
  wizard.ts           # Planning wizard logic
  context.ts          # Mission context builder voor LLM
  ui.ts               # Footer widget + renderers
  package.json        # Dependencies (none needed, pure Node)
```

---

## 6. Key Design Decisions

| Vraag | Keuze | Reden |
|---|---|---|
| State opslag | `~/.pi/missions/<id>/` JSON files | Cross-session, git-friendly, debuggable |
| Planning | AI-gegenereerde features via wizard | Flexibeler dan YAML hand-schrijven |
| Continuation | Suggestie, niet auto | pi philosophy = user in control |
| Orchestrator | v0.3 optioneel | MVP eerst simpel houden |
| Budget | Soft limit + waarschuwing | Codex /goal aanpak, niet hard stoppen |
| Parallelisme | Niet in MVP | Vereist multi-session orchestratie |

---

*Referenties:*
- *Factory.ai Missions docs: https://docs.factory.ai/cli/features/missions*
- *Factory Droid Orchestrator Prompt: https://gist.github.com/V1ki/356b121038722ebf32b5aac85482c113*
- *Codex /goal PR #18073-18077: https://github.com/openai/codex*
- *Codex 0.128.0 release: https://github.com/openai/codex/releases/tag/rust-v0.128.0*
- *pi extensions.md: ~/.npm-global/lib/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md*
