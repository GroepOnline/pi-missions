# pi-missions — Implementatie Plan v1

> Gebaseerd op: Factory.ai Droid Missions + Codex /goal + pi extension API  
> Doel: Autonome, cross-session taak-orchestratie als native pi extensie

---

## 1. TypeScript Schema & Types

```typescript
// ~/.pi/agent/extensions/pi-missions/state.ts

export interface AcceptanceCriterion {
  id: string;                          // "AC-001"
  description: string;                 // "Alle tests slagen"
  checkType: "manual" | "bash" | "test_file";
  checkCommand?: string;               // bash: "npm test"
  evidence?: string;                   // bewijs van voltooiing
  verified: boolean;
}

export interface Feature {
  id: string;                          // "F001"
  milestoneId: string;                 // parent milestone
  title: string;
  description: string;
  priority: number;                    // 1=hoog, 3=laag
  dependsOn: string[];                 // ["F000"] — blocked tot deze done zijn
  acceptance: AcceptanceCriterion[];
  status: "pending" | "active" | "done" | "blocked" | "failed";
  sessions: string[];                  // alle pi sessie-bestanden die hieraan werkten
  completedAt?: number;
  notes?: string;
}

export interface Milestone {
  id: string;                          // "M01"
  title: string;
  description: string;
  status: "pending" | "active" | "complete";
  features: Feature[];
  dependsOn?: string[];                // milestone-level deps
}

export interface MissionState {
  id: string;                          // "mission-20260506-abc"
  title: string;
  goal: string;
  status: "planning" | "active" | "paused" | "complete" | "budget_limited";
  milestones: Milestone[];
  activeMilestoneId?: string;
  activeFeatureId?: string;
  tokensBudget?: number;
  tokensUsed: number;
  lastContextTokens: number;           // voor delta-berekening (geen cumul. bug)
  createdAt: number;
  updatedAt: number;
}

export interface MissionHistory {
  timestamp: number;
  action: string;                      // "feature_done" | "milestone_complete" | "paused"
  featureId?: string;
  note?: string;
}
```

### Disk Layout

```
~/.pi/missions/<id>/
  plan.json          # MissionState (milestones + features)
  history.jsonl      # append-only event log (undo/audit)
  validation.md      # acceptance criteria in leesbaar formaat
  evidence/          # bash output logs per acceptance criterion
    F001_AC001.log
  sessions/          # pi sessie refs
    session-abc.jsonl.ref
```

---

## 2. /mission Commands

```typescript
// ~/.pi/agent/extensions/pi-missions/commands.ts

pi.registerCommand("mission", {
  description: "Mission management: new|list|load|status|next|done|block|pause|resume|clear|edit",
  getArgumentCompletions: (prefix) =>
    ["new","list","load","status","next","done","block","pause","resume","clear","edit"]
      .filter(s => s.startsWith(prefix))
      .map(s => ({ value: s, label: s })),

  handler: async (args, ctx) => {
    const [sub, ...rest] = (args ?? "").trim().split(/\s+/);
    switch (sub) {
      case "new":    return handleNew(rest.join(" "), ctx, pi);
      case "list":   return handleList(ctx);
      case "load":   return handleLoad(rest[0], ctx, pi);
      case "status": return handleStatus(ctx, activeMission);
      case "next":   return handleNext(ctx, pi, activeMission);
      case "done":   return handleDone(ctx, pi, activeMission);
      case "block":  return handleBlock(rest.join(" "), ctx, pi, activeMission);
      case "pause":  return handlePause(ctx, pi, activeMission);
      case "resume": return handleResume(ctx, pi, activeMission);
      case "clear":  return handleClear(ctx, pi);
      case "edit":   return handleEdit(rest, ctx, pi, activeMission);
      default:       return handleStatus(ctx, activeMission);
    }
  }
});
```

### Command Overzicht

| Command | Actie |
|---|---|
| `/mission new <title>` | Planning wizard: AI genereert milestones + features |
| `/mission list` | Overzicht alle missions in `~/.pi/missions/` |
| `/mission load <id>` | Laad mission in huidige sessie (cross-session) |
| `/mission status` | Toon voortgang, actieve feature, token budget |
| `/mission next` | Ga naar volgende pending feature |
| `/mission done` | Markeer actieve feature als done, run acceptance checks |
| `/mission block <reden>` | Markeer als geblokkeerd met reden |
| `/mission pause` | Pauzeer mission (state → paused) |
| `/mission resume` | Hervat gepauzeerde mission |
| `/mission clear` | Ontkoppel van sessie (mission blijft op disk) |
| `/mission edit <feature-id>` | Bewerk een feature (title/description/acceptance) |

---

## 3. pi Extension Hooks

