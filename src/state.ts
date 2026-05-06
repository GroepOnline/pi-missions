import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CURRENT_SCHEMA_VERSION, type Feature, type Milestone, type MissionHistoryEntry, type MissionState } from "./types.js";

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
  return `mission-${stamp}-${slugify(title)}`;
}

export function missionDirSafe(id: string): string {
  const root = path.resolve(missionsRoot());
  const safeId = id.replace(/[^a-zA-Z0-9._-]/g, "-");
  const resolved = path.resolve(root, safeId);
  if (!resolved.startsWith(root + path.sep)) throw new Error("Invalid mission id: path traversal detected");
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

function dependenciesDone(mission: MissionState, feature: Feature): boolean {
  return feature.dependsOn.every((id) => getFeatureById(mission, id)?.status === "done");
}

export function getNextPendingFeature(mission: MissionState): Feature | null {
  return getAllFeatures(mission)
    .filter((f) => f.status === "pending" && dependenciesDone(mission, f))
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
  if (version === CURRENT_SCHEMA_VERSION) return value as MissionState;
  if (version === 1) {
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
      createdAt: value.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      milestones: value.milestones ?? [{ id: "M01", title: "Migrated", description: "Migrated flat feature list", status: "active", features: value.features ?? [] }],
    };
  }
  throw new Error(`Unsupported mission schemaVersion: ${version}`);
}

export function saveMissionSafe(mission: MissionState): void {
  const dir = missionDirSafe(mission.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "evidence"), { recursive: true });
  fs.mkdirSync(path.join(dir, "sessions"), { recursive: true });
  const target = path.join(dir, "plan.json");
  const backup = path.join(dir, "plan.json.bak");
  const preMigration = path.join(dir, "plan.json.pre-migration.bak");
  const temp = path.join(dir, "plan.json.tmp");
  if (fs.existsSync(target)) {
    fs.copyFileSync(target, backup);
    if (!fs.existsSync(preMigration)) fs.copyFileSync(target, preMigration);
  }
  try {
    mission.updatedAt = Date.now();
    fs.writeFileSync(temp, JSON.stringify(mission, null, 2), "utf-8");
    fs.renameSync(temp, target);
  } catch (error) {
    if (fs.existsSync(backup)) fs.copyFileSync(backup, target);
    throw error;
  }
}

export function loadMissionFromDisk(id: string): MissionState | null {
  const dir = missionDirSafe(id);
  for (const name of ["plan.json", "plan.json.bak"]) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8"));
      return migrateMission(raw);
    } catch {
      // Try next fallback.
    }
  }
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
    try { return [JSON.parse(line) as MissionHistoryEntry]; } catch { return []; }
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
