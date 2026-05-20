import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  appendHistory,
  autoBlockBlockedFeatures,
  autoCompleteMilestones,
  autoUnblockResolved,
  autoVerifyAcceptance,
  buildWorkerPrompt,
  calculateMetricsSummary,
  computeMissionMetrics,
  createMission,

  createMissionId,
  detectStaleFeature,
  evidenceIntegrityHash,
  getFeatureById,
  getMilestoneById,
  getMissionPhase,
  getNextPendingFeature,
  linkSession,
  listMissions,
  listSessionRefs,
  loadMissionFromDisk,
  migrateMission,
  migrateMissionOnDisk,
  missionDirSafe,
  missionsRoot,
  progress,
  readHistory,
  readRawMissionCounts,
  readRawSchemaVersion,
  saveEvidence,
  saveMissionSafe,
  slugify,
} from "../src/core/state.js";
import { exportMarkdown } from "../src/utils/markdown.js";
import { createMissionFromTemplate } from "../src/utils/markdown.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { MissionState } from "../src/core/types.js";

const tmpRoot = path.join(os.tmpdir(), `pi-missions-test-${process.pid}`);

function setupTmp(): void {
  fs.mkdirSync(tmpRoot, { recursive: true });
  // Directory used via process.env.HOME override in beforeAll.
}

function cleanupTmp(): void {
  if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
}

describe("slugify", () => {
  it("removes emoji and special chars", () => {
    expect(slugify("Hello World! 🚀")).toBe("hello-world");
  });

  it("trims leading/trailing dashes", () => {
    expect(slugify("--test--")).toBe("test");
  });

  it("caps at 64 chars", () => {
    expect(slugify("a".repeat(100)).length).toBeLessThanOrEqual(64);
  });

  it("returns 'mission' for empty input", () => {
    expect(slugify("")).toBe("mission");
  });
});

describe("createMissionId", () => {
  it("includes millisecond precision", () => {
    expect(createMissionId("Test", Date.UTC(2026, 4, 6, 12, 34, 56, 1))).toBe("pim:20260506123456001:test");
    expect(createMissionId("Test", Date.UTC(2026, 4, 6, 12, 34, 56, 999))).toBe("pim:20260506123456999:test");
  });
});

describe("createMission", () => {
  it("sets schemaVersion 3, active first feature, 0% progress", () => {
    const m = createMission("Test", "Goal");
    expect(m.schemaVersion).toBe(3);
    expect(m.activeFeatureId).toBe("F001");
    expect(m.activeMilestoneId).toBe("M01");
    expect(progress(m)).toEqual({ done: 0, total: 3, pct: 0 });
    expect(m.status).toBe("active");
    expect(m.tokensUsed).toBe(0);
    expect(m.validationToken).toBeDefined();
    expect(m.validationToken).toHaveLength(64); // 32 bytes = 64 hex chars
  });

  it("includes constraints in milestone description", () => {
    const m = createMission("T", "G", "No new deps");
    expect(m.milestones[0]!.description).toContain("Constraints: No new deps");
  });
});

describe("getNextPendingFeature", () => {
  it("returns null when all pending are blocked by deps", () => {
    const m = createMission("Test", "Goal");
    expect(getNextPendingFeature(m)).toBeNull();
  });

  it("returns next after done", () => {
    const m = createMission("Test", "Goal");
    m.milestones[0].features[0]!.status = "done";
    expect(getNextPendingFeature(m)?.id).toBe("F002");
  });

  it("respects priority ordering", () => {
    const m = createMission("Test", "Goal");
    // Remove cascading dependencies: make F002 and F003 both depend only on F001.
    m.milestones[0].features[0]!.status = "done";
    m.milestones[0].features[1]!.priority = 3;
    m.milestones[0].features[2]!.priority = 2;
    m.milestones[0].features[2]!.dependsOn = ["F001"];
    expect(getNextPendingFeature(m)?.id).toBe("F003"); // prio 2 beats prio 3
  });
});

describe("missionDirSafe", () => {
  it("guards against traversal", () => {
    expect(missionDirSafe("../../etc/passwd")).toContain(path.join(".pi", "missions"));
  });

  it("sanitizes special chars", () => {
    expect(missionDirSafe("hello/world")).toContain("hello-world");
  });
});

describe("migrateMission", () => {
  it("passes through v3 unchanged", () => {
    const m = createMission("T", "G");
    expect(migrateMission(m).schemaVersion).toBe(3);
  });

  it("migrates v1 flat features into a milestone", () => {
    const v1 = {
      schemaVersion: 1,
      id: "m-1",
      title: "Old mission",
      goal: "Do it",
      status: "active" as const,
      features: [
        { id: "F1", milestoneId: "M01", title: "Old feature", description: "desc", priority: 1, dependsOn: [], acceptance: [], status: "done" as const, sessions: [] },
      ],
      tokensUsed: 50,
    };
    const m = migrateMission(v1);
    expect(m.schemaVersion).toBe(3);
    expect(m.milestones).toHaveLength(1);
    expect(m.milestones[0]!.features).toHaveLength(1);
    expect(m.milestones[0]!.features[0]!.id).toBe("F1");
    expect(m.tokensUsed).toBe(50);
  });

  it("throws on unsupported version", () => {
    expect(() => migrateMission({ schemaVersion: 99 })).toThrow("Unsupported mission schemaVersion");
  });

  it("migrates v2 mission with missing optional fields", () => {
    const v2 = {
      schemaVersion: 2,
      id: "m-2",
    };
    const m = migrateMission(v2);
    expect(m.schemaVersion).toBe(3);
    expect(m.title).toBe("Untitled mission");
    expect(m.goal).toBe("");
    expect(m.tokensUsed).toBe(0);
    expect(m.lastContextTokens).toBe(0);
    expect(m.createdAt).toBeLessThanOrEqual(Date.now());
    expect(m.autopilot.startedAt).toBeDefined();
    expect(m.userPreferences).toBeUndefined();
  });

  it("handles missing features array during migration", () => {
    const v1 = { schemaVersion: 1, id: "m-3" };
    const m = migrateMission(v1);
    expect(m.schemaVersion).toBe(3);
    expect(m.milestones[0]!.features).toHaveLength(0);
  });

  it("ensures toolCallCount defaults to 0 during migration if missing or not a number", () => {
    const v1 = {
      schemaVersion: 1,
      id: "m-4",
      features: [
        { id: "F1", title: "Missing count" },
        { id: "F2", title: "Invalid count", toolCallCount: "not a number" },
        { id: "F3", title: "Valid count", toolCallCount: 5 }
      ]
    };
    const m = migrateMission(v1);
    const features = m.milestones[0]!.features;
    expect(features[0]!.toolCallCount).toBe(0);
    expect(features[1]!.toolCallCount).toBe(0);
    expect(features[2]!.toolCallCount).toBe(5);
  });

  it("handles autopilot and userPreferences during migration", () => {
    const v2 = {
      schemaVersion: 2,
      autopilot: {
        enabled: true,
        startedAt: "2024-01-01T00:00:00.000Z",
        lastStopReason: "manual_stop"
      },
      userPreferences: {
        theme: "dark"
      }
    };
    const m = migrateMission(v2);
    expect(m.autopilot.enabled).toBe(true);
    expect(m.autopilot.startedAt).toBe("2024-01-01T00:00:00.000Z");
    expect(m.autopilot.lastStopReason).toBe("manual_stop");
    expect(m.userPreferences).toEqual({ theme: "dark" });
  });
});

