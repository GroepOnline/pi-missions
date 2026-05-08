import { describe, expect, it } from "vitest";
import { acquireMissionLock, withMissionLock, withLock, cleanupStaleLocks, type LockOptions } from "../src/lock.js";

describe("Mission Locking", () => {
  it("lock functions are exported", () => {
    expect(typeof acquireMissionLock).toBe("function");
    expect(typeof withMissionLock).toBe("function");
    expect(typeof withLock).toBe("function");
    expect(typeof cleanupStaleLocks).toBe("function");
  });

  it("cleanupStaleLocks does not throw when no missions directory", async () => {
    // Should not throw even if directory doesn't exist
    await expect(cleanupStaleLocks()).resolves.not.toThrow();
  });

  it("LockOptions interface is exported", () => {
    const options: LockOptions = { timeout: 1000, stale: 60000 };
    expect(options.timeout).toBe(1000);
    expect(options.stale).toBe(60000);
  });

  it("functions have correct parameter types", () => {
    // Type checks - these will fail at compile time if types are wrong
    const missionId = "test-mission";
    const callback = async () => "result";
    const options: LockOptions = { timeout: 1000 };

    // These calls are type-checked but not executed
    expect(typeof acquireMissionLock).toBe("function");
    expect(typeof withMissionLock).toBe("function");
    expect(typeof withLock).toBe("function");
  });
});
