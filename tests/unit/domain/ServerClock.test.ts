import { describe, it, expect, vi } from 'vitest';
import {
  toServerTime,
  msUntil,
  estimateClockOffset,
  ClockSample,
} from '../../../src/domain/policies/ServerClock';
import { HttpDateServerClockAdapter } from '../../../src/infrastructure/ticketbox/HttpDateServerClockAdapter';

describe('ServerClock Domain & Adapter', () => {
  describe('Pure Domain Functions', () => {
    it('toServerTime calculates clientNow + offset correctly for positive and negative offsets', () => {
      const clientNow = 1_000_000;
      expect(toServerTime(clientNow, 250)).toBe(1_000_250);
      expect(toServerTime(clientNow, -500)).toBe(999_500);
      expect(toServerTime(clientNow, 0)).toBe(1_000_000);
    });

    it('msUntil calculates countdown to target server time considering offset', () => {
      const clientNow = 1_000_000;
      const offsetMs = 200; // Server is 200ms ahead of client
      const targetServerTime = 1_005_000; // Target in server reference

      // Server time currently = clientNow + offset = 1_000_200
      // msUntil = targetServerTime - currentServerTime = 1_005_000 - 1_000_200 = 4800
      expect(msUntil(targetServerTime, offsetMs, clientNow)).toBe(4800);

      // Negative offset: server is 300ms behind client
      const negOffset = -300;
      // Server time currently = 1_000_000 - 300 = 999_700
      // msUntil = 1_005_000 - 999_700 = 5300
      expect(msUntil(targetServerTime, negOffset, clientNow)).toBe(5300);
    });

    it('estimateClockOffset handles empty or invalid samples gracefully', () => {
      expect(estimateClockOffset([])).toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(estimateClockOffset(null as any)).toBeNull();

      const invalidSamples: ClockSample[] = [
        { clientRequestStartMs: 1000, serverTimeMs: NaN, clientResponseEndMs: 1100 },
        { clientRequestStartMs: 1200, serverTimeMs: 1000, clientResponseEndMs: 1100 }, // negative RTT
      ];
      expect(estimateClockOffset(invalidSamples)).toBeNull();
    });

    it('estimateClockOffset chooses the sample with the lowest RTT amidst noise', () => {
      const samples: ClockSample[] = [
        // Sample 1: high RTT = 400ms (1000 to 1400), serverTime = 2000
        // midpoint = 1200, offset = 2000 - 1200 = 800
        { clientRequestStartMs: 1000, serverTimeMs: 2000, clientResponseEndMs: 1400 },
        // Sample 2: low RTT = 50ms (2000 to 2050), serverTime = 2525
        // midpoint = 2025, offset = 2525 - 2025 = 500
        { clientRequestStartMs: 2000, serverTimeMs: 2525, clientResponseEndMs: 2050 },
        // Sample 3: medium RTT = 120ms (3000 to 3120), serverTime = 3600
        // midpoint = 3060, offset = 3600 - 3060 = 540
        { clientRequestStartMs: 3000, serverTimeMs: 3600, clientResponseEndMs: 3120 },
      ];

      const estimate = estimateClockOffset(samples);
      expect(estimate).not.toBeNull();
      expect(estimate!.roundTripTimeMs).toBe(50);
      expect(estimate!.offsetMs).toBe(500);
      expect(estimate!.sampleCount).toBe(3);
      // Uncertainty includes 1000ms Date header resolution + RTT/2 (25ms) = 1025ms
      expect(estimate!.uncertaintyMs).toBe(1025);
    });

    it('estimateClockOffset handles negative offset correctly', () => {
      // Client is at 5000, Server is at 4000 (server 1000ms behind)
      const samples: ClockSample[] = [
        { clientRequestStartMs: 5000, serverTimeMs: 4050, clientResponseEndMs: 5100 },
      ];
      const estimate = estimateClockOffset(samples);
      expect(estimate).not.toBeNull();
      // midpoint = 5050; offset = 4050 - 5050 = -1000
      expect(estimate!.offsetMs).toBe(-1000);
      expect(estimate!.roundTripTimeMs).toBe(100);
      expect(estimate!.uncertaintyMs).toBe(1050);
    });
  });

  describe('HttpDateServerClockAdapter', () => {
    it('synchronizes clock using Date header and safeTicketboxFetch', async () => {
      const serverDateStr = 'Wed, 21 Oct 2026 07:28:00 GMT';

      const mockResponse = {
        headers: new Headers({
          date: serverDateStr,
        }),
      } as unknown as Response;

      // Mock global fetch
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => mockResponse);

      const adapter = new HttpDateServerClockAdapter(undefined, {
        endpointUrl: 'https://api-v2.ticketbox.vn/gin/api/v2/events/0',
        maxSamples: 2,
        sampleIntervalMs: 10,
      });

      const estimate = await adapter.synchronize(2);
      expect(estimate).not.toBeNull();
      expect(estimate!.sampleCount).toBe(2);
      expect(adapter.getLastEstimate()).toBe(estimate);

      // Verify that fetch was called on ticketbox.vn host with credentials omit
      expect(fetchSpy).toHaveBeenCalled();
      const lastCall = fetchSpy.mock.calls[0]!;
      expect(lastCall[0]).toContain('ticketbox.vn');
      expect((lastCall[1] as RequestInit)?.credentials).toBe('omit');

      fetchSpy.mockRestore();
    });

    it('falls back safely when Date header is missing or invalid', async () => {
      const mockResponse = {
        headers: new Headers(),
      } as unknown as Response;

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => mockResponse);

      const adapter = new HttpDateServerClockAdapter(undefined, {
        endpointUrl: 'https://api-v2.ticketbox.vn/gin/api/v2/events/0',
        maxSamples: 1,
      });

      const estimate = await adapter.synchronize(1);
      expect(estimate).toBeNull();
      expect(adapter.getLastEstimate()).toBeNull();

      fetchSpy.mockRestore();
    });
  });
});
