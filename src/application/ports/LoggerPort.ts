export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  attemptId?: string;
  state?: string;
  accountId?: string;
  profileId?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface LoggerPort {
  debug(event: string, meta?: Record<string, unknown>): void;
  info(event: string, meta?: Record<string, unknown>): void;
  warn(event: string, meta?: Record<string, unknown>): void;
  error(event: string, err?: unknown, meta?: Record<string, unknown>): void;
  withContext(context: {
    attemptId?: string | undefined;
    state?: string | undefined;
    profileId?: string | undefined;
  }): LoggerPort;
}
