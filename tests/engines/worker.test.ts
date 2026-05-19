import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { createMission } from "../../src/core/state.js";
import type { Feature, MissionState } from "../../src/core/types.js";

// ── Mock node:child_process before importing the module under test ──────────
// Use vi.hoisted so the mock factory can access it (Vitest hoists vi.mock calls).
const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));
vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

// ── Mock state helpers to avoid disk writes ─────────────────────────────────
vi.mock("../../src/core/state.js", async () => {
  const actual = await vi.importActual("../../src/core/state.js");
  return {
    ...(actual as object),
    appendHistory: vi.fn(),
    saveMissionSafe: vi.fn(() => Promise.resolve()),
    getFeatureById: (await vi.importActual("../../src/core/state.js") as any).getFeatureById,
  };
});

// ── Now import the module under test ────────────────────────────────────────
import {
  buildWorkerPrompt,
  getActiveWorker,
  isWorkerRunning,
  killWorker,
  spawnWorker,
  type WorkerConfig,
  type WorkerResult,
  type ActiveWorker,
} from "../../src/engines/worker.js";
import { appendHistory } from "../../src/core/state.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function makeMission(title = "Worker Test", goal = "Test worker engine"): MissionState {
  return createMission(title, goal);
}

function activeFeature(m: MissionState): Feature {
  const f = m.milestones[0]!.features[0]!;
  f.status = "active";
  return f;
}

/** Create a fake ChildProcess-like EventEmitter with mocked .kill() */
function fakeChildProcess(): ChildProcess & { emitClose(code: number | null, signal: string | null): void; emitError(msg: string): void } {
  const emitter = new EventEmitter() as any;
  emitter.stdin = null;
  emitter.stdout = new EventEmitter();
  emitter.stderr = new EventEmitter();
  emitter.kill = vi.fn();
  emitter.pid = 12345;
  emitter.emitClose = (code: number | null, signal: string | null) => {
    emitter.emit("close", code, signal);
  };
  emitter.emitError = (msg: string) => {
    emitter.emit("error", new Error(msg));
  };
  return emitter as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset worker module state by forcing the internal singleton to null.
  // We do this by killing any leftover worker and resetting mocks.
});

