import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsAsync from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { CURRENT_SCHEMA_VERSION, DEFAULT_AUTOPILOT, DEFAULT_FEATURE_MAX_TOOL_CALLS, DEFAULT_FEATURE_MAX_WALL_CLOCK_MS, STALE_FEATURE_WARN_CLOCK_MS, type Feature, type Milestone, type MissionHistoryEntry, type MissionMetrics, type MissionMetricsSummary, type MissionState, type ToolPhase } from "./types.js";
import { withLock } from "./lock.js";
import { logger } from "./logger.js";
import { createFeedback, formatError } from "./feedback.js";

export function createValidationToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function missionsRoot(): string {
  return path.join(os.homedir(), ".pi", "missions");
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "mission";
}

export function createMissionId(title: string, now = Date.now()): string {
  const date = new Date(now).toISOString().replace(/[-:T.Z]/g, "");
  const stamp = date.slice(0, 17);
  const slug = slugify(title);
  return `pim:${stamp}:${slug}`;  // pim = pi-missions namespace
}

export function isValidMissionId(id: string): boolean {
  return id.startsWith("pim:") && id.split(":").length === 3;
}

export function missionDirSafe(id: string): string {
  const root = path.resolve(missionsRoot());
  const safeId = id.replace(/[^a-zA-Z0-9._-]/g, "-");
  const resolved = path.resolve(root, safeId);
  if (!resolved.startsWith(root + path.sep)) {
    logger.error("state", "Path traversal detected in mission ID", undefined, { missionId: id });
    throw new Error("Invalid mission id: path traversal detected");
  }
  return resolved;
}

export function getAllFeatures(mission: MissionState): Feature[] {
  return mission.milestones.flatMap((m) => m.features);
}

export function getMilestoneById(mission: MissionState, id: string): Milestone | undefined {
  return mission.milestones.find((m) => m.id === id);
}

export function getFeatureById(mission: MissionState, id: string): Feature | undefined {
  return getAllFeatures(mission).find((f) => f.id === id);
}

export function getActiveFeature(mission: MissionState): Feature | null {
  return mission.activeFeatureId ? getFeatureById(mission, mission.activeFeatureId) ?? null : null;
}

export function dependenciesDone(mission: MissionState, feature: Feature): boolean {
  return feature.dependsOn.every((id) => getFeatureById(mission, id)?.status === "done");
}

export function getNextPendingFeature(mission: MissionState): Feature | null {
  return getAllFeatures(mission)
    .filter((f) => (f.status === "pending" || f.status === "waiting") && dependenciesDone(mission, f))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))[0] ?? null;
}

export function progress(mission: MissionState): { done: number; total: number; pct: number } {
  const all = getAllFeatures(mission);
  const done = all.filter((f) => f.status === "done").length;
  const total = all.length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function createMission(title: string, goal: string, constraints = ""): MissionState {
  const id = createMissionId(title);
  const now = Date.now();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id,
    title,
    goal,
    status: "active",
    activeMilestoneId: "M01",
    activeFeatureId: "F001",
    tokensUsed: 0,
    lastContextTokens: 0,
    validationToken: createValidationToken(),
    autopilot: { ...DEFAULT_AUTOPILOT, startedAt: new Date(now).toISOString() },
    createdAt: now,
    updatedAt: now,
    milestones: [
      {
        id: "M01",
        title: "Plan and execute",
        description: constraints ? `Constraints: ${constraints}` : "Initial mission execution milestone",
        status: "active",
        features: [
          {
            id: "F001",
            milestoneId: "M01",
            title: "Clarify scope and current state",
            description: "Read the repository, identify relevant files, constraints, and existing behavior.",
            priority: 1,
            dependsOn: [],
            status: "active",
            sessions: [],
            toolCallCount: 0,
            startedAt: now,
            acceptance: [{ id: "AC001", description: "Relevant files and constraints documented", checkType: "manual", verified: false }],
          },
          {
            id: "F002",
            milestoneId: "M01",
            title: "Implement the core change",
            description: "Make the smallest coherent implementation that satisfies the mission goal.",
            priority: 2,
            dependsOn: ["F001"],
            status: "pending",
            sessions: [],
            toolCallCount: 0,
            acceptance: [{ id: "AC001", description: "Implementation matches mission goal", checkType: "manual", verified: false }],
          },
          {
            id: "F003",
            milestoneId: "M01",
            title: "Verify and summarize",
            description: "Run relevant checks, capture evidence, and summarize results.",
            priority: 3,
            dependsOn: ["F002"],
            status: "pending",
            sessions: [],
            toolCallCount: 0,
            acceptance: [{ id: "AC001", description: "Verification evidence saved", checkType: "manual", verified: false }],
          },
        ],
      },
    ],
  };
}