describe("save / load roundtrip", () => {
  const origHome = process.env.HOME;

  beforeAll(() => {
    process.env.HOME = tmpRoot;
    setupTmp();
  });

  afterAll(() => {
    process.env.HOME = origHome;
    cleanupTmp();
  });

  it("roundtrips via plan.json", async () => {
    const m = createMission("Roundtrip", "Ensure save works");
    await saveMissionSafe(m);
    const loaded = loadMissionFromDisk(m.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(m.id);
    expect(loaded!.title).toBe("Roundtrip");
    expect(loaded!.schemaVersion).toBe(3);
    expect(loaded!.validationToken).toBe(m.validationToken);
  });

  it("falls back to plan.json.bak when plan.json is corrupted", async () => {
    const m = createMission("Backup test", "Testing");
    await saveMissionSafe(m);
    // Save twice so plan.json.bak is created from the first save.
    m.title = "Backup test modified";
    await saveMissionSafe(m);
    // Corrupt plan.json
    const dir = missionDirSafe(m.id);
    fs.writeFileSync(path.join(dir, "plan.json"), "{corrupted}", "utf-8");
    const loaded = loadMissionFromDisk(m.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(m.id);
  });

  it("returns null for unknown mission id", () => {
    expect(loadMissionFromDisk("nonexistent-999")).toBeNull();
  });
});

describe("listMissions", () => {
  const origHome = process.env.HOME;

  beforeAll(() => {
    process.env.HOME = tmpRoot;
    cleanupTmp();
    setupTmp();
  });

  afterAll(() => {
    process.env.HOME = origHome;
    cleanupTmp();
  });

  it("returns empty array when no missions exist", () => {
    expect(listMissions()).toEqual([]);
  });

  it("lists saved missions", async () => {
    const m1 = createMission("A", "Goal A");
    const m2 = createMission("B", "Goal B");
    // saveMissionSafe overwrites updatedAt; both get near-identical timestamps.
    await saveMissionSafe(m1);
    await saveMissionSafe(m2);
    const list = listMissions();
    expect(list).toHaveLength(2);
    const titles = list.map((m) => m.title);
    expect(titles).toContain("A");
    expect(titles).toContain("B");
  });
});

describe("history", () => {
  const origHome = process.env.HOME;

  beforeAll(() => {
    process.env.HOME = tmpRoot;
    cleanupTmp();
    setupTmp();
  });

  afterAll(() => {
    process.env.HOME = origHome;
    cleanupTmp();
  });

  it("appends and reads history entries", () => {
    const m = createMission("Hist test", "Testing history");
    appendHistory(m, { event: "feature_done", featureId: "F001", note: "all good" });
    appendHistory(m, { event: "mission_paused" });
    const entries = readHistory(m.id);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.event).toBe("feature_done");
    expect(entries[0]!.featureId).toBe("F001");
    expect(entries[1]!.event).toBe("mission_paused");
  });

  it("returns empty array for missing history file", () => {
    expect(readHistory("nonexistent-mission")).toEqual([]);
  });
});

describe("evidence", () => {
  const origHome = process.env.HOME;

  beforeAll(() => {
    process.env.HOME = tmpRoot;
    cleanupTmp();
    setupTmp();
  });

  afterAll(() => {
    process.env.HOME = origHome;
    cleanupTmp();
  });

  it("saves evidence to file", () => {
    const m = createMission("Evidence", "Test");
    const f = m.milestones[0].features[0]!;
    const file = saveEvidence(m, f, "## Test output\nAll passing");
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, "utf-8")).toContain("All passing");
  });
});

describe("progress", () => {
  it("computes correct percentage", () => {
    const m = createMission("P", "G");
    expect(progress(m)).toEqual({ done: 0, total: 3, pct: 0 });
    m.milestones[0].features[0]!.status = "done";
    expect(progress(m)).toEqual({ done: 1, total: 3, pct: 33 });
    m.milestones[0].features[1]!.status = "done";
    m.milestones[0].features[2]!.status = "done";
    expect(progress(m)).toEqual({ done: 3, total: 3, pct: 100 });
  });

  it("returns 0% for empty milestones", () => {
    const m = createMission("Empty", "Test");
    m.milestones = [];
    expect(progress(m)).toEqual({ done: 0, total: 0, pct: 0 });
  });
});

describe("getFeatureById", () => {
  it("finds a feature by id", () => {
    const m = createMission("Lookup", "Test");
    expect(getFeatureById(m, "F001")?.title).toBe("Clarify scope and current state");
  });

  it("returns undefined for nonexistent id", () => {
    const m = createMission("Lookup", "Test");
    expect(getFeatureById(m, "F999")).toBeUndefined();
  });
});

describe("getMilestoneById", () => {
  it("finds a milestone by id", () => {
    const m = createMission("Lookup", "Test");
    expect(getMilestoneById(m, "M01")?.title).toBe("Plan and execute");
  });

  it("returns undefined for nonexistent id", () => {
    const m = createMission("Lookup", "Test");
    expect(getMilestoneById(m, "M99")).toBeUndefined();
  });
});

