import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  missionId?: string;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

class Logger {
  private logFile: string;
  private logLevel: LogLevel;

  constructor() {
    const logDir = path.join(os.homedir(), ".pi", "missions", "logs");
    fs.mkdirSync(logDir, { recursive: true });
    this.logFile = path.join(logDir, "pi-missions.log");
    this.logLevel = (process.env.PI_MISSIONS_LOG_LEVEL as LogLevel) || LogLevel.INFO;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    return levels.indexOf(level) >= levels.indexOf(this.logLevel);
  }

  private write(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) return;

    const line = JSON.stringify(entry) + "\n";
    try {
      fs.appendFileSync(this.logFile, line, "utf-8");
    } catch (e) {
      // Silent fail - can't log if log file is unavailable
    }
  }

  private log(
    level: LogLevel,
    component: string,
    message: string,
    context?: Record<string, unknown>,
    error?: Error
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
      context,
    };

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    this.write(entry);
  }

  debug(component: string, message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, component, message, context);
  }

  info(component: string, message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, component, message, context);
  }

  warn(component: string, message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, component, message, context);
  }

  error(component: string, message: string, error?: Error, context?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, component, message, context, error);
  }

  withMission(missionId: string): MissionLogger {
    return new MissionLogger(this, missionId);
  }
}

class MissionLogger {
  constructor(private logger: Logger, private missionId: string) {}

  private addMissionId(context?: Record<string, unknown>): Record<string, unknown> {
    return { ...context, missionId: this.missionId };
  }

  debug(component: string, message: string, context?: Record<string, unknown>): void {
    this.logger.debug(component, message, this.addMissionId(context));
  }

  info(component: string, message: string, context?: Record<string, unknown>): void {
    this.logger.info(component, message, this.addMissionId(context));
  }

  warn(component: string, message: string, context?: Record<string, unknown>): void {
    this.logger.warn(component, message, this.addMissionId(context));
  }

  error(component: string, message: string, error?: Error, context?: Record<string, unknown>): void {
    this.logger.error(component, message, error, this.addMissionId(context));
  }
}

export const logger = new Logger();