export function migrateMission(raw: unknown): MissionState {
  const value = raw as Partial<MissionState> & { features?: Feature[]; schemaVersion?: number };
  const version = value.schemaVersion ?? 1;
  if (version === CURRENT_SCHEMA_VERSION) {
    return { ...(value as MissionState), autopilot: { ...DEFAULT_AUTOPILOT, ...(value as MissionState).autopilot } };
  }
  if (version === 1 || version === 2) {
    const v1Features = (value.features ?? []).map((f: any) => ({ ...f, toolCallCount: f.toolCallCount ?? 0 }));
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: String(value.id ?? createMissionId(String(value.title ?? "mission"))),
      title: String(value.title ?? "Untitled mission"),
      goal: String(value.goal ?? ""),
      status: value.status ?? "active",
      activeFeatureId: value.activeFeatureId,
      activeMilestoneId: value.activeMilestoneId ?? "M01",
      tokensBudget: value.tokensBudget,
      tokensUsed: value.tokensUsed ?? 0,
      lastContextTokens: value.lastContextTokens ?? 0,
      validationToken: (value as MissionState).validationToken || createValidationToken(),
      autopilot: { ...DEFAULT_AUTOPILOT, ...(value as MissionState).autopilot, startedAt: (value as MissionState).autopilot?.startedAt ?? new Date(value.createdAt ?? Date.now()).toISOString() },
      userPreferences: (value as MissionState).userPreferences,
      createdAt: value.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      milestones: value.milestones ?? [{ id: "M01", title: "Migrated", description: "Migrated flat feature list", status: "active", features: v1Features }],
    };
  }
  logger.error("state", "Unsupported mission schema version", undefined, { version });
  throw new Error(`Unsupported mission schemaVersion: ${version}`);
}

export async function saveMissionSafe(mission: MissionState): Promise<void> {
  const dir = missionDirSafe(mission.id);
  const target = path.join(dir, "plan.json");
  
  await withLock(target, async () => {
    await fsAsync.mkdir(dir, { recursive: true });
    await fsAsync.mkdir(path.join(dir, "evidence"), { recursive: true });
    await fsAsync.mkdir(path.join(dir, "sessions"), { recursive: true });
    
    const backup = path.join(dir, "plan.json.bak");
    const preMigration = path.join(dir, "plan.json.pre-migration.bak");
    const temp = path.join(dir, "plan.json.tmp");
    
    if (fs.existsSync(target)) {
      await fsAsync.copyFile(target, backup);
      if (!fs.existsSync(preMigration)) await fsAsync.copyFile(target, preMigration);
    }
    
    try {
      mission.updatedAt = Date.now();
      await fsAsync.writeFile(temp, JSON.stringify(mission, null, 2), "utf-8");
      await fsAsync.rename(temp, target);
    } catch (error) {
      logger.error("state", "Failed to save mission, restoring from backup", error as Error, { missionId: mission.id });
      if (fs.existsSync(backup)) await fsAsync.copyFile(backup, target);
      throw error;
    }
  });
}