describe("missionsRoot", () => {
  afterEach(() => {
    delete process.env.MISSIONS_ROOT;
    delete process.env.PI_MISSIONS_ROOT;
  });

  it("returns default path when no env var is set", () => {
    const root = missionsRoot();
    expect(root).toContain(path.join(".pi", "missions"));
  });

  it("respects MISSIONS_ROOT env var", () => {
    process.env.MISSIONS_ROOT = "/shared/missions";
    expect(missionsRoot()).toBe("/shared/missions");
  });

  it("prefers MISSIONS_ROOT over PI_MISSIONS_ROOT", () => {
    process.env.MISSIONS_ROOT = "/shared/missions";
    process.env.PI_MISSIONS_ROOT = "/pi/specific";
    expect(missionsRoot()).toBe("/shared/missions");
  });

  it("falls back to PI_MISSIONS_ROOT when MISSIONS_ROOT not set", () => {
    process.env.PI_MISSIONS_ROOT = "/pi/specific";
    expect(missionsRoot()).toBe("/pi/specific");
  });

  it("throws on relative MISSIONS_ROOT path", () => {
    process.env.MISSIONS_ROOT = "relative/path";
    expect(() => missionsRoot()).toThrow("MISSIONS_ROOT must be an absolute path");
  });

  it("throws on relative PI_MISSIONS_ROOT path", () => {
    process.env.PI_MISSIONS_ROOT = "also/relative";
    expect(() => missionsRoot()).toThrow("PI_MISSIONS_ROOT must be an absolute path");
  });
});

describe("linkSession (multi-agent)", () => {
  const origHome = process.env.HOME;
  let prevCodingAgent: string | undefined;

  beforeAll(() => {
    prevCodingAgent = process.env.CODING_AGENT;
    process.env.HOME = tmpRoot;
    cleanupTmp();
    setupTmp();
  });

  afterAll(() => {
    process.env.HOME = origHome;
    cleanupTmp();
    if (prevCodingAgent !== undefined) process.env.CODING_AGENT = prevCodingAgent;
    else delete process.env.CODING_AGENT;
  });

  it("creates a JSON session reference file with agent metadata", async () => {
    const m = createMission("Session", "Test");
    await saveMissionSafe(m);
    linkSession(m, "/home/user/.pi/sessions/session-abc.jsonl", "pi");
    const refFile = path.join(missionDirSafe(m.id), "sessions", "session-abc.jsonl.pi.ref");
    expect(fs.existsSync(refFile)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(refFile, "utf-8"));
    expect(parsed.sessionFile).toBe("/home/user/.pi/sessions/session-abc.jsonl");
    expect(parsed.agent).toBe("pi");
    expect(parsed.linkedAt).toBeTruthy();
    expect(typeof parsed.linkedAtMs).toBe("number");
  });

  it("defaults agent to unknown when not specified", async () => {
    delete process.env.CODING_AGENT;
    const m = createMission("Session", "Test");
    await saveMissionSafe(m);
    linkSession(m, "/tmp/session.jsonl");
    const refFile = path.join(missionDirSafe(m.id), "sessions", "session.jsonl.unknown.ref");
    const parsed = JSON.parse(fs.readFileSync(refFile, "utf-8"));
    expect(parsed.agent).toBe("unknown");
  });

  it("uses CODING_AGENT env var when no agent param", async () => {
    process.env.CODING_AGENT = "devin";
    const m = createMission("Session", "Test");
    await saveMissionSafe(m);
    linkSession(m, "/tmp/session-devin.jsonl");
    const refFile = path.join(missionDirSafe(m.id), "sessions", "session-devin.jsonl.devin.ref");
    const parsed = JSON.parse(fs.readFileSync(refFile, "utf-8"));
    expect(parsed.agent).toBe("devin");
  });

  it("includes agent in ref filename to prevent cross-agent collisions", async () => {
    process.env.CODING_AGENT = "pi";
    const m = createMission("Collision", "Test");
    await saveMissionSafe(m);
    // Simulate same basename from different agents
    linkSession(m, "/home/pi/sessions/session-1.jsonl"); // pi agent
    linkSession(m, "/home/devin/sessions/session-1.jsonl", "devin"); // devin agent
    linkSession(m, "/home/opencode/sessions/session-1.jsonl", "opencode"); // opencode agent

    const piRef = path.join(missionDirSafe(m.id), "sessions", "session-1.jsonl.pi.ref");
    const devinRef = path.join(missionDirSafe(m.id), "sessions", "session-1.jsonl.devin.ref");
    const ocRef = path.join(missionDirSafe(m.id), "sessions", "session-1.jsonl.opencode.ref");

    expect(fs.existsSync(piRef)).toBe(true);
    expect(fs.existsSync(devinRef)).toBe(true);
    expect(fs.existsSync(ocRef)).toBe(true);

    // All three coexist without overwriting
    expect(JSON.parse(fs.readFileSync(piRef, "utf-8")).sessionFile).toBe("/home/pi/sessions/session-1.jsonl");
    expect(JSON.parse(fs.readFileSync(devinRef, "utf-8")).sessionFile).toBe("/home/devin/sessions/session-1.jsonl");
    expect(JSON.parse(fs.readFileSync(ocRef, "utf-8")).sessionFile).toBe("/home/opencode/sessions/session-1.jsonl");
  });
});

