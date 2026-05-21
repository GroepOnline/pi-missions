import * as fs from "node:fs";
import * as fsAsync from "node:fs/promises";
import * as path from "node:path";
import * as lockfile from "proper-lockfile";
import type {
  ActivateNextResult,
  CompleteFeatureOptions,
  CompleteFeatureResult,
  Feature,
  Milestone,
  MissionHistoryEntry,
  MissionMetrics,
  MissionState,
  StaleFeatureAlert,
  ToolPhase,
} from "./types.js";
import { buildMissionGoalTree, type GoalTreeNode } from "../utils/mission-builder.js";
import {
  SCHEMA_VERSION,
  DEFAULT_AUTOPILOT,
  DEFAULT_FEATURE_MAX_TOOL_CALLS,
  DEFAULT_FEATURE_MAX_WALL_CLOCK_MS,
  STALE_FEATURE_WARN_MS,
} from "./types.js";
import {
  createMissionId,
  createValidationToken,
  isValidMissionId,
  missionDirSafe,
  missionsRoot,
  sha256,
  slugify,
} from "../utils/fs.js";

// Re-export for consumers
export { missionsRoot, missionDirSafe, createMissionId, isValidMissionId, createValidationToken, slugify };

// ═══════════════════════════════════════════════════════════════════════════
// Lock management
// ═══════════════════════════════════════════════════════════════════════════

export async function acquireMissionLock(missionId: string, stale = 30_000): Promise<() => Promise<void>> {
  const dir = missionDirSafe(missionId);
  fs.mkdirSync(dir, { recursive: true });
  return lockfile.lock(path.join(dir, ".lock"), {
    retries: { retries: 10, minTimeout: 100, maxTimeout: 500 },
    stale,
    realpath: false,
  });
}

export async function withLock<T>(
  lockPath: string,
  callback: () => Promise<T> | T,
  stale = 30_000,
): Promise<T> {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const release = await lockfile.lock(lockPath, {
    retries: { retries: 10, minTimeout: 100, maxTimeout: 500 },
    stale,
    realpath: false,
  });
  try {
    return await callback();
  } finally {
    await release();
  }
}

export async function withMissionLock<T>(
  missionId: string,
  callback: () => Promise<T> | T,
  stale = 30_000,
): Promise<T> {
  return withLock(path.join(missionDirSafe(missionId), ".lock"), callback, stale);
}

export async function cleanupStaleLocks(): Promise<void> {
  const root = missionsRoot();
  if (!fs.existsSync(root)) return;
  for (const entry of await fs.promises.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      await lockfile.unlock(path.join(root, entry.name, ".lock"), { realpath: false });
    } catch { /* lock may not exist */ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Feature access helpers
// ═══════════════════════════════════════════════════════════════════════════

export function getAllFeatures(mission: MissionState): Feature[] {
  return mission.milestones.flatMap(m => m.features);
}

export function getMilestoneById(mission: MissionState, id: string): Milestone | undefined {
  return mission.milestones.find(m => m.id === id);
}

export function getFeatureById(mission: MissionState, id: string): Feature | undefined {
  return getAllFeatures(mission).find(f => f.id === id);
}

export function getActiveFeature(mission: MissionState): Feature | null {
  return mission.activeFeatureId ? getFeatureById(mission, mission.activeFeatureId) ?? null : null;
}

export function dependenciesDone(mission: MissionState, feature: Feature): boolean {
  return feature.dependsOn.every(id => getFeatureById(mission, id)?.status === "done");
}

export function getNextPendingFeature(mission: MissionState): Feature | null {
  return getAllFeatures(mission)
    .filter(f => (f.status === "pending" || f.status === "waiting") && dependenciesDone(mission, f))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))[0] ?? null;
}

export function progress(mission: MissionState): { done: number; total: number; pct: number } {
  const all = getAllFeatures(mission);
  const done = all.filter(f => f.status === "done").length;
  return { done, total: all.length, pct: all.length ? Math.round((done / all.length) * 100) : 0 };
}

