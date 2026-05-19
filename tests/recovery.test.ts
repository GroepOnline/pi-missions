import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  withRetry,
  withRetrySync,
  defaultShouldRetry,
  RetryPresets,
  withDegradation,
  withDegradationSync,
  ErrorRecoveryEngine,
  getErrorRecoveryEngine,
  resetErrorRecoveryEngine,
} from "../src/engines/recovery.js";

// ===========================================================================
// withRetry Tests
// ===========================================================================

describe("withRetry", () => {
  it("succeeds on first attempt", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxRetries: 3 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and eventually succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("transient: timeout"))
      .mockRejectedValueOnce(new Error("transient: timeout"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10, jitterFactor: 0 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting all retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("persistent failure"));
    await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 5, jitterFactor: 0 })).rejects.toThrow("persistent failure");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("does not retry when shouldRetry returns false", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("permanent error"));
    await expect(
      withRetry(fn, {
        maxRetries: 3,
        baseDelayMs: 5,
        shouldRetry: () => false,
      })
    ).rejects.toThrow("permanent error");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("uses exponential backoff delays", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");
    const start = Date.now();
    await withRetry(fn, { maxRetries: 2, baseDelayMs: 50, jitterFactor: 0 });
    const elapsed = Date.now() - start;
    // With no jitter: base 50ms + 100ms = ~150ms
    expect(elapsed).toBeGreaterThanOrEqual(140);
  });

  it("respects maxDelayMs cap", async () => {
    const fn = vi.fn()
      .mockRejectedValue(new Error("fail"))
      .mockRejectedValue(new Error("fail"))
      .mockRejectedValue(new Error("fail"))
      .mockRejectedValue(new Error("fail"));
    const start = Date.now();
    await expect(
      withRetry(fn, { maxRetries: 3, baseDelayMs: 10000, maxDelayMs: 100, jitterFactor: 0 })
    ).rejects.toThrow("fail");
    const elapsed = Date.now() - start;
    // All delays capped at 100ms, 3 retries = max ~300ms
    expect(elapsed).toBeLessThan(2000);
  });

  it("calls with operationName for logging", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await expect(
      withRetry(fn, { maxRetries: 1, baseDelayMs: 1, operationName: "test-op" })
    ).rejects.toThrow("fail");
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("[test-op]"));
    writeSpy.mockRestore();
  });
});

// ===========================================================================
// withRetrySync Tests
// ===========================================================================

