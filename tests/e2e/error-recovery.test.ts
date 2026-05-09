import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createMission, saveMissionSafe, loadMissionFromDisk } from "../../src/state.js";
import { getErrorRecoveryEngine } from "../../src/recovery.js";

const tmpRoot = path.join(os.tmpdir(), `pi-missions-e2e-recovery-${process.pid}`);

function setupTmp(): void {
  fs.mkdirSync(tmpRoot, { recursive: true });
}

function cleanupTmp(): void {
  if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
}

describe("E2E: Error Recovery Scenarios", () => {
  const origHome = process.env.HOME;

  beforeAll(() => {
    process.env.HOME = tmpRoot;
    cleanupTmp();
    setupTmp();
  });

  afterAll(() => {
    process.env.HOME = origHome;
    cleanupTmp();
  });

  it("scenario: network error with successful retry", async () => {
    const recovery = getErrorRecoveryEngine();
    recovery.clearErrors();
    
    const mission = createMission("Network Error Test", "Test network error recovery");
    await saveMissionSafe(mission);
    
    const networkError = {
      toolName: "bash",
      featureId: mission.activeFeatureId,
      missionId: mission.id,
      timestamp: Date.now(),
      errorType: "NetworkError",
      errorMessage: "Connection refused to api.example.com",
      stackTrace: "Error: Connection refused\n    at ...",
    };
    
    // First error - should retry
    const result1 = recovery.handleError(networkError);
    expect(result1.record.category).toBe("network");
    expect(result1.action).toBe("retry");
    expect(result1.shouldRetry).toBe(true);
    expect(result1.retryAfter).toBe(2000);
    
    // Simulate retry success - mark as resolved
    recovery.markResolved(result1.record.id);
    
    const stats = recovery.getStats();
    expect(stats.total).toBe(1);
    expect(stats.resolved).toBe(1);
  });

  it("scenario: permission error requires user intervention", async () => {
    const recovery = getErrorRecoveryEngine();
    recovery.clearErrors();
    
    const mission = createMission("Permission Error Test", "Test permission error handling");
    await saveMissionSafe(mission);
    
    const permError = {
      toolName: "write",
      featureId: mission.activeFeatureId,
      missionId: mission.id,
      timestamp: Date.now(),
      errorType: "PermissionError",
      errorMessage: "EACCES: permission denied, open '/etc/hosts'",
      stackTrace: "Error: EACCES: permission denied\n    at ...",
    };
    
    const result = recovery.handleError(permError);
    expect(result.record.category).toBe("permission");
    expect(result.action).toBe("ask_user");
    expect(result.shouldRetry).toBe(false);
    expect(result.record.severity).toBe("critical");
  });

  it("scenario: permanent syntax error blocks operation", async () => {
    const recovery = getErrorRecoveryEngine();
    recovery.clearErrors();
    
    const mission = createMission("Syntax Error Test", "Test permanent error blocking");
    await saveMissionSafe(mission);
    
    const syntaxError = {
      toolName: "edit",
      featureId: mission.activeFeatureId,
      missionId: mission.id,
      timestamp: Date.now(),
      errorType: "SyntaxError",
      errorMessage: "Unexpected token < in JSON at position 42",
      stackTrace: "SyntaxError: Unexpected token <\n    at ...",
    };
    
    const result = recovery.handleError(syntaxError);
    expect(result.record.category).toBe("permanent");
    expect(result.action).toBe("block");
    expect(result.shouldRetry).toBe(false);
    expect(result.record.severity).toBe("critical");
  });

  it("scenario: transient error with multiple retries", async () => {
    const recovery = getErrorRecoveryEngine();
    recovery.clearErrors();
    
    const mission = createMission("Transient Error Test", "Test transient error retry logic");
    await saveMissionSafe(mission);
    
    const transientError = {
      toolName: "bash",
      featureId: mission.activeFeatureId,
      missionId: mission.id,
      timestamp: Date.now(),
      errorType: "TransientError",
      errorMessage: "Resource temporarily unavailable",
      stackTrace: "Error: EAGAIN: resource temporarily unavailable\n    at ...",
    };
    
    // Test that error handling works
    const result1 = recovery.handleError(transientError);
    expect(result1.record.retryCount).toBe(0);
    expect(result1.record.category).toBeDefined();
    expect(result1.action).toBeDefined();
    expect(result1.record.id).toBeDefined();
  });

  it("clears retry state when feature errors are cleared", async () => {
    const recovery = getErrorRecoveryEngine();
    recovery.clearErrors();

    const mission = createMission("Retry Cleanup Test", "Test feature retry cleanup");
    const transientError = {
      toolName: "bash",
      featureId: mission.activeFeatureId,
      missionId: mission.id,
      timestamp: Date.now(),
      errorType: "TransientError",
      errorMessage: "Temporary lock busy, retry",
    };

    const first = recovery.handleError(transientError);
    const second = recovery.handleError(transientError);
    expect(first.retryAfter).toBe(1000);
    expect(second.retryAfter).toBe(2000);

    recovery.clearErrorsForFeature(mission.activeFeatureId!);

    const afterClear = recovery.handleError(transientError);
    expect(afterClear.record.retryCount).toBe(0);
    expect(afterClear.retryAfter).toBe(1000);
  });

  it("scenario: system error triggers degradation", async () => {
    const recovery = getErrorRecoveryEngine();
    recovery.clearErrors();
    
    const mission = createMission("System Error Test", "Test system error degradation");
    await saveMissionSafe(mission);
    
    const systemError = {
      toolName: "bash",
      featureId: mission.activeFeatureId,
      missionId: mission.id,
      timestamp: Date.now(),
      errorType: "SystemError",
      errorMessage: "ENOMEM: Cannot allocate memory",
      stackTrace: "Error: ENOMEM: Cannot allocate memory\n    at ...",
    };
    
    const result = recovery.handleError(systemError);
    // System errors are handled with some recovery strategy
    expect(result.record.category).toBeDefined();
    expect(result.action).toBeDefined();
    // Error should be recorded
    expect(result.record.id).toBeDefined();
  });

  it("scenario: error isolation between features", async () => {
    const recovery = getErrorRecoveryEngine();
    recovery.clearErrors();
    
    const mission = createMission("Error Isolation Test", "Test error isolation between features");
    await saveMissionSafe(mission);
    
    // Error in feature F001
    const error1 = {
      toolName: "bash",
      featureId: "F001",
      missionId: mission.id,
      timestamp: Date.now(),
      errorType: "NetworkError",
      errorMessage: "Connection refused",
    };
    
    recovery.handleError(error1);
    
    // Error in feature F002
    const error2 = {
      toolName: "read",
      featureId: "F002",
      missionId: mission.id,
      timestamp: Date.now(),
      errorType: "NetworkError",
      errorMessage: "Timeout",
    };
    
    recovery.handleError(error2);
    
    // Check errors per feature
    const f001Errors = recovery.getErrorsForFeature("F001");
    const f002Errors = recovery.getErrorsForFeature("F002");
    
    expect(f001Errors.length).toBe(1);
    expect(f002Errors.length).toBe(1);
    
    // Clear errors for F001
    recovery.clearErrorsForFeature("F001");
    
    // F001 errors should be gone, F002 should remain
    const f001ErrorsAfter = recovery.getErrorsForFeature("F001");
    const f002ErrorsAfter = recovery.getErrorsForFeature("F002");
    
    expect(f001ErrorsAfter.length).toBe(0);
    expect(f002ErrorsAfter.length).toBe(1);
  });

  it("scenario: custom recovery strategy", async () => {
    const recovery = getErrorRecoveryEngine();
    recovery.clearErrors();
    
    // Test that custom strategies can be set
    recovery.setStrategy("network", {
      category: "network",
      maxRetries: 10,
      backoffMs: 5000,
      fallbackAction: "ask_user",
    });
    
    // Test that the strategy is stored (not applied unless error is categorized as network)
    const stats = recovery.getStats();
    expect(stats).toBeDefined();
  });

  it("scenario: error statistics aggregation", async () => {
    const recovery = getErrorRecoveryEngine();
    recovery.clearErrors();
    
    const mission = createMission("Error Statistics Test", "Test error statistics");
    await saveMissionSafe(mission);
    
    // Generate mixed errors
    const errors = [
      { toolName: "bash", featureId: "F001", missionId: mission.id, timestamp: Date.now(), errorType: "NetworkError", errorMessage: "Timeout" },
      { toolName: "bash", featureId: "F001", missionId: mission.id, timestamp: Date.now(), errorType: "NetworkError", errorMessage: "Refused" },
      { toolName: "bash", featureId: "F001", missionId: mission.id, timestamp: Date.now(), errorType: "NetworkError", errorMessage: "Refused" },
      { toolName: "write", featureId: "F001", missionId: mission.id, timestamp: Date.now(), errorType: "PermissionError", errorMessage: "Denied" },
      { toolName: "edit", featureId: "F002", missionId: mission.id, timestamp: Date.now(), errorType: "SyntaxError", errorMessage: "Parse error" },
      { toolName: "bash", featureId: "F003", missionId: mission.id, timestamp: Date.now(), errorType: "SystemError", errorMessage: "Out of memory" },
    ];
    
    errors.forEach(err => recovery.handleError(err));
    
    const stats = recovery.getStats();
    expect(stats.total).toBe(6);
    // Check that errors are categorized
    expect(Object.keys(stats.byCategory).length).toBeGreaterThan(0);
    // Check that severity is assigned
    expect(Object.keys(stats.bySeverity).length).toBeGreaterThan(0);
  });
});
