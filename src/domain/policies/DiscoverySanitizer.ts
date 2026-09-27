/**
 * Sanitizer policy for passive discovery artifacts and network observation.
 * Guarantees discovery artifacts cannot capture or commit sensitive credentials.
 * Strictly enforces docs/ticketbox/08-security-and-compliance.md and Phase 8 Pre-Discovery Hardening.
 */

const FORBIDDEN_KEYS = new Set([
  'authorization',
  'auth',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'password',
  'pass',
  'passwd',
  'otp',
  'cvv',
  'cvc',
  'card',
  'cardnumber',
  'card_number',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'session',
  'sessionid',
  'session_id',
  'sessiontoken',
  'session_token',
  'secret',
  'client_secret',
  'credential',
  'apikey',
  'api_key',
  'bearer',
  'code',
]);

export class DiscoverySanitizer {
  /**
   * Sanitizes a URL by stripping any query parameter that matches or contains sensitive keys or values.
   */
  public static sanitizeUrl(rawUrl: string): string {
    if (!rawUrl || rawUrl.trim() === '') {
      return '';
    }

    try {
      const parsed = new URL(rawUrl);
      const keysToDelete: string[] = [];
      const allKeys = Array.from(parsed.searchParams.keys());

      for (const key of allKeys) {
        const lowerKey = key.toLowerCase();
        const value = parsed.searchParams.get(key) || '';
        if (
          DiscoverySanitizer.isSensitiveKey(lowerKey) ||
          DiscoverySanitizer.isSensitiveString(value)
        ) {
          keysToDelete.push(key);
        }
      }

      for (const key of keysToDelete) {
        parsed.searchParams.delete(key);
      }

      return parsed.toString();
    } catch {
      // In case of non-standard or malformed URL, strip query string entirely if it looks suspect
      const queryIndex = rawUrl.indexOf('?');
      if (queryIndex !== -1) {
        return rawUrl.substring(0, queryIndex);
      }
      return rawUrl;
    }
  }

  /**
   * Sanitizes HTTP headers by redacting or omitting sensitive headers.
   */
  public static sanitizeHeaders(
    headers: Record<string, string | number | boolean>
  ): Record<string, string> {
    const sanitized: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();
      if (DiscoverySanitizer.isSensitiveKey(lowerKey)) {
        sanitized[key] = '[REDACTED]';
      } else {
        const stringVal = String(value);
        if (DiscoverySanitizer.isSensitiveString(stringVal)) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = stringVal;
        }
      }
    }

    return sanitized;
  }

  /**
   * Recursively sanitizes any payload, artifact, or log object.
   */
  public static sanitizePayload<T>(payload: T): T {
    if (payload === null || payload === undefined) {
      return payload;
    }

    if (typeof payload === 'string') {
      if (DiscoverySanitizer.isSensitiveString(payload)) {
        return '[REDACTED]' as unknown as T;
      }
      return payload;
    }

    if (typeof payload !== 'object') {
      return payload;
    }

    if (Array.isArray(payload)) {
      return payload.map((item) => DiscoverySanitizer.sanitizePayload(item)) as unknown as T;
    }

    const sanitizedObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (DiscoverySanitizer.isSensitiveKey(lowerKey)) {
        sanitizedObj[key] = '[REDACTED]';
      } else {
        sanitizedObj[key] = DiscoverySanitizer.sanitizePayload(value);
      }
    }

    return sanitizedObj as T;
  }

  /**
   * Tests whether a key is sensitive.
   */
  public static isSensitiveKey(key: string): boolean {
    const lowerKey = key.toLowerCase();
    if (FORBIDDEN_KEYS.has(lowerKey)) return true;
    for (const forbidden of FORBIDDEN_KEYS) {
      if (lowerKey.includes(forbidden)) return true;
    }
    return false;
  }

  /**
   * Tests whether a string value contains sensitive tokens (e.g. Bearer tokens, JWTs, session cookies).
   */
  public static isSensitiveString(val: string): boolean {
    const lower = val.toLowerCase().trim();
    return (
      lower.startsWith('bearer ') ||
      lower.includes('eyjh') || // JWT header pattern
      lower.includes('connect.sid=') ||
      lower.includes('tb_session=') ||
      lower.includes('session=') ||
      lower.includes('password=') ||
      lower.includes('token=')
    );
  }
}