describe("listSessionRefs", () => {
  const origHome = process.env.HOME;

  beforeAll(() => {
    process.env.HOME = tmpRoot;
    cleanupTmp();
    setupTmp();
  });

  afterAll(() => {
    process.env.HOME = origHome;
    cleanupTmp();
  });

  it("returns empty array when no sessions linked", () => {
    expect(listSessionRefs("nonexistent-mission")).toEqual([]);
  });

  it("lists session refs with agent metadata", async () => {
    const m = createMission("MultiSession", "Test");
    await saveMissionSafe(m);
    linkSession(m, "/tmp/pi-session.jsonl", "pi");
    linkSession(m, "/tmp/devin-session.jsonl", "devin");
    linkSession(m, "/tmp/opencode-session.jsonl", "opencode");

    const refs = listSessionRefs(m.id);
    expect(refs).toHaveLength(3);

    const agents = refs.map((r) => r.agent).sort();
    expect(agents).toEqual(["devin", "opencode", "pi"]);

    const files = refs.map((r) => r.sessionFile);
    expect(files).toContain("/tmp/pi-session.jsonl");
    expect(files).toContain("/tmp/devin-session.jsonl");
    expect(files).toContain("/tmp/opencode-session.jsonl");

    // All should have linkedAt timestamps
    for (const ref of refs) {
      expect(ref.linkedAt).toBeTruthy();
    }
  });

  it("handles legacy plain-text session refs (backward compat)", async () => {
    const m = createMission("Legacy", "Test");
    await saveMissionSafe(m);
    // Write a legacy-format ref file (just a file path)
    const dir = path.join(missionDirSafe(m.id), "sessions");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "legacy.ref"), "/tmp/old-session.jsonl", "utf-8");

    const refs = listSessionRefs(m.id);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.sessionFile).toBe("/tmp/old-session.jsonl");
    expect(refs[0]!.agent).toBe("unknown");
    expect(refs[0]!.linkedAt).toBe("");
  });

  it("skips non-.ref files in sessions dir", async () => {
    const m = createMission("Filtered", "Test");
    await saveMissionSafe(m);
    const dir = path.join(missionDirSafe(m.id), "sessions");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "notes.txt"), "some notes", "utf-8");
    linkSession(m, "/tmp/real-session.jsonl", "codex");

    const refs = listSessionRefs(m.id);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.agent).toBe("codex");
  });
});

describe("autoBlockBlockedFeatures", () => {

  it("blocks features with unresolved dependencies", () => {
    const m = createMission("Deps", "Test deps");
    // F001 active, F002 depends on F001 (not done), F003 depends on F002
    expect(autoBlockBlockedFeatures(m)).toBe(2); // F002 and F003 waiting
    expect(m.milestones[0].features[1]!.status).toBe("waiting");
    expect(m.milestones[0].features[2]!.status).toBe("waiting");
  });

  it("does not block features with done dependencies", () => {
    const m = createMission("DepsDone", "Test");
    m.milestones[0].features[0]!.status = "done";
    // F001 done → F002 deps resolved → stays pending. F003 depends on F002 (pending) → gets waiting.
    expect(autoBlockBlockedFeatures(m)).toBe(1);
    expect(m.milestones[0].features[1]!.status).toBe("pending");
    expect(m.milestones[0].features[2]!.status).toBe("waiting");
  });

  it("skips already done features", () => {
    const m = createMission("Skipped", "Test");
    m.milestones[0].features[0]!.status = "done";
    m.milestones[0].features[1]!.status = "done";
    autoBlockBlockedFeatures(m);
    expect(m.milestones[0].features[0]!.status).toBe("done");
    expect(m.milestones[0].features[1]!.status).toBe("done");
  });

  it("blocks active feature if its deps are not done", () => {
    const m = createMission("ActiveBlocked", "Test");
    m.milestones[0].features[0]!.status = "pending";
    m.milestones[0].features[1]!.status = "active";
    m.milestones[0].features[1]!.dependsOn = ["F000"]; // nonexistent dep
    autoBlockBlockedFeatures(m);
    expect(m.milestones[0].features[1]!.status).toBe("waiting");
  });
});

describe("getMissionPhase", () => {

  it("returns planning for planning status", () => {
    const m = createMission("Phase", "Test");
    m.status = "planning";
    expect(getMissionPhase(m)).toBe("planning");
  });

  it("returns execution for active with no active feature", () => {
    const m = createMission("Phase", "Test");
    m.activeFeatureId = undefined;
    expect(getMissionPhase(m)).toBe("execution");
  });

  it("returns verification for verify/test/summarize titles", () => {
    const m = createMission("Phase", "Test");
    m.milestones[0].features[0]!.title = "Verify the implementation";
    expect(getMissionPhase(m)).toBe("verification");
    m.milestones[0].features[0]!.title = "Test everything";
    expect(getMissionPhase(m)).toBe("verification");
    m.milestones[0].features[0]!.title = "Summarize results";
    expect(getMissionPhase(m)).toBe("verification");
  });

  it("returns planning for clarify/plan/scope titles", () => {
    const m = createMission("Phase", "Test");
    m.milestones[0].features[0]!.title = "Clarify the requirements";
    expect(getMissionPhase(m)).toBe("planning");
    m.milestones[0].features[0]!.title = "Plan the architecture";
    expect(getMissionPhase(m)).toBe("planning");
    m.milestones[0].features[0]!.title = "Scope the work";
    expect(getMissionPhase(m)).toBe("planning");
  });

  it("returns planning for research/analyze/inspect discovery features", () => {
    const m = createMission("Phase", "Test");
    m.milestones[0].features[0]!.title = "Research repo layout";
    expect(getMissionPhase(m)).toBe("planning");
    m.milestones[0].features[0]!.title = "Analyze current API";
    expect(getMissionPhase(m)).toBe("planning");
    m.milestones[0].features[0]!.title = "Implement later";
    m.milestones[0].features[0]!.description = "Inspect current state before writing";
    expect(getMissionPhase(m)).toBe("planning");
  });

  it("returns execution for neutral titles", () => {
    const m = createMission("Phase", "Test");
    m.milestones[0].features[0]!.title = "Implement the feature";
    expect(getMissionPhase(m)).toBe("execution");
  });
});

describe("buildWorkerPrompt", () => {

  it("includes mission goal and progress", () => {
    const m = createMission("Worker", "Build X");
    const f = m.milestones[0].features[0]!;
    const prompt = buildWorkerPrompt(m, f);
    expect(prompt).toContain("## Mission: Worker");
    expect(prompt).toContain("Goal: Build X");
    expect(prompt).toContain("Progress: 0/3");
  });

  it("includes feature details and acceptance criteria", () => {
    const m = createMission("Worker", "Build X");
    const f = m.milestones[0].features[0]!;
    f.acceptance = [
      { id: "AC001", description: "Tests pass", checkType: "bash", checkCommand: "npm test", verified: false },
    ];
    const prompt = buildWorkerPrompt(m, f);
    expect(prompt).toContain("## Feature: F001");
    expect(prompt).toContain("AC001: Tests pass");
    expect(prompt).toContain("npm test");
  });

  it("includes dependency info", () => {
    const m = createMission("Worker", "Build X");
    const f = m.milestones[0].features[0]!;
    f.dependsOn = ["F000"];
    const prompt = buildWorkerPrompt(m, f);
    expect(prompt).toContain("Dependencies");
    expect(prompt).toContain("F000");
  });

  it("tells worker NOT to call mission_feature_done", () => {
    const m = createMission("Worker", "Build X");
    const f = m.milestones[0].features[0]!;
    expect(buildWorkerPrompt(m, f)).toContain("do NOT call mission_feature_done");
  });
});