```typescript
// ~/.pi/agent/extensions/pi-missions/index.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function piMissions(pi: ExtensionAPI) {
  let activeMission: MissionState | null = null;

  // ── Herstel state bij session start ──────────────────────────────────────
  pi.on("session_start", async (event, ctx) => {
    if (event.reason === "reload") return;

    // Herstel mission state
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && entry.customType === "pi-mission-active") {
        activeMission = await loadMissionFromDisk(entry.data.missionId);
        if (activeMission) {
          updateFooter(ctx, activeMission);
          pi.setSessionName(`🎯 ${activeMission.title}`);  // zichtbaar in /resume picker
        }
      }
    }
  });

  // ── Registreer mission context files voor skill/resource discovery ─────────
  pi.on("resources_discover", async (event, ctx) => {
    // Maak .pi/missions/ directory vindbaar als resource path
    const missionsDir = path.join(os.homedir(), ".pi", "missions");
    if (fs.existsSync(missionsDir)) {
      return { skillPaths: [], promptPaths: [], themePaths: [] }; // toekomstig: mission templates als prompts
    }
  });

  // ── session_before_tree: highlight mission entries in /tree view ───────────
  pi.on("session_before_tree", async (event, ctx) => {
    // Voeg mission info toe aan branch summary zodat /tree navigatie
    // laat zien aan welke feature elke branch gekoppeld is
    if (!activeMission) return;
    return {
      summary: {
        summary: `Mission: ${activeMission.title} — Feature: ${getActiveFeature(activeMission)?.title ?? "none"}`,
        details: { missionId: activeMission.id },
      },
    };
  });

  // ── Injecteer mission context in elke turn ────────────────────────────────
  pi.on("before_agent_start", async (_event, ctx) => {
    if (!activeMission || activeMission.status !== "active") return;
    const feature = getActiveFeature(activeMission);
    return {
      message: {
        customType: "pi-mission-context",
        content: buildContext(activeMission, feature),
        display: false,
      },
    };
  });

  // ── Token budget tracking (delta, niet cumulatief!) ───────────────────────
  pi.on("turn_end", async (_event, ctx) => {
    if (!activeMission) return;
    const usage = ctx.getContextUsage();
    if (usage) {
      // Delta berekening — vermijdt cumulatieve-tokens bug
      const delta = usage.tokens - (activeMission.lastContextTokens ?? 0);
      activeMission.tokensUsed += Math.max(0, delta);
      activeMission.lastContextTokens = usage.tokens;

      if (activeMission.tokensBudget &&
          activeMission.tokensUsed > activeMission.tokensBudget * 0.8) {
        ctx.ui.notify("⚠️ Mission budget 80% gebruikt — overweeg /mission pause", "warning");
        activeMission.status = "budget_limited";
      }
      updateFooter(ctx, activeMission);
    }
  });

  // ── Bewaar mission context bij compaction ─────────────────────────────────
  pi.on("session_before_compact", async (event, ctx) => {
    if (!activeMission) return; // geen actieve mission → laat custom-compaction doen

    const feature = getActiveFeature(activeMission);
    const missionSummary = buildCompactionSummary(activeMission, feature);

    // Voeg mission state toe aan compaction — NIET blokkeren
    // Werkt samen met custom-compaction.ts: beide returnen, laatste wint
    // Oplossing: mission injecteert via custom message VOOR de compaction
    pi.appendEntry("pi-mission-compaction-checkpoint", {
      missionId: activeMission.id,
      summary: missionSummary,
      timestamp: Date.now(),
    });
  });

  // ── Opslaan bij session shutdown ──────────────────────────────────────────
  pi.on("session_shutdown", async (_event, ctx) => {
    if (!activeMission) return;
    activeMission.updatedAt = Date.now();
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (sessionFile) await linkSession(activeMission, sessionFile);
    await saveMission(activeMission);
  });
}
```

---

## 4. Planning Wizard

```typescript
async function handleNew(title: string, ctx: ExtensionCommandContext, pi: ExtensionAPI) {
  await ctx.waitForIdle();

  // Stap 1: verzamel info
  const goal = await ctx.ui.input("Mission doel", `Wat wil je bereiken met: ${title}?`);
  const constraints = await ctx.ui.input("Constraints", "Harde regels? (bijv. 'tests must pass')");

  // Stap 2: laat AI milestones + features genereren
  pi.sendUserMessage([
    `Analyseer dit mission doel en genereer een gestructureerd plan in JSON.`,
    ``,
    `Titel: ${title}`,
    `Doel: ${goal}`,
    `Constraints: ${constraints}`,
    ``,
    `Output een JSON object met deze structuur:`,
    `{ "milestones": [ { "id": "M01", "title": "...", "features": [`,
    `  { "id": "F001", "milestoneId": "M01", "title": "...", "description": "...",`,
    `    "priority": 1, "dependsOn": [], "acceptance": [`,
    `      { "id": "AC001", "description": "...", "checkType": "bash", "checkCommand": "npm test", "verified": false }`,
    `    ], "status": "pending", "sessions": [] }`,
    `  ] } ] }`,
    ``,
    `Output ALLEEN de JSON, geen markdown code blocks.`,
  ].join("\n"), { deliverAs: "followUp" });
}
```

---

## 5. State Persistentie & Cross-session

### Disk opslag (EXDEV-safe)
```typescript
async function saveMission(mission: MissionState): Promise<void> {
  const dir = path.join(os.homedir(), ".pi", "missions", mission.id);
  fs.mkdirSync(dir, { recursive: true });

  const target = path.join(dir, "plan.json");
  const temp = target + ".tmp";          // ZELFDE filesystem, geen EXDEV

  fs.writeFileSync(temp, JSON.stringify(mission, null, 2), "utf-8");
  fs.renameSync(temp, target);           // atomisch op zelfde FS
}
```

### Session-missie koppeling
```typescript
// In session_start: herstel via appendEntry
pi.appendEntry("pi-mission-active", { missionId: mission.id });

// In session_shutdown: link sessie aan mission
async function linkSession(mission: MissionState, sessionFile: string) {
  const link = path.join(
    os.homedir(), ".pi", "missions", mission.id,
    "sessions", path.basename(sessionFile) + ".ref"
  );
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.writeFileSync(link, sessionFile);
}
```

---

## 6. Integratie Bestaande Extensions

### custom-compaction.ts conflict
- **Probleem**: beide luisteren naar `session_before_compact`
- **Oplossing**: pi-missions `appendEntry` checkpoint VOOR compaction, dan doet custom-compaction zijn summary — de appendEntry overleeft de compaction als custom entry

### handoff.ts integratie
- Na `/mission done` op een grote feature: suggereer `/handoff Continue with next mission feature: <title>`
- Handoff genereert gefocust prompt met mission context + volgende feature

### agent-runtime (orchestrator mode v0.3)
```typescript
// Orchestrator spawnt worker via pi.exec() + agent-runtime subagent tool
const result = await pi.exec("pi", [
  "--model", "azure-deepseek/DeepSeek-V4-Flash",
  "-p", buildWorkerPrompt(feature),
  "--no-interactive"
]);
```

### ultra-footer.ts
- pi-missions gebruikt key `"pi-mission"` voor `ctx.ui.setStatus()` — conflicteert niet
- Footer: `🎯 Refactor Auth [3/7 43%] — Implement OAuth`

