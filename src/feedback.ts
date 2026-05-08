/**
 * Graceful degradation and user feedback utilities.
 * Provides user-friendly error messages and recovery suggestions.
 */

export interface ErrorFeedback {
  userMessage: string;
  technicalDetails?: string;
  recoverySuggestion?: string;
  severity: "info" | "warning" | "error" | "critical";
}

export class FeedbackHandler {
  /**
   * Create user-friendly error feedback from an error.
   * @param error - The error to convert to feedback
   * @param context - Optional context for the error
   * @returns ErrorFeedback with user-friendly message
   */
  static createFeedback(error: unknown, context?: string): ErrorFeedback {
    if (error instanceof Error) {
      return this.createFeedbackFromError(error, context);
    }
    
    return {
      userMessage: "An unexpected error occurred",
      technicalDetails: String(error),
      severity: "error",
    };
  }
  
  private static createFeedbackFromError(error: Error, context?: string): ErrorFeedback {
    const message = error.message.toLowerCase();
    
    // File system errors
    if (message.includes("enoent") || message.includes("no such file")) {
      return {
        userMessage: context 
          ? `Could not find required file for: ${context}`
          : "Could not find required file",
        technicalDetails: error.message,
        recoverySuggestion: "Please check that the file exists and you have the correct permissions",
        severity: "error",
      };
    }
    
    if (message.includes("eacces") || message.includes("permission")) {
      return {
        userMessage: context
          ? `Permission denied for: ${context}`
          : "Permission denied",
        technicalDetails: error.message,
        recoverySuggestion: "Please check file permissions and try again",
        severity: "error",
      };
    }
    
    // Lock errors
    if (message.includes("lock") || message.includes("locked")) {
      return {
        userMessage: "File is locked by another process",
        technicalDetails: error.message,
        recoverySuggestion: "Please wait a moment and try again, or ensure no other process is using the file",
        severity: "warning",
      };
    }
    
    // JSON parsing errors
    if (message.includes("json") || message.includes("parse")) {
      return {
        userMessage: "Invalid data format",
        technicalDetails: error.message,
        recoverySuggestion: "Please check the data format and try again",
        severity: "error",
      };
    }
    
    // Validation errors
    if (message.includes("validation") || message.includes("invalid")) {
      return {
        userMessage: "Data validation failed",
        technicalDetails: error.message,
        recoverySuggestion: "Please check the data and ensure all required fields are present",
        severity: "error",
      };
    }
    
    // Generic error
    return {
      userMessage: context
        ? `An error occurred while: ${context}`
        : "An error occurred",
      technicalDetails: error.message,
      severity: "error",
    };
  }
  
  /**
   * Format feedback for display to users.
   * @param feedback - The feedback to format
   * @returns Formatted string
   */
  static formatFeedback(feedback: ErrorFeedback): string {
    const lines = [feedback.userMessage];
    
    if (feedback.recoverySuggestion) {
      lines.push(`\n💡 ${feedback.recoverySuggestion}`);
    }
    
    if (feedback.technicalDetails && process.env.NODE_ENV === "development") {
      lines.push(`\n🔧 Technical details: ${feedback.technicalDetails}`);
    }
    
    return lines.join("\n");
  }
  
  /**
   * Get severity level for UI notifications.
   * @param feedback - The feedback to get severity for
   * @returns UI-compatible severity level
   */
  static getSeverityForUI(feedback: ErrorFeedback): "info" | "warning" | "error" {
    if (feedback.severity === "critical") {
      return "error";
    }
    return feedback.severity;
  }
}

/**
 * Create user-friendly error feedback.
 * @param error - The error to convert
 * @param context - Optional context
 * @returns ErrorFeedback
 */
export function createFeedback(error: unknown, context?: string): ErrorFeedback {
  return FeedbackHandler.createFeedback(error, context);
}

/**
 * Format error feedback for display.
 * @param error - The error to format
 * @param context - Optional context
 * @returns Formatted error message
 */
export function formatError(error: unknown, context?: string): string {
  const feedback = createFeedback(error, context);
  return FeedbackHandler.formatFeedback(feedback);
}

/**
 * Get UI severity level for an error.
 * @param error - The error to get severity for
 * @param context - Optional context
 * @returns UI-compatible severity level
 */
export function getErrorSeverity(error: unknown, context?: string): "info" | "warning" | "error" {
  const feedback = createFeedback(error, context);
  return FeedbackHandler.getSeverityForUI(feedback);
}