describe("exportMarkdown", () => {
  const origHome = process.env.HOME;

  beforeAll(() => {
    process.env.HOME = tmpRoot;
    cleanupTmp();
    setupTmp();
  });

  afterAll(() => {
    process.env.HOME = origHome;
    cleanupTmp();
  });

  it("produces a complete markdown report", () => {
    const m = createMission("Export", "Export test");
    m.tokensUsed = 500;
    const md = exportMarkdown(m);
    expect(md).toContain("# Mission Report: Export");
    expect(md).toContain("**Status**: active");
    expect(md).toContain("**Goal**: Export test");
    expect(md).toContain("**Goal tree**: 0/3 leaf goals (0%)");
    expect(md).toContain("**Progress**: 0/3 (0%)");
    expect(md).toContain("**Tokens used**: 500");
    expect(md).toContain("## Executive Summary");
    expect(md).toContain("## Goal Tree");
    expect(md).toContain("**Active feature**");
    expect(md).toContain("**Handoff**");
    expect(md).toContain("##");
  });

  it("shows milestone and feature sections", () => {
    const m = createMission("Export", "Export test");
    m.milestones[0].features[0]!.status = "done";
    m.milestones[0].features[0]!.completedAt = 1000;
    const md = exportMarkdown(m);
    expect(md).toContain("### F001: Clarify scope and current state");
    expect(md).toContain("**Acceptance criteria:**");
  });

  it("includes evidence section when evidence exists", async () => {
    const m = createMission("ExportEv", "Test");
    const f = m.milestones[0].features[0]!;
    f.status = "done";
    await saveMissionSafe(m);
    saveEvidence(m, f, "## Test evidence\nAll passed");
    const md = exportMarkdown(m);
    expect(md).toContain("Evidence");
    expect(md).toContain("All passed");
  });

  it("handles empty milestones gracefully", () => {
    const m = createMission("Empty", "Test");
    m.milestones = [];
    const md = exportMarkdown(m);
    expect(md).toContain("# Mission Report: Empty");
    expect(md).not.toContain("## ✅ Milestone:");
  });
});

describe("createMissionFromTemplate", () => {
  it("creates mission from refactor template", () => {
    const m = createMissionFromTemplate("refactor", "Refactor Core");
    expect(m).not.toBeNull();
    expect(m!.title).toBe("Refactor Core");
    expect(m!.goal).toContain("Refactor");
    expect(m!.milestones[0]!.description).toContain("Constraints:");
  });

  it("uses template label as fallback title", () => {
    const m = createMissionFromTemplate("auth", "");
    expect(m).not.toBeNull();
    expect(m!.title).toBe("Auth implementation");
  });

  it("returns null for unknown template", () => {
    expect(createMissionFromTemplate("nonexistent", "Title")).toBeNull();
  });

  it("ci-cd template contains pipeline goal", () => {
    const m = createMissionFromTemplate("ci-cd", "CI Setup");
    expect(m!.goal).toContain("CI/CD");
    expect(m!.milestones[0]!.description).toContain("Constraints:");
  });
});

describe("autoVerifyAcceptance", () => {
  it("verifies bash criteria with exit code 0", () => {
    const m = createMission("AutoVerify", "Test");
    const f = m.milestones[0].features[0]!;
    f.acceptance = [
      { id: "AC001", description: "Echo test", checkType: "bash", checkCommand: "echo ok", verified: false },
    ];
    const execFn = (_cmd: string) => ({ code: 0, stdout: "ok" });
    expect(autoVerifyAcceptance(f, execFn)).toBe(1);
    expect(f.acceptance[0]!.verified).toBe(true);
    expect(f.acceptance[0]!.evidence).toBe("ok");
  });

  it("does not verify bash criteria with non-zero exit", () => {
    const m = createMission("AutoVerify", "Test");
    const f = m.milestones[0].features[0]!;
    f.acceptance = [
      { id: "AC001", description: "Fail test", checkType: "bash", checkCommand: "exit 1", verified: false },
    ];
    const execFn = (_cmd: string) => ({ code: 1, stdout: "" });
    expect(autoVerifyAcceptance(f, execFn)).toBe(0);
    expect(f.acceptance[0]!.verified).toBe(false);
  });

  it("skips already verified and waived criteria", () => {
    const m = createMission("AutoVerify", "Test");
    const f = m.milestones[0].features[0]!;
    f.acceptance = [
      { id: "AC001", description: "Already done", checkType: "bash", checkCommand: "echo x", verified: true },
      { id: "AC002", description: "Waived", checkType: "bash", checkCommand: "echo x", verified: false, waived: true },
      { id: "AC003", description: "Manual check", checkType: "manual", verified: false },
    ];
    const execFn = (_cmd: string) => ({ code: 0, stdout: "x" });
    expect(autoVerifyAcceptance(f, execFn)).toBe(0);
  });

  it("handles execFn throwing gracefully", () => {
    const m = createMission("AutoVerify", "Test");
    const f = m.milestones[0].features[0]!;
    f.acceptance = [
      { id: "AC001", description: "Will throw", checkType: "bash", checkCommand: "bad", verified: false },
    ];
    const execFn = (_cmd: string) => { throw new Error("Command failed"); };
    expect(autoVerifyAcceptance(f, execFn)).toBe(0);
  });
});

