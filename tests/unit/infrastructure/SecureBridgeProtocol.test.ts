import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TicketboxJourneyAdapter } from '../../../src/infrastructure/ticketbox/TicketboxJourneyAdapter';
import { SanitizedLogger } from '../../../src/infrastructure/logging/SanitizedLogger';
import {
  generateBridgeNonce,
  generateBridgeRequestId,
  isValidBridgeRequest,
  isValidClickSelector,
  isValidClickText,
} from '../../../src/extension/shared/BridgeProtocol';

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

  describe('T2: Strict bridge hardening & negative tests', () => {
    it('refuses to send postMessage and returns INVALID_ORIGIN when origin is invalid or null', async () => {
      const postMessageSpy = vi.fn();
      const fakeWindow = {
        location: { origin: 'null' },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        postMessage: postMessageSpy,
      };

      const origWindow = globalThis.window;
      // @ts-expect-error test mock
      globalThis.window = fakeWindow;

      const adapter = new TicketboxJourneyAdapter(logger);
      const res = await adapter.sendPageBridgeRequest('CHECK_READY', {}, 50);

      expect(res.success).toBe(false);
      expect(res.error).toBe('INVALID_ORIGIN');
      expect(postMessageSpy).not.toHaveBeenCalled();

      globalThis.window = origWindow;
    });

    it('fails closed when crypto is unavailable (no Math.random fallback)', () => {
      const origCrypto = globalThis.crypto;
      // @ts-expect-error mock missing crypto
      delete globalThis.crypto;

      try {
        expect(() => generateBridgeNonce()).toThrow(/FAIL_CLOSED/);
        expect(() => generateBridgeRequestId()).toThrow(/FAIL_CLOSED/);
      } finally {
        globalThis.crypto = origCrypto;
      }
    });

    it('rejects message with wrong source or missing schema in isValidBridgeRequest', () => {
      // Invalid source
      expect(
        isValidBridgeRequest({
          source: 'ATTACKER_SOURCE',
          type: 'CHECK_READY',
          requestId: 'req-1',
          nonce: 'nonce-1',
        })
      ).toBe(false);

      // Unknown action
      expect(
        isValidBridgeRequest({
          source: 'TICKETBOX_ASSISTANT_CONTENT',
          type: 'EVIL_ACTION',
          requestId: 'req-1',
          nonce: 'nonce-1',
        })
      ).toBe(false);

      // Missing nonce
      expect(
        isValidBridgeRequest({
          source: 'TICKETBOX_ASSISTANT_CONTENT',
          type: 'CHECK_READY',
          requestId: 'req-1',
          nonce: '',
        })
      ).toBe(false);

      // Malformed payload (seats is not array)
      expect(
        isValidBridgeRequest({
          source: 'TICKETBOX_ASSISTANT_CONTENT',
          type: 'CHECK_READY',
          requestId: 'req-1',
          nonce: 'valid-nonce',
          payload: { seats: 'not-an-array' },
        })
      ).toBe(false);
    });

    it('validates CLICK_ELEMENT selectors against allowlist', () => {
      // Allowed selectors
      expect(isValidClickSelector('#btn-next')).toBe(true);
      expect(isValidClickSelector('#continue-button')).toBe(true);
      expect(isValidClickSelector('button.btn-next')).toBe(true);
      expect(isValidClickSelector('#submit-btn')).toBe(true);

      // Disallowed arbitrary selectors
      expect(isValidClickSelector('body')).toBe(false);
      expect(isValidClickSelector('input[name="password"]')).toBe(false);
      expect(isValidClickSelector('script')).toBe(false);
      expect(isValidClickSelector('div.evil-overlay')).toBe(false);

      // Text validations
      expect(isValidClickText('Tiếp tục')).toBe(true);
      expect(isValidClickText('<script>alert(1)</script>')).toBe(false);
    });
  });
});
