import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { acquireLock, withLock, isLocked } from "../src/lock.js";
import { missionsRoot } from "../src/state.js";

describe("File Locking", () => {
  const testDir = path.join(missionsRoot(), "lock-test");
  const testFile = path.join(testDir, "test-lock.json");

  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should acquire and release lock", async () => {
    const release = await acquireLock(testFile);
    expect(await isLocked(testFile)).toBe(true);
    await release();
    expect(await isLocked(testFile)).toBe(false);
  });

  it("should execute callback while holding lock", async () => {
    let callbackExecuted = false;
    await withLock(testFile, async () => {
      expect(await isLocked(testFile)).toBe(true);
      callbackExecuted = true;
    });
    expect(callbackExecuted).toBe(true);
    expect(await isLocked(testFile)).toBe(false);
  });

  it("should prevent concurrent access", async () => {
    const release1 = await acquireLock(testFile);
    expect(await isLocked(testFile)).toBe(true);
    
    // Try to acquire the same lock again immediately - should fail
    let secondLockAcquired = false;
    try {
      const release2 = await acquireLock(testFile, { timeout: 100, retries: 0 });
      secondLockAcquired = true;
      await release2();
    } catch {
      // Expected to fail
    }
    
    expect(secondLockAcquired).toBe(false);
    expect(await isLocked(testFile)).toBe(true);
    
    // Release first lock
    await release1();
    expect(await isLocked(testFile)).toBe(false);
  });

  it("should timeout if lock cannot be acquired", async () => {
    const release = await acquireLock(testFile);
    
    try {
      await acquireLock(testFile, { timeout: 100, retries: 1 });
      expect.fail("Should have thrown timeout error");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("Failed to acquire lock");
    } finally {
      await release();
    }
  });

  it("should handle stale locks", async () => {
    // Test that stale option is accepted
    const release = await acquireLock(testFile, { stale: 5000 });
    expect(await isLocked(testFile)).toBe(true);
    await release();
    expect(await isLocked(testFile)).toBe(false);
  });

  it("should create parent directories if they don't exist", async () => {
    const nestedFile = path.join(testDir, "nested", "deep", "file.json");
    const release = await acquireLock(nestedFile);
    expect(fs.existsSync(path.dirname(nestedFile))).toBe(true);
    await release();
  });

  it("should return callback result from withLock", async () => {
    const result = await withLock(testFile, async () => {
      return "test-result";
    });
    expect(result).toBe("test-result");
  });

  it("should release lock even if callback throws", async () => {
    try {
      await withLock(testFile, async () => {
        throw new Error("Callback error");
      });
      expect.fail("Should have thrown error");
    } catch (error) {
      expect((error as Error).message).toBe("Callback error");
    }
    // Lock should be released despite error
    expect(await isLocked(testFile)).toBe(false);
  });
});