### moshi-hook.ts / Prometheus metrics
- **REMOVED**: pi-missions is a local, open-source pi extension. No external observability integrations.
- Metrics are shown IN the terminal dashboard (simple numbers, progress bars).
- All tracking is via `history.jsonl` for later offline analysis.

---

## 7. UX & Dashboard Widget — Factory Droid Style

> Inspired by Factory.ai Droid Missions mission control UI.
> The dashboard must show the full mission hierarchy at a glance: milestones → features → progress.

```typescript
function updateFooter(ctx: ExtensionContext, mission: MissionState | null) {
  if (!mission) { ctx.ui.setStatus("pi-mission", ""); return; }

  const p = progress(mission);
  const feat = getActiveFeature(mission);
  const icon = mission.status === "paused" ? "⏸" :
                mission.status === "budget_limited" ? "⚠️" :
                mission.status === "complete" ? "✅" : "🎯";

  ctx.ui.setStatus("pi-mission",
    `${icon} ${mission.title} [${p.done}/${p.total} ${p.pct}%]${feat ? ` — ${feat.title}` : ""}`
  );
}
```

### Mission Control Dashboard (Factory Droid style)

The `/mission dashboard` command renders a rich hierarchical view:

```
🎯 Mission: Refactor Auth Module
   ID: mission-20260506-refactor-auth
   Status: active | Progress: 4/9 (44%) | Tokens: 8,421
────────────────────────────────────────────────────────────────────

📦 M01: Discovery & Planning          [2/3 67%] ⬅ ACTIVE
   ├── ✅ F001 [P1] done        Map current auth flow
   ├── ✅ F002 [P1] done        Document session handling
   └── ➡️  F003 [P1] active     Define acceptance criteria

📦 M02: Implementation                [0/3 0%]
   ├── • F004 [P2] pending      Extract auth service
   ├── • F005 [P2] pending      Add JWT token support
   └── • F006 [P2] pending      Implement refresh flow

📦 M03: Verification                  [0/3 0%]
   ├── • F007 [P3] pending      Run full test suite
   ├── • F008 [P3] pending      Manual smoke tests
   └── • F009 [P3] pending      Update documentation

────────────────────────────────────────────────────────────────────
🔥 Active feature: F003 — Define acceptance criteria
   Check: bash "npm test" (unverified)
   Check: manual "All routes still work" (unverified)
```

### Dashboard rendering rules

- **Milestone level**: show ID, title, progress fraction, icon (✅/➡️/•)
- **Feature level**: show icon, ID, priority, status, title. If blocked, show reason.
- **Active feature**: show full acceptance criteria with check type and verification state
- **Sort features**: active first, then pending (by priority), then blocked, then done
- **Progress bars**: use `████░░░░░░` or `[##----]` style for milestone progress
- **Collapse done milestones**: by default show last 2 done milestones collapsed
- **Colors**: use status-based coloring in widget (done=green, active=yellow, blocked=red)

### Dashboard widget structure

```typescript
function buildDashboardRows(mission: MissionState): string[] {
  const rows: string[] = [];
  const p = progress(mission);

  // Header
  rows.push(
    `${mission.status === "complete" ? "✅" : "🎯"} Mission: ${mission.title}`,
    `ID: ${mission.id}`,
    `Status: ${mission.status} | Progress: ${p.done}/${p.total} (${p.pct}%) | Tokens: ${mission.tokensUsed}`,
    "─".repeat(80),
  );

  for (const milestone of mission.milestones) {
    const mDone = milestone.features.filter(f => f.status === "done").length;
    const mTotal = milestone.features.length;
    const bar = progressBar(mDone, mTotal, 10);
    const mi = milestone.status === "complete" ? "✅" :
               milestone.status === "active" ? "📦" : "•";

    rows.push(`${mi} ${milestone.id}: ${milestone.title} [${bar} ${mDone}/${mTotal}]`);

    const sorted = [...milestone.features].sort((a, b) => {
      const order = { active: 0, pending: 1, blocked: 2, done: 3, failed: 4 };
      return (order[a.status] ?? 5) - (order[b.status] ?? 5) || a.priority - b.priority;
    });

    for (const feature of sorted) {
      const mark = feature.status === "done" ? "✅" :
                   feature.status === "active" ? "➡️" :
                   feature.status === "blocked" ? "⛔" : "•";
      const deps = feature.dependsOn.length ? ` (deps: ${feature.dependsOn.join(", ")})` : "";
      const note = feature.notes ? ` — ${feature.notes.slice(0, 40)}` : "";
      rows.push(`  ${mark} ${feature.id} [P${feature.priority}] ${feature.status.padEnd(8)} ${feature.title}${deps}${note}`);

      // Show acceptance criteria for active feature
      if (feature.status === "active" && feature.acceptance.length) {
        for (const ac of feature.acceptance) {
          const checkMark = ac.verified ? "✅" : ac.waived ? "➖" : "⬜";
          const cmdHint = ac.checkCommand ? ` [${ac.checkType}: \`${ac.checkCommand.slice(0, 40)}\`]` : "";
          rows.push(`       ${checkMark} ${ac.id}: ${ac.description}${cmdHint}`);
        }
      }
    }
  }

  const active = getActiveFeature(mission);
  if (active) {
    rows.push("─".repeat(80));
    rows.push(`🔥 Active: ${active.id} — ${active.title}`);
  }

  return rows;
}