export function loadMissionFromDisk(id: string): MissionState | null {
  const dir = missionDirSafe(id);
  for (const name of ["plan.json", "plan.json.bak"]) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8"));
      logger.debug("state", `Loaded mission from ${name}`, { missionId: id, source: name });
      return migrateMission(raw);
    } catch (error) {
      // Try next fallback.
      logger.debug("state", `Failed to load ${name}, trying next fallback`, { missionId: id, fileName: name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  logger.warn("state", "Failed to load mission from disk", { missionId: id });
  return null;
}

export function listMissions(): MissionState[] {
  const root = missionsRoot();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => loadMissionFromDisk(e.name))
    .filter((m): m is MissionState => Boolean(m))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Calculate summary metrics across all missions.
 */
export function calculateMetricsSummary(): MissionMetricsSummary {
  const missions = listMissions();
  const metrics = missions.map(computeMissionMetrics);
  
  if (metrics.length === 0) {
    return {
      totalMissions: 0,
      completedMissions: 0,
      successRate: 0,
      averageTokensPerMission: 0,
      averageFeaturesPerMission: 0,
      averageCompletionTimeMs: 0,
    };
  }
  
  const completedMissions = metrics.filter((m) => m.completed !== undefined);
  const totalTokens = metrics.reduce((sum, m) => sum + m.totalTokensUsed, 0);
  const totalFeatures = metrics.reduce((sum, m) => sum + m.totalFeatures, 0);
  const totalCompletionTime = completedMissions.reduce((sum, m) => {
    if (m.completed) {
      return sum + (m.completed - m.created);
    }
    return sum;
  }, 0);
  
  return {
    totalMissions: metrics.length,
    completedMissions: completedMissions.length,
    successRate: completedMissions.length / metrics.length,
    averageTokensPerMission: totalTokens / metrics.length,
    averageFeaturesPerMission: totalFeatures / metrics.length,
    averageCompletionTimeMs: completedMissions.length > 0 
      ? totalCompletionTime / completedMissions.length 
      : 0,
  };
}

export function appendHistory(mission: MissionState, entry: Omit<MissionHistoryEntry, "ts" | "missionId">): void {
  const dir = missionDirSafe(mission.id);
  fs.mkdirSync(dir, { recursive: true });
  const line: MissionHistoryEntry = { ts: Math.floor(Date.now() / 1000), missionId: mission.id, ...entry };
  fs.appendFileSync(path.join(dir, "history.jsonl"), JSON.stringify(line) + "\n", "utf-8");
}

export function readHistory(id: string): MissionHistoryEntry[] {
  const file = path.join(missionDirSafe(id), "history.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf-8").split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as MissionHistoryEntry]; } catch (error) {
      logger.debug("state", "Failed to parse history entry", { missionId: id, line, error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  });
}

export function saveEvidence(mission: MissionState, feature: Feature, text: string): string {
  const dir = path.join(missionDirSafe(mission.id), "evidence");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${feature.id}.md`);
  fs.writeFileSync(file, text, "utf-8");
  return file;
}

export function linkSession(mission: MissionState, sessionFile: string): void {
  const dir = path.join(missionDirSafe(mission.id), "sessions");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${path.basename(sessionFile)}.ref`), sessionFile, "utf-8");
}

// ---------------------------------------------------------------------------
// DependsOn auto-blocking
// ---------------------------------------------------------------------------

/** Mark features as blocked when their dependencies are not all done. */
export function autoBlockBlockedFeatures(mission: MissionState): number {
  let waiting = 0;
  for (const f of getAllFeatures(mission)) {
    if (f.status === "blocked" || f.status === "done" || f.status === "failed") continue;
    if (f.dependsOn.length && !dependenciesDone(mission, f)) {
      f.status = "waiting";
      f.notes = `Waiting on ${f.dependsOn.filter((id) => getFeatureById(mission, id)?.status !== "done").join(", ")}`;
      waiting++;
    } else if (f.status === "waiting") {
      f.status = "pending";
      f.notes = undefined;
    }
  }
  return waiting;
}

// ---------------------------------------------------------------------------
// Mission phase detection
// ---------------------------------------------------------------------------

export function getMissionPhase(mission: MissionState): ToolPhase {
  if (mission.status === "planning") return "planning";
  const active = getActiveFeature(mission);
  if (!active) return "execution";
  const t = `${active.title} ${active.description}`.toLowerCase();
  if (t.includes("verify") || t.includes("test") || t.includes("summarize")) return "verification";
  if (
    t.includes("clarify") ||
    t.includes("plan") ||
    t.includes("scope") ||
    t.includes("research") ||
    t.includes("analyze") ||
    t.includes("analyse") ||
    t.includes("inspect") ||
    t.includes("investigate") ||
    t.includes("discover") ||
    t.includes("reconnaissance") ||
    t.includes("current state")
  ) {
    return "planning";
  }
  return "execution";
}

