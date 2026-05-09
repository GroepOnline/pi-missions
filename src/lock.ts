import * as fs from "node:fs";
import * as path from "node:path";
import * as lockfile from "proper-lockfile";
import { missionsRoot } from "./paths.js";

export interface LockOptions {
  stale?: number;
}

function missionDirSafeLocal(missionId: string): string {
  const root = path.resolve(missionsRoot());
  const safeId = missionId.replace(/[^a-zA-Z0-9._-]/g, "-");
  const resolved = path.resolve(root, safeId);
  if (!resolved.startsWith(root + path.sep)) throw new Error("Invalid mission id: path traversal detected");
  return resolved;
}

export async function acquireMissionLock(missionId: string, options: LockOptions = {}): Promise<() => Promise<void>> {
  const dir = missionDirSafeLocal(missionId);
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
  return withLock(path.join(missionDirSafeLocal(missionId), ".lock"), callback, options);
}

export async function cleanupStaleLocks(): Promise<void> {
  const root = missionsRoot();
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try { await lockfile.unlock(path.join(root, entry.name, ".lock"), { realpath: false }); } catch { /* noop */ }
  }
}
