/**
 * Ticketbox Catalog Discovery
 *
 * Discovers events, showings, and ticket catalogs from:
 * - Authoritative Event API v2
 * - Authoritative Showing API v2
 * - Authoritative Seatmap API
 * - DOM fallback via TicketboxCatalogParser
 */

import { LoggerPort } from '../../../application/ports/LoggerPort';
import {
  EventCatalog,
  ShowingSnapshot,
  TicketCandidate,
  TicketMode,
  TicketAvailability,
  TicketType,
} from '../../../domain/entities/EventCatalog';
import { JourneyTicketType } from '../../../domain/entities/BookingJourneyModels';
import { assertInScope, ScopedPurchasePlan } from '../../../domain/entities/ScopedPurchasePlan';
import { DOMElementLike, wrapBrowserElement } from '../parsing/DOMElementLike';
import { TicketboxCatalogParser } from '../parsing/TicketboxCatalogParser';
import { TicketboxSeatMapParser } from '../parsing/TicketboxSeatMapParser';
import { TicketboxApiClient } from '../client/TicketboxApiClient';

export interface CatalogDiscoveryContext {
  getRoot: () => DOMElementLike | null;
  getPageUrl: () => string;
  getShowingId: () => string | null;
  getEventId: () => string | null;
  apiClient: TicketboxApiClient;
  getScopedPlan: () => ScopedPurchasePlan | null | undefined;
  clickElement: (el: DOMElementLike) => void;
}

export class TicketboxCatalogDiscovery {
  constructor(
    private readonly ctx: CatalogDiscoveryContext,
    private readonly logger?: LoggerPort
  ) {}

