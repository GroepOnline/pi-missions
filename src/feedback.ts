// Shim: re-exports feedback utilities for backward compatibility with tests
// Matches the old feedback API that tests expect

export interface ErrorFeedback {
  userMessage: string;
  technicalDetails?: string;
  recoverySuggestion?: string;
  severity: "error" | "warning" | "info";
}

export class FeedbackHandler {
  static createFeedback(error: unknown, context?: string): ErrorFeedback {
    const msg = error instanceof Error ? error.message : String(error ?? "");
    let userMessage: string;
    let severity: "error" | "warning" | "info" = "error";
    let recoverySuggestion: string | undefined;
    let technicalDetails: string | undefined;

    if (!error) {
      userMessage = "An unexpected error occurred";
      severity = "error";
    } else if (typeof error !== "object" || error === null) {
      userMessage = `An unexpected error occurred: ${String(error)}`;
      technicalDetails = String(error);
      severity = "error";
    } else if (error instanceof Error) {
      const m = error.message;
      if (m.includes("ENOENT") || m.includes("no such file")) {
        userMessage = "Could not find required file";
        recoverySuggestion = "Check the file path and permissions";
      } else if (m.includes("EACCES") || m.includes("permission denied")) {
        userMessage = "Permission denied when accessing file";
        recoverySuggestion = "Check file permissions and try again";
      } else if (m.includes("lock") || m.includes("locked")) {
        userMessage = `File is locked: ${m}`;
        severity = "warning";
      } else if (m.includes("Unexpected token") || m.includes("JSON")) {
        userMessage = "Invalid data format encountered";
        recoverySuggestion = "The data appears to be corrupted or in an unexpected format";
      } else if (m.includes("Validation")) {
        userMessage = "Data validation failed";
        recoverySuggestion = "Check that all required fields are present and correctly formatted";
      } else {
        userMessage = m;
        recoverySuggestion = context ? `Error while ${context}. Please try again.` : "Please try again.";
      }
    } else {
      userMessage = String(error);
      severity = "error";
    }

    const result: ErrorFeedback = { userMessage, severity };
    if (recoverySuggestion) result.recoverySuggestion = recoverySuggestion;
    if (technicalDetails) result.technicalDetails = technicalDetails;
    if (context && !recoverySuggestion) result.recoverySuggestion = `Error while ${context}. Please try again.`;
    return result;
  }

  static formatFeedback(feedback: { userMessage: string; severity?: string; recoverySuggestion?: string; technicalDetails?: string }): string {
    const parts: string[] = [feedback.userMessage];
    if (feedback.recoverySuggestion) parts.push(`💡 ${feedback.recoverySuggestion}`);
    if (process.env.NODE_ENV === "development" && feedback.technicalDetails) parts.push(`🔧 ${feedback.technicalDetails}`);
    return parts.join("\n");
  }

  static getSeverityForUI(feedback: { severity?: string }): string {
    if (feedback.severity === "critical") return "error";
    return feedback.severity ?? "info";
  }
}

export function createFeedback(error: unknown, context?: string): ErrorFeedback {
  return FeedbackHandler.createFeedback(error, context);
}

export function formatError(error: unknown): string {
  return FeedbackHandler.formatFeedback(FeedbackHandler.createFeedback(error));
}

export function getErrorSeverity(error: unknown): string {
  return FeedbackHandler.getSeverityForUI(FeedbackHandler.createFeedback(error));
}