function progressBar(done: number, total: number, width: number): string {
  const filled = Math.round((done / total) * width);
  return "[" + "█".repeat(filled) + "░".repeat(width - filled) + "]";
}
```

```typescript
function updateFooter(ctx: ExtensionContext, mission: MissionState | null) {
  if (!mission) { ctx.ui.setStatus("pi-mission", ""); return; }

  const done  = getAllFeatures(mission).filter(f => f.status === "done").length;
  const total = getAllFeatures(mission).length;
  const pct   = Math.round((done / total) * 100);
  const feat  = getActiveFeature(mission);
  const icon  = mission.status === "paused" ? "⏸" :
                mission.status === "budget_limited" ? "⚠️" : "🎯";

  ctx.ui.setStatus("pi-mission",
    `${icon} ${mission.title} [${done}/${total} ${pct}%]${feat ? ` — ${feat.title}` : ""}`
  );
}
```

### Dashboard Widget
```typescript
pi.registerCommand("mission-dashboard", {
  handler: async (_, ctx) => {
    if (!activeMission) return;
    const rows = buildDashboardRows(activeMission);
    ctx.ui.setWidget("pi-mission-dashboard", rows);
  }
});
```

---

## 8. LLM Tools (pi.registerTool)

Naast `/mission` commands krijgt de LLM eigen tools — zodat de agent zelf mission state kan bijhouden zonder user input:

```typescript
// LLM kan feature als done markeren wanneer het zeker is dat acceptance criteria voldaan zijn
pi.registerTool({
  name: "mission_feature_done",
  label: "Feature Done",
  description: "Mark the active mission feature as done when all acceptance criteria are met",
  promptSnippet: "Mark active mission feature as done with evidence",
  promptGuidelines: [
    "Use mission_feature_done when you have completed all acceptance criteria for the current feature and have evidence (test output, file changes, etc.)",
  ],
  parameters: Type.Object({
    evidence: Type.String({ description: "Bewijs van voltooiing (test output, git diff, etc.)" }),
    notes: Type.Optional(Type.String({ description: "Optionele notities" })),
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    if (!activeMission) return { content: [{ type: "text", text: "Geen actieve mission" }] };
    const feature = getActiveFeature(activeMission);
    if (!feature) return { content: [{ type: "text", text: "Geen actieve feature" }] };

    feature.status = "done";
    feature.completedAt = Date.now();
    feature.notes = params.notes;
    // Sla evidence op
    const evidenceDir = path.join(os.homedir(), ".pi", "missions", activeMission.id, "evidence");
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, `${feature.id}.md`), params.evidence);

    await saveMission(activeMission);
    updateFooter(ctx, activeMission);

    return {
      content: [{ type: "text", text: `✅ Feature '${feature.title}' gemarkeerd als done.` }],
      details: { featureId: feature.id, evidence: params.evidence },
    };
  },
});

// LLM kan next feature activeren
pi.registerTool({
  name: "mission_next_feature",
  label: "Next Feature",
  description: "Advance to next pending feature in the mission",
  parameters: Type.Object({}),
  async execute(toolCallId, _params, _signal, _onUpdate, ctx) {
    if (!activeMission) return { content: [{ type: "text", text: "Geen actieve mission" }] };
    const next = getNextPendingFeature(activeMission);
    if (!next) {
      activeMission.status = "complete";
      await saveMission(activeMission);
      return { content: [{ type: "text", text: "🎉 Alle features voltooid! Mission complete." }] };
    }
    activeMission.activeFeatureId = next.id;
    next.status = "active";
    await saveMission(activeMission);
    updateFooter(ctx, activeMission);
    return {
      content: [{ type: "text", text: `➡️ Volgende feature: ${next.title}\n\n${next.description}` }],
      details: { feature: next },
    };
  },
});
```

---

## 9. Keyboard Shortcuts

```typescript
// Sneltoets voor meest gebruikte mission acties
pi.registerShortcut("ctrl+shift+m", {
  description: "Toggle mission status panel",
  handler: async (ctx) => {
    if (!activeMission) {
      ctx.ui.notify("Geen actieve mission. Gebruik /mission new", "info");
      return;
    }
    const rows = buildDashboardRows(activeMission);
    ctx.ui.setWidget("pi-mission-dashboard", rows);
  },
});