// ═══════════════════════════════════════════════════════════════════════════
// Mission creation
// ═══════════════════════════════════════════════════════════════════════════

export function createMission(title: string, goal: string, constraints = ""): MissionState {
  const id = createMissionId(title);
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
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
    milestones: [{
      id: "M01",
      title: "Plan and execute",
      description: constraints ? `Constraints: ${constraints}` : "Initial mission execution milestone",
      status: "active",
      features: [
        {
          id: "F001", milestoneId: "M01",
          title: "Clarify scope and current state",
          description: "Read the repository, identify relevant files, constraints, and existing behavior.",
          priority: 1, dependsOn: [], status: "active", sessions: [], toolCallCount: 0, startedAt: now,
          acceptance: [{ id: "AC001", description: "Relevant files and constraints documented", checkType: "manual", verified: false }],
        },
        {
          id: "F002", milestoneId: "M01",
          title: "Implement the core change",
          description: "Make the smallest coherent implementation that satisfies the mission goal.",
          priority: 2, dependsOn: ["F001"], status: "pending", sessions: [], toolCallCount: 0,
          acceptance: [{ id: "AC001", description: "Implementation matches mission goal", checkType: "manual", verified: false }],
        },
        {
          id: "F003", milestoneId: "M01",
          title: "Verify and summarize",
          description: "Run relevant checks, capture evidence, and summarize results.",
          priority: 3, dependsOn: ["F002"], status: "pending", sessions: [], toolCallCount: 0,
          acceptance: [{ id: "AC001", description: "Verification evidence saved", checkType: "manual", verified: false }],
        },
      ],
    }],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Migration
// ═══════════════════════════════════════════════════════════════════════════

export function migrateMission(raw: unknown): MissionState {
  const value = raw as Partial<MissionState> & { features?: Feature[]; schemaVersion?: number };
  const version = value.schemaVersion ?? 1;
  if (version > SCHEMA_VERSION) throw new Error(`Unsupported mission schemaVersion ${version}`);
  if (version === SCHEMA_VERSION) {
    return { ...(value as MissionState), autopilot: { ...DEFAULT_AUTOPILOT, ...(value as MissionState).autopilot } };
  }
  // v1/v2 migration: flat features list → milestones
  const v1Features = (value.features ?? []).map((f) => ({
    ...f,
    toolCallCount: typeof f.toolCallCount === "number" ? f.toolCallCount : 0,
  } as unknown as Feature));
  return {
    schemaVersion: SCHEMA_VERSION,
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
    autopilot: {
      ...DEFAULT_AUTOPILOT,
      ...(value as MissionState).autopilot,
      startedAt: (value as MissionState).autopilot?.startedAt ?? new Date(value.createdAt ?? Date.now()).toISOString(),
    },
    userPreferences: (value as MissionState).userPreferences,
    createdAt: value.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    milestones: value.milestones ?? [{
      id: "M01", title: "Migrated", description: "Migrated flat feature list",
      status: "active", features: v1Features,
    }],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Disk I/O
// ═══════════════════════════════════════════════════════════════════════════

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

    mission.updatedAt = Date.now();
    // Strip goalTree (circular .root refs) before serialization
    const { goalTree: _, ...serializable } = mission as MissionState & { goalTree?: unknown };
    const data = JSON.stringify(serializable, null, 2);

    // Retry the write once on failure
    try {
      await fsAsync.writeFile(temp, data, "utf-8");
    } catch {
      await new Promise(r => setTimeout(r, 100));
      await fsAsync.writeFile(temp, data, "utf-8");
    }
    await fsAsync.rename(temp, target);
  });
}

export function loadMissionFromDisk(id: string): MissionState | null {
  const dir = missionDirSafe(id);
  for (const name of ["plan.json", "plan.json.bak"]) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8"));
      return migrateMission(raw);
    } catch { /* try next fallback */ }
  }
  return null;
}

