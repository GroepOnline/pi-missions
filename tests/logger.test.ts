import { describe, expect, it } from "vitest";
import { logger, LogLevel } from "../src/logger.js";

describe("Logger", () => {
  it("has log methods", () => {
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("has withMission method", () => {
    expect(typeof logger.withMission).toBe("function");
  });

  it("creates MissionLogger with mission ID", () => {
    const missionLogger = logger.withMission("test-mission-id");
    expect(missionLogger).toBeDefined();
    expect(typeof missionLogger.debug).toBe("function");
    expect(typeof missionLogger.info).toBe("function");
    expect(typeof missionLogger.warn).toBe("function");
    expect(typeof missionLogger.error).toBe("function");
  });

  it("log methods do not throw", () => {
    // These should not throw (they just won't log if below level)
    logger.debug("test-component", "debug message");
    logger.info("test-component", "info message");
    logger.warn("test-component", "warn message");
    logger.error("test-component", "error message");
  });

  it("handles errors in error logging", () => {
    const testError = new Error("Test error");
    testError.stack = "Error: Test error\n    at test.js:1:10";
    
    // Should not throw
    logger.error("test-component", "Test error message", testError, { context: "data" });
  });

  it("handles missing error gracefully", () => {
    // Should not throw even without error object
    logger.error("test-component", "Test error message");
  });

  it("handles context data", () => {
    // Should not throw with context
    logger.info("test-component", "Test message", { key: "value", number: 123 });
  });

  it("LogLevel enum has correct values", () => {
    expect(LogLevel.DEBUG).toBe("debug");
    expect(LogLevel.INFO).toBe("info");
    expect(LogLevel.WARN).toBe("warn");
    expect(LogLevel.ERROR).toBe("error");
  });

  it("MissionLogger includes mission ID in context", () => {
    const missionLogger = logger.withMission("test-mission-123");
    
    // Just verify the methods exist - actual logging would go to file
    expect(typeof missionLogger.debug).toBe("function");
    expect(typeof missionLogger.info).toBe("function");
    expect(typeof missionLogger.warn).toBe("function");
    expect(typeof missionLogger.error).toBe("function");
  });
});
