// Shim: re-exports logger for backward compatibility with tests
// The v2 codebase uses inline logging via core/state utilities; this provides
// a minimal compatible logger API for existing test suites.

export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  component: string;
  missionId?: string;
  message: string;
  context?: Record<string, unknown>;
  error?: string;
}

class Logger {
  private entries: LogEntry[] = [];

  log(level: LogLevel, component: string, message: string, context?: unknown): void {
    this.entries.push({
      timestamp: Date.now(),
      level,
      component,
      message,
      context: context as Record<string, unknown> | undefined,
    });
  }

  debug(component: string, message: string, context?: unknown): void {
    this.log(LogLevel.DEBUG, component, message, context);
  }

  info(component: string, message: string, context?: unknown): void {
    this.log(LogLevel.INFO, component, message, context);
  }

  warn(component: string, message: string, context?: unknown): void {
    this.log(LogLevel.WARN, component, message, context);
  }

  error(component: string, message: string, error?: unknown, context?: unknown): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level: LogLevel.ERROR,
      component,
      message,
      context: context as Record<string, unknown> | undefined,
      error: error instanceof Error ? error.message : String(error ?? ""),
    };
    this.entries.push(entry);
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }

  withMission(_missionId: string): Logger {
    return this;
  }
}

export const logger = new Logger();