/** Read the raw schemaVersion from disk without migrating. Returns null if not found. */
export function readRawSchemaVersion(id: string): number | null {
  const dir = missionDirSafe(id);
  for (const name of ["plan.json", "plan.json.bak"]) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8"));
      if (raw && typeof raw === "object" && !Array.isArray(raw) && "schemaVersion" in raw) {
        return (raw as Record<string, unknown>).schemaVersion as number;
      }
      return 1; // pre-schemaVersion missions
    } catch { /* try next fallback */ }
  }
  return null;
}

/** Migrate a mission, creating a pre-migration backup first. Returns the migrated mission or null. */
export async function migrateMissionOnDisk(id: string): Promise<MissionState | null> {
  const dir = missionDirSafe(id);
  const target = path.join(dir, "plan.json");
  if (!fs.existsSync(target)) return null;

  return withLock(target, async () => {
    // Create pre-migration backup
    const preBackup = path.join(dir, `plan.json.pre-migration-${Date.now()}.bak`);
    await fsAsync.copyFile(target, preBackup);

    const raw = JSON.parse(await fsAsync.readFile(target, "utf-8"));
    const migrated = migrateMission(raw);
    // Write migrated state atomically
    const temp = path.join(dir, "plan.json.tmp");
    await fsAsync.writeFile(temp, JSON.stringify(migrated, null, 2), "utf-8");
    await fsAsync.rename(temp, target);
    return migrated;
  });
}

/** Read raw plan.json to get pre-migration counts. Returns { milestones, features } or null. */
export function readRawMissionCounts(id: string): { milestones: number; features: number } | null {
  const dir = missionDirSafe(id);
  for (const name of ["plan.json", "plan.json.bak"]) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8"));
      if (raw && typeof raw === "object") {
        const o = raw as Record<string, unknown>;
        if (Array.isArray(o.milestones)) {
          const features = o.milestones.reduce(
            (s: number, m: unknown) => s + (Array.isArray((m as Record<string, unknown>)?.features) ? ((m as Record<string, unknown>).features as unknown[]).length : 0),
            0,
          );
          return { milestones: (o.milestones as unknown[]).length, features };
        }
        if (Array.isArray(o.features)) {
          return { milestones: 1, features: (o.features as unknown[]).length };
        }
        return { milestones: 0, features: 0 };
      }
    } catch { /* try next */ }
  }
  return null;
}

export function listMissions(): MissionState[] {
  const root = missionsRoot();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .filter(e => {
      if (e.name.startsWith("pim-")) return true;
      if (/^mission-\d{17,}/.test(e.name)) return true;
      return false;
    })
    .map(e => loadMissionFromDisk(e.name))
    .filter((m): m is MissionState => Boolean(m))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

// ═══════════════════════════════════════════════════════════════════════════
// History
// ═══════════════════════════════════════════════════════════════════════════

export function appendHistory(
  mission: MissionState,
  entry: Omit<MissionHistoryEntry, "ts" | "missionId">,
): void {
  const dir = missionDirSafe(mission.id);
  fs.mkdirSync(dir, { recursive: true });
  const line: MissionHistoryEntry = {
    ts: Math.floor(Date.now() / 1000),
    missionId: mission.id,
    ...entry,
  };
  fs.appendFileSync(path.join(dir, "history.jsonl"), JSON.stringify(line) + "\n", "utf-8");
}

export function readHistory(id: string): MissionHistoryEntry[] {
  const file = path.join(missionDirSafe(id), "history.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf-8").split("\n").filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line) as MissionHistoryEntry]; } catch { return []; }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Evidence
// ═══════════════════════════════════════════════════════════════════════════

