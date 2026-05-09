import * as fs from "node:fs";
import * as path from "node:path";
import * as lockfile from "proper-lockfile";
import { missionsRoot } from "./paths.js";
import { missionDirSafe } from "./state.js";

export interface LockOptions {
  stale?: number;
}

export async function acquireMissionLock(missionId: string, options: LockOptions = {}): Promise<() => Promise<void>> {
  const dir = missionDirSafe(missionId);
  fs.mkdirSync(dir, { recursive: true });
  return lockfile.lock(path.join(dir, ".lock"), {
    retries: { retries: 10, minTimeout: 100, maxTimeout: 500 },
    stale: options.stale ?? 30000,
    realpath: false,
  });
}

export async function withLock<T>(lockPath: string, callback: () => Promise<T> | T, options?: LockOptions): Promise<T> {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const release = await lockfile.lock(lockPath, {
    retries: { retries: 10, minTimeout: 100, maxTimeout: 500 },
    stale: options?.stale ?? 30000,
    realpath: false,
  });
  try {
    return await callback();
  } finally {
    await release();
  }
}

export async function withMissionLock<T>(missionId: string, callback: () => Promise<T> | T, options?: LockOptions): Promise<T> {
  return withLock(path.join(missionDirSafe(missionId), ".lock"), callback, options);
}

export async function cleanupStaleLocks(): Promise<void> {
  const root = missionsRoot();
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try { await lockfile.unlock(path.join(root, entry.name, ".lock"), { realpath: false }); } catch { /* noop */ }
  }
}