afterEach(() => {
  // Only restore env stubs; don't restoreAllMocks (would break module-level vi.mock)
  vi.unstubAllEnvs();
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildWorkerPrompt
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildWorkerPrompt", () => {
  it("builds a prompt with mission context and feature instructions", () => {
    const m = makeMission();
    const f = activeFeature(m);
    const prompt = buildWorkerPrompt(m, f);

    expect(prompt).toContain("You are a worker agent executing a single feature");
    expect(prompt).toContain(`/mission load ${m.id}`);
    expect(prompt).toContain("mission_feature_done");
    expect(prompt).toContain("mission_block_self");
    expect(prompt).toContain("mission_ask_user");
    expect(prompt).toContain("Provide a brief summary");
    // Does NOT contain the Additional Instructions section by default
    expect(prompt).not.toContain("## Additional Instructions");
  });

  it("includes customPrompt in Additional Instructions section when provided", () => {
    const m = makeMission();
    const f = activeFeature(m);
    const prompt = buildWorkerPrompt(m, f, "Run only the unit tests");

    expect(prompt).toContain("## Additional Instructions");
    expect(prompt).toContain("Run only the unit tests");
  });

  it("does not include Additional Instructions when customPrompt is undefined", () => {
    const m = makeMission();
    const f = activeFeature(m);
    const prompt = buildWorkerPrompt(m, f, undefined);

    expect(prompt).not.toContain("## Additional Instructions");
  });

  it("handles empty customPrompt string (falsy, so no section added)", () => {
    const m = makeMission();
    const f = activeFeature(m);
    const prompt = buildWorkerPrompt(m, f, "");

    // Empty string is falsy — no Additional Instructions section
    expect(prompt).not.toContain("## Additional Instructions");
  });

  it("includes mission load command with the correct mission id", () => {
    const m = makeMission("Refactor Auth", "Ensure no regressions");
    const f = activeFeature(m);

    const prompt = buildWorkerPrompt(m, f);
    expect(prompt).toContain(`/mission load ${m.id}`);
    expect(prompt).toContain("mission_feature_done");
    expect(prompt).toContain("mission_block_self");
    expect(prompt).toContain("mission_ask_user");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getActiveWorker / isWorkerRunning / killWorker (module state)
// ═══════════════════════════════════════════════════════════════════════════════

describe("worker state (no worker)", () => {
  it("getActiveWorker returns null when no worker is running", () => {
    expect(getActiveWorker()).toBeNull();
  });

  it("isWorkerRunning returns false when no worker is running", () => {
    expect(isWorkerRunning()).toBe(false);
  });

  it("killWorker returns false when no worker is running", () => {
    expect(killWorker()).toBe(false);
  });
});

describe("worker state after starting a worker", () => {
  it("getActiveWorker returns the active worker while running", async () => {
    const m = makeMission();
    const f = activeFeature(m);

    const child = fakeChildProcess();
    mockSpawn.mockReturnValue(child);

    // Don't await — we want to check state before the process closes
    const promise = spawnWorker(m, { featureId: f.id, timeoutMs: 50 });

    expect(getActiveWorker()).not.toBeNull();
    expect(getActiveWorker()!.featureId).toBe(f.id);
    expect(getActiveWorker()!.status).toBe("running");

    // Clean up
    child.emitClose(0, null);
    await promise;
  });

  it("isWorkerRunning returns true while worker is running", async () => {
    const m = makeMission();
    const f = activeFeature(m);

    const child = fakeChildProcess();
    mockSpawn.mockReturnValue(child);

    const promise = spawnWorker(m, { featureId: f.id, timeoutMs: 50 });

    expect(isWorkerRunning()).toBe(true);

    child.emitClose(0, null);
    await promise;
  });

  it("spawnWorker returns error when worker is already running", async () => {
    const m = makeMission();
    const f = activeFeature(m);

    const child = fakeChildProcess();
    mockSpawn.mockReturnValue(child);

    // Start first worker (don't await)
    const _first = spawnWorker(m, { featureId: f.id, timeoutMs: 50 });

    // Second spawn should immediately fail
    const result = await spawnWorker(m, { featureId: f.id });
    expect("error" in result).toBe(true);
    expect((result as { error: string }).error).toContain("Worker already running");

    // Clean up
    child.emitClose(0, null);
    await _first;
  });

  it("killWorker returns true and kills the worker process", async () => {
    const m = makeMission();
    const f = activeFeature(m);

    const child = fakeChildProcess();
    mockSpawn.mockReturnValue(child);

    const promise = spawnWorker(m, { featureId: f.id, timeoutMs: 5000 });

    expect(killWorker()).toBe(true);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(isWorkerRunning()).toBe(true); // not yet "closed"

    child.emitClose(null, "SIGTERM");
    const result = await promise;
    const wr = result as WorkerResult;
    expect(wr.signal).toBe("SIGTERM");
    expect(wr.killed).toBe(false); // only timeout sets killed
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// spawnWorker early returns
// ═══════════════════════════════════════════════════════════════════════════════

describe("spawnWorker — early returns", () => {
  it("returns error when feature is not found", async () => {
    const m = makeMission();
    const result = await spawnWorker(m, { featureId: "F999" });

    expect("error" in result).toBe(true);
    expect((result as { error: string }).error).toContain("Feature not found");
    expect((result as { error: string }).error).toContain("F999");
  });

  it("returns error when mission has no milestones", async () => {
    const m = makeMission();
    m.milestones = [];
    const result = await spawnWorker(m, { featureId: "F001" });

    expect("error" in result).toBe(true);
    expect((result as { error: string }).error).toContain("Feature not found");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// spawnWorker — full lifecycle with mocked child_process
// ═══════════════════════════════════════════════════════════════════════════════

describe("spawnWorker — process lifecycle", () => {
  it("resolves with WorkerResult on successful exit (code 0)", async () => {
    const m = makeMission();
    const f = activeFeature(m);

    const child = fakeChildProcess();
    mockSpawn.mockReturnValue(child);

    const promise = spawnWorker(m, { featureId: f.id, timeoutMs: 5000 });

    // Simulate stdout data
    child.stdout!.emit("data", Buffer.from("Feature implemented"));
    child.stderr!.emit("data", Buffer.from(""));

    // Emit successful close
    child.emitClose(0, null);

    const result = await promise;
    expect("error" in result).toBe(false);
    const wr = result as WorkerResult;
    expect(wr.exitCode).toBe(0);
    expect(wr.signal).toBeNull();
    expect(wr.killed).toBe(false);
    expect(wr.stdout).toContain("Feature implemented");
    expect(wr.durationMs).toBeGreaterThanOrEqual(0);

    // Worker status should be 'done'
    const active = getActiveWorker();
    expect(active).not.toBeNull();
    expect(active!.status).toBe("done");
  });

  it("resolves with WorkerResult on error exit (code 1)", async () => {
    const m = makeMission();
    const f = activeFeature(m);

    const child = fakeChildProcess();
    mockSpawn.mockReturnValue(child);

    const promise = spawnWorker(m, { featureId: f.id, timeoutMs: 5000 });

    child.stderr!.emit("data", Buffer.from("Error: test failed"));
    child.emitClose(1, null);

    const result = await promise;
    const wr = result as WorkerResult;
    expect(wr.exitCode).toBe(1);
    expect(wr.stderr).toContain("Error: test failed");
    expect(wr.killed).toBe(false);

    const active = getActiveWorker();
    expect(active!.status).toBe("error");
  });

  it("resolves with signal info when process is killed by signal", async () => {
    const m = makeMission();
    const f = activeFeature(m);

    const child = fakeChildProcess();
    mockSpawn.mockReturnValue(child);

    const promise = spawnWorker(m, { featureId: f.id, timeoutMs: 5000 });

    child.emitClose(null, "SIGKILL");

    const result = await promise;
    const wr = result as WorkerResult;
    expect(wr.exitCode).toBeNull();
    expect(wr.signal).toBe("SIGKILL");
  });

  it("handles process error (e.g., binary not found)", async () => {
    const m = makeMission();
    const f = activeFeature(m);

    const child = fakeChildProcess();
    mockSpawn.mockReturnValue(child);

    const promise = spawnWorker(m, { featureId: f.id, timeoutMs: 5000 });

    child.emitError("ENOENT: pi not found");

    const result = await promise;
    expect("error" in result).toBe(true);
    expect((result as { error: string }).error).toContain("Worker process error");
    expect((result as { error: string }).error).toContain("ENOENT");

    // activeWorker should be null after process error
    expect(getActiveWorker()).toBeNull();
  });

  it("truncates stdout at MAX_STDOUT_BYTES", async () => {
    const m = makeMission();
    const f = activeFeature(m);

    const child = fakeChildProcess();
    mockSpawn.mockReturnValue(child);

    const promise = spawnWorker(m, { featureId: f.id, timeoutMs: 5000 });

    // Send 100KB of data (MAX_STDOUT_BYTES = 50_000)
    child.stdout!.emit("data", Buffer.alloc(60_000, "a"));

    child.emitClose(0, null);
    const result = await promise;
    const wr = result as WorkerResult;
    expect(wr.stdout.length).toBeLessThanOrEqual(50_000);
  });

  it("truncates stderr at MAX_STDERR_BYTES", async () => {
    const m = makeMission();
    const f = activeFeature(m);

    const child = fakeChildProcess();
    mockSpawn.mockReturnValue(child);

    const promise = spawnWorker(m, { featureId: f.id, timeoutMs: 5000 });

    child.stderr!.emit("data", Buffer.alloc(30_000, "b")); // MAX_STDERR_BYTES = 25_000

    child.emitClose(0, null);
    const result = await promise;
    const wr = result as WorkerResult;
    expect(wr.stderr.length).toBeLessThanOrEqual(25_000);
  });

  it("times out and kills the worker process", async () => {
    vi.useFakeTimers();

    const m = makeMission();
    const f = activeFeature(m);

    const child = fakeChildProcess();
    mockSpawn.mockReturnValue(child);

    // Short timeout
    const promise = spawnWorker(m, { featureId: f.id, timeoutMs: 100 });

    // Advance time past timeout
    vi.advanceTimersByTime(150);

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(getActiveWorker()!.status).toBe("timeout");

    // Now let the process close
    child.emitClose(null, "SIGTERM");
    const result = await promise;
    const wr = result as WorkerResult;
    expect(wr.killed).toBe(true);

    vi.useRealTimers();
  });

  it("logs worker result to history via appendHistory", async () => {
    const m = makeMission();
    const f = activeFeature(m);

    const child = fakeChildProcess();
    mockSpawn.mockReturnValue(child);

    const promise = spawnWorker(m, { featureId: f.id, timeoutMs: 5000 });
    child.emitClose(0, null);
    await promise;

    expect(appendHistory).toHaveBeenCalled();
    const historyCall = (appendHistory as any).mock.calls[0] as any;
    expect(historyCall[1].event).toBe("worker_finished");
    expect(historyCall[1].featureId).toBe(f.id);
    expect(historyCall[1].details.exitCode).toBe(0);
  });

  it("passes the correct args to child_process.spawn", async () => {
    const m = makeMission();
    const f = activeFeature(m);

    const child = fakeChildProcess();
    mockSpawn.mockReturnValue(child);

    const promise = spawnWorker(m, {
      featureId: f.id,
      model: "azure-deepseek/DeepSeek-V4",
      timeoutMs: 5000,
    });
    child.emitClose(0, null);
    await promise;

    expect(mockSpawn).toHaveBeenCalled();
    const spawnArgs = mockSpawn.mock.calls[0] as any[];
    // First arg is the pi binary
    expect(spawnArgs[0]).toBeDefined();
    // Second arg is the args array
    const args = spawnArgs[1] as string[];
    expect(args).toContain("--model");
    expect(args).toContain("azure-deepseek/DeepSeek-V4");
    // The prompt is passed as a positional argument
    const promptArg = args.find((a: string) => a.includes("You are a worker agent"));
    expect(promptArg).toBeDefined();
  });

  it("includes -e flag when PI_MISSIONS_EXTENSION_PATH is set", async () => {
    vi.stubEnv("PI_MISSIONS_EXTENSION_PATH", "/path/to/pi-missions/index.ts");

    const m = makeMission();
    const f = activeFeature(m);

    const child = fakeChildProcess();
    mockSpawn.mockReturnValue(child);

    const promise = spawnWorker(m, { featureId: f.id, timeoutMs: 5000 });
    child.emitClose(0, null);
    await promise;

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain("-e");
    expect(args).toContain("/path/to/pi-missions/index.ts");

    vi.unstubAllEnvs();
  });

  it("does not include -e flag when PI_MISSIONS_EXTENSION_PATH is not set", async () => {
    vi.stubEnv("PI_MISSIONS_EXTENSION_PATH", undefined);

    const m = makeMission();
    const f = activeFeature(m);

    const child = fakeChildProcess();
    mockSpawn.mockReturnValue(child);

    const promise = spawnWorker(m, { featureId: f.id, timeoutMs: 5000 });
    child.emitClose(0, null);
    await promise;

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).not.toContain("-e");

    vi.unstubAllEnvs();
  });

  it("uses PI_WORKER_MODEL env var when no model in config", async () => {
    vi.stubEnv("PI_WORKER_MODEL", "env-model");

    const m = makeMission();
    const f = activeFeature(m);

    const child = fakeChildProcess();
    mockSpawn.mockReturnValue(child);

    const promise = spawnWorker(m, { featureId: f.id, timeoutMs: 5000 });
    child.emitClose(0, null);
    await promise;

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain("--model");
    expect(args).toContain("env-model");

    vi.unstubAllEnvs();
  });

  it("defaults model to 'auto' when no config or env var", async () => {
    vi.stubEnv("PI_WORKER_MODEL", undefined);

    const m = makeMission();
    const f = activeFeature(m);

    const child = fakeChildProcess();
    mockSpawn.mockReturnValue(child);

    const promise = spawnWorker(m, { featureId: f.id, timeoutMs: 5000 });
    child.emitClose(0, null);
    await promise;

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain("--model");
    expect(args).toContain("auto");

    vi.unstubAllEnvs();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Type validation
// ═══════════════════════════════════════════════════════════════════════════════

describe("type exports", () => {
  it("WorkerConfig has expected shape", () => {
    const config: WorkerConfig = {
      featureId: "F001",
      customPrompt: "Run tests",
      model: "gpt-4",
      timeoutMs: 300_000,
    };
    expect(config.featureId).toBe("F001");
    expect(config.customPrompt).toBe("Run tests");
  });

  it("WorkerResult has expected shape", () => {
    const result: WorkerResult = {
      featureId: "F001",
      exitCode: 0,
      signal: null,
      stdout: "output",
      stderr: "",
      durationMs: 1234,
      killed: false,
    };
    expect(result.exitCode).toBe(0);
    expect(result.killed).toBe(false);
    expect(result.durationMs).toBe(1234);
  });

  it("ActiveWorker has expected shape", () => {
    const child = fakeChildProcess();
    const worker: ActiveWorker = {
      process: child as any,
      featureId: "F001",
      startedAt: Date.now(),
      status: "running",
    };
    expect(worker.featureId).toBe("F001");
    expect(worker.status).toBe("running");
  });
});
