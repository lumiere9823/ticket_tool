import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isAllowedTicketboxHost,
  safeTicketboxFetch,
} from '../../../src/extension/shared/NetworkSafety';
import {
  TicketboxJourneyAdapter,
  addBoundedSetItem,
  MAX_SEAT_SET_SIZE,
} from '../../../src/infrastructure/ticketbox/TicketboxJourneyAdapter';

describe('P3-5: Resource Bounds and Network Safety', () => {
  describe('Network Host Domain Validation', () => {
    it('allows valid Ticketbox domain and subdomains', () => {
      expect(isAllowedTicketboxHost('https://ticketbox.vn')).toBe(true);
      expect(isAllowedTicketboxHost('https://api-v2.ticketbox.vn/events')).toBe(true);
      expect(isAllowedTicketboxHost('https://sub.sub2.ticketbox.vn/foo/bar?q=1')).toBe(true);
      expect(isAllowedTicketboxHost('http://ticketbox.vn')).toBe(true);
    });

    it('rejects malicious phishing, prefix, or suffix domains', () => {
      expect(isAllowedTicketboxHost('https://evil-ticketbox.vn')).toBe(false);
      expect(isAllowedTicketboxHost('https://ticketbox.vn.evil.com')).toBe(false);
      expect(isAllowedTicketboxHost('https://noticketbox.vn')).toBe(false);
      expect(isAllowedTicketboxHost('https://example.com')).toBe(false);
      expect(isAllowedTicketboxHost('javascript:alert(1)')).toBe(false);
      expect(isAllowedTicketboxHost('')).toBe(false);
    });
  });

  describe('safeTicketboxFetch Credential Omission and Host Guard', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('throws error and blocks network request if host is outside Ticketbox domain', async () => {
      await expect(safeTicketboxFetch('https://attacker.com/steal-data')).rejects.toThrow(
        /outside allowed Ticketbox domain/
      );

      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('enforces { credentials: "omit" } on all outgoing requests', async () => {
      await safeTicketboxFetch('https://api-v2.ticketbox.vn/event/api/v1/test', {
        headers: { Accept: 'application/json' },
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api-v2.ticketbox.vn/event/api/v1/test',
        expect.objectContaining({
          credentials: 'omit',
          headers: { Accept: 'application/json' },
        })
      );
    });
  });

  describe('Bounded In-Memory Collections (FIFO Eviction)', () => {
    it('evicts oldest entries when Set capacity is exceeded', () => {
      const set = new Set<string>();
      const limit = 3;

      addBoundedSetItem(set, 'seat-1', limit);
      addBoundedSetItem(set, 'seat-2', limit);
      addBoundedSetItem(set, 'seat-3', limit);
      expect(Array.from(set)).toEqual(['seat-1', 'seat-2', 'seat-3']);

      // Adding 4th item should evict 'seat-1'
      addBoundedSetItem(set, 'seat-4', limit);
      expect(set.size).toBe(3);
      expect(set.has('seat-1')).toBe(false);
      expect(Array.from(set)).toEqual(['seat-2', 'seat-3', 'seat-4']);

      // Adding 5th item should evict 'seat-2'
      addBoundedSetItem(set, 'seat-5', limit);
      expect(set.size).toBe(3);
      expect(set.has('seat-2')).toBe(false);
      expect(Array.from(set)).toEqual(['seat-3', 'seat-4', 'seat-5']);
    });

    it('bounds blacklistedSeatKeys inside TicketboxJourneyAdapter', () => {
      const adapter = new TicketboxJourneyAdapter();

      // Add items up to and beyond MAX_SEAT_SET_SIZE
      for (let i = 0; i < MAX_SEAT_SET_SIZE + 50; i++) {
        adapter.blacklistSeat(`SEAT-BLOCK-${i}`);
      }

      const blacklisted = adapter.getBlacklistedSeats();
      expect(blacklisted.size).toBeLessThanOrEqual(MAX_SEAT_SET_SIZE);
      // Newest seat should be present
      expect(adapter.isSeatBlacklisted(`SEAT-BLOCK-${MAX_SEAT_SET_SIZE + 49}`)).toBe(true);
      // Very first seat should have been evicted
      expect(adapter.isSeatBlacklisted('SEAT-BLOCK-0')).toBe(false);
    });
  });
});