describe("detectStaleFeature", () => {

  it("returns null for non-active mission", () => {
    const m = createMission("Stale", "Test");
    m.status = "paused";
    expect(detectStaleFeature(m)).toBeNull();
  });

  it("returns null when no active feature", () => {
    const m = createMission("Stale", "Test");
    m.activeFeatureId = undefined;
    expect(detectStaleFeature(m)).toBeNull();
  });

  it("returns null when feature has no startedAt", () => {
    const m = createMission("Stale", "Test");
    m.milestones[0].features[0]!.startedAt = undefined;
    expect(detectStaleFeature(m)).toBeNull();
  });

  it("returns null when within both limits", () => {
    const m = createMission("Stale", "Test");
    m.milestones[0].features[0]!.startedAt = Date.now();
    expect(detectStaleFeature(m, Date.now() + 1000)).toBeNull();
  });

  it("warns when approaching time limit (two-tier: > 20min)", () => {
    const m = createMission("Stale", "Test");
    const f = m.milestones[0].features[0]!;
    f.startedAt = 1000;
    // Don't set maxWallClockMs — defaults to 30 min, so 21 min is warn level
    const alert = detectStaleFeature(m, 1000 + 21 * 60 * 1000); // 21 min elapsed
    expect(alert).not.toBeNull();
    expect(alert!.level).toBe("warn");
    expect(alert!.activeMs).toBe(21 * 60 * 1000);
  });

  it("detects time-exceeded stale feature (critical)", () => {
    const m = createMission("Stale", "Test");
    const f = m.milestones[0].features[0]!;
    f.startedAt = 1000;
    f.maxWallClockMs = 1000;
    const alert = detectStaleFeature(m, 3000);
    expect(alert).not.toBeNull();
    expect(alert!.level).toBe("critical");
    expect(alert!.featureId).toBe("F001");
    expect(alert!.activeMs).toBe(2000);
  });

  it("detects tools-exceeded stale feature (critical)", () => {
    const m = createMission("Stale", "Test");
    const f = m.milestones[0].features[0]!;
    f.startedAt = 1000;
    f.maxToolCalls = 5;
    f.toolCallCount = 10;
    const alert = detectStaleFeature(m, 2000);
    expect(alert).not.toBeNull();
    expect(alert!.level).toBe("critical");
    expect(alert!.toolCallsUsed).toBe(10);
    expect(alert!.maxToolCalls).toBe(5);
  });

  it("returns warn at 20min default, critical at 30min default", () => {
    const m = createMission("Stale", "Test");
    const f = m.milestones[0].features[0]!;
    f.startedAt = 1;
    // 25 min elapsed → should be "warn" (past 20min but not past 30min)
    const warnAlert = detectStaleFeature(m, 1 + 25 * 60 * 1000);
    expect(warnAlert?.level).toBe("warn");
    // 31 min elapsed → should be "critical" (past 30min default)
    const critAlert = detectStaleFeature(m, 1 + 31 * 60 * 1000);
    expect(critAlert?.level).toBe("critical");
  });
});

describe("autoUnblockResolved", () => {

  it("unblocks features whose dependencies are now done", () => {
    const m = createMission("Unblock", "Test");
    // F001 done, F002 waiting (waiting on F001), F003 pending
    m.milestones[0].features[0]!.status = "done";
    m.milestones[0].features[1]!.status = "waiting";
    m.milestones[0].features[1]!.notes = "Waiting on F001";
    expect(autoUnblockResolved(m)).toBe(1);
    expect(m.milestones[0].features[1]!.status).toBe("pending");
    expect(m.milestones[0].features[1]!.notes).toBeUndefined();
  });

  it("unblocks features with no deps", () => {
    const m = createMission("Unblock", "Test");
    // Add a waiting feature with no dependencies
    m.milestones[0].features[0]!.status = "waiting";
    m.milestones[0].features[0]!.dependsOn = [];
    m.milestones[0].features[0]!.notes = "Stuck";
    expect(autoUnblockResolved(m)).toBe(1);
    expect(m.milestones[0].features[0]!.status).toBe("pending");
  });

  it("does not unblock when deps still unresolved", () => {
    const m = createMission("Unblock", "Test");
    m.milestones[0].features[1]!.status = "waiting";
    m.milestones[0].features[1]!.notes = "Waiting";
    // F001 is not done, so F002 should stay waiting
    expect(autoUnblockResolved(m)).toBe(0);
    expect(m.milestones[0].features[1]!.status).toBe("waiting");
  });

  it("returns 0 when nothing to unblock", () => {
    const m = createMission("Unblock", "Test");
    expect(autoUnblockResolved(m)).toBe(0);
  });
});

describe("autoCompleteMilestones", () => {
  it("returns 0 and does not change status when features are pending or active", () => {
    const m = createMission("AC", "Test");
    m.milestones[0].status = "active";
    expect(autoCompleteMilestones(m)).toBe(0);
    expect(m.milestones[0].status).toBe("active"); // unchanged
  });

  it("auto-completes milestone when all features are done", () => {
    const m = createMission("AC", "Test");
    m.milestones[0].features[0]!.status = "done";
    m.milestones[0].features[1]!.status = "done";
    m.milestones[0].features[2]!.status = "done";
    m.milestones[0].status = "active";
    expect(autoCompleteMilestones(m)).toBe(1);
    expect(m.milestones[0].status).toBe("complete");
  });

  it("does NOT auto-complete when any feature is failed", () => {
    const m = createMission("AC", "Test");
    m.milestones[0].features[0]!.status = "done";
    m.milestones[0].features[1]!.status = "done";
    m.milestones[0].features[2]!.status = "failed";
    m.milestones[0].status = "active";
    expect(autoCompleteMilestones(m)).toBe(0);
    expect(m.milestones[0].status).toBe("active"); // NOT complete
  });

  it("skips already complete milestones and returns 0", () => {
    const m = createMission("AC", "Test");
    m.milestones[0].status = "complete";
    expect(autoCompleteMilestones(m)).toBe(0);
    expect(m.milestones[0].status).toBe("complete"); // unchanged
  });

  it("returns 1 for empty milestones (vacuous truth)", () => {
    const m = createMission("AC", "Test");
    m.milestones[0].features = [];
    m.milestones[0].status = "active";
    expect(autoCompleteMilestones(m)).toBe(1); // every([]) = true → auto-complete
  });

  it("sets milestone to active when it has an active feature", () => {
    const m = createMission("AC", "Test");
    m.milestones[0].status = "pending";
    m.milestones[0].features[0]!.status = "active";
    expect(autoCompleteMilestones(m)).toBe(0);
    expect(m.milestones[0].status).toBe("active");
  });

  it("handles multiple milestones correctly", () => {
    const m = createMission("AC", "Test");
    m.milestones[0].status = "active";
    m.milestones[0].features[0]!.status = "done";
    m.milestones[0].features[1]!.status = "done";
    m.milestones[0].features[2]!.status = "done";
    // Add second milestone
    m.milestones.push({
      id: "M02",
      title: "Second",
      description: "",
      status: "active",
      features: [
        { id: "F004", milestoneId: "M02", title: "F1", description: "", priority: 1, dependsOn: [], acceptance: [], status: "done", sessions: [], toolCallCount: 0 },
        { id: "F005", milestoneId: "M02", title: "F2", description: "", priority: 2, dependsOn: [], acceptance: [], status: "pending", sessions: [], toolCallCount: 0 },
      ],
    });
    expect(autoCompleteMilestones(m)).toBe(1); // only M01 complete
    expect(m.milestones[0].status).toBe("complete");
    expect(m.milestones[1].status).toBe("active"); // M02 still has pending
  });
});

