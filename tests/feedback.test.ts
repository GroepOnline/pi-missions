import { describe, it, expect } from "vitest";
import { 
  FeedbackHandler, 
  createFeedback, 
  formatError, 
  getErrorSeverity 
} from "../src/utils/feedback.js";

describe("Feedback Handler", () => {
  describe("createFeedback", () => {
    it("handles file not found errors", () => {
      const error = new Error("ENOENT: no such file or directory, open '/path/to/file'");
      const feedback = FeedbackHandler.createFeedback(error, "loading mission");
      
      expect(feedback.userMessage).toContain("Could not find required file");
      expect(feedback.severity).toBe("error");
      expect(feedback.recoverySuggestion).toContain("permissions");
    });

    it("handles permission errors", () => {
      const error = new Error("EACCES: permission denied, open '/path/to/file'");
      const feedback = FeedbackHandler.createFeedback(error);
      
      expect(feedback.userMessage).toContain("Permission denied");
      expect(feedback.severity).toBe("error");
    });

    it("handles lock errors", () => {
      const error = new Error("File is locked by another process");
      const feedback = FeedbackHandler.createFeedback(error);
      
      expect(feedback.userMessage).toContain("locked");
      expect(feedback.severity).toBe("warning");
    });

    it("handles JSON parsing errors", () => {
      const error = new Error("Unexpected token < in JSON at position 0");
      const feedback = FeedbackHandler.createFeedback(error);
      
      expect(feedback.userMessage).toContain("Invalid data format");
      expect(feedback.severity).toBe("error");
    });

    it("handles validation errors", () => {
      const error = new Error("Validation failed: missing required field");
      const feedback = FeedbackHandler.createFeedback(error);
      
      expect(feedback.userMessage).toContain("Data validation failed");
      expect(feedback.severity).toBe("error");
    });

    it("handles generic errors", () => {
      const error = new Error("Something went wrong");
      const feedback = FeedbackHandler.createFeedback(error, "saving data");

      expect(feedback.userMessage).toBe("Something went wrong");
      expect(feedback.recoverySuggestion).toContain("saving data");
      expect(feedback.severity).toBe("error");
    });

    it("handles non-error objects", () => {
      const error = "string error";
      const feedback = FeedbackHandler.createFeedback(error);
      
      expect(feedback.userMessage).toContain("unexpected error");
      expect(feedback.technicalDetails).toBe("string error");
    });

    it("handles null errors", () => {
      const feedback = FeedbackHandler.createFeedback(null);
      
      expect(feedback.userMessage).toContain("unexpected error");
    });
  });

  describe("formatFeedback", () => {
    it("formats basic feedback", () => {
      const feedback = {
        userMessage: "Test error",
        severity: "error" as const,
      };
      
      const formatted = FeedbackHandler.formatFeedback(feedback);
      expect(formatted).toContain("Test error");
    });

    it("includes recovery suggestion", () => {
      const feedback = {
        userMessage: "Test error",
        recoverySuggestion: "Try again",
        severity: "error" as const,
      };
      
      const formatted = FeedbackHandler.formatFeedback(feedback);
      expect(formatted).toContain("Try again");
      expect(formatted).toContain("💡");
    });

    it("includes technical details in development", () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      
      const feedback = {
        userMessage: "Test error",
        technicalDetails: "Stack trace here",
        severity: "error" as const,
      };
      
      const formatted = FeedbackHandler.formatFeedback(feedback);
      expect(formatted).toContain("Stack trace here");
      expect(formatted).toContain("🔧");
      
      process.env.NODE_ENV = originalEnv;
    });

    it("hides technical details in production", () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      
      const feedback = {
        userMessage: "Test error",
        technicalDetails: "Stack trace here",
        severity: "error" as const,
      };
      
      const formatted = FeedbackHandler.formatFeedback(feedback);
      expect(formatted).not.toContain("Stack trace here");
      
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe("getSeverityForUI", () => {
    it("maps critical to error", () => {
      const feedback = {
        userMessage: "Critical error",
        severity: "critical" as const,
      };
      
      const severity = FeedbackHandler.getSeverityForUI(feedback);
      expect(severity).toBe("error");
    });

    it("passes through other severities", () => {
      const warningFeedback = {
        userMessage: "Warning",
        severity: "warning" as const,
      };
      
      expect(FeedbackHandler.getSeverityForUI(warningFeedback)).toBe("warning");
    });
  });
});

describe("Convenience functions", () => {
  it("createFeedback delegates to FeedbackHandler", () => {
    const error = new Error("Test error");
    const feedback = createFeedback(error);
    
    expect(feedback.userMessage).toContain("error");
  });

  it("formatError creates and formats feedback", () => {
    const error = new Error("Test error");
    const formatted = formatError(error);
    
    expect(formatted).toContain("error");
  });

  it("getErrorSeverity returns UI severity", () => {
    const error = new Error("Test error");
    const severity = getErrorSeverity(error);
    
    expect(["info", "warning", "error"]).toContain(severity);
  });
});