pi.registerShortcut("ctrl+shift+d", {
  description: "Mark current feature done (mission)",
  handler: async (ctx) => {
    if (!activeMission) return;
    const feature = getActiveFeature(activeMission);
    if (!feature) return;
    const ok = await ctx.ui.confirm("Feature done?", `Markeer '${feature.title}' als voltooid?`);
    if (ok) {
      feature.status = "done";
      feature.completedAt = Date.now();
      await saveMission(activeMission);
      updateFooter(ctx, activeMission);
      ctx.ui.notify(`✅ ${feature.title} done!`, "success");
    }
  },
});
```

---

## 10. Completion Detection

De agent_end hook detecteert of de actieve feature waarschijnlijk klaar is:

```typescript
pi.on("agent_end", async (event, ctx) => {
  if (!activeMission || activeMission.status !== "active") return;
  const feature = getActiveFeature(activeMission);
  if (!feature) return;

  // Analyseer de laatste messages op completion-signalen
  const lastMessages = event.messages.slice(-3);
  const combinedText = lastMessages
    .flatMap(m => m.content)
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map(c => c.text.toLowerCase())
    .join(" ");

  const completionSignals = [
    "klaar", "done", "voltooid", "geïmplementeerd",
    "tests slagen", "tests pass", "alle criteria",
  ];
  const hasSignal = completionSignals.some(s => combinedText.includes(s));

  // Check acceptance criteria: run bash checks
  const bashCriteria = feature.acceptance.filter(
    c => c.checkType === "bash" && c.checkCommand && !c.verified
  );

  if (hasSignal || bashCriteria.length > 0) {
    // Verificeer bash criteria automatisch
    for (const criterion of bashCriteria) {
      const result = await pi.exec("bash", ["-c", criterion.checkCommand!], { timeout: 30000 });
      if (result.code === 0) {
        criterion.verified = true;
        criterion.evidence = result.stdout.slice(0, 500);
      }
    }

    const allVerified = feature.acceptance.every(c => c.verified || c.checkType === "manual");

    if (allVerified && hasSignal) {
      ctx.ui.notify(
        `✅ Feature '${feature.title}' lijkt klaar!\nGebruik /mission done of Ctrl+Shift+D om te bevestigen.`,
        "info"
      );
    }
  }
});
```

---

## 11. Context Injectie Strategie (grote missions)

Bij 50+ features wordt de context injectie te groot. Strategie:

```typescript
function buildContext(mission: MissionState, activeFeature: Feature | null): string {
  const allFeatures = getAllFeatures(mission);
  const done   = allFeatures.filter(f => f.status === "done").length;
  const total  = allFeatures.length;

  // Altijd inject: mission goal + active feature details
  let ctx = [
    `## Actieve Mission: ${mission.title}`,
    `Doel: ${mission.goal}`,
    `Voortgang: ${done}/${total} features voltooid`,
    `Status: ${mission.status}`,
  ].join("\n");

  if (activeFeature) {
    ctx += `\n\n### Huidige Feature: ${activeFeature.title}\n${activeFeature.description}`;
    ctx += `\n\nAcceptance criteria:\n${activeFeature.acceptance.map(a => `- [ ] ${a.description}`).join("\n")}`;
    if (activeFeature.dependsOn.length) {
      ctx += `\n\nBlokkerende features: ${activeFeature.dependsOn.join(", ")}`;
    }
  }

  // Conditioneel: toon max 5 recente done features voor context
  const recentDone = allFeatures
    .filter(f => f.status === "done")
    .slice(-5);
  if (recentDone.length) {
    ctx += `\n\n### Recent voltooid:\n${recentDone.map(f => `- ✅ ${f.title}`).join("\n")}`;
  }

  // Nooit: toon ALLE pending features (te groot)
  const pendingCount = allFeatures.filter(f => f.status === "pending").length;
  if (pendingCount > 0) {
    ctx += `\n\n(${pendingCount} features nog te doen — gebruik /mission status voor volledig overzicht)`;
  }

  return ctx;
}
```

---

## 12. Error Recovery & Resilience

```typescript
// Backup voor plan.json write
async function saveMissionSafe(mission: MissionState): Promise<void> {
  const dir = missionDir(mission.id);
  const target = path.join(dir, "plan.json");
  const backup = path.join(dir, "plan.json.bak");
  const temp   = path.join(dir, "plan.json.tmp");  // zelfde FS, geen EXDEV

  // Backup huidige state
  if (fs.existsSync(target)) fs.copyFileSync(target, backup);

  try {
    fs.writeFileSync(temp, JSON.stringify(mission, null, 2), "utf-8");
    fs.renameSync(temp, target);  // atomisch op zelfde FS
  } catch (err) {
    // Herstel backup als write faalt
    if (fs.existsSync(backup)) fs.copyFileSync(backup, target);
    throw err;
  }
}

// Load met fallback naar backup
function loadMissionFromDisk(id: string): MissionState | null {
  const dir = missionDir(id);
  for (const file of ["plan.json", "plan.json.bak"]) {
    try {
      const data = fs.readFileSync(path.join(dir, file), "utf-8");
      return JSON.parse(data) as MissionState;
    } catch { continue; }
  }
  return null;
}
```

---

## 13. Multi-Mission & Session Tree Integratie

### /mission fork — alternatieve aanpak

```typescript
// In commands switch-case
case "fork": return handleFork(rest.join(" "), ctx, pi, activeMission);

async function handleFork(reason: string, ctx: ExtensionCommandContext, pi: ExtensionAPI, mission: MissionState | null) {
  if (!mission?.activeFeatureId) { ctx.ui.notify("Geen actieve feature", "error"); return; }
  const feature = getActiveFeature(mission)!;
  const newApproach = await ctx.ui.input("Alternatieve aanpak", `Fork van '${feature.title}': beschrijf nieuwe strategie`);
  if (!newApproach) return;

  // Fork huidige pi sessie — bewaar context, nieuwe branch
  await ctx.fork(ctx.sessionManager.getLeafId(), {
    withSession: async (forkCtx) => {
      // Markeer active feature als blocked in original, nieuwe poging in fork
      const forkedFeature: Feature = {
        ...feature,
        id: `${feature.id}-fork-${Date.now()}`,
        title: `${feature.title} [Fork: ${newApproach.slice(0, 30)}]`,
        status: "active",
        notes: `Fork van ${feature.id}: ${reason}`,
      };
      const milestone = getMilestoneById(mission, feature.milestoneId)!;
      milestone.features.push(forkedFeature);
      mission.activeFeatureId = forkedFeature.id;
      await saveMission(mission);
      forkCtx.ui.notify(`🌿 Fork aangemaakt: ${forkedFeature.title}`, "info");
    },
  });
}
```

### pi.setLabel() voor /tree navigatie

```typescript
// In turn_end: label elke entry met actieve feature naam
pi.on("turn_end", async (_event, ctx) => {
  if (!activeMission) return;
  const feature = getActiveFeature(activeMission);
  if (feature) {
    const leafId = ctx.sessionManager.getLeafId();
    if (leafId) pi.setLabel(leafId, `🎯 ${feature.title}`);
  }
  // ... rest van turn_end (token tracking, footer update)
});
```

### Multi-mission switching

```typescript
// /mission list toont alle missions met switch optie
async function handleList(ctx: ExtensionCommandContext) {
  const dir = path.join(os.homedir(), ".pi", "missions");
  if (!fs.existsSync(dir)) { ctx.ui.notify("Geen missions gevonden", "info"); return; }

  const missions = fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => loadMissionFromDisk(e.name))
    .filter((m): m is MissionState => m !== null);

  if (!missions.length) { ctx.ui.notify("Geen missions", "info"); return; }

  const items = missions.map(m => {
    const all = getAllFeatures(m);
    const done = all.filter(f => f.status === "done").length;
    return { value: m.id, label: `${m.title} [${done}/${all.length}] — ${m.status}` };
  });

  const choice = await ctx.ui.select("Mission laden:", items.map(i => i.label));
  if (choice) {
    const mission = missions.find(m => m.title === choice?.split(" [")[0]);
    if (mission) await handleLoad(mission.id, ctx, pi);
  }
}
```

### RPC Mode (ctx.hasUI check)

```typescript
// Alle interactieve calls moeten ctx.hasUI checken
async function handleNew(title: string, ctx: ExtensionCommandContext, pi: ExtensionAPI) {
  if (!ctx.hasUI) {
    // Non-interactief: gebruik title als goal, sla wizard over
    ctx.ui.notify(`[pi-missions] Non-interactive mode: scaffold mission '${title}' zonder wizard`, "info");
    await scaffoldMission(title, title, "", ctx, pi);
    return;
  }
  // Interactieve wizard flow...
  const goal = await ctx.ui.input("Mission doel", `Wat wil je bereiken?`);
  // ...
}
```

### Auto-save timer

```typescript
// Sla state op elke 2 minuten als mission actief is (niet alleen op shutdown)
let autoSaveInterval: NodeJS.Timer | null = null;

