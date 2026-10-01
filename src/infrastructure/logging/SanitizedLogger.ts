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
  // PII fields (P3-4)
  'phone',
  'phonenumber',
  'telephone',
  'mobile',
  'tel',
  'email',
  'emailaddress',
  'idcard',
  'cccd',
  'cmnd',
  'nationalid',
  'passport',
  'address',
  'fulladdress',
  'street',
  'fullname',
  'firstname',
  'lastname',
  'customername',
  'birthyear',
  'birthday',
  'dob',
  'dateofbirth',
  'gender',
]);

const SAFE_KEYS = new Set([
  'attemptid',
  'state',
  'currentstate',
  'previousstate',
  'profileid',
  'accountid',
  'timestamp',
  'event',
  'status',
  'level',
  'target',
  'category',
  'candidateid',
  'tierid',
  'ticketid',
  'price',
  'quantity',
  'total',
  'count',
  'durationms',
  'latency',
  'step',
  'action',
  'type',
  'id',
  'url',
  'pathname',
  'hostname',
  'method',
  'statuscode',
  'ok',
  'success',
  'reason',
  'code',
  'mode',
  'showingid',
  'isretryable',
]);

const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

export class SanitizedLogger implements LoggerPort {
  private readonly defaultContext: {
    attemptId?: string | undefined;
    state?: string | undefined;
    profileId?: string | undefined;
    minLogLevel?: LogLevel | undefined;
  };
  private readonly logSink?: ((entry: StructuredLogEntry) => void) | undefined;
  private readonly minLogLevel: LogLevel;

  constructor(
    defaultContext: {
      attemptId?: string | undefined;
      state?: string | undefined;
      profileId?: string | undefined;
      minLogLevel?: LogLevel | undefined;
    } = {},
    logSink?: ((entry: StructuredLogEntry) => void) | undefined
  ) {
    this.defaultContext = defaultContext;
    this.logSink = logSink;
    this.minLogLevel = defaultContext.minLogLevel ?? 'DEBUG';
  }

  public debug(event: string, meta?: Record<string, unknown>): void {
    if (LOG_LEVEL_SEVERITY[this.minLogLevel] > LOG_LEVEL_SEVERITY.DEBUG && !this.logSink) {
      return;
    }
    this.log('DEBUG', event, undefined, meta);
  }

  public info(event: string, meta?: Record<string, unknown>): void {
    if (LOG_LEVEL_SEVERITY[this.minLogLevel] > LOG_LEVEL_SEVERITY.INFO && !this.logSink) {
      return;
    }
    this.log('INFO', event, undefined, meta);
  }

  public warn(event: string, meta?: Record<string, unknown>): void {
    if (LOG_LEVEL_SEVERITY[this.minLogLevel] > LOG_LEVEL_SEVERITY.WARN && !this.logSink) {
      return;
    }
    this.log('WARN', event, undefined, meta);
  }

  public error(event: string, err?: unknown, meta?: Record<string, unknown>): void {
    this.log('ERROR', event, err, meta);
  }

  public withContext(context: {
    attemptId?: string | undefined;
    state?: string | undefined;
    profileId?: string | undefined;
    minLogLevel?: LogLevel | undefined;
  }): LoggerPort {
    return new SanitizedLogger(
      { ...this.defaultContext, ...context, minLogLevel: context.minLogLevel ?? this.minLogLevel },
      this.logSink
    );
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
    if (SAFE_KEYS.has(lowerKey)) return false;
    if (SENSITIVE_KEYS.has(lowerKey)) return true;
    for (const s of SENSITIVE_KEYS) {
      if (lowerKey.includes(s)) return true;
    }
    return false;
  }

  private isSensitiveString(val: string): boolean {
    if (val.length < 5) return false;
    const lower = val.toLowerCase();
    if (
      lower.startsWith('bearer ') ||
      lower.includes('eyjh') || // JWT header prefix
      lower.includes('connect.sid=') ||
      lower.includes('tb_session=')
    ) {
      return true;
    }

    // P3-4 Pattern-based PII matching with fast-path guards:
    // 1. Email pattern: only execute regex if '@' and '.' are present
    if (
      val.includes('@') &&
      val.includes('.') &&
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(val)
    ) {
      return true;
    }

    // 2. Vietnam Phone number / ID card: only test if string contains digits and is at least 9 chars
    if (val.length >= 9 && /\d/.test(val)) {
      if (/(?:\+84|0)(?:3[2-9]|5[689]|7[06-9]|8[1-9]|9[0-9])[0-9]{7}\b/.test(val)) {
        return true;
      }
      if (/\b\d{9}\b|\b\d{12}\b/.test(val)) {
        return true;
      }
    }

    return false;
  }
}