  public async discoverTicketCatalog(
    showingId?: string | null,
    allowedShowingIds?: string[] | null
  ): Promise<EventCatalog> {
    if (allowedShowingIds && allowedShowingIds.length > 0) {
      this.ctx.apiClient.setAllowedShowingIds(allowedShowingIds);
    }
    const root = this.ctx.getRoot();
    const url = this.ctx.getPageUrl();
    const targetShowingId =
      showingId && showingId !== 'default' ? showingId : this.ctx.getShowingId();

    const isBookingPage =
      url.includes('/bookings/') ||
      url.includes('/select-ticket') ||
      url.includes('/question-form');
    const baseCatalogForEventId = root ? TicketboxCatalogParser.parseCatalog(root, url) : null;
    const discoveredEventId = baseCatalogForEventId?.eventId || this.ctx.getEventId();

    if (!isBookingPage && discoveredEventId) {
      try {
        const eventApiData = await this.ctx.apiClient.fetchEventApi(discoveredEventId);
        if (eventApiData?.data?.result?.showings?.length) {
          const result = eventApiData.data.result;
          let showingSnapshots: ShowingSnapshot[] = result.showings
            .filter((s) => s.isSalable)
            .map((s) => ({
              id: String(s.id),
              name: s.showingTime || null,
              date: s.showingTime || null,
              ticketTypes: s.ticketTypes.map((t) => ({
                id: String(t.id),
                name: t.name,
                price: { amount: t.price, currency: 'VND' as const },
                mode: 'UNKNOWN' as TicketMode,
                availability: (t.status === 'book_now'
                  ? 'AVAILABLE'
                  : t.status === 'sold_out'
                    ? 'SOLD_OUT'
                    : 'UNKNOWN') as TicketAvailability,
                minQuantity: t.minQtyPerOrder,
                maxQuantity: t.maxQtyPerOrder,
                selectedQuantity: 0,
                selectable: t.status === 'book_now',
                source: { page: 'EVENT' as const, evidence: ['event-api-v2'] },
              })),
            }));

          if (targetShowingId && targetShowingId !== 'default') {
            const filtered = showingSnapshots.filter((s) => s.id === targetShowingId);
            if (filtered.length > 0) {
              showingSnapshots = filtered;
            }
          }

          if (showingSnapshots.length > 0) {
            this.logger?.info('Discovered showings from Event API', {
              eventId: discoveredEventId,
              showingsCount: showingSnapshots.length,
              targetShowingId: targetShowingId ?? 'all',
            });
            return {
              eventId: discoveredEventId,
              eventTitle: result.title || baseCatalogForEventId?.eventTitle || null,
              eventUrl: url,
              showings: showingSnapshots,
            };
          }
        }
      } catch (err) {
        this.logger?.warn('Error fetching Event API showings, falling back to DOM', {
          err: String(err),
        });
      }
    }

    if (
      targetShowingId &&
      targetShowingId !== 'default' &&
      !this.ctx.apiClient.getCachedSeatmapData()
    ) {
      try {
        const showingApiData =
          this.ctx.apiClient.getCachedShowingApiData() ||
          (await this.ctx.apiClient.fetchShowingApi(targetShowingId));
        if (showingApiData?.data?.result?.ticketTypes?.length) {
          const res = showingApiData.data.result;
          const isStanding = res.seatMapId === 0;
          const ticketTypes: TicketType[] = res.ticketTypes.map((t) => ({
            id: String(t.id),
            name: t.name,
            price: { amount: t.price, currency: 'VND' as const },
            mode: isStanding ? ('STANDING' as const) : ('SEATED' as const),
            availability: (t.status === 'book_now'
              ? 'AVAILABLE'
              : t.status === 'sold_out'
                ? 'SOLD_OUT'
                : 'UNKNOWN') as TicketAvailability,
            minQuantity: t.minQtyPerOrder || 1,
            maxQuantity: t.maxQtyPerOrder || 4,
            selectedQuantity: 0,
            selectable: t.status === 'book_now',
            source: {
              page: isBookingPage ? ('BOOKING' as const) : ('EVENT' as const),
              evidence: ['showing-api-v2', `seatMapId-${res.seatMapId}`],
            },
            rawLabel: t.name,
          }));

          const baseCatalog = root
            ? TicketboxCatalogParser.parseCatalog(root, url)
            : { eventId: null, eventTitle: null, eventUrl: url, showings: [] };

          this.logger?.info('Discovered ticket types from authoritative Showing API', {
            showingId: targetShowingId,
            seatMapId: res.seatMapId,
            mode: isStanding ? 'STANDING' : 'SEATED',
            ticketCount: ticketTypes.length,
            availableCount: ticketTypes.filter((t) => t.selectable).length,
          });

          return {
            eventId: String(res.event?.id || baseCatalog.eventId || ''),
            eventTitle: res.event?.title || baseCatalog.eventTitle || null,
            eventUrl: url,
            showings: [
              {
                id: targetShowingId,
                name: res.showingTime || baseCatalog.showings[0]?.name || null,
                date: res.showingTime || baseCatalog.showings[0]?.date || null,
                ticketTypes,
              },
            ],
          };
        }
      } catch (err) {
        this.logger?.warn('Error fetching Showing API, falling back to other strategies', {
          err: String(err),
        });
      }
    }

    const cachedSeatmap = this.ctx.apiClient.getCachedSeatmapData();
    if (cachedSeatmap || targetShowingId) {
      try {
        const seatmapData =
          cachedSeatmap || (await this.ctx.apiClient.fetchSeatmapApi(targetShowingId!));
        if (seatmapData) {
          const apiTickets = TicketboxSeatMapParser.parseTicketTypesFromSeatmapApi(seatmapData);
          if (apiTickets.length > 0) {
            const baseCatalog = root
              ? TicketboxCatalogParser.parseCatalog(root, url)
              : {
                  eventId: null,
                  eventTitle: null,
                  eventUrl: url,
                  showings: [],
                };

            const showingName = baseCatalog.showings[0]?.name || null;
            const showingDate = baseCatalog.showings[0]?.date || null;

            this.logger?.info('Discovered ticket types from authoritative Seatmap API', {
              showingId: targetShowingId,
              ticketCount: apiTickets.length,
            });

            return {
              eventId: baseCatalog.eventId,
              eventTitle: baseCatalog.eventTitle,
              eventUrl: url,
              showings: [
                {
                  id: targetShowingId,
                  name: showingName,
                  date: showingDate,
                  ticketTypes: apiTickets,
                },
              ],
            };
          }
        }
      } catch (err: unknown) {
        this.logger?.warn(
          'Error discovering tickets from Seatmap API, falling back to DOM parser',
          {
            err: String(err),
          }
        );
      }
    }

    if (!root) {
      return {
        eventId: null,
        eventTitle: null,
        eventUrl: url,
        showings: [],
      };
    }
    const catalog = TicketboxCatalogParser.parseCatalog(root, url);
    if (showingId) {
      return {
        ...catalog,
        showings: catalog.showings.filter((s) => s.id === showingId),
      };
    }
    return catalog;
  }

  public async revalidateTicket(
    candidate: TicketCandidate
  ): Promise<{ isValid: boolean; reason?: string }> {
    const tickets = await this.discoverJourneyTickets();
    const matched = tickets.find(
      (t) => t.name === candidate.ticket.name || (t.id && t.id === candidate.ticket.id)
    );

    if (!matched) {
      return { isValid: false, reason: 'Ticket not found in current DOM' };
    }

    if (matched.availability !== 'AVAILABLE' || !matched.selectable) {
      return {
        isValid: false,
        reason: `Ticket availability changed to ${matched.availability}`,
      };
    }

    return { isValid: true };
  }

