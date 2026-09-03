import { spawn, type ChildProcess } from "node:child_process";
import type { Feature, MissionState } from "../core/types.js";
import { appendHistory, getFeatureById, loadMissionFromDisk } from "../core/state.js";
import {
  orchestraCorrelationEnv,
  type MissionOrchestraExecutionCorrelation,
} from "../integrations/orchestra-execution.js";
import { buildLeanContext } from "../utils/context.js";

// ═══════════════════════════════════════════════════════════════════════════
// Worker configuration & result types
// ═══════════════════════════════════════════════════════════════════════════

export interface WorkerConfig {
  featureId: string;
  customPrompt?: string;
  model?: string;
  timeoutMs?: number;
  /** Optional execution-local Orchestra correlation supplied by the mission layer. */
  orchestraCorrelation?: MissionOrchestraExecutionCorrelation;
}

export interface WorkerResult {
  featureId: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  killed: boolean;
  orchestraCorrelation?: MissionOrchestraExecutionCorrelation;
}

export type WorkerStatus = "idle" | "running" | "done" | "error" | "timeout";

export interface ActiveWorker {
  process: ChildProcess;
  featureId: string;
  startedAt: number;
  result?: WorkerResult;
  status: WorkerStatus;
  orchestraCorrelation?: MissionOrchestraExecutionCorrelation;
}

// ═══════════════════════════════════════════════════════════════════════════
// Active worker tracking (one worker at a time)
// ═══════════════════════════════════════════════════════════════════════════

let activeWorker: ActiveWorker | null = null;

export function getActiveWorker(): ActiveWorker | null {
  return activeWorker;
}

export function isWorkerRunning(): boolean {
  return activeWorker?.status === "running";
}

// ═══════════════════════════════════════════════════════════════════════════
// Extension path for worker processes
// Set by extension.ts at startup via PI_MISSIONS_EXTENSION_PATH env var.
// Workers inherit this and use it to load pi-missions in the child process.
// ═══════════════════════════════════════════════════════════════════════════