export function saveEvidence(mission: MissionState, feature: Feature, text: string): string {
  const dir = path.join(missionDirSafe(mission.id), "evidence");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${feature.id}.md`);
  fs.writeFileSync(file, text, "utf-8");
  return file;
}

export function evidenceIntegrityHash(mission: MissionState, featureId: string): string | null {
  const evidenceFile = path.join(missionDirSafe(mission.id), "evidence", `${featureId}.md`);
  if (!fs.existsSync(evidenceFile)) return null;
  return sha256(fs.readFileSync(evidenceFile));
}

export function evidenceIntegrityHashSafe(mission: MissionState, featureId: string): string | null {
  try { return evidenceIntegrityHash(mission, featureId); } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════
// Session linking
// ═══════════════════════════════════════════════════════════════════════════

export function linkSession(mission: MissionState, sessionFile: string, agent?: string): void {
  const dir = path.join(missionDirSafe(mission.id), "sessions");
  fs.mkdirSync(dir, { recursive: true });
  const agentSource = agent || process.env.CODING_AGENT || "unknown";
  const refPath = path.join(dir, `${path.basename(sessionFile)}.${agentSource}.ref`);
  fs.writeFileSync(refPath, JSON.stringify({
    sessionFile,
    agent: agentSource,
    linkedAt: new Date().toISOString(),
    linkedAtMs: Date.now(),
  }, null, 2), "utf-8");
}

export function listSessionRefs(missionId: string): Array<{ sessionFile: string; agent: string; linkedAt: string }> {
  const dir = path.join(missionDirSafe(missionId), "sessions");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith(".ref"))
    .flatMap(e => {
      try {
        const raw = fs.readFileSync(path.join(dir, e.name), "utf-8").trim();
        // Legacy plain-text refs: just a file path
        if (!raw.startsWith("{")) {
          return [{ sessionFile: raw, agent: "unknown", linkedAt: "" }];
        }
        const parsed = JSON.parse(raw);
        return [{
          sessionFile: typeof parsed.sessionFile === "string" ? parsed.sessionFile : raw,
          agent: typeof parsed.agent === "string" ? parsed.agent : "unknown",
          linkedAt: typeof parsed.linkedAt === "string" ? parsed.linkedAt : "",
        }];
      } catch {
        return [];
      }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// Auto-blocking / auto-unblocking
// ═══════════════════════════════════════════════════════════════════════════

export function autoBlockBlockedFeatures(mission: MissionState): number {
  let waiting = 0;
  for (const f of getAllFeatures(mission)) {
    if (f.status === "blocked" || f.status === "done" || f.status === "failed") continue;
    if (f.dependsOn.length && !dependenciesDone(mission, f)) {
      f.status = "waiting";
      f.notes = `Waiting on ${f.dependsOn.filter(id => getFeatureById(mission, id)?.status !== "done").join(", ")}`;
      waiting++;
    } else if (f.status === "waiting") {
      f.status = "pending";
      f.notes = undefined;
    }
  }
  return waiting;
}

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

// ═══════════════════════════════════════════════════════════════════════════
// Milestone auto-complete
// ═══════════════════════════════════════════════════════════════════════════

export function autoCompleteMilestones(mission: MissionState): number {
  let completed = 0;
  for (const m of mission.milestones) {
    if (m.status === "complete") continue;
    if (m.features.every(f => f.status === "done")) {
      m.status = "complete";
      completed++;
    } else if (m.features.some(f => f.status === "active")) {
      m.status = "active";
    }
  }
  return completed;
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase detection
// ═══════════════════════════════════════════════════════════════════════════

export function getMissionPhase(mission: MissionState): ToolPhase {
  if (mission.status === "planning") return "planning";
  const active = getActiveFeature(mission);
  if (!active) return "execution";
  const t = `${active.title} ${active.description ?? ""}`.toLowerCase();
  if (t.includes("verify") || t.includes("test") || t.includes("summarize")) return "verification";
  if (t.includes("clarify") || t.includes("plan") || t.includes("scope") ||
      t.includes("research") || t.includes("analyze") || t.includes("analyse") ||
      t.includes("inspect") || t.includes("investigate") || t.includes("discover") ||
      t.includes("reconnaissance") || t.includes("current state")) {
    return "planning";
  }
  return "execution";
}

// ═══════════════════════════════════════════════════════════════════════════
// Transitions: completeActiveFeature + activateNextFeature
// ═══════════════════════════════════════════════════════════════════════════

function allFeaturesDone(mission: MissionState): boolean {
  return getAllFeatures(mission).every(f => f.status === "done");
}

export function autoVerifyAcceptance(
  feature: Feature,
  execFn: (cmd: string) => { code: number; stdout: string },
): number {
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
    } catch { /* leave unverified */ }
  }
  return verified;
}

export function completeActiveFeature(
  mission: MissionState,
  options: CompleteFeatureOptions,
): CompleteFeatureResult {
  const feature = getActiveFeature(mission);
  if (!feature) return { ok: false, reason: "No active mission feature." };

  if (options.autoVerify && feature._execFn) {
    autoVerifyAcceptance(feature, feature._execFn);
  }

  const unverifiedBash = feature.acceptance.filter(
    ac => !ac.verified && !ac.waived && ac.checkType === "bash",
  );
  if (unverifiedBash.length > 0) {
    const details = unverifiedBash
      .map(ac => `${ac.id}: ${ac.description}${ac.checkCommand ? ` [bash: ${ac.checkCommand}]` : ""}`)
      .join("\n");
    return { ok: false, reason: `Cannot mark feature done: ${unverifiedBash.length} bash acceptance criteria need verification.\n${details}`, unverifiedBashCount: unverifiedBash.length };
  }

  feature.status = "done";
  feature.completedAt = Date.now();
  if (options.notes !== undefined) feature.notes = options.notes;
  if (options.markAcceptanceVerified) {
    for (const ac of feature.acceptance) if (!ac.waived) ac.verified = true;
  }

  const evidenceFile = saveEvidence(mission, feature, options.evidence || "Marked done.");
  appendHistory(mission, {
    event: "feature_done",
    featureId: feature.id,
    note: options.historyNote ?? options.notes,
    details: { evidenceFile, ...options.historyDetails },
  });

  autoUnblockResolved(mission);
  const missionComplete = !getNextPendingFeature(mission) && allFeaturesDone(mission);
  if (missionComplete) {
    mission.status = "complete";
    mission.autopilot.enabled = false;
    mission.autopilot.lastStopReason = "mission_complete";
  }
  autoCompleteMilestones(mission);

  // Rebuild goalTree to keep it in sync after feature transitions
  (mission as { goalTree?: GoalTreeNode }).goalTree = buildMissionGoalTree(mission.title, mission.goal, mission.milestones);

  return { ok: true, feature, evidenceFile, missionComplete };
}

export function activateNextFeature(mission: MissionState, note?: string): ActivateNextResult {
  const active = getActiveFeature(mission);
  if (active?.status === "active") return { ok: false, reason: "active_not_done", active };

  autoUnblockResolved(mission);
  const next = getNextPendingFeature(mission);
  if (!next) {
    if (allFeaturesDone(mission)) {
      mission.status = "complete";
      mission.autopilot.enabled = false;
      mission.autopilot.lastStopReason = "mission_complete";
      autoCompleteMilestones(mission);
      appendHistory(mission, { event: "mission_complete", note: note ?? "All features complete" });
      return { ok: false, reason: "mission_complete" };
    }
    return { ok: false, reason: "no_unblocked_pending" };
  }

  next.status = "active";
  next.startedAt = next.startedAt ?? Date.now();
  mission.status = "active";
  mission.activeFeatureId = next.id;
  mission.activeMilestoneId = next.milestoneId;
  appendHistory(mission, { event: "feature_active", featureId: next.id, note });
  return { ok: true, next };
}

// ═══════════════════════════════════════════════════════════════════════════
// Stale feature detection
// ═══════════════════════════════════════════════════════════════════════════

export function detectStaleFeature(mission: MissionState, now?: number): StaleFeatureAlert | null {
  if (mission.status !== "active") return null;
  const feature = getActiveFeature(mission);
  if (!feature || feature.status !== "active" || !feature.startedAt) return null;

  const ts = now ?? Date.now();
  const maxWallMs = feature.maxWallClockMs ?? DEFAULT_FEATURE_MAX_WALL_CLOCK_MS;
  const maxToolCalls = feature.maxToolCalls ?? DEFAULT_FEATURE_MAX_TOOL_CALLS;
  const activeMs = ts - feature.startedAt;
  const timeCritical = activeMs > maxWallMs;
  const timeWarn = activeMs > STALE_FEATURE_WARN_MS;
  const toolsExceeded = feature.toolCallCount > maxToolCalls;

  if (timeCritical || toolsExceeded) {
    return {
      featureId: feature.id, title: feature.title, activeMs,
      maxMs: maxWallMs, warnMs: STALE_FEATURE_WARN_MS,
      toolCallsUsed: feature.toolCallCount, maxToolCalls, level: "critical",
    };
  }
  if (timeWarn) {
    return {
      featureId: feature.id, title: feature.title, activeMs,
      maxMs: maxWallMs, warnMs: STALE_FEATURE_WARN_MS,
      toolCallsUsed: feature.toolCallCount, maxToolCalls, level: "warn",
    };
  }
  return null;
}

export function detectStaleFeatureSafe(mission: MissionState, now?: number): StaleFeatureAlert | null {
  try { return detectStaleFeature(mission, now); } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════
// Metrics
// ═══════════════════════════════════════════════════════════════════════════

export function computeMissionMetrics(mission: MissionState): MissionMetrics {
  const all = getAllFeatures(mission);
  const history = readHistory(mission.id);
  const doneFeatures = all.filter(f => f.status === "done");
  const failedFeatures = all.filter(f => f.status === "failed");
  let acceptanceFailures = 0;
  let evidenceHashErrors = 0;
  for (const f of all) {
    acceptanceFailures += f.acceptance.filter(ac => !ac.verified && !ac.waived).length;
    if (f.status === "done" && evidenceIntegrityHash(mission, f.id) === null) evidenceHashErrors++;
  }
  const completionEvent = history.find(h => h.event === "mission_complete");
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

export function calculateMetricsSummary(): import("./types.js").MissionMetricsSummary {
  const missions = listMissions();
  const metrics = missions.map(computeMissionMetrics);
  if (metrics.length === 0) {
    return {
      totalMissions: 0, completedMissions: 0, successRate: 0,
      averageTokensPerMission: 0, averageFeaturesPerMission: 0, averageCompletionTimeMs: 0,
    };
  }
  const completed = metrics.filter(m => m.completed !== undefined);
  const totalTokens = metrics.reduce((s, m) => s + m.totalTokensUsed, 0);
  const totalFeatures = metrics.reduce((s, m) => s + m.totalFeatures, 0);
  const totalTime = completed.reduce((s, m) => s + ((m.completed ?? m.created) - m.created), 0);
  return {
    totalMissions: metrics.length,
    completedMissions: completed.length,
    successRate: completed.length / metrics.length,
    averageTokensPerMission: totalTokens / metrics.length,
    averageFeaturesPerMission: totalFeatures / metrics.length,
    averageCompletionTimeMs: completed.length > 0 ? totalTime / completed.length : 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Worker prompt builder
// ═══════════════════════════════════════════════════════════════════════════

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
    ...feature.acceptance.map(ac => `- [ ] ${ac.id}: ${ac.description}${ac.checkCommand ? `\n  Command: \`${ac.checkCommand}\`` : ""}`),
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