// ---------------------------------------------------------------------------
// Orchestrator worker prompt builder
// ---------------------------------------------------------------------------

export function buildWorkerPrompt(mission: MissionState, feature: Feature): string {
  const p = progress(mission);
  return [
    `## Mission: ${mission.title}`,
    `Goal: ${mission.goal}`,
    `Progress: ${p.done}/${p.total} features (${p.pct}%)`,
    "",
    `## Feature: ${feature.id} — ${feature.title}`,
    feature.description,
    "",
    "### Acceptance Criteria",
    ...feature.acceptance.map((ac) => `- [ ] ${ac.id}: ${ac.description}${ac.checkCommand ? `\n  Command: \`${ac.checkCommand}\`` : ""}`),
    feature.dependsOn.length ? `\n### Dependencies\n${feature.dependsOn.join(", ")}` : "",
    "",
    "### Instructions",
    "1. Read the feature description and acceptance criteria carefully.",
    "2. Explore relevant code and understand the current state.",
    "3. Implement the smallest change that satisfies all acceptance criteria.",
    "4. Run checks to verify completion.",
    "5. Report completion with evidence — do NOT call mission_feature_done; the orchestrator will do that.",
    "",
    "Work ONLY on this feature. Do not advance to the next feature.",
  ].join("\n");
}

// ── Markdown export ──────────────────────────────────────────────────────────
// Moved to ./export.js — import directly from export.js to avoid circular dependency.
// Templates moved to ./templates.js — import directly from templates.js to avoid circular dependency.

// ---------------------------------------------------------------------------
// Revolutionary: Auto-acceptance verification
// ---------------------------------------------------------------------------

/** Run bash-check acceptance criteria and auto-verify them. Returns count of verified criteria. */
export function autoVerifyAcceptance(feature: Feature, execFn: (cmd: string) => { code: number; stdout: string }): number {
  let verified = 0;
  for (const ac of feature.acceptance) {
    if (ac.verified || ac.waived || ac.checkType !== "bash" || !ac.checkCommand) continue;
    try {
      const result = execFn(ac.checkCommand);
      if (result.code === 0) {
        ac.verified = true;
        ac.evidence = result.stdout.slice(0, 1000);
        verified++;
      }
    } catch (error) {
      // Command execution failed — leave unverified.
      logger.debug("state", "Bash acceptance check failed", {
        featureId: feature.id,
        checkCommand: ac.checkCommand,
        error: error instanceof Error ? error.message : String(error)
      });
      // Graceful degradation: continue with other acceptance criteria
    }
  }
  return verified;
}

// ---------------------------------------------------------------------------
// Revolutionary: Stale feature detection
// ---------------------------------------------------------------------------

export interface StaleFeatureAlert {
  featureId: string;
  title: string;
  activeMs: number;
  maxMs: number;
  warnMs: number;
  toolCallsUsed: number;
  maxToolCalls: number;
  level: "warn" | "critical";
}

/** Check if the active feature has exceeded its wall-clock or tool-call limits.
 * Two-tier: warn at STALE_FEATURE_WARN_CLOCK_MS (20min), critical at maxWallClockMs (30min default). */