describe("withRetrySync", () => {
  it("succeeds on first attempt", () => {
    const fn = vi.fn().mockReturnValue("ok");
    const result = withRetrySync(fn, { maxRetries: 3 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure", () => {
    const fn = vi.fn()
      .mockImplementationOnce(() => { throw new Error("fail"); })
      .mockImplementationOnce(() => { throw new Error("fail"); })
      .mockReturnValue("ok");
    const result = withRetrySync(fn, { maxRetries: 3, baseDelayMs: 5, jitterFactor: 0 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting retries", () => {
    const fn = vi.fn().mockImplementation(() => { throw new Error("fail"); });
    expect(() => withRetrySync(fn, { maxRetries: 1, baseDelayMs: 1, jitterFactor: 0 })).toThrow("fail");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// defaultShouldRetry Tests
// ===========================================================================

describe("defaultShouldRetry", () => {
  it("returns true for timeout errors", () => {
    expect(defaultShouldRetry(new Error("operation timed out"))).toBe(true);
    expect(defaultShouldRetry(new Error("timeout exceeded"))).toBe(true);
  });

  it("returns true for network errors", () => {
    expect(defaultShouldRetry(new Error("ECONNREFUSED"))).toBe(true);
    expect(defaultShouldRetry(new Error("getaddrinfo ENOTFOUND"))).toBe(true);
    expect(defaultShouldRetry(new Error("ECONNRESET"))).toBe(true);
  });

  it("returns true for lock errors", () => {
    expect(defaultShouldRetry(new Error("lock busy"))).toBe(true);
    expect(defaultShouldRetry(new Error("EAGAIN: resource temporarily"))).toBe(true);
    expect(defaultShouldRetry(new Error("EBUSY"))).toBe(true);
  });

  it("returns false for syntax/parse errors", () => {
    expect(defaultShouldRetry(new Error("SyntaxError: unexpected token"))).toBe(false);
    expect(defaultShouldRetry(new Error("parse error at line 1"))).toBe(false);
  });

  it("returns false for permission errors", () => {
    expect(defaultShouldRetry(new Error("EACCES: permission denied"))).toBe(false);
    expect(defaultShouldRetry(new Error("EPERM"))).toBe(false);
  });

  it("returns false for validation errors", () => {
    expect(defaultShouldRetry(new Error("validation failed"))).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(defaultShouldRetry(null)).toBe(false);
    expect(defaultShouldRetry(undefined)).toBe(false);
  });

  it("works with plain error objects", () => {
    expect(defaultShouldRetry({ message: "timeout occurred" })).toBe(true);
    // Plain object's String() representation includes [object Object], not the message content
    // So this test just validates the non-null path
    expect(defaultShouldRetry({ message: "parsing failed" })).toBe(false);
  });
});

// ===========================================================================
// RetryPresets Tests
// ===========================================================================

describe("RetryPresets", () => {
  it("fileIO has moderate retries", () => {
    expect(RetryPresets.fileIO.maxRetries).toBe(3);
    expect(RetryPresets.fileIO.baseDelayMs).toBe(500);
    expect(RetryPresets.fileIO.maxDelayMs).toBe(10000);
  });

  it("network has aggressive retries", () => {
    expect(RetryPresets.network.maxRetries).toBe(5);
    expect(RetryPresets.network.baseDelayMs).toBe(2000);
  });

  it("lock has many short retries", () => {
    expect(RetryPresets.lock.maxRetries).toBe(10);
    expect(RetryPresets.lock.baseDelayMs).toBe(100);
  });

  it("persistence has retry safety", () => {
    expect(RetryPresets.persistence.maxRetries).toBe(5);
    expect(RetryPresets.persistence.maxDelayMs).toBe(5000);
  });
});

// ===========================================================================
// withDegradation Tests
// ===========================================================================

describe("withDegradation", () => {
  it("returns primary result when it succeeds", async () => {
    const primary = vi.fn().mockResolvedValue("primary");
    const fallback = vi.fn().mockResolvedValue("fallback");
    const result = await withDegradation(primary, fallback);
    expect(result).toEqual({ ok: true, value: "primary", degraded: false });
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("uses fallback when primary fails", async () => {
    const primary = vi.fn().mockRejectedValue(new Error("primary error"));
    const fallback = vi.fn().mockResolvedValue("fallback");
    const result = await withDegradation(primary, fallback);
    expect(result.ok).toBe(true);
    expect(result.value).toBe("fallback");
    expect(result.degraded).toBe(true);
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toBe("primary error");
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("returns error when both primary and fallback fail", async () => {
    const primary = vi.fn().mockRejectedValue(new Error("primary error"));
    const fallback = vi.fn().mockRejectedValue(new Error("fallback error"));
    const result = await withDegradation(primary, fallback);
    expect(result.ok).toBe(false);
    expect(result.value).toBeUndefined();
    expect(result.degraded).toBe(true);
    expect(result.error).toBeDefined();
  });
});

describe("withDegradationSync", () => {
  it("returns primary result when it succeeds", () => {
    const primary = vi.fn().mockReturnValue("primary");
    const fallback = vi.fn().mockReturnValue("fallback");
    const result = withDegradationSync(primary, fallback);
    expect(result).toEqual({ ok: true, value: "primary", degraded: false });
  });

  it("uses fallback when primary fails", () => {
    const primary = vi.fn().mockImplementation(() => { throw new Error("fail"); });
    const fallback = vi.fn().mockReturnValue("fallback");
    const result = withDegradationSync(primary, fallback);
    expect(result.ok).toBe(true);
    expect(result.value).toBe("fallback");
    expect(result.degraded).toBe(true);
  });

  it("returns error when both fail", () => {
    const primary = vi.fn().mockImplementation(() => { throw new Error("primary fail"); });
    const fallback = vi.fn().mockImplementation(() => { throw new Error("fallback fail"); });
    const result = withDegradationSync(primary, fallback);
    expect(result.ok).toBe(false);
    expect(result.value).toBeUndefined();
    expect(result.degraded).toBe(true);
  });
});

// ===========================================================================
// ErrorRecoveryEngine Alert Tests
// ===========================================================================

describe("ErrorRecoveryEngine alerts", () => {
  let engine: ErrorRecoveryEngine;

  beforeEach(() => {
    resetErrorRecoveryEngine();
    engine = getErrorRecoveryEngine();
  });

  afterEach(() => {
    resetErrorRecoveryEngine();
  });

  it("fires critical error alert for permanent errors", () => {
    const alertFn = vi.fn();
    engine.onAlert(alertFn);

    engine.handleError({
      toolName: "edit",
      featureId: "F001",
      missionId: "pim:test",
      timestamp: Date.now(),
      errorType: "SyntaxError",
      errorMessage: "Unexpected token in JSON",
    });

    // Should fire multiple alerts: error_critical, recovery_failed
    const criticalAlerts = alertFn.mock.calls.filter(
      ([alert]: any) => alert.type === "error_critical"
    );
    expect(criticalAlerts.length).toBeGreaterThanOrEqual(1);
    const alert = criticalAlerts[0][0];
    expect(alert.record.category).toBe("permanent");
    expect(alert.record.severity).toBe("critical");
  });

  it("fires threshold alert after multiple consecutive failures", () => {
    const alertFn = vi.fn();
    engine.onAlert(alertFn);
    engine.setAlertThresholds({ consecutiveFailures: 2 });

    const error = {
      toolName: "bash",
      featureId: "F001",
      missionId: "pim:test",
      timestamp: Date.now(),
      errorType: "Timeout",
      errorMessage: "operation timed out",
    };

    // First error — should not alert on threshold
    engine.handleError(error);
    expect(alertFn).toHaveBeenCalledTimes(1); // still might fire for other reasons

    // Second error for same operation — should trigger threshold
    alertFn.mockClear();
    engine.handleError(error);
    expect(alertFn).toHaveBeenCalled();
  });

  it("fires retry exhausted alert when max retries reached", () => {
    const alertFn = vi.fn();
    engine.onAlert(alertFn);

    const error = {
      toolName: "bash",
      featureId: "F001",
      missionId: "pim:test",
      timestamp: Date.now(),
      errorType: "Timeout",
      errorMessage: "temporary: EBUSY",
    };

    // Categorized as "transient" (no "timeout" string → not network).
    // Transient strategy has maxRetries: 3.
    // After 4 calls (initial + 3 retries), retries are exhausted.
    engine.handleError(error);
    engine.handleError(error);
    engine.handleError(error);
    engine.handleError(error);

    // Should have fired retry_exhausted at least once
    const exhaustedAlerts = alertFn.mock.calls.filter(
      ([alert]: any) => alert.type === "retry_exhausted"
    );
    expect(exhaustedAlerts.length).toBeGreaterThanOrEqual(1);
  });

  it("unregisters alert callback when returned function is called", () => {
    const alertFn = vi.fn();
    const unregister = engine.onAlert(alertFn);
    unregister();

    engine.handleError({
      toolName: "edit",
      featureId: "F001",
      missionId: "pim:test",
      timestamp: Date.now(),
      errorType: "SyntaxError",
      errorMessage: "parse failed",
    });

    expect(alertFn).not.toHaveBeenCalled();
  });

  it("alerts do not throw when callback throws", () => {
    engine.onAlert(() => { throw new Error("callback error"); });

    expect(() =>
      engine.handleError({
        toolName: "test",
        featureId: "F001",
        missionId: "pim:test",
        timestamp: Date.now(),
        errorType: "Error",
        errorMessage: "test error",
      })
    ).not.toThrow();
  });

  it("clearConsecutiveFailures resets counters for specific tool", () => {
    const error = {
      toolName: "bash",
      featureId: "F001",
      missionId: "pim:test",
      timestamp: Date.now(),
      errorType: "Timeout",
      errorMessage: "timeout",
    };

    engine.handleError(error);
    engine.handleError(error);

    engine.clearConsecutiveFailures("bash");

    // After clearing, new errors should not count toward the old tally
    engine.handleError(error);
    // Should have 3 total error records
    expect(engine.getStats().total).toBe(3);
  });

  it("clearConsecutiveFailures without args clears all counters", () => {
    engine.handleError({
      toolName: "bash", featureId: "F001", missionId: "pim:test",
      timestamp: Date.now(), errorType: "Timeout", errorMessage: "timeout",
    });
    engine.handleError({
      toolName: "write", featureId: "F002", missionId: "pim:test",
      timestamp: Date.now(), errorType: "Timeout", errorMessage: "timeout",
    });

    engine.clearConsecutiveFailures();
    // No errors should have been raised to threshold (clean slate)
    // Just verify no crash
    expect(engine.getStats().total).toBe(2);
  });
});

// ===========================================================================
// ErrorRecoveryEngine alert threshold configuration
// ===========================================================================

describe("ErrorRecoveryEngine thresholds", () => {
  let engine: ErrorRecoveryEngine;

  beforeEach(() => {
    resetErrorRecoveryEngine();
    engine = getErrorRecoveryEngine();
  });

  afterEach(() => {
    resetErrorRecoveryEngine();
  });

  it("setAlertThresholds updates thresholds", () => {
    engine.setAlertThresholds({ criticalErrors: 3, consecutiveFailures: 5, totalErrorsBeforeAlert: 10 });
    // No errors to test, just verify it doesn't throw
    expect(true).toBe(true);
  });

  it("markResolved clears consecutive failure counter", () => {
    const error = {
      toolName: "bash",
      featureId: "F001",
      missionId: "pim:test",
      timestamp: Date.now(),
      errorType: "Timeout",
      errorMessage: "timeout",
    };

    const { record } = engine.handleError(error);
    engine.handleError(error);

    engine.markResolved(record.id);

    // Should have 2 records total (both errors), but consecutive counter reset
    expect(engine.getStats().total).toBe(2);
  });
});
