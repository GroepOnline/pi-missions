/**
 * Simple structured logging utility.
 * Provides consistent log formatting and levels without external dependencies.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogEntry {
  level: LogLevel;
  timestamp: number;
  message: string;
  context?: string;
  data?: Record<string, unknown>;
}

export class Logger {
  private minLevel: LogLevel;
  private context: string;
  
  constructor(context: string, minLevel: LogLevel = LogLevel.INFO) {
    this.context = context;
    this.minLevel = minLevel;
  }
  
  private shouldLog(level: LogLevel): boolean {
    return level >= this.minLevel;
  }
  
  private formatMessage(level: LogLevel, message: string, data?: Record<string, unknown>): string {
    const levelName = LogLevel[level];
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${levelName}] [${this.context}]`;
    
    if (data && Object.keys(data).length > 0) {
      return `${prefix} ${message} ${JSON.stringify(data)}`;
    }
    
    return `${prefix} ${message}`;
  }
  
  debug(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(this.formatMessage(LogLevel.DEBUG, message, data));
    }
  }
  
  info(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log(this.formatMessage(LogLevel.INFO, message, data));
    }
  }
  
  warn(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage(LogLevel.WARN, message, data));
    }
  }
  
  error(message: string, error?: Error | unknown, data?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      const errorData = error instanceof Error 
        ? { ...data, error: { message: error.message, stack: error.stack } }
        : data;
      
      console.error(this.formatMessage(LogLevel.ERROR, message, errorData));
    }
  }
}

/**
 * Create a logger instance for a specific context.
 * @param context - The context/module name for the logger
 * @param minLevel - Minimum log level (default: INFO)
 * @returns Logger instance
 */
export function createLogger(context: string, minLevel: LogLevel = LogLevel.INFO): Logger {
  return new Logger(context, minLevel);
}

/**
 * Global logger for general logging.
 */
export const logger = createLogger("pi-missions");

/**
 * Set global minimum log level.
 * @param level - Minimum log level
 */
export function setLogLevel(level: LogLevel): void {
  logger.minLevel = level;
}