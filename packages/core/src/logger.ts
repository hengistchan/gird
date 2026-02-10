/**
 * Logger utilities for the Gird MCP Server Manager
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
  colorize?: boolean;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  context?: Record<string, unknown>;
  error?: Error;
}

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
};

const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: COLORS.dim,
  [LogLevel.INFO]: COLORS.blue,
  [LogLevel.WARN]: COLORS.yellow,
  [LogLevel.ERROR]: COLORS.red,
};

/**
 * Simple logger implementation
 */
export class Logger {
  private level: LogLevel;
  private prefix: string;
  private colorize: boolean;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? LogLevel.INFO;
    this.prefix = options.prefix ?? '';
    this.colorize = options.colorize ?? true;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.level;
  }

  private formatMessage(entry: LogEntry): string {
    const timestamp = entry.timestamp.toISOString();
    const levelName = LEVEL_NAMES[entry.level];
    const prefix = this.prefix ? `[${this.prefix}] ` : '';
    let message = `${timestamp} ${prefix}${levelName}: ${entry.message}`;

    if (entry.context) {
      message += ` ${JSON.stringify(entry.context)}`;
    }

    if (entry.error) {
      message += `\n${entry.error.stack ?? entry.error.message}`;
    }

    if (this.colorize) {
      const color = LEVEL_COLORS[entry.level];
      return `${color}${message}${COLORS.reset}`;
    }

    return message;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>, error?: Error): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
    };

    if (context !== undefined) {
      entry.context = context;
    }

    if (error !== undefined) {
      entry.error = error;
    }

    const formatted = this.formatMessage(entry);

    switch (level) {
      case LogLevel.ERROR:
        console.error(formatted);
        break;
      case LogLevel.WARN:
        console.warn(formatted);
        break;
      default:
        console.log(formatted);
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, context, error);
  }

  /**
   * Create a child logger with a different prefix
   */
  child(prefix: string): Logger {
    const newPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix;
    return new Logger({
      level: this.level,
      prefix: newPrefix,
      colorize: this.colorize,
    });
  }
}

/**
 * Default logger instance
 */
export const logger = new Logger();

/**
 * Create a logger with a specific prefix
 */
export function createLogger(prefix: string, options?: Omit<LoggerOptions, 'prefix'>): Logger {
  return new Logger({ ...options, prefix });
}

/**
 * Parse log level from string
 */
export function parseLogLevel(level: string): LogLevel {
  const upper = level.toUpperCase();
  if (upper in LogLevel) {
    return LogLevel[upper as keyof typeof LogLevel];
  }
  return LogLevel.INFO;
}
