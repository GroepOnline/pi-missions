import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createMission, saveMissionSafe, loadMissionFromDisk, getActiveFeature, getAllFeatures, getNextPendingFeature } from "../../src/state.js";
import { getCompletionDetector } from "../../src/completion.js";
import { getErrorRecoveryEngine } from "../../src/recovery.js";

const tmpRoot = path.join(os.tmpdir(), `pi-missions-e2e-${process.pid}`);

function setupTmp(): void {
  fs.mkdirSync(tmpRoot, { recursive: true });
}

function cleanupTmp(): void {
  if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
}

describe("E2E: Mission Lifecycle", () => {
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

  it("complete mission lifecycle: create, progress, complete", async () => {
    // Create a mission
    const mission = createMission("E2E Test Mission", "Test complete mission lifecycle");
    expect(mission.status).toBe("active");
    expect(mission.activeFeatureId).toBe("F001");
    
    // Save to disk
    await saveMissionSafe(mission);
    
    // Load from disk
    const loaded = loadMissionFromDisk(mission.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(mission.id);
    expect(loaded!.title).toBe(mission.title);
    
    // Get active feature
    const activeFeature = getActiveFeature(loaded!);
    expect(activeFeature).not.toBeNull();
    expect(activeFeature!.id).toBe("F001");
    expect(activeFeature!.status).toBe("active");
    
    // Simulate completion detection
    const detector = getCompletionDetector();
    const detectionResult = detector.detectCompletion(activeFeature!, "I have completed the implementation. The feature is done.");
    // Check that completion detection produces some result
    expect(detectionResult.confidence).toBeDefined();
    expect(detectionResult.suggestedAction).toBeDefined();
    expect(detectionResult.signals).toBeDefined();
    
    // Mark feature as done
    activeFeature!.status = "done";
    activeFeature!.completedAt = Date.now();
    for (const ac of activeFeature!.acceptance) {
      ac.verified = true;
    }
    
    // Get next pending feature
    const nextFeature = getNextPendingFeature(loaded!);
    expect(nextFeature).not.toBeNull();
    expect(nextFeature!.id).toBe("F002");
    
    // Activate next feature
    nextFeature!.status = "active";
    loaded!.activeFeatureId = nextFeature!.id;
    loaded!.activeMilestoneId = nextFeature!.milestoneId;
    
    // Mark second feature as done
    nextFeature!.status = "done";
    nextFeature!.completedAt = Date.now();
    for (const ac of nextFeature!.acceptance) {
      ac.verified = true;
    }
    
    // Get third feature
    const thirdFeature = getNextPendingFeature(loaded!);
    expect(thirdFeature).not.toBeNull();
    expect(thirdFeature!.id).toBe("F003");
    
    // Mark third feature as done
    thirdFeature!.status = "done";
    thirdFeature!.completedAt = Date.now();
    for (const ac of thirdFeature!.acceptance) {
      ac.verified = true;
    }
    
    // Check if mission is complete
    const allFeatures = getAllFeatures(loaded!);
    const allDone = allFeatures.every(f => f.status === "done");
    expect(allDone).toBe(true);
    
    // Mark mission as complete
    loaded!.status = "complete";
    loaded!.milestones[0]!.status = "complete"; // Manually update milestone status
    
    // Save final state
    await saveMissionSafe(loaded!);
    
    // Verify final state
    const final = loadMissionFromDisk(mission.id);
    expect(final!.status).toBe("complete");
    expect(final!.milestones[0]!.status).toBe("complete");
  });

  it("error recovery: detect and categorize errors", () => {
    const recovery = getErrorRecoveryEngine();
    
    // Test network error
    const networkError = {
      toolName: "bash",
      featureId: "F001",
      missionId: "test-mission",
      timestamp: Date.now(),
      errorType: "NetworkError",
      errorMessage: "Connection refused",
      stackTrace: "error stack",
    };
    
    const networkResult = recovery.handleError(networkError);
    expect(networkResult.record.category).toBe("network");
    expect(networkResult.action).toBe("retry");
    expect(networkResult.shouldRetry).toBe(true);
    
    // Test permission error
    const permError = {
      toolName: "write",
      featureId: "F001",
      missionId: "test-mission",
      timestamp: Date.now(),
      errorType: "PermissionError",
      errorMessage: "Access denied",
      stackTrace: "error stack",
    };
    
    const permResult = recovery.handleError(permError);
    expect(permResult.record.category).toBe("permission");
    expect(permResult.action).toBe("ask_user");
    expect(permResult.shouldRetry).toBe(false);
    
    // Test permanent error
    const permError2 = {
      toolName: "edit",
      featureId: "F001",
      missionId: "test-mission",
      timestamp: Date.now(),
      errorType: "SyntaxError",
      errorMessage: "Unexpected token",
      stackTrace: "error stack",
    };
    
    const permResult2 = recovery.handleError(permError2);
    expect(permResult2.record.category).toBe("permanent");
    expect(permResult2.action).toBe("block");
    expect(permResult2.shouldRetry).toBe(false);
  });

  it("error recovery: retry with exponential backoff", () => {
    const recovery = getErrorRecoveryEngine();
    recovery.clearErrors();
    
    const transientError = {
      toolName: "bash",
      featureId: "F001",
      missionId: "test-mission",
      timestamp: Date.now(),
      errorType: "TransientError",
      errorMessage: "Temporary failure",
      stackTrace: "error stack",
    };
    
    // First attempt
    const result1 = recovery.handleError(transientError);
    expect(result1.record.retryCount).toBe(0);
    expect(result1.shouldRetry).toBe(true);
    expect(result1.retryAfter).toBe(1000); // Initial backoff
    
    // Second attempt (simulated)
    const result2 = recovery.handleError(transientError);
    expect(result2.record.retryCount).toBe(1);
    expect(result2.shouldRetry).toBe(true);
    expect(result2.retryAfter).toBe(2000); // 2^1 * 1000
    
    // Third attempt
    const result3 = recovery.handleError(transientError);
    expect(result3.record.retryCount).toBe(2);
    expect(result3.shouldRetry).toBe(true);
    expect(result3.retryAfter).toBe(4000); // 2^2 * 1000
    
    // Fourth attempt (max retries for transient is 3)
    const result4 = recovery.handleError(transientError);
    expect(result4.record.retryCount).toBe(3);
    expect(result4.shouldRetry).toBe(false);
  });

  it("error recovery: statistics tracking", () => {
    const recovery = getErrorRecoveryEngine();
    recovery.clearErrors();
    
    // Generate some errors
    const errors = [
      { toolName: "bash", featureId: "F001", missionId: "test-mission", timestamp: Date.now(), errorType: "NetworkError", errorMessage: "Connection refused" },
      { toolName: "read", featureId: "F001", missionId: "test-mission", timestamp: Date.now(), errorType: "NetworkError", errorMessage: "Timeout" },
      { toolName: "write", featureId: "F001", missionId: "test-mission", timestamp: Date.now(), errorType: "PermissionError", errorMessage: "Access denied" },
      { toolName: "edit", featureId: "F002", missionId: "test-mission", timestamp: Date.now(), errorType: "SyntaxError", errorMessage: "Parse error" },
    ];
    
    errors.forEach(err => recovery.handleError(err));
    
    const stats = recovery.getStats();
    expect(stats.total).toBe(4);
    expect(stats.byCategory.network).toBe(2);
    expect(stats.byCategory.permission).toBe(1);
    expect(stats.byCategory.permanent).toBe(1);
  });

  it("completion detection: multi-factor analysis", () => {
    const detector = getCompletionDetector();
    detector.clearToolCallHistory();
    
    // Create a mock feature with acceptance criteria
    const feature = {
      id: "F001",
      milestoneId: "M01",
      title: "Test Feature",
      description: "Test feature",
      priority: 1,
      dependsOn: [],
      acceptance: [
        { id: "AC1", description: "Test passes", checkType: "manual" as const, verified: true },
        { id: "AC2", description: "Code reviewed", checkType: "manual" as const, verified: true },
      ],
      status: "active" as const,
      sessions: [],
      toolCallCount: 0,
    };
    
    // Record some successful tool calls
    detector.recordToolCall("read", true);
    detector.recordToolCall("read", true);
    detector.recordToolCall("read", true);
    detector.recordToolCall("bash", true);
    detector.recordToolCall("bash", true);
    
    // Test completion with strong signals
    const result = detector.detectCompletion(feature, "I have completed the implementation. All tests pass and the feature is done.");
    // With acceptance criteria verified and keyword signals, should suggest completion
    expect(["high", "medium"]).toContain(result.confidence);
    expect(result.signals.length).toBeGreaterThan(0);
    expect(result.suggestedAction).toBe("auto_done"); // With all acceptance criteria verified, it should auto-done
  });

  it("stuck detection: identify repeated failures", () => {
    const detector = getCompletionDetector();
    detector.clearToolCallHistory();
    
    // Record repeated failures
    for (let i = 0; i < 5; i++) {
      detector.recordToolCall("bash", false);
    }
    
    const stuckResult = detector.detectStuck();
    expect(stuckResult.isStuck).toBe(true);
    expect(stuckResult.suggestedAction).toBe("block_self");
    expect(stuckResult.reason).toContain("consecutive");
  });

  it("stuck detection: identify repeated tool patterns", () => {
    const detector = getCompletionDetector();
    detector.clearToolCallHistory();
    
    // Record same tool called repeatedly
    for (let i = 0; i < 5; i++) {
      detector.recordToolCall("read", true);
    }
    
    const stuckResult = detector.detectStuck();
    expect(stuckResult.isStuck).toBe(true);
    expect(stuckResult.suggestedAction).toBe("block_self");
    expect(stuckResult.reason).toContain("read");
  });
});
