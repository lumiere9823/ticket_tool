import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TicketboxJourneyAdapter } from '../../../src/infrastructure/ticketbox/TicketboxJourneyAdapter';
import { SanitizedLogger } from '../../../src/infrastructure/logging/SanitizedLogger';

describe('P3-1: Secure Bridge Protocol (Content Script <-> Page Bridge)', () => {
  let logger: SanitizedLogger;

  beforeEach(() => {
    logger = new SanitizedLogger({ state: 'TEST' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates a cryptographic UUID for requestId instead of Date.now() + Math.random()', async () => {
    let capturedData: Record<string, unknown> | null = null;

    const fakeWindow = {
      location: { origin: 'https://ticketbox.vn' },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      postMessage: (data: Record<string, unknown>) => {
        capturedData = data;
      },
    };

    const origWindow = globalThis.window;
    // @ts-expect-error test mock
    globalThis.window = fakeWindow;

    const adapter = new TicketboxJourneyAdapter(logger);
    // Trigger request without waiting for timeout to inspect postMessage payload
    void adapter.sendPageBridgeRequest('CHECK_READY', {}, 50);

    expect(capturedData).not.toBeNull();
    const requestId = capturedData!['requestId'] as string;
    // UUID v4 format: 8-4-4-4-12 hex digits
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(requestId).toMatch(uuidRegex);

    globalThis.window = origWindow;
  });

  it('includes cryptographic nonce in outgoing bridge requests and rejects responses without matching nonce', async () => {
    const listeners: Record<string, ((ev: unknown) => void)[]> = {};

    const fakeWindow = {
      location: { origin: 'https://ticketbox.vn' },
      addEventListener: (event: string, handler: (ev: unknown) => void) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(handler);
      },
      removeEventListener: (event: string, handler: (ev: unknown) => void) => {
        listeners[event] = (listeners[event] || []).filter((h) => h !== handler);
      },
      postMessage: vi.fn((data: Record<string, unknown>) => {
        if (data && data.source === 'TICKETBOX_ASSISTANT_CONTENT') {
          // Attacker sends response with MISSING or WRONG nonce
          const handlers = listeners['message'] || [];
          for (const h of handlers) {
            h({
              source: fakeWindow,
              origin: 'https://ticketbox.vn',
              data: {
                source: 'TICKETBOX_ASSISTANT_PAGE',
                type: `${data.type}_RESPONSE`,
                requestId: data.requestId,
                nonce: 'attacker-wrong-nonce',
                success: true,
                data: { ok: true },
              },
            });
          }
        }
      }),
    };

    const origWindow = globalThis.window;
    // @ts-expect-error test mock
    globalThis.window = fakeWindow;

    const adapter = new TicketboxJourneyAdapter(logger);
    // Must timeout because the response with wrong nonce is ignored!
    const res = await adapter.sendPageBridgeRequest('CHECK_READY', {}, 80);

    expect(res.success).toBe(false);
    expect(res.error).toBe('TIMEOUT');

    globalThis.window = origWindow;
  });

  it('accepts bridge response when nonce matches', async () => {
    const listeners: Record<string, ((ev: unknown) => void)[]> = {};

    const fakeWindow = {
      location: { origin: 'https://ticketbox.vn' },
      addEventListener: (event: string, handler: (ev: unknown) => void) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(handler);
      },
      removeEventListener: (event: string, handler: (ev: unknown) => void) => {
        listeners[event] = (listeners[event] || []).filter((h) => h !== handler);
      },
      postMessage: vi.fn((data: Record<string, unknown>) => {
        if (data && data.source === 'TICKETBOX_ASSISTANT_CONTENT') {
          const handlers = listeners['message'] || [];
          for (const h of handlers) {
            h({
              source: fakeWindow,
              origin: 'https://ticketbox.vn',
              data: {
                source: 'TICKETBOX_ASSISTANT_PAGE',
                type: `${data.type}_RESPONSE`,
                requestId: data.requestId,
                nonce: data.nonce, // Valid matching nonce
                success: true,
                data: { ok: true },
              },
            });
          }
        }
      }),
    };

    const origWindow = globalThis.window;
    // @ts-expect-error test mock
    globalThis.window = fakeWindow;

    const adapter = new TicketboxJourneyAdapter(logger);
    const res = await adapter.sendPageBridgeRequest<{ ok: boolean }>('CHECK_READY', {}, 500);

    expect(res.success).toBe(true);
    expect(res.data?.ok).toBe(true);

    globalThis.window = origWindow;
  });

  it('uses window.location.origin as targetOrigin instead of wildcard "*"', async () => {
    let capturedTargetOrigin: string | null = null;

    const fakeWindow = {
      location: { origin: 'https://ticketbox.vn' },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      postMessage: (_data: Record<string, unknown>, targetOrigin: string) => {
        capturedTargetOrigin = targetOrigin;
      },
    };

    const origWindow = globalThis.window;
    // @ts-expect-error test mock
    globalThis.window = fakeWindow;

    const adapter = new TicketboxJourneyAdapter(logger);
    void adapter.sendPageBridgeRequest('CHECK_READY', {}, 50);

    expect(capturedTargetOrigin).toBe('https://ticketbox.vn');

    globalThis.window = origWindow;
  });

  it('does NOT dispatch parallel CustomEvent (TICKETBOX_ASSISTANT_REQUEST removed)', async () => {
    const dispatchSpy = vi.fn();

    const fakeWindow = {
      location: { origin: 'https://ticketbox.vn' },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      postMessage: vi.fn(),
      dispatchEvent: dispatchSpy,
    };

    const origWindow = globalThis.window;
    // @ts-expect-error test mock
    globalThis.window = fakeWindow;

    const adapter = new TicketboxJourneyAdapter(logger);
    void adapter.sendPageBridgeRequest('CHECK_READY', {}, 50);

    expect(dispatchSpy).not.toHaveBeenCalled();

    globalThis.window = origWindow;
  });
});
