import { LoggerPort, LogLevel, StructuredLogEntry } from '../../application/ports/LoggerPort';

const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'pass',
  'otp',
  'cvv',
  'cvc',
  'card',
  'cardnumber',
  'token',
  'accesstoken',
  'refreshtoken',
  'session',
  'sessiontoken',
  'secret',
]);

export class SanitizedLogger implements LoggerPort {
  private readonly defaultContext: {
    attemptId?: string | undefined;
    state?: string | undefined;
    profileId?: string | undefined;
  };
  private readonly logSink?: ((entry: StructuredLogEntry) => void) | undefined;

  constructor(
    defaultContext: {
      attemptId?: string | undefined;
      state?: string | undefined;
      profileId?: string | undefined;
    } = {},
    logSink?: ((entry: StructuredLogEntry) => void) | undefined
  ) {
    this.defaultContext = defaultContext;
    this.logSink = logSink;
  }

  public debug(event: string, meta?: Record<string, unknown>): void {
    this.log('DEBUG', event, undefined, meta);
  }

  public info(event: string, meta?: Record<string, unknown>): void {
    this.log('INFO', event, undefined, meta);
  }

  public warn(event: string, meta?: Record<string, unknown>): void {
    this.log('WARN', event, undefined, meta);
  }

  public error(event: string, err?: unknown, meta?: Record<string, unknown>): void {
    this.log('ERROR', event, err, meta);
  }

  public withContext(context: {
    attemptId?: string | undefined;
    state?: string | undefined;
    profileId?: string | undefined;
  }): LoggerPort {
    return new SanitizedLogger({ ...this.defaultContext, ...context }, this.logSink);
  }

  private log(level: LogLevel, event: string, err?: unknown, meta?: Record<string, unknown>): void {
    const sanitizedMeta = meta ? this.sanitizeObject(meta) : undefined;
    const errorMessage = err ? (err instanceof Error ? err.message : String(err)) : undefined;

    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...(this.defaultContext.attemptId ? { attemptId: this.defaultContext.attemptId } : {}),
      ...(this.defaultContext.state ? { state: this.defaultContext.state } : {}),
      ...(this.defaultContext.profileId ? { profileId: this.defaultContext.profileId } : {}),
      ...(sanitizedMeta ? { metadata: sanitizedMeta } : {}),
      ...(errorMessage ? { error: errorMessage } : {}),
    };

    if (this.logSink) {
      this.logSink(entry);
    } else {
      const formatted = `[${entry.timestamp}] [${entry.level}] ${entry.event}${
        entry.attemptId ? ` [${entry.attemptId}]` : ''
      }${entry.state ? ` [${entry.state}]` : ''}`;

      const errorDetail =
        entry.error || (entry.metadata?.error ? String(entry.metadata.error) : '');
      const fullMessage = errorDetail ? `${formatted} — ${errorDetail}` : formatted;

      if (level === 'ERROR') {
        console.error(fullMessage, entry.metadata ?? '', entry.error ?? '');
      } else if (level === 'WARN') {
        console.warn(fullMessage, entry.metadata ?? '');
      } else {
        console.info(fullMessage, entry.metadata ?? '');
      }
    }
  }

  public sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();

      if (this.isSensitiveKey(lowerKey)) {
        sanitized[key] = '[REDACTED]';
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeObject(value as Record<string, unknown>);
      } else if (Array.isArray(value)) {
        sanitized[key] = value.map((item) =>
          item && typeof item === 'object'
            ? this.sanitizeObject(item as Record<string, unknown>)
            : item
        );
      } else if (typeof value === 'string' && this.isSensitiveString(value)) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  private isSensitiveKey(lowerKey: string): boolean {
    if (SENSITIVE_KEYS.has(lowerKey)) return true;
    for (const s of SENSITIVE_KEYS) {
      if (lowerKey.includes(s)) return true;
    }
    return false;
  }

  private isSensitiveString(val: string): boolean {
    const lower = val.toLowerCase();
    return (
      lower.startsWith('bearer ') ||
      lower.includes('eyjh') || // JWT header prefix
      lower.includes('connect.sid=') ||
      lower.includes('tb_session=')
    );
  }
}