function getExtensionPath(): string | null {
  return process.env.PI_MISSIONS_EXTENSION_PATH || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Build worker prompt
// ═══════════════════════════════════════════════════════════════════════════

const MAX_STDOUT_BYTES = 50_000;
const MAX_STDERR_BYTES = 25_000;

export function buildWorkerPrompt(
  mission: MissionState,
  feature: Feature,
  customPrompt?: string,
): string {
  const context = buildLeanContext(mission);
  const lines = [
    context,
    "",
    `You are a worker agent executing a single feature in a software development mission.`,
    ``,
    `## First: Load the mission`,
    `Run: /mission load ${mission.id}`,
    ``,
    `3. Implement the smallest, most coherent change that satisfies the acceptance criteria`,
    `4. When ALL acceptance criteria are satisfied, call **mission_feature_done** with evidence`,
    `5. If you get stuck, call **mission_block_self** with a clear reason`,
    `6. If you need user input, call **mission_ask_user**`,
    `7. Do NOT move to the NEXT feature — just complete this one and stop`,
  ];

  if (customPrompt) {
    lines.push("", "## Additional Instructions", customPrompt);
  }

  lines.push(
    "",
    "## Output",
    "Provide a brief summary of what you accomplished, then call mission_feature_done with evidence.",
  );

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// Spawn worker — returns a Promise that resolves when the worker exits
// ═══════════════════════════════════════════════════════════════════════════

export function spawnWorker(
  mission: MissionState,
  config: WorkerConfig,
): Promise<WorkerResult | { error: string }> {
  if (isWorkerRunning()) {
    const running = activeWorker;
    if (running) {
      return Promise.resolve({ error: `Worker already running for feature ${running.featureId}. Wait for it to finish.` });
    }
  }

  const feature = getFeatureById(mission, config.featureId);
  if (!feature) {
    return Promise.resolve({ error: `Feature not found: ${config.featureId}` });
  }

  const prompt = buildWorkerPrompt(mission, feature, config.customPrompt);
  const piPath = process.env.PI_PATH || "pi";
  const model = config.model || process.env.PI_WORKER_MODEL || "auto";
  const timeoutMs = config.timeoutMs ?? 600_000; // 10 min default

  const extPath = getExtensionPath();
  const args: string[] = ["--model", model];

  if (extPath) {
    args.push("-e", extPath);
  }

  // pi takes messages as positional arguments; pass prompt directly
  args.push(prompt);

  const correlationEnv = config.orchestraCorrelation
    ? orchestraCorrelationEnv(config.orchestraCorrelation)
    : {};

  const child = spawn(piPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: (() => {
      const childEnv: NodeJS.ProcessEnv = { ...process.env, ...correlationEnv, PI_NO_COLOR: "1" };
      if (!config.orchestraCorrelation) {
        delete childEnv.PI_ORCHESTRA_CONTRACT_VERSION;
        delete childEnv.PI_ORCHESTRA_CALLER;
        delete childEnv.PI_MISSION_ID;
        delete childEnv.PI_MISSION_TASK_ID;
        delete childEnv.PI_MISSION_ATTEMPT_ID;
        delete childEnv.PI_ORCHESTRA_IDEMPOTENCY_KEY;
      }
      return childEnv;
    })(),
  });

  let stdout = "";
  let stderr = "";
  let killed = false;

  child.stdout?.on("data", (chunk: Buffer) => {
    if (stdout.length < MAX_STDOUT_BYTES) {
      stdout += chunk.toString().slice(0, MAX_STDOUT_BYTES - stdout.length);
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    if (stderr.length < MAX_STDERR_BYTES) {
      stderr += chunk.toString().slice(0, MAX_STDERR_BYTES - stderr.length);
    }
  });

  const startedAt = Date.now();

  activeWorker = {
    process: child,
    featureId: config.featureId,
    startedAt,
    status: "running",
    orchestraCorrelation: config.orchestraCorrelation,
  };

  const timeout = setTimeout(() => {
    killed = true;
    if (activeWorker) activeWorker.status = "timeout";
    child.kill("SIGTERM");
    setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 5000);
  }, timeoutMs);

  return new Promise<WorkerResult | { error: string }>((resolve) => {
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      const durationMs = Date.now() - startedAt;

      const result: WorkerResult = {
        featureId: config.featureId,
        exitCode: code,
        signal: signal ?? null,
        stdout,
        stderr,
        durationMs,
        killed,
        orchestraCorrelation: config.orchestraCorrelation,
      };

      if (activeWorker) {
        activeWorker.result = result;
        activeWorker.status = result.killed ? "timeout" : result.exitCode === 0 ? "done" : "error";
      }

      // The child may have persisted feature completion while it was running.
      // Re-read after close so history is only appended for a mission that
      // still exists. appendHistory writes its own JSONL record; rewriting
      // plan.json here would risk rolling newer child state back.
      try {
        const missionId = mission.id;
        const freshMission = loadMissionFromDisk(missionId);
        if (freshMission) {
          appendHistory(freshMission, {
            event: "worker_finished",
            featureId: config.featureId,
            note: `Exit ${code}${signal ? ` (${signal})` : ""} in ${Math.round(durationMs / 1000)}s`,
            details: {
              exitCode: code,
              signal: signal ?? undefined,
              durationMs,
              killed,
              missionId,
              stdoutLen: stdout.length,
              stderrLen: stderr.length,
              model,
              orchestraCorrelation: config.orchestraCorrelation,
            },
          });
        }
      } catch { /* history is best-effort for workers */ }

      resolve(result);
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      activeWorker = null;
      resolve({
        error: `Worker process error: ${err.message}`,
      } as { error: string });
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Kill active worker
// ═══════════════════════════════════════════════════════════════════════════

export function killWorker(): boolean {
  if (!activeWorker || activeWorker.status !== "running") return false;
  activeWorker.process.kill("SIGTERM");
  return true;
}
