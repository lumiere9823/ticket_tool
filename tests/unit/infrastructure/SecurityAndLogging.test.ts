import { describe, it, expect } from 'vitest';
import { SanitizedLogger } from '../../../src/infrastructure/logging/SanitizedLogger';
import { ChromeMessageBus } from '../../../src/infrastructure/messaging/ChromeMessageBus';
import { ChromeStorageRepository } from '../../../src/infrastructure/storage/ChromeStorageRepository';
import { StructuredLogEntry } from '../../../src/application/ports/LoggerPort';

describe('Security & Infrastructure Tests', () => {
  it('SanitizedLogger MUST redact passwords, tokens, cookies, OTP, and CVV (Rule 10)', () => {
    let capturedEntry: StructuredLogEntry | null = null;
    const logger = new SanitizedLogger({}, (entry) => {
      capturedEntry = entry;
    });

    logger.info('Network response inspection', {
      url: 'https://ticketbox.vn/api/checkout',
      password: 'super_secret_password',
      authorization: 'Bearer secret_access_token_123',
      cookie: 'tb_session=xyz123abc; connect.sid=sess_999',
      otp: '123456',
      cvv: '999',
      nested: {
        card: '4111222233334444',
        user: 'john_doe',
        rawToken: 'eyJhGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig',
      },
    });

    expect(capturedEntry).not.toBeNull();
    const meta = capturedEntry!.metadata!;

    expect(meta['password']).toBe('[REDACTED]');
    expect(meta['authorization']).toBe('[REDACTED]');
    expect(meta['cookie']).toBe('[REDACTED]');
    expect(meta['otp']).toBe('[REDACTED]');
    expect(meta['cvv']).toBe('[REDACTED]');

    const nested = meta['nested'] as Record<string, unknown>;
    expect(nested['card']).toBe('[REDACTED]');
    expect(nested['rawToken']).toBe('[REDACTED]');
    expect(nested['user']).toBe('john_doe'); // non-sensitive preserved
  });

  it('ChromeMessageBus should validate messages and reject malformed schemas (Rule 13)', async () => {
    const bus = new ChromeMessageBus();

    expect(bus.isValidMessage(null)).toBe(false);
    expect(bus.isValidMessage({})).toBe(false);
    expect(bus.isValidMessage({ type: 'STOP_REQUESTED' })).toBe(false); // missing timestamp

    expect(
      bus.isValidMessage({
        type: 'STOP_REQUESTED',
        timestamp: '2026-09-26T23:00:00Z',
      })
    ).toBe(true);

    // Reject unknown message types
    expect(
      bus.isValidMessage({
        type: 'FORGED_ADMIN_MESSAGE',
        timestamp: '2026-09-26T23:00:00Z',
      })
    ).toBe(false);

    // Reject payload missing required fields
    expect(
      bus.isValidMessage({
        type: 'START_MONITORING',
        timestamp: '2026-09-26T23:00:00Z',
        // missing eventUrl and attemptId
      })
    ).toBe(false);

    expect(
      bus.isValidMessage({
        type: 'RESERVATION_CONFIRMED',
        timestamp: '2026-09-26T23:00:00Z',
        reservationId: '   ', // empty string rejected
      })
    ).toBe(false);

    // Accept properly formed messages
    expect(
      bus.isValidMessage({
        type: 'START_MONITORING',
        timestamp: '2026-09-26T23:00:00Z',
        eventUrl: 'https://ticketbox.vn/event/123',
        attemptId: 'att-123',
      })
    ).toBe(true);

    expect(
      bus.isValidMessage({
        type: 'RESERVATION_CONFIRMED',
        timestamp: '2026-09-26T23:00:00Z',
        reservationId: 'RES-999',
      })
    ).toBe(true);

    expect(
      bus.isValidMessage({
        type: 'HEARTBEAT_PING',
        timestamp: '2026-09-30T06:35:00Z',
      })
    ).toBe(true);

    expect(
      bus.isValidMessage({
        type: 'FETCH_SHOWING_REQUEST',
        timestamp: '2026-09-30T06:35:00Z',
        showingId: '48573955765118',
      })
    ).toBe(true);

    expect(
      bus.isValidMessage({
        type: 'FETCH_SHOWING_RESPONSE',
        timestamp: '2026-09-30T06:35:00Z',
        showingId: '48573955765118',
        success: true,
      })
    ).toBe(true);

    await expect(bus.publish({} as never)).rejects.toThrow('Invalid message format');
  });

  it('ChromeStorageRepository should persist and retrieve configurations and state safely', async () => {
    const storage = new ChromeStorageRepository();

    await storage.saveConfiguration({
      targetEventUrl: 'https://ticketbox.vn/event/rock-fest',
      preferences: {
        categoryPriority: ['VIP', 'CAT 1'],
        quantity: 2,
        allowFallback: false,
      },
      discoveryMode: true,
    });

    const config = await storage.getConfiguration();
    expect(config?.targetEventUrl).toBe('https://ticketbox.vn/event/rock-fest');
    expect(config?.discoveryMode).toBe(true);

    await storage.clearSession();
    const cleared = await storage.getConfiguration();
    expect(cleared).toBeNull();
  });
});