export function detectStaleFeature(mission: MissionState, now?: number): StaleFeatureAlert | null {
  if (mission.status !== "active") return null;
  const feature = getActiveFeature(mission);
  if (!feature || feature.status !== "active") return null;
  const ts = now ?? Date.now();
  if (!feature.startedAt) return null;

  const maxWallMs = feature.maxWallClockMs ?? DEFAULT_FEATURE_MAX_WALL_CLOCK_MS;
  const maxToolCalls = feature.maxToolCalls ?? DEFAULT_FEATURE_MAX_TOOL_CALLS;
  const activeMs = ts - feature.startedAt;

  const timeCritical = activeMs > maxWallMs;
  const timeWarn = activeMs > STALE_FEATURE_WARN_CLOCK_MS;
  const toolsExceeded = feature.toolCallCount > maxToolCalls;

  if (timeCritical || toolsExceeded) {
    return {
      featureId: feature.id,
      title: feature.title,
      activeMs,
      maxMs: maxWallMs,
      warnMs: STALE_FEATURE_WARN_CLOCK_MS,
      toolCallsUsed: feature.toolCallCount,
      maxToolCalls,
      level: "critical",
    };
  }
  if (timeWarn) {
    return {
      featureId: feature.id,
      title: feature.title,
      activeMs,
      maxMs: maxWallMs,
      warnMs: STALE_FEATURE_WARN_CLOCK_MS,
      toolCallsUsed: feature.toolCallCount,
      maxToolCalls,
      level: "warn",
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Revolutionary: Self-healing — auto-unblock when dependencies resolve
// ---------------------------------------------------------------------------

/** Move dependency-waiting features back to pending once dependencies are resolved. Returns count of resolved wait states. */
export function autoUnblockResolved(mission: MissionState): number {
  let unblocked = 0;
  for (const f of getAllFeatures(mission)) {
    if (f.status !== "waiting") continue;
    if (f.dependsOn.length === 0 || dependenciesDone(mission, f)) {
      f.status = "pending";
      f.notes = undefined;
      unblocked++;
    }
  }
  return unblocked;
}

// ---------------------------------------------------------------------------
// Milestone auto-complete
// ---------------------------------------------------------------------------

/** Mark milestones as 'complete' when all their features are done (failed = not complete). Returns count of auto-completed milestones. */
export function autoCompleteMilestones(mission: MissionState): number {
  let completed = 0;
  for (const m of mission.milestones) {
    if (m.status === "complete") continue;
    // Only auto-complete if all features are done — failed features block completion
    if (m.features.every((f) => f.status === "done")) {
      m.status = "complete";
      completed++;
    } else if (m.features.some((f) => f.status === "active")) {
      m.status = "active";
    }
  }
  return completed;
}

// ---------------------------------------------------------------------------
// Revolutionary: Evidence integrity hashing
// ---------------------------------------------------------------------------

/** Compute a SHA-256 hash of the evidence file for integrity verification. */
export function evidenceIntegrityHash(mission: MissionState, featureId: string): string | null {
  const evidenceFile = path.join(missionDirSafe(mission.id), "evidence", `${featureId}.md`);
  if (!fs.existsSync(evidenceFile)) return null;
  const content = fs.readFileSync(evidenceFile);
  return crypto.createHash("sha256").update(content).digest("hex");
}

// ---------------------------------------------------------------------------
// Revolutionary: Metrics computation
// ---------------------------------------------------------------------------

export function computeMissionMetrics(mission: MissionState): MissionMetrics {
  const all = getAllFeatures(mission);
  const history = readHistory(mission.id);
  const doneFeatures = all.filter((f) => f.status === "done");
  const failedFeatures = all.filter((f) => f.status === "failed");
  let acceptanceFailures = 0;
  let evidenceHashErrors = 0;
  for (const f of all) {
    acceptanceFailures += f.acceptance.filter((ac) => !ac.verified && !ac.waived).length;
    if (f.status === "done") {
      const hash = evidenceIntegrityHash(mission, f.id);
      if (hash === null) evidenceHashErrors++;
    }
  }
  const completionEvent = history.find((h) => h.event === "mission_complete");
  const totalWallMs = completionEvent
    ? (completionEvent.ts * 1000) - mission.createdAt
    : Date.now() - mission.createdAt;
  return {
    missionId: mission.id,
    created: mission.createdAt,
    completed: completionEvent?.ts ? completionEvent.ts * 1000 : undefined,
    totalFeatures: all.length,
    featuresDone: doneFeatures.length,
    featuresFailed: failedFeatures.length,
    totalTokensUsed: mission.tokensUsed,
    totalWallClockMs: totalWallMs,
    acceptanceFailures,
    evidenceHashErrors,
  };
}