describe("evidenceIntegrityHash", () => {
  const origHome = process.env.HOME;

  beforeAll(() => {
    process.env.HOME = tmpRoot;
    cleanupTmp();
    setupTmp();
  });

  afterAll(() => {
    process.env.HOME = origHome;
    cleanupTmp();
  });

  it("returns null when evidence file does not exist", () => {
    const m = createMission("Hash", "Test");
    expect(evidenceIntegrityHash(m, "F001")).toBeNull();
  });

  it("returns sha256 hex hash of evidence file", async () => {
    const m = createMission("Hash", "Test");
    const f = m.milestones[0].features[0]!;
    await saveMissionSafe(m);
    saveEvidence(m, f, "test data");
    const hash = evidenceIntegrityHash(m, f.id);
    expect(hash).not.toBeNull();
    expect(hash).toHaveLength(64);
    expect(typeof hash).toBe("string");
  });

  it("produces different hashes for different content", async () => {
    const m = createMission("Hash", "Test");
    const f1 = m.milestones[0].features[0]!;
    const f2 = m.milestones[0].features[1]!;
    await saveMissionSafe(m);
    saveEvidence(m, f1, "data one");
    saveEvidence(m, f2, "data two");
    expect(evidenceIntegrityHash(m, "F001")).not.toBe(evidenceIntegrityHash(m, "F002"));
  });
});

describe("computeMissionMetrics", () => {
  const origHome = process.env.HOME;

  beforeAll(() => {
    process.env.HOME = tmpRoot;
    cleanupTmp();
    setupTmp();
  });

  afterAll(() => {
    process.env.HOME = origHome;
    cleanupTmp();
  });

  it("computes metrics for a fresh mission", () => {
    const m = createMission("Metrics", "Test");
    const metrics = computeMissionMetrics(m);
    expect(metrics.totalFeatures).toBe(3);
    expect(metrics.featuresDone).toBe(0);
    expect(metrics.featuresFailed).toBe(0);
    expect(metrics.totalTokensUsed).toBe(0);
    expect(metrics.acceptanceFailures).toBeGreaterThan(0);
    expect(metrics.totalWallClockMs).toBeGreaterThanOrEqual(0);
  });

  it("counts done and failed features", () => {
    const m = createMission("Metrics", "Test");
    m.milestones[0].features[0]!.status = "done";
    m.milestones[0].features[1]!.status = "failed";
    const metrics = computeMissionMetrics(m);
    expect(metrics.featuresDone).toBe(1);
    expect(metrics.featuresFailed).toBe(1);
  });

  it("tracks acceptance failures", () => {
    const m = createMission("Metrics", "Test");
    // F001 has 1 AC not verified
    const metrics = computeMissionMetrics(m);
    expect(metrics.acceptanceFailures).toBeGreaterThanOrEqual(3); // 3 features × 1 AC each
  });

  it("sets completed from mission_complete event", async () => {
    const m = createMission("Metrics", "Test");
    m.createdAt = 1000000;
    await saveMissionSafe(m);
    appendHistory(m, { event: "mission_complete" });
    const metrics = computeMissionMetrics(m);
    expect(metrics.completed).toBeGreaterThan(0);
  });

  it("computes evidenceHashErrors for done features without evidence", async () => {
    const m = createMission("Metrics", "Test");
    m.milestones[0].features[0]!.status = "done";
    await saveMissionSafe(m);
    // No evidence saved → evidenceHashErrors should be 1
    const metrics = computeMissionMetrics(m);
    expect(metrics.evidenceHashErrors).toBeGreaterThanOrEqual(1);
  });
});

describe("calculateMetricsSummary", () => {
  const origHome = process.env.HOME;

  beforeAll(() => {
    process.env.HOME = tmpRoot;
    cleanupTmp();
    setupTmp();
  });

  afterAll(() => {
    process.env.HOME = origHome;
    cleanupTmp();
  });

  it("calculates summary across all missions", async () => {
    const m1 = createMission("Mission 1", "Test 1");
    const m2 = createMission("Mission 2", "Test 2");
    
    // Mark first mission as complete
    m1.status = "complete";
    m1.milestones[0].features[0]!.status = "done";
    m1.milestones[0].features[1]!.status = "done";
    m1.milestones[0].features[2]!.status = "done";
    await saveMissionSafe(m1);
    appendHistory(m1, { event: "mission_complete" });
    
    // Mark second mission as still active
    m2.milestones[0].features[0]!.status = "done";
    await saveMissionSafe(m2);
    
    const summary = calculateMetricsSummary();
    expect(summary.totalMissions).toBeGreaterThanOrEqual(2); // At least our 2 new missions
    expect(summary.completedMissions).toBeGreaterThanOrEqual(1); // At least our 1 completed mission
    expect(summary.averageTokensPerMission).toBeGreaterThanOrEqual(0);
    expect(summary.averageFeaturesPerMission).toBeGreaterThan(0);
  });
});