  public async discoverJourneyTickets(
    targetShowingId?: string | null
  ): Promise<JourneyTicketType[]> {
    const root = this.ctx.getRoot();
    if (!root) return [];

    const catalog = await this.discoverTicketCatalog(targetShowingId);
    const journeyTickets: JourneyTicketType[] = [];

    for (const showing of catalog.showings) {
      if (
        targetShowingId &&
        targetShowingId !== 'default' &&
        showing.id &&
        showing.id !== targetShowingId
      ) {
        continue;
      }
      for (const t of showing.ticketTypes) {
        journeyTickets.push({
          id: t.id,
          showingId: showing.id,
          name: t.name,
          price: t.price.amount,
          currency: t.price.currency,
          mode: t.mode === 'STANDING' ? 'STANDING' : t.mode === 'SEATED' ? 'SEATED' : 'UNKNOWN',
          availability:
            t.availability === 'AVAILABLE'
              ? 'AVAILABLE'
              : t.availability === 'SOLD_OUT'
                ? 'SOLD_OUT'
                : t.availability === 'NOT_STARTED'
                  ? 'NOT_STARTED'
                  : t.availability === 'CLOSED'
                    ? 'CLOSED'
                    : 'UNKNOWN',
          minQuantity: t.minQuantity,
          maxQuantity: t.maxQuantity,
          selectable: t.selectable,
          evidence: t.source.evidence,
        });
      }
    }

    return journeyTickets;
  }

  public async clickCalendarShowingDate(showingId: string | null): Promise<boolean> {
    const scopedPlan = this.ctx.getScopedPlan();
    if (scopedPlan && showingId) {
      assertInScope(scopedPlan, showingId);
    }
    if (typeof document === 'undefined') return false;

    let targetDateText: string | null = null;
    let dayNum: number | null = null;

    const eventId = this.ctx.getEventId();
    if (eventId) {
      const resolvedEventApi = await this.ctx.apiClient.fetchEventApi(eventId);
      if (showingId && resolvedEventApi?.data?.result?.showings) {
        const showing = resolvedEventApi.data.result.showings.find(
          (s) => String(s.id) === showingId
        );
        if (showing?.showingTime) {
          targetDateText = showing.showingTime;
          const dayMatch =
            targetDateText.match(/\b(\d{1,2})\s*Tháng/i) || targetDateText.match(/\b(\d{1,2})\b/);
          if (dayMatch && dayMatch[1]) {
            dayNum = parseInt(dayMatch[1], 10);
          }
        }
      }
    }

    this.logger?.info('Attempting calendar date selection', {
      showingId,
      targetDateText,
      dayNum,
    });

    const calendarScope =
      document.querySelector(
        '#ticket-info, [class*="calendar"], [class*="schedule"], .ant-picker-calendar'
      ) || document;

    const candidates = Array.from(
      calendarScope.querySelectorAll(
        '.ant-picker-cell, [class*="cell"], [class*="date"], td, li, div[role="button"], button'
      )
    );

    const indicatorCells = candidates.filter((el) => {
      const style = el.getAttribute('style') || '';
      const cls = (el.className || '').toString();
      const hasGreen =
        style.includes('green') ||
        style.includes('#') ||
        cls.includes('underline') ||
        cls.includes('showing') ||
        cls.includes('active') ||
        cls.includes('event');
      const hasIndicatorChild =
        el.querySelector(
          '[class*="underline"], [class*="indicator"], [class*="dot"], svg, span[style*="background"], div[style*="background"]'
        ) !== null;
      return hasGreen || hasIndicatorChild;
    });

    if (dayNum !== null) {
      const dayStr = String(dayNum);
      const dayPadded = dayNum < 10 ? `0${dayNum}` : dayStr;

      const pool = indicatorCells.length > 0 ? indicatorCells : candidates;
      for (const el of pool) {
        const txt = el.textContent?.trim() || '';
        if (txt === dayStr || txt === dayPadded || new RegExp(`\\b0?${dayNum}\\b`).test(txt)) {
          this.logger?.info('Found calendar cell matching day number, clicking', {
            dayNum,
            txt: txt.slice(0, 30),
          });
          this.ctx.clickElement(wrapBrowserElement(el));
          return true;
        }
      }
    }

    if (indicatorCells.length > 0) {
      const first = indicatorCells[0]!;
      this.logger?.info('Clicking first calendar cell with showing indicator');
      this.ctx.clickElement(wrapBrowserElement(first));
      return true;
    }

    return false;
  }
}
