import { describe, it, expect, vi } from "vitest";
import { Logger, LogLevel, createLogger, logger, setLogLevel } from "../src/logger.js";

describe("Logger", () => {
  describe("log levels", () => {
    it("respects minimum log level", () => {
      const log = createLogger("test", LogLevel.WARN);
      
      const debugSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      
      log.debug("debug message");
      log.info("info message");
      log.warn("warn message");
      log.error("error message");
      
      // Debug and info should not be logged (below WARN level)
      expect(debugSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      
      debugSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("logs all messages when min level is DEBUG", () => {
      const log = createLogger("test", LogLevel.DEBUG);
      
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      
      log.debug("debug message");
      log.info("info message");
      log.warn("warn message");
      log.error("error message");
      
      expect(logSpy).toHaveBeenCalledTimes(2); // debug + info
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe("message formatting", () => {
    it("includes timestamp, level, and context", () => {
      const log = createLogger("test-context");
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      
      log.info("test message");
      
      const call = logSpy.mock.calls[0][0] as string;
      expect(call).toContain("test-context");
      expect(call).toContain("INFO");
      expect(call).toContain("test message");
      
      logSpy.mockRestore();
    });

    it("includes data when provided", () => {
      const log = createLogger("test");
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      
      log.info("test message", { key: "value", number: 42 });
      
      const call = logSpy.mock.calls[0][0] as string;
      expect(call).toContain("test message");
      expect(call).toContain("key");
      expect(call).toContain("value");
      
      logSpy.mockRestore();
    });

    it("includes error details when error is provided", () => {
      const log = createLogger("test");
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      
      const error = new Error("Test error");
      log.error("test error", error);
      
      const call = errorSpy.mock.calls[0][0] as string;
      expect(call).toContain("test error");
      expect(call).toContain("Test error");
      
      errorSpy.mockRestore();
    });
  });

  describe("global logger", () => {
    it("provides default logger instance", () => {
      expect(logger).toBeInstanceOf(Logger);
    });

    it("allows changing global log level", () => {
      const originalLevel = logger.minLevel;
      
      setLogLevel(LogLevel.ERROR);
      expect(logger.minLevel).toBe(LogLevel.ERROR);
      
      setLogLevel(originalLevel);
      expect(logger.minLevel).toBe(originalLevel);
    });
  });

  describe("createLogger", () => {
    it("creates logger with specified context", () => {
      const log = createLogger("my-context");
      expect(log).toBeInstanceOf(Logger);
      
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      log.info("test");
      
      const call = logSpy.mock.calls[0][0] as string;
      expect(call).toContain("my-context");
      
      logSpy.mockRestore();
    });

    it("creates logger with specified minimum level", () => {
      const log = createLogger("test", LogLevel.ERROR);
      expect(log.minLevel).toBe(LogLevel.ERROR);
    });
  });
});