describe("readRawSchemaVersion", () => {
  const origHome = process.env.HOME;

  beforeAll(() => {
    process.env.HOME = tmpRoot;
    cleanupTmp();
    setupTmp();
  });

  afterAll(() => {
    process.env.HOME = origHome;
    cleanupTmp();
  });

  it("returns null for unknown mission", () => {
    expect(readRawSchemaVersion("nonexistent-999")).toBeNull();
  });

  it("returns current schema version for saved mission", async () => {
    const m = createMission("SchemaCheck", "Test");
    await saveMissionSafe(m);
    expect(readRawSchemaVersion(m.id)).toBe(3);
  });

  it("returns 1 for pre-schemaVersion missions (no schemaVersion field)", async () => {
    const m = createMission("OldFormat", "Test");
    await saveMissionSafe(m);
    // Simulate old format by writing JSON without schemaVersion
    const dir = missionDirSafe(m.id);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "plan.json"), "utf-8"));
    delete raw.schemaVersion;
    fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(raw), "utf-8");
    expect(readRawSchemaVersion(m.id)).toBe(1);
  });

  it("falls back to plan.json.bak when plan.json is corrupted", async () => {
    const m = createMission("BakVersion", "Test");
    await saveMissionSafe(m);
    m.title = "BakVersion modified";
    await saveMissionSafe(m); // creates plan.json.bak
    fs.writeFileSync(path.join(missionDirSafe(m.id), "plan.json"), "{corrupted", "utf-8");
    expect(readRawSchemaVersion(m.id)).toBe(3);
  });
});

describe("readRawMissionCounts", () => {
  const origHome = process.env.HOME;

  beforeAll(() => {
    process.env.HOME = tmpRoot;
    cleanupTmp();
    setupTmp();
  });

  afterAll(() => {
    process.env.HOME = origHome;
    cleanupTmp();
  });

  it("returns null for unknown mission", () => {
    expect(readRawMissionCounts("nonexistent-999")).toBeNull();
  });

  it("returns milestone and feature counts from plan.json", async () => {
    const m = createMission("Counts", "Test");
    await saveMissionSafe(m);
    const counts = readRawMissionCounts(m.id);
    expect(counts).not.toBeNull();
    expect(counts!.milestones).toBe(1);
    expect(counts!.features).toBe(3);
  });

  it("reads v1 flat features as 1 milestone with N features", async () => {
    const m = createMission("V1Counts", "Test");
    await saveMissionSafe(m);
    // Write a v1-style plan.json with flat features and no milestones
    const dir = missionDirSafe(m.id);
    fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify({
      id: m.id,
      title: "V1 mission",
      goal: "Test",
      status: "active",
      features: [
        { id: "F1", title: "F1", status: "done" },
        { id: "F2", title: "F2", status: "pending" },
        { id: "F3", title: "F3", status: "pending" },
        { id: "F4", title: "F4", status: "pending" },
      ],
    }, null, 2), "utf-8");
    const counts = readRawMissionCounts(m.id);
    expect(counts).not.toBeNull();
    expect(counts!.milestones).toBe(1);
    expect(counts!.features).toBe(4);
  });

  it("handles plan.json with neither milestones nor features", async () => {
    const m = createMission("EmptyCounts", "Test");
    await saveMissionSafe(m);
    const dir = missionDirSafe(m.id);
    fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify({
      id: m.id, title: "Minimal", status: "active",
    }, null, 2), "utf-8");
    const counts = readRawMissionCounts(m.id);
    expect(counts).not.toBeNull();
    expect(counts!.milestones).toBe(0);
    expect(counts!.features).toBe(0);
  });
});

describe("migrateMissionOnDisk", () => {
  const origHome = process.env.HOME;

  beforeAll(() => {
    process.env.HOME = tmpRoot;
    cleanupTmp();
    setupTmp();
  });

  afterAll(() => {
    process.env.HOME = origHome;
    cleanupTmp();
  });

  it("returns null for unknown mission", async () => {
    expect(await migrateMissionOnDisk("nonexistent-999")).toBeNull();
  });

  it("creates pre-migration backup before migrating", async () => {
    const m = createMission("MigBackup", "Test");
    await saveMissionSafe(m);

    // Simulate a v1 mission by writing v1 format
    const dir = missionDirSafe(m.id);
    fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify({
      schemaVersion: 1,
      id: m.id,
      title: "MigBackup",
      goal: "Test",
      status: "active",
      features: [
        { id: "F1", milestoneId: "M01", title: "Old feature", description: "", priority: 1, dependsOn: [], acceptance: [], status: "done", sessions: [] },
      ],
    }, null, 2), "utf-8");

    const migrated = await migrateMissionOnDisk(m.id);
    expect(migrated).not.toBeNull();
    expect(migrated!.schemaVersion).toBe(3);
    expect(migrated!.milestones).toHaveLength(1);

    // Verify backup was created
    const files = fs.readdirSync(dir);
    const backups = files.filter(f => f.startsWith("plan.json.pre-migration-") && f.endsWith(".bak"));
    expect(backups.length).toBeGreaterThanOrEqual(1);

    // Verify the backup contains original v1 data
    const backupContent = JSON.parse(fs.readFileSync(path.join(dir, backups[0]!), "utf-8"));
    expect(backupContent.schemaVersion).toBe(1);
  });

  it("migrates v3 mission in-place (no-op but still creates backup)", async () => {
    const m = createMission("MigV3", "Test");
    await saveMissionSafe(m);

    const migrated = await migrateMissionOnDisk(m.id);
    expect(migrated).not.toBeNull();
    expect(migrated!.schemaVersion).toBe(3);

    // Reload and verify
    const reloaded = loadMissionFromDisk(m.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.schemaVersion).toBe(3);
  });

  it("writes migrated state that is loadable via loadMissionFromDisk", async () => {
    const m = createMission("MigRoundtrip", "Test");
    await saveMissionSafe(m);

    // Write v1 format
    const dir = missionDirSafe(m.id);
    fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify({
      schemaVersion: 1,
      id: m.id,
      title: "MigRoundtrip",
      goal: "Test roundtrip",
      status: "active",
      features: [
        { id: "A1", milestoneId: "M01", title: "Alpha", description: "desc A", priority: 1, dependsOn: [], acceptance: [], status: "done", sessions: [] },
        { id: "B1", milestoneId: "M01", title: "Beta", description: "desc B", priority: 2, dependsOn: [], acceptance: [], status: "pending", sessions: [] },
      ],
    }, null, 2), "utf-8");

    const migrated = await migrateMissionOnDisk(m.id);
    expect(migrated).not.toBeNull();

    const reloaded = loadMissionFromDisk(m.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.schemaVersion).toBe(3);
    expect(reloaded!.milestones).toHaveLength(1);
    const features = reloaded!.milestones.flatMap(ml => ml.features);
    expect(features).toHaveLength(2);
    expect(features.map(f => f.id).sort()).toEqual(["A1", "B1"]);
  });
});
