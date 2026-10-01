import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TicketboxJourneyAdapter } from '../../../src/infrastructure/ticketbox/TicketboxJourneyAdapter';
import { LoggerPort } from '../../../src/application/ports/LoggerPort';

describe('Scoped Discovery Adapter (AC-10)', () => {
  const mockLogger: LoggerPort = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    withContext: vi.fn().mockReturnThis(),
  };

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('AC-10: strictly blocks fetch requests for showings outside the allowed whitelist', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: { result: { sections: [{ id: 'sec-1', name: 'Section 1' }] } },
      }),
    });
    globalThis.fetch = fetchSpy;

    const adapter = new TicketboxJourneyAdapter(mockLogger);

    // Set allowed whitelist to only 'show-1'
    adapter.setAllowedShowingIds(['show-1']);

    // 1. Attempt to fetch showing outside whitelist: 'show-2'
    const resultOutOfScope = await adapter.fetchSeatmapApi('show-2');

    // Must return null without making any HTTP request
    expect(resultOutOfScope).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("Skipping seatmap fetch for showing 'show-2'"),
      expect.objectContaining({ showingId: 'show-2' })
    );

    // 2. Fetch showing in whitelist: 'show-1'
    const resultInScope = await adapter.fetchSeatmapApi('show-1');

    // Should proceed to fetch 'show-1'
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/showings/show-1/seatmap'),
      expect.objectContaining({ credentials: 'omit' })
    );
    expect(resultInScope).not.toBeNull();
  });

  it('AC-10: discoverTicketCatalog with allowedShowingIds skips seatmap query for out-of-scope showings', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: { result: { sections: [] } },
      }),
    });
    globalThis.fetch = fetchSpy;

    const adapter = new TicketboxJourneyAdapter(mockLogger);

    // Call discoverTicketCatalog requesting target showing 'show-unwanted', but allowedShowingIds is ['show-wanted']
    await adapter.discoverTicketCatalog('show-unwanted', ['show-wanted']);

    // fetch should NOT have been called with show-unwanted
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('/showings/show-unwanted/seatmap')
    );
  });

  describe('C4 (A2): Adapter assertInScope Chokepoint on User Actions & Navigation', () => {
    it('selectTicket throws ScopeViolationError if ticket is out of scope and performs no action', async () => {
      const adapter = new TicketboxJourneyAdapter(mockLogger);
      adapter.setScopedPlan({
        eventId: 'evt-1',
        targets: [
          {
            showingId: 'showing-allowed',
            ticketTypeIds: ['t-allowed'],
            rank: 1,
          },
        ],
        quantity: 1,
        strategy: 'BY_TARGET_ORDER',
        persistence: {
          maxDurationMinutes: 30,
          maxAttempts: 200,
          pollIntervalMs: 2000,
          jitterRatio: 0.2,
        },
      });

      // Attempting to select 't-forbidden' in 'showing-allowed'
      await expect(adapter.selectTicket('t-forbidden', 1, 'showing-allowed')).rejects.toThrow(
        'Ticket t-forbidden is outside whitelist'
      );

      // Attempting to select 't-allowed' in 'showing-forbidden'
      await expect(adapter.selectTicket('t-allowed', 1, 'showing-forbidden')).rejects.toThrow(
        'Showing showing-forbidden is outside whitelist'
      );
    });

    it('clickCalendarShowingDate throws ScopeViolationError if showing date is out of scope', async () => {
      const adapter = new TicketboxJourneyAdapter(mockLogger);
      adapter.setScopedPlan({
        eventId: 'evt-1',
        targets: [
          {
            showingId: 'showing-allowed',
            ticketTypeIds: ['t-allowed'],
            rank: 1,
          },
        ],
        quantity: 1,
        strategy: 'BY_TARGET_ORDER',
        persistence: {
          maxDurationMinutes: 30,
          maxAttempts: 200,
          pollIntervalMs: 2000,
          jitterRatio: 0.2,
        },
      });

      await expect(adapter.clickCalendarShowingDate('showing-forbidden')).rejects.toThrow(
        'Showing showing-forbidden is outside whitelist'
      );
    });
  });
});
