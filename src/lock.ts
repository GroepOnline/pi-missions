import lockfile from "proper-lockfile";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * File locking utilities to prevent concurrent write conflicts.
 * Uses proper-lockfile with robust retry logic and stale lock detection.
 */

export interface LockOptions {
  /** Maximum time to wait for lock acquisition (ms). Default: 10000 (10s) */
  timeout?: number;
  /** Lock staleness threshold (ms). Default: 30000 (30s) */
  stale?: number;
  /** Number of retry attempts. Default: 10 */
  retries?: number;
}

const DEFAULT_OPTIONS: Required<LockOptions> = {
  timeout: 10000,
  stale: 30000,
  retries: 10,
};

/**
 * Acquire a lock on a file/directory.
 * @param filePath - Path to file or directory to lock
 * @param options - Lock configuration options
 * @returns Promise that resolves when lock is acquired
 * @throws Error if lock cannot be acquired within timeout
 */
export async function acquireLock(filePath: string, options: LockOptions = {}): Promise<() => Promise<void>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // Ensure parent directory exists for lockfile
  const parentDir = path.dirname(filePath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  // Ensure the file exists (proper-lockfile needs this)
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "", "utf-8");
  }

  try {
    const release = await lockfile.lock(filePath, {
      stale: opts.stale,
      retries: {
        retries: opts.retries,
        minTimeout: 100,
        maxTimeout: 500,
      },
    });
    
    // Return a function that releases the lock
    return async () => {
      try {
        await release();
      } catch (error) {
        // Log but don't throw - lock cleanup is best-effort
        console.error(`Failed to release lock for ${filePath}:`, error);
      }
    };
  } catch (error) {
    throw new Error(`Failed to acquire lock for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute a callback while holding a file lock.
 * @param filePath - Path to file or directory to lock
 * @param callback - Async function to execute while holding lock
 * @param options - Lock configuration options
 * @returns Result of the callback
 */
export async function withLock<T>(filePath: string, callback: () => Promise<T>, options: LockOptions = {}): Promise<T> {
  const release = await acquireLock(filePath, options);
  try {
    return await callback();
  } finally {
    await release();
  }
}

/**
 * Check if a path is currently locked.
 * @param filePath - Path to check
 * @returns true if locked, false otherwise
 */
export async function isLocked(filePath: string): Promise<boolean> {
  try {
    return await lockfile.check(filePath);
  } catch {
    return false;
  }
}
