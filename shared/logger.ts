type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LEVEL_ORDER: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

export interface LogContext {
  deviceId?: string;
  externalSessionId?: string;
  hubSessionId?: string;
  commandId?: string;
  eventId?: string;
  correlationId?: string;
  [key: string]: unknown;
}

export class Logger {
  private readonly minLevel: number;

  constructor(level: string) {
    const normalized = level.toUpperCase() as LogLevel;
    this.minLevel = LEVEL_ORDER[normalized] ?? LEVEL_ORDER.INFO;
  }

  private write(level: LogLevel, message: string, context?: LogContext): void {
    if (LEVEL_ORDER[level] < this.minLevel) return;
    const entry = {
      ts: new Date().toISOString(),
      level,
      message,
      ...context,
    };
    console.error(JSON.stringify(entry));
  }

  debug(message: string, context?: LogContext): void {
    this.write("DEBUG", message, context);
  }

  info(message: string, context?: LogContext): void {
    this.write("INFO", message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write("WARN", message, context);
  }

  error(message: string, context?: LogContext): void {
    this.write("ERROR", message, context);
  }
}
