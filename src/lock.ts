import * as fs from "node:fs";
import * as path from "node:path";
import * as lockfile from "proper-lockfile";

const LOCK_TIMEOUT = 5000;
const LOCK_STALE = 30000;

export interface LockOptions {
  timeout?: number;
  stale?: number;
}

/**
 * Compute the canonical, filesystem-safe directory path for a mission under the user's missions root.
 *
 * The missions root is resolved from the user's HOME or USERPROFILE and the ".pi/missions" subpath. The provided `missionId` is sanitized by replacing any character not in `[a-zA-Z0-9._-]` with `-`, and the resulting path is validated to prevent path traversal.
 *
 * @param missionId - The mission identifier to convert into a safe directory name
 * @returns The resolved absolute directory path for the mission under the user's missions root
 * @throws Error if the resolved path would escape the missions root (path traversal)
 */
function missionDirSafeLocal(missionId: string): string {
  const root = path.resolve(process.env.HOME || process.env.USERPROFILE || "", ".pi", "missions");
  const safeId = missionId.replace(/[^a-zA-Z0-9._-]/g, "-");
  const resolved = path.resolve(root, safeId);
  if (!resolved.startsWith(root + path.sep)) throw new Error("Invalid mission id: path traversal detected");
  return resolved;
}

/**
 * Acquire an exclusive lock for the given mission and ensure the mission directory exists.
 *
 * @param missionId - Mission identifier; it will be sanitized and used to compute the mission directory.
 * @param options - Lock options; `stale` can override the lock staleness timeout.
 * @returns A function that releases the acquired lock; calling it returns a promise that resolves when the lock is released.
 */
export async function acquireMissionLock(missionId: string, options: LockOptions = {}): Promise<() => Promise<void>> {
  const dir = missionDirSafeLocal(missionId);
  fs.mkdirSync(dir, { recursive: true });
  return lockfile.lock(path.join(dir, ".lock"), {
    retries: { retries: 10, minTimeout: 100, maxTimeout: 500 },
    stale: options.stale ?? LOCK_STALE,
    realpath: false,
  });
}

/**
 * Acquire an exclusive lock on the given lock file, run `callback` while the lock is held, and release the lock afterwards.
 *
 * @param lockPath - Filesystem path to the lock file to acquire (parent directory will be created if missing)
 * @param callback - Function to execute while the lock is held
 * @param options - Optional lock behavior overrides (`timeout` is unused internally but available for callers; `stale` overrides the stale duration)
 * @returns The value returned by `callback`
 */
export async function withLock<T>(lockPath: string, callback: () => Promise<T> | T, options?: LockOptions): Promise<T> {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const release = await lockfile.lock(lockPath, {
    retries: { retries: 10, minTimeout: 100, maxTimeout: 500 },
    stale: options?.stale ?? LOCK_STALE,
    realpath: false,
  });
  const timeout = options?.timeout ?? LOCK_TIMEOUT;
  void timeout;
  try {
    return await callback();
  } finally {
    await release();
  }
}

/**
 * Acquire an exclusive lock for the specified mission and execute the given callback while the lock is held.
 *
 * @param missionId - Identifier for the mission; it will be sanitized and used to locate the mission's lock file
 * @param callback - Function to execute while holding the lock
 * @param options - Optional lock behavior overrides (`timeout`, `stale`)
 * @returns The value returned by `callback`
 */
export async function withMissionLock<T>(missionId: string, callback: () => Promise<T> | T, options?: LockOptions): Promise<T> {
  return withLock(path.join(missionDirSafeLocal(missionId), ".lock"), callback, options);
}

/**
 * Releases stale `.lock` files for all missions under the user's `.pi/missions` directory.
 *
 * Scans the resolved missions root (HOME or USERPROFILE + `/.pi/missions`) and attempts to unlock
 * each mission's `.lock` file. If the missions root does not exist the function returns immediately.
 * Any errors encountered while unlocking individual lock files are suppressed.
 */
export async function cleanupStaleLocks(): Promise<void> {
  const missionsRoot = path.join(process.env.HOME || process.env.USERPROFILE || "", ".pi", "missions");
  if (!fs.existsSync(missionsRoot)) return;
  for (const entry of fs.readdirSync(missionsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try { await lockfile.unlock(path.join(missionsRoot, entry.name, ".lock"), { realpath: false }); } catch { /* noop */ }
  }
}
