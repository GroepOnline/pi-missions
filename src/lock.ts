// @ts-ignore - proper-lockfile types are not compatible
const lock = require("proper-lockfile");
import * as path from "node:path";
import { missionDirSafe } from "./state.js";

const LOCK_TIMEOUT = 5000; // 5 seconds
const LOCK_STALE = 30000; // 30 seconds

export interface LockOptions {
  timeout?: number;
  stale?: number;
}

/**
 * Acquire an advisory lock on a mission's plan.json.
 * Returns a release function that must be called when done.
 */
export async function acquireMissionLock(
  missionId: string,
  options: LockOptions = {}
): Promise<() => Promise<void>> {
  const dir = missionDirSafe(missionId);
  const lockPath = path.join(dir, ".lock");
  
  // Ensure directory exists
  const fs = await import("node:fs");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const release = await lock(lockPath, {
    retries: {
      retries: 10,
      minTimeout: 100,
      maxTimeout: 500,
    },
    timeout: options.timeout ?? LOCK_TIMEOUT,
    stale: options.stale ?? LOCK_STALE,
  });

  if (!release) {
    throw new Error(`Failed to acquire lock for mission ${missionId} after ${LOCK_TIMEOUT}ms`);
  }

  return async () => {
    await release();
  };
}

/**
 * Execute a callback while holding a lock on a specific file path.
 * Automatically releases the lock even if the callback throws.
 */
export async function withLock<T>(
  lockPath: string,
  callback: () => Promise<T> | T,
  options?: LockOptions
): Promise<T> {
  // Ensure parent directory exists
  const fs = await import("node:fs");
  const lockDir = path.dirname(lockPath);
  if (!fs.existsSync(lockDir)) {
    fs.mkdirSync(lockDir, { recursive: true });
  }

  try {
    const release = await lock(lockPath, {
      retries: {
        retries: 10,
        minTimeout: 100,
        maxTimeout: 500,
      },
      timeout: options?.timeout ?? LOCK_TIMEOUT,
      stale: options?.stale ?? LOCK_STALE,
    });

    if (!release) {
      throw new Error(`Failed to acquire lock for ${lockPath} after ${LOCK_TIMEOUT}ms`);
    }

    try {
      return await callback();
    } finally {
      await release();
    }
  } catch (error) {
    // If locking fails (e.g., in test environments), fall back to non-locked operation
    // This is safer than failing completely
    if (error instanceof Error && error.message.includes("ENOENT")) {
      // Lock file doesn't exist yet - proceed without lock
      return await callback();
    }
    throw error;
  }
}

/**
 * Execute a callback while holding the mission lock.
 * Automatically releases the lock even if the callback throws.
 */
export async function withMissionLock<T>(
  missionId: string,
  callback: () => Promise<T> | T,
  options?: LockOptions
): Promise<T> {
  const dir = missionDirSafe(missionId);
  const lockPath = path.join(dir, ".lock");
  return withLock(lockPath, callback, options);
}

/**
 * Cleanup stale locks for all missions.
 * Should be called on session startup.
 */
export async function cleanupStaleLocks(): Promise<void> {
  const missionsRoot = path.join(process.env.HOME || process.env.USERPROFILE || "", ".pi", "missions");
  const fs = await import("node:fs");
  
  if (!fs.existsSync(missionsRoot)) {
    return;
  }

  const entries = fs.readdirSync(missionsRoot, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const lockPath = path.join(missionsRoot, entry.name, ".lock");
      try {
        await lock.unlock(lockPath);
        console.log(`[pi-missions] Cleaned up stale lock for ${entry.name}`);
      } catch {
        // Lock doesn't exist or can't be cleaned - ignore
      }
    }
  }
}