pi.on("session_start", async (event, ctx) => {
  // ... bestaande restore code ...
  autoSaveInterval = setInterval(async () => {
    if (activeMission && activeMission.status === "active") {
      activeMission.updatedAt = Date.now();
      await saveMissionSafe(activeMission).catch(console.error);
    }
  }, 2 * 60 * 1000); // elke 2 minuten
});

pi.on("session_shutdown", async (_event, ctx) => {
  if (autoSaveInterval) { clearInterval(autoSaveInterval); autoSaveInterval = null; }
  // ... finale save ...
});
```

---

## 14. File Structuur & Imports

```
~/.pi/agent/extensions/pi-missions/
  index.ts          # export default piMissions(pi), registreer hooks + commands
  commands.ts       # alle /mission subcommand handlers
  state.ts          # types + loadMission/saveMissionSafe/getAllFeatures etc.
  context.ts        # buildContext(), buildCompactionSummary()
  ui.ts             # updateFooter(), buildDashboardRows()
  tools.ts          # registerTool: mission_feature_done, mission_next_feature
  package.json      # geen dependencies (pure Node built-ins)
```

**Verplichte imports in index.ts:**
```typescript
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { MissionState, Feature, Milestone } from "./state.js";
import { loadMissionFromDisk, saveMissionSafe, getAllFeatures, getActiveFeature, getNextPendingFeature } from "./state.js";
import { buildContext, buildCompactionSummary } from "./context.js";
import { updateFooter, buildDashboardRows } from "./ui.js";
import { registerMissionTools } from "./tools.js";
```

---

## 15. Implementatie Fasen

### v0.1 — MVP
- [x] `state.ts`: MissionState + Feature + Milestone types + EXDEV-safe disk I/O
- [x] `commands.ts`: `/mission new` + all 16 commands
- [x] `/mission status` + footer (`ctx.ui.setStatus("pi-mission", ...)`)
- [x] `/mission done` + `/mission next` + disk write
- [x] `/mission load <id>` cross-session via appendEntry
- [x] `session_start` restore, `session_shutdown` save
- [x] `pi.setSessionName()` op mission title

### v0.2 — Smart continuation ✅ ALLEEN TBD ITEMS
- [x] `before_agent_start`: context injectie met truncatie strategie
- [x] Token budget: delta tracking via `lastContextTokens`
- [x] `turn_end`: footer update + 80% budget warning → status=budget_limited
- [x] `agent_end`: completion detection + bash acceptance checks
- [x] `mission_feature_done` + `mission_next_feature` LLM tools
- [x] Ctrl+Shift+M / Ctrl+Shift+D shortcuts

### v0.3 — Dashboard & Planning Wizard ✅ COMPLETE
- [x] **Factory Droid Dashboard**: milestone progress bars, feature hierarchy, acceptance criteria inline, active feature detail block
- [x] **Planning Wizard AI-generatie**: `/mission new` → AI generates milestones + features via `pi.sendUserMessage()` + JSON parse
- [x] **Milestone auto-complete**: when all features in a milestone are done, set milestone.status = "complete"
- [x] **More templates**: expand MISSION_TEMPLATES from 3 to 9 (refactor, fix-bug, add-feature, docs, investigate, auth, ci-cd, security-audit, performance-opt)

### v0.4 — Orchestrator & Polish ✅ COMPLETE
- [x] `dependsOn` blokkering visualisatie in dashboard
- [x] `session_before_compact` checkpoint met mission summary
- [x] `/handoff` suggestie na grote features
- [x] `agent-runtime` worker spawning via `child_process.spawn` (3 tools + 3 commands)
- [x] `/mission edit <feature-id>` met `ctx.ui.editor()`
- [x] History replay: `/mission history [feature_id|event|search]` met table output + jq hints
- [x] `pi.setLabel(entryId, featureTitle)` voor /tree navigatie
- [x] Project-local `.pi/extensions/pi-missions/` support
- [x] Mission schema migration UI: `/mission migrate` met preview, backup, en confirm flow
- [x] Legacy shim cleanup: 19 flat `src/*.ts` files deleted; modular subdirectories

---

## 16. Testing & Verification Plan

De extensie krijgt een expliciet testplan zodat implementatie regressies zichtbaar zijn vóór installatie.

### Static checks

```bash
cd ~/.pi/agent/extensions/pi-missions
npm run check       # tsc --noEmit
npm run test        # vitest unit tests
pi --extension ./index.ts --help >/dev/null  # smoke-test jiti load
```

### Unit tests (vitest)

```typescript
// tests/state.test.ts
import { describe, it, expect } from "vitest";
import { getNextPendingFeature, saveMissionSafe, loadMissionFromDisk } from "../state.js";

describe("mission state", () => {
  it("skips features with unresolved dependsOn", () => {
    const mission = fixtureMission({
      features: [
        { id: "F1", status: "pending", dependsOn: ["F0"] },
        { id: "F0", status: "done", dependsOn: [] },
      ],
    });
    expect(getNextPendingFeature(mission)?.id).toBe("F1");
  });

  it("roundtrips EXDEV-safe save/load", async () => {
    const mission = fixtureMission();
    await saveMissionSafe(mission);
    expect(loadMissionFromDisk(mission.id)?.id).toBe(mission.id);
  });
});
```

### Integration tests met pi

```bash
# 1. Extension laadt zonder errors
pi -e ~/.pi/agent/extensions/pi-missions/index.ts -p "/mission status"

# 2. New mission scaffold
pi -e ~/.pi/agent/extensions/pi-missions/index.ts -p "/mission new test mission"
test -d ~/.pi/missions

# 3. State restore over sessies
pi -p "/mission load <id>"
pi -p "/mission status" | grep "test mission"
```

### Manual verification checklist

| Scenario | Verwachting |
|---|---|
| `/mission new` in TUI | Wizard vraagt goal/constraints, genereert milestones |
| `/mission status` | Footer toont `🎯 title [done/total %]` |
| `/mission done` | Acceptance checks draaien, evidence wordt opgeslagen |
| `/mission pause/resume` | Status wisselt zonder state loss |
| `/mission fork` | Nieuwe sessie/branch met alternatieve aanpak |
| `/compact` tijdens mission | Mission summary blijft in context |
| `/handoff` na grote feature | Nieuwe sessie krijgt mission + active feature context |
| `/tree` | Entries hebben `pi.setLabel()` labels met feature titel |
| Non-interactive `pi -p` | Geen blocking dialogs; `ctx.hasUI` fallback werkt |

### Regression tests voor bekende pitfalls

- **EXDEV**: temp files nooit in `/tmp`; write gebeurt naast target.
- **Token budget bug**: `tokensUsed` gebruikt delta via `lastContextTokens`, niet cumulatieve context.
- **Reload lifecycle**: `session_start` met `reason === "reload"` overschrijft geen actieve in-memory state.
- **sendUserMessage**: tijdens streaming altijd `deliverAs: "followUp"` of `"steer"` gebruiken.
- **session replacement**: in `ctx.fork(..., { withSession })` alleen de nieuwe `forkCtx` gebruiken, geen stale oude ctx.

### Definition of Done voor v0.1

```bash
npm run check
npm run test
pi -e ./index.ts -p "/mission status"
pi -e ./index.ts -p "/mission new smoke-test"
pi -e ./index.ts -p "/mission pause"
pi -e ./index.ts -p "/mission resume"
```

Een release is pas klaar als alle bovenstaande commands slagen en er minimaal één echte mission succesvol door `new → next → done → complete` loopt.

---

## 17. Security & Threat Model

Missions draaien langdurig en kunnen tools blijven aanroepen; daarom is een expliciet threat model verplicht.

### Threat scenarios

| Threat | Risico | Mitigatie |
|---|---|---|
| Prompt injection via `mission.goal` of repo-bestanden | Agent negeert mission boundaries | Mission context altijd als data labelen, nooit als system override |
| Path traversal in mission id (`../../etc/passwd`) | Schrijven buiten `~/.pi/missions` | `sanitizeMissionId()` + `path.resolve()` boundary check |
| Tool abuse tijdens planning | Planning-agent voert code uit | Tool whitelist per phase: planning=read-only, execution=write/edit/bash |
| Budget exhaustion DoS | Oneindige tool loop | `maxToolCallsPerFeature`, `tokensBudget`, `maxWallClockMs` |
| Evidence spoofing | Feature als done zonder bewijs | Acceptance checks slaan raw command output op in `evidence/` |

### Tool whitelist per phase

```typescript
interface ToolPolicy {
  phase: "planning" | "execution" | "verification";
  allowedTools: string[];
  maxToolCalls: number;
}

const TOOL_POLICIES: Record<ToolPolicy["phase"], ToolPolicy> = {
  planning:     { phase: "planning",     allowedTools: ["read", "grep", "find"], maxToolCalls: 30 },
  execution:    { phase: "execution",    allowedTools: ["read", "edit", "write", "bash"], maxToolCalls: 120 },
  verification: { phase: "verification", allowedTools: ["read", "bash"], maxToolCalls: 60 },
};

pi.on("tool_call", async (event, ctx) => {
  if (!activeMission) return;
  const phase = getMissionPhase(activeMission);
  const policy = TOOL_POLICIES[phase];
  if (!policy.allowedTools.includes(event.toolName)) {
    return { block: true, reason: `Tool ${event.toolName} niet toegestaan in ${phase}` };
  }
});
```

### Path boundary check

```typescript
function missionDirSafe(id: string): string {
  const root = path.join(os.homedir(), ".pi", "missions");
  const safeId = id.replace(/[^a-zA-Z0-9._-]/g, "-");
  const resolved = path.resolve(root, safeId);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) {
    throw new Error("Invalid mission id: path traversal detected");
  }
  return resolved;
}
```

---

## 18. Schema Migration & Upgrade Path

Mission state krijgt een expliciete `schemaVersion`, zodat updates veilig zijn.

```typescript
export const CURRENT_SCHEMA_VERSION = 2;

export interface MissionStateV2 extends MissionState {
  schemaVersion: 2;
}

export function migrateMission(raw: unknown): MissionStateV2 {
  const any = raw as any;
  const version = any.schemaVersion ?? 1;
  if (version === 2) return any as MissionStateV2;
  if (version === 1) return migrate_v1_to_v2(any);
  throw new Error(`Unsupported mission schemaVersion: ${version}`);
}

export function migrate_v1_to_v2(v1: any): MissionStateV2 {
  return {
    ...v1,
    schemaVersion: 2,
    milestones: v1.milestones ?? [{
      id: "M01",
      title: "Default",
      description: "Migrated flat feature list",
      status: "active",
      features: v1.features ?? [],
    }],
    lastContextTokens: v1.lastContextTokens ?? 0,
    tokensUsed: v1.tokensUsed ?? 0,
  };
}
```

### Backward compatibility policy

- Minor releases mogen optionele fields toevoegen.
- Major schema bump vereist migratiefunctie + backup `plan.json.pre-migration.bak`.
- Onbekende `schemaVersion` → hard fail, geen silent corruption.

---

## 19. Extension Packaging & Distribution

### package.json skeleton

```json
{
  "name": "@devctx/pi-missions",
  "version": "0.1.0",
  "description": "Long-running missions for pi coding agent",
  "type": "module",
  "exports": { ".": "./dist/index.js" },
  "main": "./dist/index.js",
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "check": "tsc --noEmit",
    "test": "vitest run"
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": ">=0.73.0"
  },
  "dependencies": {
    "typebox": "latest"
  },
  "pi": {
    "extensions": ["./dist/index.js"]
  }
}
```

### Install flows

```bash
# Local development
pi -e ./src/index.ts

# Project-local install
mkdir -p .pi/extensions/pi-missions
cp -r dist/* .pi/extensions/pi-missions/

# Package install
pi install ./pi-missions
pi install npm:@devctx/pi-missions@0.1.0

# Hot reload after edits
/reload
```

### Semver policy

- `patch`: bug fixes, no command/schema changes
- `minor`: new commands/tools, backward-compatible schema additions
- `major`: breaking schema migration or command rename

---

## 20. Acceptance Examples & Walkthroughs

### Happy path

```text
> /mission new Refactor auth module
? Mission doel: Refactor auth zonder behavior changes
? Constraints: npm test moet slagen
✅ Mission created: mission-20260506-auth
🎯 Refactor auth [0/3 0%] — Map current auth flow

> /mission next
➡️ Feature F001 active: Map current auth flow

> implementatie gebeurt...
✅ Acceptance AC001 passed: npm test

> /mission done
✅ F001 done. Evidence saved: evidence/F001.md
🎯 Refactor auth [1/3 33%] — Extract auth service

> /mission next
➡️ Feature F002 active: Extract auth service
```

### Pause + handoff + resume

```text
> /mission pause
⏸ Mission paused. State saved to ~/.pi/missions/mission-.../plan.json

> /handoff Continue mission Refactor auth from active feature F002
✅ Handoff prompt generated in new session

> /mission load mission-20260506-auth
🎯 Refactor auth [1/3 33%] — Extract auth service
```

### Failure walkthrough

```text
> /mission done
❌ AC002 failed: npm test exited 1
Evidence saved: evidence/F002_AC002_fail.log
Feature remains active.
Suggestion: /mission fork "try smaller extraction"

> /mission fork try smaller extraction
🌿 Fork created: F002-fork-1778020000
```

Mission is done when all milestones are `complete`, all acceptance criteria are verified or explicitly waived, and final `/mission status` shows `100%`.

---

## 21. Metrics & Debug Interface (Terminal-first)

> All observability is terminal-native. No external integrations.

### Simple metrics in dashboard

The `/mission dashboard` shows key numbers directly:
- `Progress: 4/9 (44%)` — overall feature completion
- `Tokens: 8,421` — token usage this session
- `[████████░░]` — per-milestone progress bar
- `M01 [2/3 67%]` — per-milestone completion fraction

### Structured log format

Elke belangrijke gebeurtenis gaat naar `history.jsonl`:

```json
{"ts":1778020000,"missionId":"mission-abc","event":"feature_done","featureId":"F001","duration_ms":12345,"tokensUsed":9021}
{"ts":1778021000,"missionId":"mission-abc","event":"milestone_complete","milestoneId":"M01"}
{"ts":1778022000,"missionId":"mission-abc","event":"mission_complete"}
```

### /mission debug

```typescript
case "debug": return handleDebug(rest[0], ctx, activeMission);

async function handleDebug(id: string | undefined, ctx: ExtensionCommandContext, mission: MissionState | null) {
  const m = id ? loadMissionFromDisk(id) : mission;
  if (!m) { ctx.ui.notify("Geen mission voor debug", "error"); return; }
  const history = readHistory(m.id).slice(-20);
  ctx.ui.setWidget("pi-mission-debug", [
    `Mission: ${m.title}`,
    `Status: ${m.status}`,
    `Active: ${m.activeFeatureId ?? "none"}`,
    "─".repeat(80),
    ...history.map(h => `${new Date(h.ts * 1000).toISOString()} ${h.event} ${h.featureId ?? ""}`),
  ]);
}
```

### Offline trace replay (bash)

```bash
# Event summary
jq -r '.event + " " + (.featureId // "")' ~/.pi/missions/<id>/history.jsonl

# Feature durations
jq -s 'group_by(.featureId) | map({featureId: .[0].featureId, count: length, first: .[0].ts, last: .[-1].ts})' ~/.pi/missions/<id>/history.jsonl

# Mission health
jq -s '[.[] | select(.event == "feature_done") | .featureId] | unique | length' ~/.pi/missions/<id>/history.jsonl
```

### Structured log format

Elke belangrijke gebeurtenis gaat naar `history.jsonl`:

```json
{"ts":1778020000,"missionId":"mission-abc","event":"feature_done","featureId":"F001","duration_ms":12345,"tokensUsed":9021}
```

### /mission debug

```typescript
case "debug": return handleDebug(rest[0], ctx, activeMission);

async function handleDebug(id: string | undefined, ctx: ExtensionCommandContext, mission: MissionState | null) {
  const m = id ? loadMissionFromDisk(id) : mission;
  if (!m) { ctx.ui.notify("Geen mission voor debug", "error"); return; }
  const history = readHistory(m.id).slice(-20);
  ctx.ui.setWidget("pi-mission-debug", [
    `Mission: ${m.title}`,
    `Status: ${m.status}`,
    `Active: ${m.activeFeatureId ?? "none"}`,
    "─".repeat(60),
    ...history.map(h => `${new Date(h.ts * 1000).toISOString()} ${h.event} ${h.featureId ?? ""}`),
  ]);
}
```

### Trace replay

```bash
jq -r '.event + " " + (.featureId // "")' ~/.pi/missions/<id>/history.jsonl
```

### Metrics

- `missions.created`
- `missions.completed`
- `missions.failed`
- `features.completed`
- `features.avg_duration_ms`
- `acceptance.failures`
- `tokens.used_per_feature`

All metrics are terminal-native only. No external observability integrations.
