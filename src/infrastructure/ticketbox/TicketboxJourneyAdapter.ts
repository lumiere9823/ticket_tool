import {
  TicketboxPageAdapter,
  PageEventState,
  PageInventoryState,
  PageSelectionState,
  PageReservationResult,
  PageCheckoutState,
} from '../../application/ports/TicketboxPageAdapter';
import { LoggerPort } from '../../application/ports/LoggerPort';
import { CandidateTicket } from '../../domain/entities/CandidateTicket';
import { Reservation } from '../../domain/entities/Reservation';
import { Event } from '../../domain/entities/Event';
import { Money } from '../../domain/value-objects/Money';
import {
  EventCatalog,
  ShowingSnapshot,
  TicketCandidate,
  TicketType,
  TicketboxPageType,
  TicketMode,
  TicketAvailability,
} from '../../domain/entities/EventCatalog';
import {
  BookingSummary,
  FormSchema,
  JourneyTicketType,
  Seat,
  SeatArea,
  UserProfileData,
} from '../../domain/entities/BookingJourneyModels';
import { assertInScope, ScopedPurchasePlan } from '../../domain/entities/ScopedPurchasePlan';
import { DOMElementLike, wrapBrowserElement } from './parsing/DOMElementLike';

import { TicketboxCatalogParser } from './parsing/TicketboxCatalogParser';
import { SeatmapApiResponse, TicketboxSeatMapParser } from './parsing/TicketboxSeatMapParser';
import { TicketboxSummaryParser } from './parsing/TicketboxSummaryParser';
import { TicketboxFormParser } from './parsing/TicketboxFormParser';
import { FormAutofillPolicy } from '../../domain/policies/FormAutofillPolicy';

/**
 * Internal typed interface for DOM elements that support mutations (click, value assignment).
 * Used to avoid `any` casts when interacting with DOMElementLike in the journey adapter.
 */
interface MutableDOMElement extends DOMElementLike {
  click?: () => void;
  value?: string;
  attributes: Record<string, string>;
}

/** Shape of the /gin/api/v2/events/{id} response */
interface TicketboxEventApiShowingTicket {
  id: number;
  name: string;
  price: number;
  status: string;
  maxQtyPerOrder: number;
  minQtyPerOrder: number;
}
interface TicketboxEventApiShowing {
  id: number;
  status: string;
  isSalable: boolean;
  showingTime: string;
  ticketTypes: TicketboxEventApiShowingTicket[];
}
interface TicketboxEventApiResponse {
  status: number;
  data: {
    result: {
      id: number;
      title: string;
      showings: TicketboxEventApiShowing[];
    };
  };
}

export interface TicketboxQuestionOption {
  optionText: string;
}

export interface TicketboxQuestionItem {
  type: number;
  question: string;
  helperText?: string;
  isAnswerRequired: boolean;
  options?: TicketboxQuestionOption[];
}

export interface TicketboxQuestionFormApiResponse {
  status: number;
  message?: string;
  data: {
    result: {
      id: number;
      eventId: number;
      questionCollection: TicketboxQuestionItem[];
    };
  };
}

/**
 * Concrete Page Adapter for executing the complete Ticketbox booking journey.
 * Strictly enforces:
 * - Read-and-verify after every action
 * - Normal user-facing controls only (no hidden API manipulation)
 * - Safe autofill with user profile data only
 * - Works with live browser DOM and test fixtures via DOMElementLike
 */
export class TicketboxJourneyAdapter implements TicketboxPageAdapter {
  private customRoot?: DOMElementLike | undefined;
  private cachedSeatmapData?: SeatmapApiResponse | null = null;
  private cachedShowingId?: string | null = null;
  private failedSeatmapShowingIds = new Map<string, number>();
  private cachedEventApiData: TicketboxEventApiResponse | null = null;
  private cachedEventApiId: string | null = null;
  private cachedQuestionFormData: TicketboxQuestionFormApiResponse | null = null;
  private cachedQuestionFormEventId: string | null = null;
  private cachedSeats: Seat[] = [];
  private selectedSeatIds = new Set<string>();
  private blacklistedSeatKeys = new Set<string>();
  public navigationPending = false;
  private allowedShowingIds?: Set<string> | null = null;
  private scopedPlan?: ScopedPurchasePlan | null = null;

  public blacklistSeat(seatIdOrLabel: string): void {
    if (!seatIdOrLabel) return;
    const raw = seatIdOrLabel.trim();
    const norm = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (norm) {
      this.blacklistedSeatKeys.add(norm);
      this.blacklistedSeatKeys.add(raw.toUpperCase());
      this.selectedSeatIds.delete(raw);
      this.selectedSeatIds.delete(norm);
      this.logger?.info('Blacklisted unavailable seat from selection', {
        seatIdOrLabel: raw,
        normKey: norm,
      });
    }
  }

  public isSeatBlacklisted(seatIdOrLabel?: string | null): boolean {
    if (!seatIdOrLabel) return false;
    const raw = seatIdOrLabel.trim().toUpperCase();
    const norm = raw.replace(/[^A-Z0-9]/g, '');
    return this.blacklistedSeatKeys.has(norm) || this.blacklistedSeatKeys.has(raw);
  }

  public getBlacklistedSeats(): Set<string> {
    return this.blacklistedSeatKeys;
  }

  constructor(
    private readonly logger?: LoggerPort,
    root?: DOMElementLike | Document | Element | undefined
  ) {
    if (root) {
      if ('tagName' in root && typeof (root as DOMElementLike).querySelector === 'function') {
        this.customRoot = root as DOMElementLike;
      } else if (typeof document !== 'undefined') {
        this.customRoot = wrapBrowserElement(root as Element | Document);
      }
    }
  }

  public setAllowedShowingIds(ids: string[] | null): void {
    this.allowedShowingIds = ids ? new Set(ids) : null;
  }

  public setScopedPlan(plan: ScopedPurchasePlan | null): void {
    this.scopedPlan = plan;
    if (plan && plan.targets && plan.targets.length > 0) {
      this.allowedShowingIds = new Set(plan.targets.map((t) => t.showingId));
    }
  }

  private getRoot(): DOMElementLike | null {
    if (this.customRoot) return this.customRoot;
    if (typeof document !== 'undefined') {
      return wrapBrowserElement(document);
    }
    return null;
  }

  public setRoot(root: DOMElementLike | Document | Element): void {
    if ('tagName' in root && typeof (root as DOMElementLike).querySelector === 'function') {
      this.customRoot = root as DOMElementLike;
    } else if (typeof document !== 'undefined') {
      this.customRoot = wrapBrowserElement(root as Element | Document);
    }
  }

  public setSeatmapData(data: SeatmapApiResponse | null): void {
    this.cachedSeatmapData = data;
  }

  public isNavigationPending(): boolean {
    return this.navigationPending;
  }

  public getShowingId(): string | null {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const root = this.getRoot();
    return TicketboxCatalogParser.extractShowingId(url, root);
  }

  public async fetchSeatmapApi(showingId: string): Promise<SeatmapApiResponse | null> {
    // BR-S01 & AC-10 Scope Guard: strictly forbid fetching seatmaps for showings outside the whitelist
    if (this.allowedShowingIds && !this.allowedShowingIds.has(showingId)) {
      this.logger?.info(
        `Skipping seatmap fetch for showing '${showingId}' because it is outside the whitelist (BR-S01 / AC-10)`,
        { showingId }
      );
      return null;
    }

    if (this.cachedShowingId === showingId && this.cachedSeatmapData) {
      return this.cachedSeatmapData;
    }

    // Skip recently failed seatmap fetches (e.g. HTTP 500 / 404 on standing events without seatmaps) for 5 minutes
    const lastFailedAt = this.failedSeatmapShowingIds.get(showingId);
    if (lastFailedAt && Date.now() - lastFailedAt < 300_000) {
      return null;
    }

    const url = `https://api-v2.ticketbox.vn/event/api/v1/events/showings/${showingId}/seatmap`;
    this.logger?.info('Fetching seatmap API', { showingId, url });

    // 1. Direct fetch if in browser or node
    if (typeof fetch !== 'undefined') {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const json = (await res.json()) as SeatmapApiResponse;
          if (json && json.data?.result?.sections) {
            this.cachedShowingId = showingId;
            this.cachedSeatmapData = json;
            this.logger?.info('Seatmap API fetched successfully via direct fetch', {
              sectionsCount: json.data.result.sections.length,
            });
            return json;
          }
        } else {
          this.failedSeatmapShowingIds.set(showingId, Date.now());
        }
      } catch (err: unknown) {
        this.logger?.debug('Direct fetch failed, falling back to background message', {
          err: String(err),
        });
      }
    }

    // 2. Background service worker fetch fallback
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        const response = await new Promise<SeatmapApiResponse | null>((resolve) => {
          const timeout = setTimeout(() => resolve(null), 3000);
          const listener = (msg: unknown) => {
            const m = msg as {
              type?: string;
              showingId?: string;
              success?: boolean;
              data?: SeatmapApiResponse;
            };
            if (m && m.type === 'FETCH_SEATMAP_RESPONSE' && m.showingId === showingId) {
              clearTimeout(timeout);
              chrome.runtime.onMessage.removeListener(listener);
              resolve(m.success && m.data ? m.data : null);
            }
          };
          chrome.runtime.onMessage.addListener(listener);
          chrome.runtime.sendMessage({
            type: 'FETCH_SEATMAP_REQUEST',
            timestamp: new Date().toISOString(),
            showingId,
          });
        });

        if (response && response.data?.result?.sections) {
          this.cachedShowingId = showingId;
          this.cachedSeatmapData = response;
          this.logger?.info('Seatmap API fetched successfully via background worker', {
            sectionsCount: response.data.result.sections.length,
          });
          return response;
        } else {
          this.failedSeatmapShowingIds.set(showingId, Date.now());
        }
      } catch (err: unknown) {
        this.logger?.warn('Background message fetch failed', { err: String(err) });
        this.failedSeatmapShowingIds.set(showingId, Date.now());
      }
    }

    this.failedSeatmapShowingIds.set(showingId, Date.now());
    return null;
  }

  /** Fetches all showings from the authoritative Event API. Cached per eventId. */
  public async fetchEventApi(eventId: string): Promise<TicketboxEventApiResponse | null> {
    if (this.cachedEventApiId === eventId && this.cachedEventApiData) {
      return this.cachedEventApiData;
    }
    const url = `https://api-v2.ticketbox.vn/gin/api/v2/events/${eventId}`;
    this.logger?.info('Fetching Event API for showings', { eventId, url });
    try {
      const res = await fetch(url, { credentials: 'omit' });
      if (res.ok) {
        const json = (await res.json()) as TicketboxEventApiResponse;
        if (json?.data?.result?.showings) {
          this.cachedEventApiId = eventId;
          this.cachedEventApiData = json;
          this.logger?.info('Event API fetched successfully', {
            eventId,
            showingsCount: json.data.result.showings.length,
          });
          return json;
        }
      }
    } catch (err) {
      this.logger?.debug('Event API direct fetch failed, falling back to DOM', { err: String(err) });
    }
    return null;
  }


  /** Fetches question form schema from the authoritative API. Cached per eventId. */
  public async fetchQuestionFormApi(
    eventId: string
  ): Promise<TicketboxQuestionFormApiResponse | null> {
    if (this.cachedQuestionFormEventId === eventId && this.cachedQuestionFormData) {
      return this.cachedQuestionFormData;
    }
    const url = `https://api-v2.ticketbox.vn/event/api/v1/events/${eventId}/question-form`;
    this.logger?.info('Fetching Question Form API', { eventId, url });
    try {
      const res = await fetch(url, { credentials: 'omit' });
      if (res.ok) {
        const json = (await res.json()) as TicketboxQuestionFormApiResponse;
        if (json?.data?.result?.questionCollection) {
          this.cachedQuestionFormEventId = eventId;
          this.cachedQuestionFormData = json;
          this.logger?.info('Question Form API fetched successfully', {
            eventId,
            questionCount: json.data.result.questionCollection.length,
          });
          return json;
        }
      }
    } catch (err) {
      this.logger?.warn('Question Form API fetch failed', { err: String(err) });
    }
    return null;
  }

  public async sendPageBridgeRequest<T>(
    action: string,
    payload: Record<string, unknown>,
    timeoutMs = 3500
  ): Promise<{ success: boolean; data?: T; error?: string }> {
    if (typeof window === 'undefined') {
      return { success: false, error: 'NO_WINDOW' };
    }

    const requestId = `tb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve) => {
      let resolved = false;

      const cleanup = () => {
        window.removeEventListener('message', onMessage);
        window.removeEventListener('TICKETBOX_ASSISTANT_RESPONSE', onCustomEvent as EventListener);
      };

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve({ success: false, error: 'TIMEOUT' });
        }
      }, timeoutMs);

      const onMessage = (event: MessageEvent) => {
        if (
          event.source === window &&
          event.data &&
          event.data.source === 'TICKETBOX_ASSISTANT_PAGE' &&
          event.data.requestId === requestId
        ) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            cleanup();
            resolve(event.data as { success: boolean; data?: T; error?: string });
          }
        }
      };

      const onCustomEvent = (event: unknown) => {
        const detail = (
          event as {
            detail?: {
              requestId?: string;
              success?: boolean;
              data?: T;
              error?: string;
            };
          }
        ).detail;
        if (detail && detail.requestId === requestId) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            cleanup();
            resolve(detail as { success: boolean; data?: T; error?: string });
          }
        }
      };

      window.addEventListener('message', onMessage);
      window.addEventListener('TICKETBOX_ASSISTANT_RESPONSE', onCustomEvent as EventListener);

      window.postMessage(
        {
          source: 'TICKETBOX_ASSISTANT_CONTENT',
          type: action,
          requestId,
          payload,
        },
        '*'
      );

      try {
        window.dispatchEvent(
          new CustomEvent('TICKETBOX_ASSISTANT_REQUEST', {
            detail: { type: action, requestId, payload },
          })
        );
      } catch {
        // ignore
      }
    });
  }

  public async getEventState(): Promise<PageEventState> {
    const root = this.getRoot();
    const url = typeof window !== 'undefined' ? window.location.href : 'http://localhost/event';
    const catalog = root ? TicketboxCatalogParser.parseCatalog(root, url) : null;
    const hasEventInfo = !!catalog && (!!catalog.eventTitle || !!catalog.eventId);

    return {
      event: hasEventInfo
        ? new Event({
            id: catalog!.eventId ?? 'discovered_event',
            name: catalog!.eventTitle ?? 'Ticketbox Event',
            url: catalog!.eventUrl,
            status: 'ON_SALE',
          })
        : null,
      isEventReady: hasEventInfo,
      pageUrl: url,
    };
  }

  public async getInventoryState(): Promise<PageInventoryState> {
    const tickets = await this.discoverJourneyTickets();
    const available = tickets.some((t) => t.availability === 'AVAILABLE');

    return {
      candidates: tickets.map((t) => ({
        id: t.id ?? t.name,
        categoryName: t.name,
        price: new Money(t.price, 'VND'),
        isAvailable: t.availability === 'AVAILABLE',
        availableQuantity: t.maxQuantity ?? 1,
      })),
      isAvailable: available,
      observedAt: new Date().toISOString(),
      isAuthoritativeT0: false,
    };
  }

  public async getSelectionState(): Promise<PageSelectionState> {
    const summary = await this.getBookingSummary();
    if (summary && summary.items.length > 0) {
      const first = summary.items[0]!;
      return {
        selectedTicket: {
          id: first.ticket,
          categoryName: first.ticket,
          price: new Money(first.price, 'VND'),
          isAvailable: true,
          availableQuantity: first.quantity,
        },
        isSelectedInUi: true,
      };
    }

    return {
      selectedTicket: null,
      isSelectedInUi: false,
    };
  }

  public async detectPage(): Promise<TicketboxPageType> {
    const root = this.getRoot();
    const url = typeof window !== 'undefined' ? window.location.href : '';
    return TicketboxCatalogParser.detectPageType(url, root ?? undefined);
  }

  public async discoverEvent(): Promise<import('../../domain/entities/Event').Event | null> {
    const state = await this.getEventState();
    return state.event;
  }

  public async discoverShowings(): Promise<ShowingSnapshot[]> {
    const catalog = await this.discoverTicketCatalog();
    return catalog.showings;
  }

  public async discoverTicketCatalog(
    showingId?: string | null,
    allowedShowingIds?: string[] | null
  ): Promise<EventCatalog> {
    if (allowedShowingIds && allowedShowingIds.length > 0) {
      this.setAllowedShowingIds(allowedShowingIds);
    }
    const root = this.getRoot();
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const targetShowingId =
      showingId && showingId !== 'default' ? showingId : this.getShowingId();

    // 0. On event landing page: fetch all showings from Event API for multi-showing events
    const isBookingPage =
      url.includes('/bookings/') ||
      url.includes('/select-ticket') ||
      url.includes('/question-form');
    const baseCatalogForEventId = root ? TicketboxCatalogParser.parseCatalog(root, url) : null;
    const discoveredEventId = baseCatalogForEventId?.eventId;

    if (!isBookingPage && discoveredEventId) {
      try {
        const eventApiData = await this.fetchEventApi(discoveredEventId);
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

    // 1. Attempt to fetch authoritative ticket tiers from Seatmap API when showing ID is available or cached seatmap data is present
    if (this.cachedSeatmapData || targetShowingId) {
      try {
        const seatmapData =
          this.cachedSeatmapData || (await this.fetchSeatmapApi(targetShowingId!));
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

    // 2. DOM Parser fallback
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

  /**
   * Discovers normalized ticket types from the visible page.
   * Conforms to Section 4.
   */
  /**
   * Discovers normalized ticket types from the visible page.
   * Conforms to Section 4.
   */
  public async discoverJourneyTickets(
    targetShowingId?: string | null
  ): Promise<JourneyTicketType[]> {
    const root = this.getRoot();
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

  /**
   * Clicks the calendar date cell corresponding to the given showingId.
   * Looks up the showingTime (e.g. "19:30 - 21:45, 21 Tháng 10, 2026") to find the day number.
   * Returns true if a calendar date element was clicked.
   */
  public async clickCalendarShowingDate(showingId: string | null): Promise<boolean> {
    if (this.scopedPlan && showingId) {
      assertInScope(this.scopedPlan, showingId);
    }
    if (typeof document === 'undefined') return false;

    let targetDateText: string | null = null;
    let dayNum: number | null = null;

    if (showingId && this.cachedEventApiData?.data?.result?.showings) {
      const showing = this.cachedEventApiData.data.result.showings.find(
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
          this.clickElement(wrapBrowserElement(el));
          return true;
        }
      }
    }

    if (indicatorCells.length > 0) {
      const first = indicatorCells[0]!;
      this.logger?.info('Clicking first calendar cell with showing indicator');
      this.clickElement(wrapBrowserElement(first));
      return true;
    }

    return false;
  }

  /**
   * Finds and clicks the "Mua vé ngay" button in the side panel/drawer that opened
   * after clicking a calendar date. Returns true if found and clicked.
   */
  private async findAndClickMuaVeNgay(): Promise<boolean> {
    if (typeof document === 'undefined') return false;

    for (let attempt = 0; attempt < 5; attempt++) {
      const drawerScope =
        document.querySelector(
          '.ant-drawer, .ant-drawer-open, [class*="drawer"], [class*="panel"], [class*="slide"], [role="dialog"]'
        ) || document;

      const buttons = Array.from(
        drawerScope.querySelectorAll('button, a, [role="button"], div[class*="btn"]')
      );

      for (const btn of buttons) {
        const text = (btn.textContent || '').toLowerCase().trim();
        if (
          text.includes('mua vé ngay') ||
          text.includes('mua vé') ||
          text.includes('đặt vé ngay')
        ) {
          const href = btn.getAttribute('href') || '';
          if (href === '#ticket-info' || href.startsWith('#')) {
            continue;
          }
          const hrefShowingMatch = href.match(/\/bookings\/([^/]+)/);
          if (this.scopedPlan && hrefShowingMatch && hrefShowingMatch[1]) {
            assertInScope(this.scopedPlan, hrefShowingMatch[1]);
          }
          this.logger?.info('Found "Mua vé ngay" button in side panel/drawer, clicking', {
            text: text.slice(0, 40),
            attempt,
          });
          this.clickElement(wrapBrowserElement(btn));
          return true;
        }
      }

      await new Promise((r) => setTimeout(r, 250));
    }

    return false;
  }

  /**
   * Selects a ticket tier following Section 7 verification rules.
   */
  public async selectTicket(
    candidateId: string,
    quantity: number,
    showingId?: string | null
  ): Promise<boolean> {
    this.logger?.info('Executing Section 7 Ticket Selection', { candidateId, quantity, showingId });

    // Resolve effective showing ID
    let effectiveShowingId =
      showingId && showingId !== 'default' ? showingId : this.getShowingId();
    if (
      (!effectiveShowingId || effectiveShowingId === 'default') &&
      this.cachedEventApiData?.data?.result?.showings
    ) {
      for (const s of this.cachedEventApiData.data.result.showings) {
        if (
          s.ticketTypes.some(
            (t) =>
              String(t.id) === candidateId || t.name.toLowerCase() === candidateId.toLowerCase()
          )
        ) {
          effectiveShowingId = String(s.id);
          break;
        }
      }
      if (
        (!effectiveShowingId || effectiveShowingId === 'default') &&
        this.cachedEventApiData.data.result.showings.length === 1 &&
        this.cachedEventApiData.data.result.showings[0]?.id
      ) {
        effectiveShowingId = String(this.cachedEventApiData.data.result.showings[0].id);
      }
    }

    const candidateLower = candidateId.toLowerCase().trim();

    // Resolve candidate name from Event API cache if candidateId is numeric, or vice-versa
    let candidateName: string | undefined;
    if (this.cachedEventApiData?.data?.result?.showings) {
      for (const s of this.cachedEventApiData.data.result.showings) {
        const found = s.ticketTypes.find(
          (t) => String(t.id) === candidateId || t.name.toLowerCase().trim() === candidateLower
        );
        if (found) {
          candidateName = found.name;
          if (!effectiveShowingId || effectiveShowingId === 'default') {
            effectiveShowingId = String(s.id);
          }
          break;
        }
      }
    }

    // MANDATORY SINGLE CHOKEPOINT: Assert in scope before any selection, navigation, or DOM interaction
    if (this.scopedPlan) {
      try {
        assertInScope(this.scopedPlan, effectiveShowingId, candidateId);
      } catch (err) {
        if (candidateName) {
          assertInScope(this.scopedPlan, effectiveShowingId, candidateName);
        } else {
          throw err;
        }
      }
    }

    const root = this.getRoot();
    if (!root) return false;

    // 0. If already on booking / seat map page, ticket tier selection is already fulfilled
    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
    const isAlreadyOnBookingPage =
      currentUrl.includes('/select-ticket') ||
      currentUrl.includes('/booking') ||
      root.querySelector('svg.seatmap, [class*="seatmap"], .seat-map') !== null;

    if (isAlreadyOnBookingPage) {
      this.logger?.info('Already on booking / seat map page; ticket tier step fulfilled', {
        candidateId,
      });
      return true;
    }

    // 0.5. Calendar / Multi-Showing Flow on Event Landing Page:
    // If there are NO ticket rows in the DOM (like Eifman Ballet calendar page),
    // click the calendar date to open the side panel, then click "Mua vé ngay",
    // or trigger direct navigation to the booking page as a guaranteed fail-safe.
    const hasTicketRows =
      root.querySelector(
        '.content-row, [class*="content-row"], .ticket-item, .ticket-row, [data-ticket-id]'
      ) !== null;

    if (!hasTicketRows && effectiveShowingId) {
      this.logger?.info(
        'Calendar/showing event page detected (no ticket rows). Initiating calendar date flow',
        {
          candidateId,
          effectiveShowingId,
        }
      );

      // Step A: Click the calendar date
      if (this.scopedPlan) {
        assertInScope(this.scopedPlan, effectiveShowingId);
      }
      const clickedDate = await this.clickCalendarShowingDate(effectiveShowingId);
      if (clickedDate) {
        await new Promise((r) => setTimeout(r, 600));
        // Step B: Click "Mua vé ngay" in drawer
        if (this.scopedPlan) {
          assertInScope(this.scopedPlan, effectiveShowingId);
        }
        const clickedMuaVe = await this.findAndClickMuaVeNgay();
        if (clickedMuaVe) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      // Check if URL navigated or booking view opened
      const postClickUrl = typeof window !== 'undefined' ? window.location.href : '';
      if (
        postClickUrl.includes('/select-ticket') ||
        postClickUrl.includes('/booking') ||
        postClickUrl.includes('/bookings/') ||
        root.querySelector('svg.seatmap, [class*="seatmap"], .seat-map') !== null
      ) {
        this.logger?.info('Calendar flow navigated to booking view successfully', {
          candidateId,
          effectiveShowingId,
        });
        this.navigationPending = true;
        return true;
      }

      // Step C: Guaranteed direct navigation fallback for showing booking URL
      if (typeof window !== 'undefined') {
        const directBookingUrl = `https://ticketbox.vn/bookings/${effectiveShowingId}/select-ticket`;
        if (this.scopedPlan) {
          try {
            assertInScope(this.scopedPlan, effectiveShowingId, candidateId);
          } catch (err) {
            if (candidateName) {
              assertInScope(this.scopedPlan, effectiveShowingId, candidateName);
            } else {
              throw err;
            }
          }
        }
        this.logger?.info('Triggering direct navigation to showing booking URL', {
          directBookingUrl,
          effectiveShowingId,
        });
        this.navigationPending = true;
        window.location.href = directBookingUrl;
        return true;
      }
    }

    // 1. Expand showing or accordion if tickets or quantity controls are not yet visible
    let showingBtn = root.querySelector(
      '#select-showing-btn, [id*="select-showing"], button.btn-buy-ticket, a[href*="/bookings/"], .ant-collapse-header button'
    );
    if (!showingBtn) {
      const allButtons = root.querySelectorAll('button, a[role="button"], a.btn, [class*="btn"]');
      for (const b of allButtons) {
        const text = b.textContent.toLowerCase().trim();
        if (
          text.includes('mua vé ngay') ||
          text.includes('mua vé') ||
          text.includes('đặt vé ngay')
        ) {
          showingBtn = b;
          break;
        }
      }
    }

    if (showingBtn && typeof (showingBtn as MutableDOMElement).click === 'function') {
      const hasQtyControls =
        root.querySelector(
          '.ant-input-number, .qty-input, input[type="number"], .ant-drawer-open'
        ) !== null;
      if (!hasQtyControls) {
        const btnHref = showingBtn.getAttribute('href') || '';
        const hrefShowingMatch = btnHref.match(/\/bookings\/([^/]+)/);
        if (this.scopedPlan && hrefShowingMatch && hrefShowingMatch[1]) {
          assertInScope(this.scopedPlan, hrefShowingMatch[1]);
        }
        this.logger?.info('Clicking showing/booking button to open ticket purchase view', {
          candidateId,
        });
        (showingBtn as MutableDOMElement).click!();

        await new Promise((r) => setTimeout(r, 600));

        const updatedUrl = typeof window !== 'undefined' ? window.location.href : '';
        const currentBtnHref = showingBtn.getAttribute('href') || btnHref;
        const isBookingTarget =
          updatedUrl.includes('/select-ticket') ||
          updatedUrl.includes('/booking') ||
          currentBtnHref.includes('/bookings/') ||
          currentBtnHref.includes('/select-ticket') ||
          root.querySelector('svg.seatmap, [class*="seatmap"], .seat-map') !== null;

        if (isBookingTarget) {
          this.logger?.info('Booking navigation initiated; ticket tier step fulfilled', {
            candidateId,
          });
          this.navigationPending = true;
          return true;
        }
      }
    }

    // 2. Locate the ticket row by ID or name
    const safeCandidateId = candidateId.replace(/"/g, '\\"');
    let targetRow: DOMElementLike | null =
      root.querySelector(`[data-ticket-id="${safeCandidateId}"]`) ||
      root.querySelector(`[id="${safeCandidateId}"]`);

    if (!targetRow) {
      const allRows = root.querySelectorAll(
        '.content-row, [class*="content-row"], .ticket-item, .ticket-row, [data-ticket-id]'
      );
      for (const row of allRows) {
        const titleEl = row.querySelector(
          '.title-tickettype, [class*="title-tickettype"], .ticket-name, .name, h3, h4, h5, strong'
        );
        const titleText = titleEl ? titleEl.textContent.trim().toLowerCase() : '';
        if (
          titleText &&
          (titleText === candidateLower ||
            titleText.includes(candidateLower) ||
            candidateLower.includes(titleText))
        ) {
          targetRow = row;
          break;
        }
      }
    }

    if (!targetRow) {
      this.logger?.warn('Ticket selection row not found in DOM', { candidateId });
      return false;
    }

    // 3. Verify ticket row is not disabled or sold out
    const isRowDisabled = this.isElementDisabled(targetRow);

    const rowText = targetRow.textContent.toLowerCase();
    const isSoldOut =
      rowText.includes('hết vé') || rowText.includes('sold out') || rowText.includes('hết chỗ');

    if (isRowDisabled || isSoldOut) {
      this.logger?.warn('Ticket row is disabled or sold out', {
        candidateId,
        isRowDisabled,
        isSoldOut,
      });
      return false;
    }

    // 4. If row contains an interactive action button (not counter handler), click it
    const actionBtn = targetRow.querySelector(
      'button:not([class*="handler"]):not([class*="up"]):not([class*="down"]), input[type="button"], input[type="submit"]'
    );
    if (actionBtn && typeof actionBtn.click === 'function') {
      this.logger?.info('Clicking action button in ticket row', { candidateId });
      actionBtn.click();
      await new Promise((r) => setTimeout(r, 200));
    } else if (typeof targetRow.click === 'function') {
      targetRow.click();
    }

    // 5. Mark as selected in DOM
    if (targetRow.setAttribute) {
      targetRow.setAttribute('aria-pressed', 'true');
    }
    if (targetRow.className && !targetRow.className.includes('selected')) {
      targetRow.className = `${targetRow.className} selected`.trim();
    }

    this.logger?.info('Ticket selection verified successfully', { candidateId });
    return true;
  }

  /**
   * Standing & Area-based Flow: Sets quantity following Section 9 rules.
   * Interacts with:
   * 1. Area Selection Modal stepper (Ant Design / Ticketbox modal popup after zone click on /select-ticket)
   * 2. Direct quantity stepper / input in ticket rows (Standing events)
   * 3. Bottom bar or drawer quantity controls
   */
  public async selectQuantity(ticket: TicketType, quantity: number): Promise<boolean> {
    const root = this.getRoot();
    if (!root) return false;

    this.logger?.info('Executing Section 9 Quantity Selection', {
      ticketName: ticket.name,
      quantity,
    });

    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
    const isAlreadyOnBookingPage =
      currentUrl.includes('/select-ticket') ||
      currentUrl.includes('/booking') ||
      root.querySelector('svg.seatmap, [class*="seatmap"], .seat-map') !== null;

    // Polling loop for modal stepper or quantity controls (modal may take 100-400ms to open after area click)
    const maxAttempts = typeof window !== 'undefined' || root.rawElement ? 15 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const doc = typeof document !== 'undefined' ? document : null;

      // 1. Check for Area Selection Modal (e.g. "Khu CAT_3R", "Khu STARDOM_L")
      const modalRaw =
        doc?.querySelector(
          '.ant-modal-content, .ant-modal, [role="dialog"], [class*="modal-content"], [class*="modal-body"], [class*="modal"]'
        ) ||
        (root.querySelector(
          '.ant-modal-content, .ant-modal, [role="dialog"], [class*="modal-content"], [class*="modal-body"], [class*="modal"]'
        )?.rawElement as HTMLElement | undefined);

      if (modalRaw) {
        const modalText = (modalRaw.textContent || '').toLowerCase();
        const isAreaModal =
          modalText.includes('khu') ||
          modalText.includes('chọn vé') ||
          modalText.includes('chỉ có thể chọn vé') ||
          modalText.includes(ticket.name.toLowerCase().trim());

        if (isAreaModal) {
          this.logger?.info('Area selection modal detected in DOM', {
            attempt,
            ticketName: ticket.name,
          });

          let modalPlusBtn: HTMLElement | null = null;
          let modalInput: HTMLInputElement | null = null;
          let currentModalQty = 0;

          // Check for input inside modal
          modalInput = modalRaw.querySelector(
            'input[type="number"], .qty-input, input.quantity, .ant-input-number-input, input'
          ) as HTMLInputElement | null;
          if (modalInput) {
            const rawVal = modalInput.value || modalInput.getAttribute('value') || '0';
            currentModalQty = parseInt(rawVal, 10) || 0;
          }

          // Check for explicit plus selector inside modal
          modalPlusBtn = modalRaw.querySelector(
            '.ant-input-number-handler-up, button[aria-label*="plus"], button[aria-label*="add"], button[aria-label*="tăng"], [class*="handler-up"], [class*="btn-plus"], [class*="plus"], [class*="increment"]'
          ) as HTMLElement | null;

          // If no explicit plus button, inspect all buttons in modal
          if (!modalPlusBtn) {
            const allModalBtns = Array.from(
              modalRaw.querySelectorAll('button, [role="button"]')
            ) as HTMLElement[];
            const stepperBtns = allModalBtns.filter((b) => {
              const bText = (b.textContent || '').trim().toLowerCase();
              const bAria = (b.getAttribute('aria-label') || '').toLowerCase();
              const bClass = (b.className || '').toString().toLowerCase();

              // Exclude close button, footer continue button, other area link
              if (
                bAria.includes('close') ||
                bClass.includes('close') ||
                bText === '✕' ||
                bText === '×' ||
                bText === 'x' ||
                bText.includes('vui lòng') ||
                bText.includes('tiếp tục') ||
                bText.includes('khu vực khác')
              ) {
                return false;
              }
              return true;
            });

            for (const b of stepperBtns) {
              const bText = (b.textContent || '').trim();
              const bAria = (b.getAttribute('aria-label') || '').toLowerCase();
              if (bText === '+' || bAria.includes('plus') || bAria.includes('add')) {
                modalPlusBtn = b;
                break;
              }
            }

            if (!modalPlusBtn && stepperBtns.length >= 2) {
              // The last button in the stepper row is the plus button
              modalPlusBtn = stepperBtns[stepperBtns.length - 1]!;
            }
          }

          // If current quantity is not from input, inspect span/div text in modal
          if (!modalInput) {
            const numbers = Array.from(modalRaw.querySelectorAll('span, div, p, strong'))
              .map((el) => ({ el, text: (el.textContent || '').trim() }))
              .filter((item) => /^\d+$/.test(item.text) && item.el.children.length === 0);
            if (numbers.length > 0) {
              currentModalQty = parseInt(numbers[0]!.text, 10) || 0;
            }
          }

          if (modalPlusBtn) {
            const clicksNeeded = Math.max(0, quantity - currentModalQty);
            this.logger?.info('Interacting with Area Modal stepper', {
              currentModalQty,
              targetQuantity: quantity,
              clicksNeeded,
            });

            for (let i = 0; i < clicksNeeded; i++) {
              this.clickElement(wrapBrowserElement(modalPlusBtn));
              await new Promise((r) => setTimeout(r, 150));
            }

            if (modalInput) {
              const proto =
                typeof window !== 'undefined' ? window.HTMLInputElement?.prototype : null;
              const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
              if (descriptor && descriptor.set) {
                descriptor.set.call(modalInput, String(quantity));
              } else {
                modalInput.value = String(quantity);
              }
              const EventCtor = (
                globalThis as unknown as {
                  Event?: new (type: string, init?: Record<string, unknown>) => unknown;
                }
              ).Event;
              if (typeof EventCtor === 'function') {
                modalInput.dispatchEvent(new EventCtor('input', { bubbles: true }) as never);
                modalInput.dispatchEvent(new EventCtor('change', { bubbles: true }) as never);
              }
            }

            await new Promise((r) => setTimeout(r, 200));
            this.logger?.info('Area modal quantity set successfully', { quantity });
            return true;
          }
        }
      }

      // 2. Standard ticket rows / landing page / drawer controls
      let ticketContainer = ticket.id ? root.querySelector(`[data-ticket-id="${ticket.id}"]`) : null;

      if (!ticketContainer) {
        const ticketLower = ticket.name.toLowerCase().trim();
        const ticketLowerClean = ticketLower.replace(/[\s_-]+/g, '');
        const allRows = root.querySelectorAll(
          '.content-row, [class*="content-row"], .ticket-item, .ticket-row, .legend-item, [class*="legend-item"], [class*="tier-item"], [class*="section-item"], .ticket-legend > div, [class*="sidebar"] li, [class*="sidebar"] div'
        );
        for (const row of allRows) {
          const titleEl = row.querySelector(
            '.title-tickettype, [class*="title-tickettype"], .ticket-name, .name, h3, h4, h5, strong, span'
          );
          if (titleEl) {
            const tText = titleEl.textContent.trim().toLowerCase();
            const tClean = tText.replace(/[\s_-]+/g, '');
            if (
              tText.includes(ticketLower) ||
              (ticketLowerClean.length > 3 && tClean.includes(ticketLowerClean))
            ) {
              ticketContainer = row;
              break;
            }
          }
        }
      }
      ticketContainer = ticketContainer || root;

      let input = ticketContainer.querySelector(
        'input[type="number"], .qty-input, input.quantity, .ant-input-number-input'
      );

      let plusBtn = ticketContainer.querySelector(
        '.ant-input-number-handler-up, button[aria-label="plus"], .btn-plus, .plus, [class*="handler-up"], [aria-label*="plus"], [aria-label*="tăng"]'
      );

      if (typeof document !== 'undefined') {
        if (!input) {
          const liveInput = document.querySelector(
            '.bottom-bar input[type="number"], [class*="bottom"] input[type="number"], .ant-drawer input[type="number"], .ant-input-number-input'
          );
          if (liveInput) input = wrapBrowserElement(liveInput);
        }
        if (!plusBtn) {
          const livePlus = document.querySelector(
            '.bottom-bar .ant-input-number-handler-up, .bottom-bar button[aria-label="plus"], [class*="bottom"] [class*="handler-up"], .ant-drawer [class*="handler-up"], .ant-drawer button[aria-label="plus"], [class*="sidebar"] .ant-input-number-handler-up'
          );
          if (livePlus) plusBtn = wrapBrowserElement(livePlus);
        }
      }

      if (input) {
        const rawCurrentVal =
          input.getAttribute('value') ||
          ('value' in input ? String((input as MutableDOMElement).value) : '') ||
          '0';
        const cur = parseInt(rawCurrentVal, 10) || 0;

        const minAttr = input.getAttribute('min');
        const maxAttr = input.getAttribute('max');
        const min = minAttr ? parseInt(minAttr, 10) : 1;
        const max = maxAttr ? parseInt(maxAttr, 10) : null;

        if (quantity < min) {
          this.logger?.warn(`Requested quantity ${quantity} is below minimum allowed ${min}`);
          return false;
        }

        if (max !== null && quantity > max) {
          this.logger?.warn(
            `Requested quantity ${quantity} exceeds maximum allowed quantity ${max}.`
          );
          return false;
        }

        const clicks = Math.max(0, quantity - cur);
        if (plusBtn && typeof (plusBtn as MutableDOMElement).click === 'function' && clicks > 0) {
          this.logger?.info('Clicking plus button to set quantity in AntDesign', {
            clicks,
            targetQuantity: quantity,
          });
          for (let i = 0; i < clicks; i++) {
            (plusBtn as MutableDOMElement).click!();
            await new Promise((r) => setTimeout(r, 120));
          }
        }

        if (input.rawElement && 'value' in input.rawElement) {
          const nativeEl = input.rawElement as HTMLInputElement;
          const proto =
            typeof window !== 'undefined' ? window.HTMLInputElement?.prototype : null;
          const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
          if (descriptor && descriptor.set) {
            descriptor.set.call(nativeEl, String(quantity));
          } else {
            nativeEl.value = String(quantity);
          }
          const EventCtor = (
            globalThis as unknown as {
              Event?: new (type: string, init?: Record<string, unknown>) => unknown;
            }
          ).Event;
          if (typeof EventCtor === 'function') {
            nativeEl.dispatchEvent(new EventCtor('input', { bubbles: true }) as never);
            nativeEl.dispatchEvent(new EventCtor('change', { bubbles: true }) as never);
          }
        }

        if ('value' in (input as MutableDOMElement)) {
          (input as MutableDOMElement).value = String(quantity);
        }
        (input as MutableDOMElement).attributes = (input as MutableDOMElement).attributes || {};
        (input as MutableDOMElement).attributes['value'] = String(quantity);

        this.logger?.info('Quantity selection verified', { quantity });
        return true;
      }

      if (plusBtn && typeof (plusBtn as MutableDOMElement).click === 'function') {
        this.logger?.info('Incrementing quantity via plus button', { targetQuantity: quantity });
        for (let i = 0; i < quantity; i++) {
          (plusBtn as MutableDOMElement).click!();
          await new Promise((r) => setTimeout(r, 120));
        }
        return true;
      }

      // Wait before next attempt if polling
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    // If on seat map page with no explicit quantity control or modal after polling, quantity is handled by seat selection
    if (isAlreadyOnBookingPage) {
      this.logger?.info('Already on seat map page; quantity handled via seat/area selection', {
        ticketName: ticket.name,
      });
      return true;
    }

    if (quantity === 1) {
      this.logger?.info('Quantity defaulted to 1 on ticket tier selection', {
        ticketName: ticket.name,
      });
      return true;
    }

    this.logger?.warn('Quantity control not found for ticket', { ticketName: ticket.name });
    return false;
  }

  /**
   * Evaluates if a button or container element is disabled.
   * Accurately avoids false positives on Tailwind CSS utility classes like disabled:opacity-50.
   */
  private isElementDisabled(el: DOMElementLike): boolean {
    if (el.hasAttribute('disabled')) {
      const val = el.getAttribute('disabled');
      if (val !== 'false') return true;
    }
    if (el.getAttribute('aria-disabled') === 'true') {
      return true;
    }

    const raw = el.rawElement as HTMLElement | undefined;
    if (raw) {
      if ('disabled' in raw && (raw as HTMLButtonElement).disabled === true) {
        return true;
      }
      if (typeof raw.matches === 'function' && raw.matches(':disabled')) {
        return true;
      }
    }

    // Exact class token match: DO NOT match Tailwind prefix classes like disabled:opacity-50 or disabled:cursor-not-allowed
    const classTokens = (el.className || '').split(/\s+/);
    for (const token of classTokens) {
      const lower = token.toLowerCase();
      if (
        lower === 'disabled' ||
        lower === 'ant-btn-disabled' ||
        lower === 'btn-disabled' ||
        lower === 'is-disabled' ||
        lower === 'button--disabled'
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Robust click dispatcher for interactive buttons and child nodes.
   */
  private clickElement(btn: DOMElementLike): void {
    const nativeEl = (btn.rawElement || btn) as HTMLElement;

    if (typeof nativeEl.focus === 'function') {
      try {
        nativeEl.focus();
      } catch {
        // ignore
      }
    }

    if (typeof window !== 'undefined' && typeof window.MouseEvent === 'function') {
      const rect =
        typeof nativeEl.getBoundingClientRect === 'function'
          ? nativeEl.getBoundingClientRect()
          : { left: 0, top: 0, width: 0, height: 0 };
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY };

      if (typeof window.PointerEvent === 'function') {
        nativeEl.dispatchEvent(new PointerEvent('pointerdown', opts));
      }
      nativeEl.dispatchEvent(new MouseEvent('mousedown', opts));
      if (typeof window.PointerEvent === 'function') {
        nativeEl.dispatchEvent(new PointerEvent('pointerup', opts));
      }
      nativeEl.dispatchEvent(new MouseEvent('mouseup', opts));
      nativeEl.dispatchEvent(new MouseEvent('click', opts));
    }

    if (typeof nativeEl.click === 'function') {
      nativeEl.click();
    } else if (typeof (btn as MutableDOMElement).click === 'function') {
      (btn as MutableDOMElement).click!();
    }

    if (typeof nativeEl.closest === 'function') {
      const parentClickable = nativeEl.closest('button, [role="button"], a') as HTMLElement | null;
      if (
        parentClickable &&
        parentClickable !== nativeEl &&
        typeof parentClickable.click === 'function'
      ) {
        parentClickable.click();
      }
    }
  }

  /**
   * Clicks the primary proceed/continue/checkout button on Ticketbox to advance the flow.
   * Employs polling retries (up to 15 attempts x 250ms) to allow React state / cart calculation
   * to remove disabled state and render the active continue button.
   *
   * Strictly filters out breadcrumbs, step titles, navigation tabs, and instructional text
   * (e.g., "1. Chọn vé", "Bấm vào khu vực để chọn vé") to prevent false positive clicks.
   */
  public async proceedToNextStep(): Promise<boolean> {
    const root = this.getRoot();
    if (!root) return false;

    // Forward navigation action verbs ONLY. "chọn vé" MUST NEVER be here.
    const targetKeywords = [
      'tiếp tục',
      'thanh toán',
      'đặt vé',
      'mua vé',
      'mua ngay',
      'đặt ngay',
      'continue',
      'checkout',
      'xác nhận',
      'proceed',
      'pay',
    ];

    // Phrases that indicate instructions, prompts, step names, or backwards navigation
    const negativeKeywords = [
      'vui lòng',
      'chọn vé',
      'chọn khu vực',
      'chọn ghế',
      'chọn chỗ',
      'trở về',
      'quay lại',
      'back',
      'hủy',
      'cancel',
      'đăng nhập',
      'login',
      'sign in',
    ];

    const maxAttempts = typeof window !== 'undefined' || root.rawElement ? 15 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const seenRaw = new Set<unknown>();

      const isCandidateValid = (el: DOMElementLike): boolean => {
        const raw = (el.rawElement || el) as HTMLElement;
        if (!raw) return false;

        // Skip non-interactive tags
        const tag = (el.tagName || '').toUpperCase();
        if (['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'NAV', 'UL', 'OL', 'LI'].includes(tag)) {
          return false;
        }

        // Check if element or ancestor is a breadcrumb, step indicator, tab, or nav
        if (typeof raw.closest === 'function') {
          const inNav = raw.closest(
            '[class*="breadcrumb"], [class*="step-"], [class*="steps"], [class*="ant-steps"], [class*="navbar"], [class*="nav-"], [role="tab"], [role="tablist"], [role="navigation"], header, nav'
          );
          if (inNav) return false;
        } else {
          let cur: DOMElementLike | null | undefined = el.parentElement;
          while (cur) {
            const curTag = (cur.tagName || '').toUpperCase();
            if (curTag === 'HEADER' || curTag === 'NAV') return false;
            const curCls = (cur.className || '').toLowerCase();
            if (
              curCls.includes('breadcrumb') ||
              curCls.includes('step') ||
              curCls.includes('navbar') ||
              curCls.includes('nav-')
            ) {
              return false;
            }
            cur = cur.parentElement;
          }
        }

        const text = (el.textContent || '').toLowerCase().trim();
        if (!text || text.length > 80) return false;

        // Reject any element containing negative phrases
        if (negativeKeywords.some((nk) => text.includes(nk))) {
          return false;
        }

        // Must contain at least one forward target action keyword
        if (!targetKeywords.some((kw) => text.includes(kw))) {
          return false;
        }

        return true;
      };

      // TIER 1: Primary action button selectors (Highest confidence)
      const tier1Candidates: DOMElementLike[] = [];
      const tier1Selector =
        '#btn-continue, [id*="continue"], .btn-continue, button.ant-btn-primary, .ant-modal button, .ant-modal-footer button, [role="dialog"] button, [class*="modal"] button, .ant-drawer-footer button, .sidebar-footer button, [class*="sidebar"] footer button, .bottom-bar button, [class*="bottom"] button, [class*="footer"] button, [class*="checkout"] button, button[type="submit"]';

      for (const el of root.querySelectorAll(tier1Selector)) {
        const raw = el.rawElement || el;
        if (!seenRaw.has(raw)) {
          seenRaw.add(raw);
          tier1Candidates.push(el);
        }
      }

      if (typeof document !== 'undefined') {
        for (const el of Array.from(document.querySelectorAll(tier1Selector))) {
          if (!seenRaw.has(el)) {
            seenRaw.add(el);
            tier1Candidates.push(wrapBrowserElement(el));
          }
        }
      }

      // TIER 2: Other standard button & input elements
      const tier2Candidates: DOMElementLike[] = [];
      const tier2Selector = 'button, input[type="submit"], a.btn, a[class*="button"], a[role="button"]';

      for (const el of root.querySelectorAll(tier2Selector)) {
        const raw = el.rawElement || el;
        if (!seenRaw.has(raw)) {
          seenRaw.add(raw);
          tier2Candidates.push(el);
        }
      }

      if (typeof document !== 'undefined') {
        for (const el of Array.from(document.querySelectorAll(tier2Selector))) {
          if (!seenRaw.has(el)) {
            seenRaw.add(el);
            tier2Candidates.push(wrapBrowserElement(el));
          }
        }
      }

      // TIER 3: Generic clickable containers (only if no Tier 1 or Tier 2 match)
      const tier3Candidates: DOMElementLike[] = [];
      const tier3Selector =
        '[role="button"], div[class*="btn"], div[class*="button"], div[class*="continue"], div.cursor-pointer';

      for (const el of root.querySelectorAll(tier3Selector)) {
        const raw = el.rawElement || el;
        if (!seenRaw.has(raw)) {
          seenRaw.add(raw);
          tier3Candidates.push(el);
        }
      }

      if (typeof document !== 'undefined') {
        for (const el of Array.from(document.querySelectorAll(tier3Selector))) {
          if (!seenRaw.has(el)) {
            seenRaw.add(el);
            tier3Candidates.push(wrapBrowserElement(el));
          }
        }
      }

      // Evaluate candidate tiers in priority order
      const candidateDebugInfo: Array<{ tag: string; text: string; disabled: boolean; tier: number }> = [];

      for (const tierList of [
        { tier: 1, list: tier1Candidates },
        { tier: 2, list: tier2Candidates },
        { tier: 3, list: tier3Candidates },
      ]) {
        for (const btn of tierList.list) {
          const text = (btn.textContent || '').toLowerCase().trim();
          const disabled = this.isElementDisabled(btn);

          if (!isCandidateValid(btn)) {
            continue;
          }

          candidateDebugInfo.push({
            tag: btn.tagName,
            text: text.slice(0, 40),
            disabled,
            tier: tierList.tier,
          });

          if (disabled) {
            continue;
          }

          this.logger?.info('Clicking next step / continue button', {
            buttonText: text,
            tagName: btn.tagName,
            tier: tierList.tier,
            attempt,
          });

          this.clickElement(btn);
          this.navigationPending = true;

          // If the clicked button was inside a modal dialog, also trigger the bottom bar continue button if present
          const rawBtn = (btn.rawElement || btn) as HTMLElement;
          const isInsideModal =
            rawBtn &&
            typeof rawBtn.closest === 'function' &&
            rawBtn.closest('.ant-modal, [role="dialog"], [class*="modal"]') !== null;

          if (isInsideModal) {
            await new Promise((r) => setTimeout(r, 350));
            const doc = typeof document !== 'undefined' ? document : null;
            const bottomBtn = doc?.querySelector(
              '.bottom-bar button, [class*="bottom"] button, #btn-continue'
            ) as HTMLElement | null;
            if (bottomBtn) {
              const bText = (bottomBtn.textContent || '').toLowerCase().trim();
              if (
                targetKeywords.some((kw) => bText.includes(kw)) &&
                !negativeKeywords.some((nk) => bText.includes(nk)) &&
                !this.isElementDisabled(wrapBrowserElement(bottomBtn))
              ) {
                this.logger?.info('Also clicked bottom bar continue button after modal confirmation', {
                  buttonText: bText,
                });
                this.clickElement(wrapBrowserElement(bottomBtn));
              }
            }
          }

          await new Promise((r) => setTimeout(r, 600));
          return true;
        }
      }

      this.logger?.debug(
        `Attempt ${attempt}/${maxAttempts}: evaluated continue candidates`,
        {
          candidates: candidateDebugInfo.filter((c) => c.text.length > 0).slice(0, 10),
        }
      );

      // If not yet available/enabled, wait 250ms before next attempt
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    this.logger?.warn('Proceed / continue button not found or remained disabled after polling');
    return false;
  }

  /**
   * Detects Ticketbox error modals (e.g. -1242: "Ghế bạn chọn VIP_A-21 đã được đặt trước").
   * Extracts the unavailable seat, blacklists it, and clicks the action button ("Chọn ghế khác")
   * to automatically recover and return to seat selection.
   */
  public async detectAndHandleErrorModal(): Promise<{
    hasError: boolean;
    isSeatUnavailable: boolean;
    seatLabel?: string | undefined;
  }> {
    const root = this.getRoot();
    const doc = typeof document !== 'undefined' ? document : null;

    const modalCandidates: DOMElementLike[] = [];
    if (root) {
      const inRoot = root.querySelectorAll(
        '.ant-modal-content, [role="dialog"], .ant-modal, [class*="modal-content"], [class*="modal-body"], [class*="modal"], [class*="popup"], [class*="alert"]'
      );
      modalCandidates.push(...inRoot);
    }
    if (doc) {
      const inDoc = Array.from(
        doc.querySelectorAll(
          '.ant-modal-content, [role="dialog"], .ant-modal, [class*="modal-content"], [class*="modal-body"], [class*="modal"], [class*="popup"], [class*="alert"]'
        )
      ).map((el) => wrapBrowserElement(el));
      modalCandidates.push(...inDoc);
    }

    for (const modal of modalCandidates) {
      const text = (modal.textContent || '').toLowerCase();
      if (!text) continue;

      const isUnavailable =
        text.includes('-1242') ||
        text.includes('đã được đặt trước') ||
        text.includes('đã có người đặt') ||
        text.includes('đã có người chọn') ||
        text.includes('không còn trống') ||
        (text.includes('xin lỗi') && text.includes('ghế'));

      if (isUnavailable) {
        let seatLabel: string | undefined;
        const match = modal.textContent.match(
          /(?:ghế|seat)\s*(?:bạn chọn)?\s*([A-Za-z0-9_-]+)\s*(?:đã được đặt trước|đã có người|không còn|đã)/i
        );
        if (match && match[1]) {
          seatLabel = match[1].trim();
        } else {
          const lastSeat = Array.from(this.selectedSeatIds).pop();
          if (lastSeat) seatLabel = lastSeat;
        }

        if (seatLabel) {
          this.blacklistSeat(seatLabel);
        }

        this.logger?.warn('Seat unavailable error modal detected (-1242)', {
          seatLabel,
          modalText: text.slice(0, 100),
        });

        // Find "Chọn ghế khác" or primary action button
        const actionBtn =
          modal.querySelector(
            'button.ant-btn-primary, button.ant-btn, [class*="btn-primary"], button'
          ) ||
          (doc
            ? wrapBrowserElement(
                doc.querySelector('.ant-modal button, [role="dialog"] button') as Element
              )
            : null);

        if (actionBtn && typeof (actionBtn as MutableDOMElement).click === 'function') {
          this.logger?.info('Clicking "Chọn ghế khác" button in error modal to recover');
          this.clickElement(actionBtn);
          await new Promise((r) => setTimeout(r, 600));
        }

        return { hasError: true, isSeatUnavailable: true, seatLabel };
      }

      const isGenericError =
        text.includes('uiii, xin lỗi') ||
        text.includes('thông báo lỗi') ||
        text.includes('vé đã hết') ||
        text.includes('số lượng vé không đủ');

      if (isGenericError) {
        this.logger?.warn('Generic error modal detected', { text: text.slice(0, 100) });
        const actionBtn = modal.querySelector('button');
        if (actionBtn && typeof (actionBtn as MutableDOMElement).click === 'function') {
          this.clickElement(actionBtn);
          await new Promise((r) => setTimeout(r, 400));
        }
        return { hasError: true, isSeatUnavailable: false };
      }
    }

    return { hasError: false, isSeatUnavailable: false };
  }

  /**
   * Seated Flow: Discovers zones/areas.
   */
  public async discoverAreas(): Promise<SeatArea[]> {
    const root = this.getRoot();
    if (this.cachedSeatmapData) {
      const apiAreas = TicketboxSeatMapParser.parseAreasFromSeatmapApi(this.cachedSeatmapData);
      if (apiAreas.length > 0) return apiAreas;
    }
    if (!root) return [];
    return TicketboxSeatMapParser.parseAreas(root);
  }

  /**
   * Seated / Area Flow: Selects an area/zone by ID, name, ticketTypeId, or coordinates.
   */
  public async selectArea(
    areaId: string,
    areaName?: string | undefined,
    ticketTypeId?: string | undefined,
    coords?: { x?: number | undefined; y?: number | undefined; width?: number | undefined; height?: number | undefined } | undefined
  ): Promise<boolean> {
    const root = this.getRoot();
    if (!root) return false;

    this.logger?.info('Selecting Area', { areaId, areaName, ticketTypeId, coords });

    const safeAreaId = areaId.replace(/"/g, '\\"');
    const safeAreaName = areaName ? areaName.replace(/"/g, '\\"') : '';
    const safeAreaNameUnderscore = areaName ? areaName.replace(/[\s-]+/g, '_').replace(/"/g, '\\"') : '';
    const safeTicketTypeId = ticketTypeId ? ticketTypeId.replace(/"/g, '\\"') : '';

    // 1. Attribute matching on DOM elements
    let areaEl: DOMElementLike | null =
      root.querySelector(`[data-zone-id="${safeAreaId}"]`) ||
      root.querySelector(`[data-area-id="${safeAreaId}"]`) ||
      root.querySelector(`[data-area="${safeAreaId}"]`) ||
      root.querySelector(`[data-section-id="${safeAreaId}"]`) ||
      root.querySelector(`[id="${safeAreaId}"]`);

    if (!areaEl && safeTicketTypeId) {
      areaEl =
        root.querySelector(`[data-ticket-id="${safeTicketTypeId}"]`) ||
        root.querySelector(`[data-ticket-type-id="${safeTicketTypeId}"]`);
    }

    if (!areaEl && safeAreaName) {
      areaEl =
        root.querySelector(`[data-area-name="${safeAreaName}"]`) ||
        root.querySelector(`[data-zone-name="${safeAreaName}"]`) ||
        root.querySelector(`[id="${safeAreaName}"]`) ||
        root.querySelector(`[id="${safeAreaNameUnderscore}"]`);
    }

    // 2. SVG element matching (g, path, polygon, rect)
    if (!areaEl) {
      const svgArea =
        root.querySelector(
          `svg g[id*="${safeAreaId}"], svg path[id*="${safeAreaId}"], [class*="${safeAreaId}"]`
        ) ||
        (safeAreaNameUnderscore
          ? root.querySelector(
              `svg g[id*="${safeAreaNameUnderscore}"], svg path[id*="${safeAreaNameUnderscore}"], svg g[name*="${safeAreaNameUnderscore}"]`
            )
          : null) ||
        (safeTicketTypeId
          ? root.querySelector(`svg [data-ticket-id="${safeTicketTypeId}"], svg [data-ticket-type-id="${safeTicketTypeId}"]`)
          : null);

      if (svgArea && typeof (svgArea as MutableDOMElement).click === 'function') {
        this.logger?.info('Clicked SVG area element', { areaId, areaName });
        (svgArea as MutableDOMElement).click!();
        return true;
      }

      // Check SVG text nodes matching area name
      if (typeof document !== 'undefined' && safeAreaName) {
        const svgTexts = Array.from(document.querySelectorAll('svg text'));
        const normName = safeAreaName.toLowerCase();
        for (const t of svgTexts) {
          const content = (t.textContent || '').trim().toLowerCase();
          if (content && (content === normName || normName.includes(content) || content.includes(normName))) {
            const clickable = (t.closest('g') || t) as HTMLElement;
            this.logger?.info('Found matching SVG text element, clicking', { text: content });
            this.clickElement(wrapBrowserElement(clickable));
            return true;
          }
        }
      }

      // 3. Right Sidebar / Legend / Ticket Tier list item matching
      if (typeof document !== 'undefined') {
        const tierCandidates = Array.from(
          document.querySelectorAll(
            '.legend-item, [class*="legend-item"], [class*="tier-item"], [class*="ticket-item"], [class*="section-item"], .ticket-legend > div, aside div[role="button"], .sidebar div[role="button"], button'
          )
        );
        for (const tc of tierCandidates) {
          const txt = (tc.textContent || '').toLowerCase();
          const matchesName = safeAreaName && txt.includes(safeAreaName.toLowerCase());
          const matchesId = safeTicketTypeId && txt.includes(safeTicketTypeId);
          if (matchesName || matchesId) {
            this.logger?.info('Found matching tier item in right sidebar/legend, clicking', {
              text: txt.slice(0, 40),
            });
            this.clickElement(wrapBrowserElement(tc as HTMLElement));
            await new Promise((r) => setTimeout(r, 400));
            return true;
          }
        }
      }

      // 4. Ticketbox Canvas / Konva interaction via Page-World Bridge
      if (typeof window !== 'undefined') {
        const bridgeRes = await this.sendPageBridgeRequest<{ transitioned: boolean }>(
          'SELECT_AREA',
          { areaId, areaName, ticketTypeId, coords }
        );

        if (bridgeRes.success) {
          this.logger?.info('Area selected successfully via Page Bridge (Konva)', {
            areaId,
            areaName,
            transitioned: bridgeRes.data?.transitioned,
          });
          await new Promise((r) => setTimeout(r, 400));
          return true;
        }

        // Check if page is already in section view
        const isAlreadySection =
          document.querySelector('.seat_status, [class*="seat_status"]') !== null;
        if (isAlreadySection) {
          this.logger?.info('Page already in section view; area selection fulfilled', { areaId });
          return true;
        }

        // Fallback: If Konva canvas exists, simulate click on canvas container at coordinates
        const konvaContent = document.querySelector('.konvajs-content') as HTMLElement | null;
        if (konvaContent) {
          this.logger?.info('Dispatching simulated click to Konva canvas container', { areaId, coords });
          this.clickElement(wrapBrowserElement(konvaContent));
          await new Promise((r) => setTimeout(r, 500));
          return true;
        }
      }

      this.logger?.info(
        'Area element not explicitly clickable in DOM; proceeding with coordinate seat discovery',
        { areaId, areaName }
      );
      return true;
    }

    if (areaEl.hasAttribute('disabled') || areaEl.getAttribute('aria-disabled') === 'true') {
      this.logger?.warn('Area element is disabled', { areaId });
      return false;
    }

    if (typeof (areaEl as MutableDOMElement).click === 'function') {
      (areaEl as MutableDOMElement).click!();
    }
    if ((areaEl as MutableDOMElement).attributes) {
      (areaEl as MutableDOMElement).attributes['data-status'] = 'selected';
    }
    if (areaEl.setAttribute) {
      areaEl.setAttribute('data-status', 'selected');
      const curClass = areaEl.getAttribute('class') || areaEl.className || '';
      if (!curClass.includes('selected')) {
        areaEl.setAttribute('class', `${curClass} selected`.trim());
      }
    }

    return true;
  }

  /**
   * Finds the actual Seatmap SVG on the page, distinguishing it from icons and toolbars.
   */
  private findSeatmapSvg(): SVGSVGElement | null {
    if (typeof document === 'undefined') return null;

    const allSvgs = Array.from(document.querySelectorAll('svg')) as SVGSVGElement[];
    if (allSvgs.length === 0) return null;

    // 1. Look for SVG that contains circles, ellipses, or [cx] elements (actual seat elements)
    for (const svg of allSvgs) {
      if (svg.querySelectorAll('circle, ellipse, [cx]').length > 5) {
        return svg;
      }
    }

    // 2. Look for SVG inside a container with class or id containing seat, map, or booking
    for (const svg of allSvgs) {
      const parent = svg.closest(
        '[class*="seat"], [id*="seat"], [class*="map"], [id*="map"], [class*="booking"]'
      );
      if (parent) {
        try {
          const rect = svg.getBoundingClientRect();
          if (rect.width > 150 && rect.height > 150) {
            return svg;
          }
        } catch {
          return svg;
        }
      }
    }

    // 3. Look for largest SVG by screen area (ignoring small icons < 150px)
    let largestSvg: SVGSVGElement | null = null;
    let maxArea = 0;
    for (const svg of allSvgs) {
      try {
        const rect = svg.getBoundingClientRect();
        const area = rect.width * rect.height;
        if (area > maxArea && rect.width > 150 && rect.height > 150) {
          maxArea = area;
          largestSvg = svg;
        }
      } catch {
        // ignore
      }
    }
    if (largestSvg) return largestSvg;

    // 4. Look for SVG with large viewBox
    for (const svg of allSvgs) {
      const vb = svg.getAttribute('viewBox');
      if (vb) {
        const parts = vb
          .trim()
          .split(/[\s,]+/)
          .map(parseFloat);
        if (
          parts.length === 4 &&
          typeof parts[2] === 'number' &&
          typeof parts[3] === 'number' &&
          parts[2] > 200 &&
          parts[3] > 200
        ) {
          return svg;
        }
      }
    }

    return null;
  }

  /**
   * Seated Flow: Detects seat map presence.
   */
  public async detectSeatMap(): Promise<{ hasSeatMap: boolean; zones?: string[] }> {
    const root = this.getRoot();
    if (!root) return { hasSeatMap: false };

    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
    const isBookingUrl = currentUrl.includes('/select-ticket') || currentUrl.includes('/booking');

    const mapEl =
      this.findSeatmapSvg() ||
      root.querySelector(
        '.seat-map, #seat-map, svg.seatmap, [data-seat-map], [data-seatmap], .seat-plan, [class*="seatmap"], [class*="seat-map"]'
      );
    const hasSeatMap = mapEl !== null || isBookingUrl;
    const areas = TicketboxSeatMapParser.parseAreas(root);

    return {
      hasSeatMap,
      zones: areas.map((a) => a.name),
    };
  }

  /**
   * Seated Flow: Discovers individual seats.
   */
  public async discoverSeats(areaId?: string): Promise<Seat[]> {
    const root = this.getRoot();
    const showingId = this.getShowingId();

    // 1. Authoritative Seatmap API data
    let seatmapData = this.cachedSeatmapData;
    if (!seatmapData && showingId) {
      seatmapData = await this.fetchSeatmapApi(showingId);
    }

    if (seatmapData) {
      const apiSeats = TicketboxSeatMapParser.parseSeatsFromSeatmapApi(seatmapData, areaId);
      if (apiSeats.length > 0) {
        if (root) {
          this.reconcileSelectedSeatsFromDOM(apiSeats, root);
        }
        for (const s of apiSeats) {
          if (this.isSeatBlacklisted(s.id) || this.isSeatBlacklisted(s.label)) {
            s.status = 'UNAVAILABLE';
            s.selectable = false;
          } else if (this.selectedSeatIds.has(s.id) || this.selectedSeatIds.has(s.label)) {
            s.status = 'SELECTED';
          }
        }
        this.cachedSeats = apiSeats;
        this.logger?.info('Discovered seats from authoritative Seatmap API', {
          totalSeats: apiSeats.length,
          availableCount: apiSeats.filter((s) => s.selectable && s.status === 'AVAILABLE').length,
          selectedCount: apiSeats.filter((s) => s.status === 'SELECTED').length,
          blacklistedCount: apiSeats.filter((s) => this.isSeatBlacklisted(s.id) || this.isSeatBlacklisted(s.label)).length,
          areaId,
        });
        return apiSeats;
      }
    }

    // 2. DOM Parser fallback
    if (!root) return [];
    const allSeats = TicketboxSeatMapParser.parseSeats(root);

    // If seats are not yet parsed from DOM nodes or if user already selected a seat, inspect bottom action bar
    const selectedBadge = root.querySelector(
      '[class*="selected"], [class*="seat-selected"], [class*="seat-info"], [class*="bottom"], footer, .bottom-bar'
    );
    const selectedBadgeText = selectedBadge ? selectedBadge.textContent : '';
    const seatMatches = selectedBadgeText.match(/\b([A-Z0-9]+[-_]\d+)\b/gi);

    if (seatMatches) {
      for (const rawLabel of seatMatches) {
        const seatLabel = rawLabel.toUpperCase();
        if (this.isSeatBlacklisted(seatLabel)) {
          continue;
        }
        const existing = allSeats.find(
          (s) => s.label.toUpperCase() === seatLabel || s.id.toUpperCase() === seatLabel
        );
        if (existing) {
          existing.status = 'SELECTED';
        } else {
          const parsed = TicketboxSeatMapParser.parseRowAndNumber(seatLabel);
          allSeats.unshift({
            id: seatLabel,
            label: seatLabel,
            row: parsed.row,
            number: parsed.number,
            area: 'DEFAULT',
            status: 'SELECTED',
            selectable: true,
          });
        }
      }
    }

    for (const s of allSeats) {
      if (this.isSeatBlacklisted(s.id) || this.isSeatBlacklisted(s.label)) {
        s.status = 'UNAVAILABLE';
        s.selectable = false;
      }
    }

    this.cachedSeats = allSeats;

    if (areaId) {
      return allSeats.filter(
        (s) =>
          !s.area ||
          s.area === areaId ||
          s.area.toLowerCase() === areaId.toLowerCase() ||
          s.areaId === areaId
      );
    }
    return allSeats;
  }

  /**
   * Reconciles already selected seats observed in DOM / SVG with parsed seats.
   */
  private reconcileSelectedSeatsFromDOM(seats: Seat[], root: DOMElementLike): void {
    try {
      const selectedNodes = root.querySelectorAll(
        '[class*="selected"], [class*="active"], [data-status="selected"], [aria-pressed="true"], svg circle[fill="#4CAF50"], svg circle[fill*="green"], svg circle[style*="green"], svg [fill*="green"]'
      );

      for (const node of selectedNodes) {
        const id =
          node.getAttribute('data-seat-id') ||
          node.getAttribute('data-id') ||
          node.getAttribute('id');
        const label =
          node.getAttribute('data-seat-label') ||
          node.getAttribute('aria-label') ||
          node.textContent.trim();
        const cxAttr = node.getAttribute('cx') || node.getAttribute('x');
        const cyAttr = node.getAttribute('cy') || node.getAttribute('y');
        const cx = cxAttr ? parseFloat(cxAttr) : NaN;
        const cy = cyAttr ? parseFloat(cyAttr) : NaN;

        for (const s of seats) {
          if (
            (id && s.id === id) ||
            (label && (s.label === label || s.id === label)) ||
            (!isNaN(cx) &&
              !isNaN(cy) &&
              typeof s.x === 'number' &&
              typeof s.y === 'number' &&
              Math.hypot(s.x - cx, s.y - cy) < 15)
          ) {
            if (this.isSeatBlacklisted(s.id) || this.isSeatBlacklisted(s.label)) {
              s.status = 'UNAVAILABLE';
              s.selectable = false;
            } else {
              s.status = 'SELECTED';
            }
          }
        }
      }

      // Also inspect bottom action bar / selected seat badge text
      const bar = root.querySelector(
        '[class*="bottom"], [class*="footer"], .checkout-bar, .booking-bar, [class*="seat-info"]'
      );
      if (bar) {
        const barText = bar.textContent.toUpperCase();
        for (const s of seats) {
          if (s.label && s.label.length >= 2 && barText.includes(s.label.toUpperCase())) {
            if (this.isSeatBlacklisted(s.id) || this.isSeatBlacklisted(s.label)) {
              s.status = 'UNAVAILABLE';
              s.selectable = false;
            } else {
              s.status = 'SELECTED';
            }
          }
        }
      }
    } catch {
      // Ignore inspection errors
    }
  }

  /**
   * Seated Flow: Selects specific seats by ID/label.
   */
  public async selectSpecificSeats(seatIds: string[]): Promise<boolean> {
    const root = this.getRoot();
    if (!root) return false;

    this.logger?.info('Selecting specific seats', { seatIds });

    // 1. Primary Ticketbox Konva Canvas seat selection via Page-World Bridge
    if (typeof window !== 'undefined') {
      const seatsToSelect = seatIds.map((id) => {
        const cached = this.cachedSeats.find((s) => s.id === id || s.label === id);
        return {
          id,
          label: cached?.label || id,
          x: cached?.x,
          y: cached?.y,
          row: cached?.row,
          number: cached?.number,
        };
      });

      const bridgeRes = await this.sendPageBridgeRequest<{ selectedCount: number }>(
        'SELECT_SEATS',
        { seats: seatsToSelect },
        4000
      );

      if (bridgeRes.success && bridgeRes.data && bridgeRes.data.selectedCount > 0) {
        this.logger?.info('Seats selected successfully via Page Bridge (Konva)', {
          selectedCount: bridgeRes.data.selectedCount,
          seatIds,
        });

        for (const id of seatIds) {
          this.selectedSeatIds.add(id);
          const seat = this.cachedSeats.find((s) => s.id === id || s.label === id);
          if (seat) {
            seat.status = 'SELECTED';
            if (seat.label) this.selectedSeatIds.add(seat.label);
          }
        }

        await new Promise((r) => setTimeout(r, 300));
        return true;
      }
    }

    // 2. DOM / SVG / Native Canvas coordinate simulation loop
    for (const seatId of seatIds) {
      const seat = this.cachedSeats.find((s) => s.id === seatId || s.label === seatId);

      let targetEl: DOMElementLike | null = null;
      let nativeTarget: Element | null = null;

      // Dynamic mount polling retry (up to 5 attempts with delay)
      for (let attempt = 0; attempt < 5; attempt++) {
        const seatmapSvg = this.findSeatmapSvg();

        // Strategy 1: SVG coordinate distance matching within seatmapSvg (most direct & accurate)
        if (!targetEl && seat && typeof seat.x === 'number' && typeof seat.y === 'number') {
          const shapes = seatmapSvg
            ? Array.from(seatmapSvg.querySelectorAll('circle, ellipse, rect, path, [cx]')).map(
                (el) => wrapBrowserElement(el)
              )
            : root.querySelectorAll(
                'svg circle, circle, svg rect, rect, svg ellipse, ellipse, svg path, svg [cx], [cx]'
              );

          let bestMatch: DOMElementLike | null = null;
          let minDistance = 25.0; // coordinate tolerance

          for (const s of shapes) {
            const cxAttr = s.getAttribute('cx') || s.getAttribute('x');
            const cyAttr = s.getAttribute('cy') || s.getAttribute('y');
            let cx = cxAttr ? parseFloat(cxAttr) : NaN;
            let cy = cyAttr ? parseFloat(cyAttr) : NaN;

            if (isNaN(cx) || isNaN(cy)) {
              const raw = (s.rawElement || s) as SVGGraphicsElement;
              if (raw && typeof raw.getBBox === 'function') {
                try {
                  const bbox = raw.getBBox();
                  cx = bbox.x + bbox.width / 2;
                  cy = bbox.y + bbox.height / 2;
                } catch {
                  // ignore
                }
              }
            }

            if (!isNaN(cx) && !isNaN(cy)) {
              const dist = Math.hypot(cx - seat.x, cy - seat.y);
              if (dist < minDistance) {
                minDistance = dist;
                bestMatch = s;
                if (dist < 1.0) break; // exact match
              }
            }
          }

          if (bestMatch) {
            targetEl = bestMatch;
            nativeTarget = (targetEl.rawElement || targetEl) as Element;
            this.logger?.info('Found seat SVG shape by coordinates', {
              seatId,
              label: seat?.label,
              x: seat?.x,
              y: seat?.y,
              minDistance,
            });
          }
        }

        // Strategy 2: Attribute matching in DOM (by ID, data-seat-id, data-id, label, row, number)
        if (!targetEl) {
          const safeSeatId = seatId.replace(/"/g, '\\"');
          const safeLabel = (seat?.label || seatId).replace(/"/g, '\\"');
          targetEl =
            root.querySelector(`[data-seat-id="${safeSeatId}"]`) ||
            root.querySelector(`[id="${safeSeatId}"]`) ||
            root.querySelector(`[id*="${safeSeatId}"]`) ||
            root.querySelector(`[data-id="${safeSeatId}"]`) ||
            root.querySelector(`[data-seat="${safeSeatId}"]`) ||
            root.querySelector(`[data-seat-label="${safeLabel}"]`) ||
            root.querySelector(`[data-seat="${safeLabel}"]`) ||
            root.querySelector(`[id*="${safeLabel}"]`) ||
            root.querySelector(`[aria-label*="${safeLabel}"]`) ||
            root.querySelector(`[title*="${safeLabel}"]`);

          if (!targetEl && seat?.row && typeof seat.number === 'number') {
            targetEl =
              root.querySelector(`[data-row="${seat.row}"][data-number="${seat.number}"]`) ||
              root.querySelector(`[data-row="${seat.row}"][data-seat-number="${seat.number}"]`) ||
              root.querySelector(`[data-row="${seat.row}"][data-seat="${seat.number}"]`);
          }
          if (targetEl) {
            nativeTarget = (targetEl.rawElement || targetEl) as Element;
          }
        }

        // Strategy 3: Screen coordinate mapping via getScreenCTM on verified seatmapSvg
        if (
          !targetEl &&
          typeof window !== 'undefined' &&
          typeof document !== 'undefined' &&
          seatmapSvg &&
          typeof seatmapSvg.createSVGPoint === 'function' &&
          typeof seatmapSvg.getScreenCTM === 'function' &&
          seat &&
          typeof seat.x === 'number' &&
          typeof seat.y === 'number'
        ) {
          try {
            const ctm = seatmapSvg.getScreenCTM();
            if (ctm) {
              const pt = seatmapSvg.createSVGPoint();
              pt.x = seat.x;
              pt.y = seat.y;
              const screenPt = pt.matrixTransform(ctm);
              if (
                screenPt.x > 0 &&
                screenPt.y > 0 &&
                screenPt.x < window.innerWidth &&
                screenPt.y < window.innerHeight
              ) {
                if (typeof document.elementsFromPoint === 'function') {
                  const stack = document.elementsFromPoint(screenPt.x, screenPt.y);
                  const svgMatch = stack.find((el) => {
                    const tag = el.tagName.toLowerCase();
                    return (
                      tag === 'circle' ||
                      tag === 'rect' ||
                      tag === 'ellipse' ||
                      tag === 'path' ||
                      tag === 'g'
                    );
                  });
                  if (svgMatch) {
                    nativeTarget = svgMatch;
                    targetEl = wrapBrowserElement(svgMatch);
                  }
                }
                if (!targetEl) {
                  const elAtPoint = document.elementFromPoint(screenPt.x, screenPt.y);
                  if (elAtPoint) {
                    nativeTarget = elAtPoint;
                    targetEl = wrapBrowserElement(elAtPoint);
                  }
                }
                if (targetEl) {
                  this.logger?.info('Located seat element via SVG screen coordinate transform', {
                    seatId,
                    label: seat?.label,
                    screenX: screenPt.x,
                    screenY: screenPt.y,
                  });
                }
              }
            }
          } catch (ctmErr) {
            this.logger?.debug('Screen coordinate transform failed, falling back', {
              err: String(ctmErr),
            });
          }
        }

        // Strategy 4: Konva canvas container hit dispatching at calculated coordinates
        if (
          !targetEl &&
          typeof document !== 'undefined' &&
          seat &&
          typeof seat.x === 'number' &&
          typeof seat.y === 'number'
        ) {
          const canvas = (document.querySelector('.konvajs-content canvas') ||
            document.querySelector('.konvajs-content') ||
            document.querySelector('canvas')) as HTMLElement | null;
          if (canvas) {
            nativeTarget = canvas;
            targetEl = wrapBrowserElement(canvas);
            this.logger?.info('Located seat on Konva canvas via coordinates', {
              seatId,
              label: seat?.label,
              x: seat.x,
              y: seat.y,
            });
          }
        }

        if (targetEl) break;
        // Wait briefly for React rendering before next attempt
        await new Promise((r) => setTimeout(r, 250));
      }

      if (!targetEl) {
        this.logger?.warn('Seat element not found in DOM or SVG', { seatId });
        return false;
      }

      // 4. Dispatch simulated mouse and pointer clicks with coordinate context
      const nativeEl = (nativeTarget || targetEl.rawElement || targetEl) as Element;

      if (typeof (nativeEl as HTMLElement).scrollIntoView === 'function') {
        try {
          (nativeEl as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'nearest' });
        } catch {
          // ignore
        }
      }

      let clientX = seat?.x ?? 0;
      let clientY = seat?.y ?? 0;

      if (typeof nativeEl.getBoundingClientRect === 'function') {
        const rect = nativeEl.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const tag = nativeEl.tagName ? nativeEl.tagName.toLowerCase() : '';
          const isCanvasOrKonva =
            tag === 'canvas' ||
            (typeof nativeEl.className === 'string' && nativeEl.className.includes('konvajs')) ||
            (typeof nativeEl.closest === 'function' && !!nativeEl.closest('.konvajs-content'));

          if (isCanvasOrKonva && seat && typeof seat.x === 'number' && typeof seat.y === 'number') {
            clientX = rect.left + seat.x;
            clientY = rect.top + seat.y;
          } else {
            clientX = rect.left + rect.width / 2;
            clientY = rect.top + rect.height / 2;
          }
        }
      }

      if (typeof (nativeEl as HTMLElement).focus === 'function') {
        try {
          (nativeEl as HTMLElement).focus();
        } catch {
          // ignore
        }
      }

      if (
        typeof window !== 'undefined' &&
        typeof window.MouseEvent === 'function' &&
        'dispatchEvent' in (nativeEl as object)
      ) {
        const mouseOpts = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX,
          clientY,
          buttons: 1,
        };
        const pointerOpts = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX,
          clientY,
          buttons: 1,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        };
        const releaseOpts = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX,
          clientY,
          buttons: 0,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        };

        if (typeof window.PointerEvent === 'function') {
          nativeEl.dispatchEvent(new PointerEvent('pointerover', pointerOpts));
          nativeEl.dispatchEvent(new PointerEvent('pointerenter', pointerOpts));
          nativeEl.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
        }
        nativeEl.dispatchEvent(new MouseEvent('mouseover', mouseOpts));
        nativeEl.dispatchEvent(new MouseEvent('mousedown', mouseOpts));

        if (typeof window.PointerEvent === 'function') {
          nativeEl.dispatchEvent(new PointerEvent('pointerup', releaseOpts));
        }
        nativeEl.dispatchEvent(new MouseEvent('mouseup', releaseOpts));
        nativeEl.dispatchEvent(new MouseEvent('click', releaseOpts));

        // If child of a group <g> or <a>, also dispatch click to parent
        const parent = nativeEl.parentElement;
        if (
          parent &&
          (parent.tagName.toLowerCase() === 'g' || parent.tagName.toLowerCase() === 'a')
        ) {
          parent.dispatchEvent(new MouseEvent('click', releaseOpts));
          if (typeof (parent as HTMLElement).click === 'function') {
            (parent as HTMLElement).click();
          }
        }

        // Also check if an overlay exists at (clientX, clientY)
        if (
          typeof document !== 'undefined' &&
          typeof document.elementFromPoint === 'function' &&
          clientX > 0 &&
          clientY > 0
        ) {
          const topEl = document.elementFromPoint(clientX, clientY);
          if (
            topEl &&
            topEl !== nativeEl &&
            !nativeEl.contains(topEl) &&
            !topEl.contains(nativeEl)
          ) {
            try {
              if (typeof window.PointerEvent === 'function') {
                topEl.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
                topEl.dispatchEvent(new PointerEvent('pointerup', releaseOpts));
              }
              topEl.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
              topEl.dispatchEvent(new MouseEvent('mouseup', releaseOpts));
              topEl.dispatchEvent(new MouseEvent('click', releaseOpts));
              if (typeof (topEl as HTMLElement).click === 'function') {
                (topEl as HTMLElement).click();
              }
            } catch {
              // ignore
            }
          }
        }
      }

      if (typeof (nativeEl as HTMLElement).click === 'function') {
        (nativeEl as HTMLElement).click();
      } else if (typeof (targetEl as MutableDOMElement).click === 'function') {
        (targetEl as MutableDOMElement).click!();
      }

      // 5. Mark selected in node attributes
      if (typeof (nativeEl as Element).setAttribute === 'function') {
        nativeEl.setAttribute('aria-pressed', 'true');
        nativeEl.setAttribute('data-status', 'selected');
        const currentClass = nativeEl.getAttribute('class') || '';
        if (!currentClass.includes('selected')) {
          nativeEl.setAttribute('class', `${currentClass} selected`.trim());
        }
      }
      if ((targetEl as MutableDOMElement).attributes) {
        (targetEl as MutableDOMElement).attributes!['data-status'] = 'selected';
        (targetEl as MutableDOMElement).attributes!['aria-pressed'] = 'true';
      }
      if (targetEl.setAttribute) {
        targetEl.setAttribute('data-status', 'selected');
        targetEl.setAttribute('aria-pressed', 'true');
      }
      if (typeof (targetEl as MutableDOMElement).className === 'string') {
        const cur = (targetEl as MutableDOMElement).className || '';
        if (!cur.includes('selected')) {
          (targetEl as MutableDOMElement).className = `${cur} selected`.trim();
        }
      }

      this.selectedSeatIds.add(seatId);
      if (seat?.label) this.selectedSeatIds.add(seat.label);
      if (seat) seat.status = 'SELECTED';

      this.logger?.info('Seat selection clicked and verified', { seatId, label: seat?.label });
      await new Promise((r) => setTimeout(r, 200));
    }

    return true;
  }

  public async selectSeats(selection: { zoneId?: string; seatIds: string[] }): Promise<boolean> {
    return this.selectSpecificSeats(selection.seatIds);
  }

  /**
   * Summary: Parses current summary panel.
   */
  public async getBookingSummary(): Promise<BookingSummary | null> {
    const root = this.getRoot();
    if (!root) return null;
    return TicketboxSummaryParser.parseSummary(root);
  }

  /**
   * Form: Parses question / attendee form schema.
   */
  public async getFormSchema(): Promise<FormSchema | null> {
    const root = this.getRoot();
    if (!root) return null;

    // Attempt to pre-fetch question form API if eventId is known
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const eventId =
      this.cachedEventApiId ||
      (url ? url.match(/events\/(\d+)/)?.[1] || url.match(/-(\d+)(?:\?|$)/)?.[1] || null : null);
    if (eventId && !this.cachedQuestionFormData) {
      await this.fetchQuestionFormApi(eventId);
    }

    return TicketboxFormParser.parseForm(root);
  }

  /**
   * Form: Safely fills attendee form with user profile data.
   */
  public async fillAttendeeForm(profile: UserProfileData): Promise<{
    allSatisfied: boolean;
    missingFields: string[];
    isConsentBlocked: boolean;
  }> {
    const schema = await this.getFormSchema();
    if (!schema) {
      return { allSatisfied: true, missingFields: [], isConsentBlocked: false };
    }

    const evalResult = FormAutofillPolicy.evaluate(schema, profile);
    const root = this.getRoot();

    if (root) {
      for (const item of evalResult.plan) {
        if (item.targetValue) {
          const safeFieldId = item.field.id.replace(/"/g, '\\"');
          const el =
            root.querySelector(item.field.selector) ||
            root.querySelector(`[id="${safeFieldId}"]`) ||
            root.querySelector(`[name="${safeFieldId}"]`);

          if (el) {
            const nativeEl = (el.rawElement || el) as HTMLElement;

            if (item.field.type === 'CHECKBOX' || item.field.type === 'RADIO') {
              if (item.targetValue === 'true') {
                if (typeof (el as MutableDOMElement).click === 'function') {
                  (el as MutableDOMElement).click!();
                }
                if (typeof nativeEl.click === 'function') {
                  nativeEl.click();
                }
                const inputEl = nativeEl as HTMLInputElement;
                if (typeof window !== 'undefined' && window.HTMLInputElement) {
                  const desc = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    'checked'
                  );
                  if (desc && desc.set) {
                    desc.set.call(inputEl, true);
                  } else {
                    inputEl.checked = true;
                  }
                } else if ('checked' in inputEl) {
                  inputEl.checked = true;
                }

                const EventCtor = (
                  globalThis as unknown as {
                    Event?: new (type: string, init?: Record<string, unknown>) => unknown;
                  }
                ).Event;
                if (
                  typeof EventCtor === 'function' &&
                  typeof nativeEl.dispatchEvent === 'function'
                ) {
                  nativeEl.dispatchEvent(new EventCtor('change', { bubbles: true }) as never);
                  nativeEl.dispatchEvent(new EventCtor('input', { bubbles: true }) as never);
                }

                // If element has a label or wrapper (e.g. Ant Design), click it too
                if (typeof nativeEl.closest === 'function') {
                  const parentWrapper = nativeEl.closest(
                    'label, .ant-radio-wrapper, .ant-checkbox-wrapper, [class*="radio"], [class*="checkbox"]'
                  ) as HTMLElement | null;
                  if (parentWrapper && typeof parentWrapper.click === 'function') {
                    parentWrapper.click();
                  }
                }

                (el as MutableDOMElement).attributes = (el as MutableDOMElement).attributes || {};
                (el as MutableDOMElement).attributes['checked'] = 'true';
                (el as MutableDOMElement).attributes['aria-checked'] = 'true';
                this.logger?.info('Consent radio/checkbox selected', { label: item.field.label });
              }
            } else if (
              item.field.type === 'SELECT' ||
              (nativeEl.tagName && nativeEl.tagName.toLowerCase() === 'select')
            ) {
              const selectEl = nativeEl as HTMLSelectElement;
              const options = Array.from(selectEl.options || []);
              const targetVal = item.targetValue.toLowerCase();
              const matchedOpt = options.find(
                (opt) =>
                  opt.value.toLowerCase() === targetVal ||
                  opt.text.toLowerCase().includes(targetVal) ||
                  targetVal.includes(opt.text.toLowerCase())
              );
              if (matchedOpt) {
                selectEl.value = matchedOpt.value;
              } else {
                selectEl.value = item.targetValue;
              }
              const EventCtor = (
                globalThis as unknown as {
                  Event?: new (type: string, init?: Record<string, unknown>) => unknown;
                }
              ).Event;
              if (typeof EventCtor === 'function' && typeof selectEl.dispatchEvent === 'function') {
                selectEl.dispatchEvent(new EventCtor('change', { bubbles: true }) as never);
              }
              this.logger?.info('Form select dropdown set', {
                label: item.field.label,
                source: item.source,
                value: item.targetValue,
              });
            } else {
              // TEXT, EMAIL, PHONE, ID_CARD, BIRTH_YEAR, ADDRESS
              const inputEl = nativeEl as HTMLInputElement;
              if (typeof window !== 'undefined' && window.HTMLInputElement) {
                const desc = Object.getOwnPropertyDescriptor(
                  window.HTMLInputElement.prototype,
                  'value'
                );
                if (desc && desc.set) {
                  desc.set.call(inputEl, item.targetValue);
                } else {
                  inputEl.value = item.targetValue;
                }
              } else if ('value' in inputEl) {
                inputEl.value = item.targetValue;
              }

              const EventCtor = (
                globalThis as unknown as {
                  Event?: new (type: string, init?: Record<string, unknown>) => unknown;
                }
              ).Event;
              if (typeof EventCtor === 'function' && typeof nativeEl.dispatchEvent === 'function') {
                nativeEl.dispatchEvent(new EventCtor('focus', { bubbles: true }) as never);
                if (typeof InputEvent !== 'undefined') {
                  try {
                    nativeEl.dispatchEvent(
                      new InputEvent('input', { bubbles: true, data: item.targetValue })
                    );
                  } catch {
                    nativeEl.dispatchEvent(new EventCtor('input', { bubbles: true }) as never);
                  }
                } else {
                  nativeEl.dispatchEvent(new EventCtor('input', { bubbles: true }) as never);
                }
                nativeEl.dispatchEvent(new EventCtor('change', { bubbles: true }) as never);
                nativeEl.dispatchEvent(new EventCtor('blur', { bubbles: true }) as never);
              }

              (el as MutableDOMElement).attributes = (el as MutableDOMElement).attributes || {};
              (el as MutableDOMElement).attributes['value'] = item.targetValue;
              if ('value' in (el as MutableDOMElement)) {
                (el as MutableDOMElement).value = item.targetValue;
              }
              this.logger?.info('Form text input filled', {
                label: item.field.label,
                source: item.source,
              });
            }
          }
        }
      }
    }

    return {
      allSatisfied: evalResult.canProceed,
      missingFields: evalResult.missingFields,
      isConsentBlocked: evalResult.isConsentBlocked,
    };
  }

  public async submitReservation(
    candidate: CandidateTicket,
    quantity: number
  ): Promise<PageReservationResult> {
    this.logger?.info('TicketboxJourneyAdapter submitReservation requested', {
      candidateId: candidate.id,
      quantity,
    });
    return {
      isConfirmed: false,
      errorMessage: 'BLOCKED_BY_DISCOVERY: Journey handoff reached payment/confirmation boundary',
    };
  }

  public async getReservationState(): Promise<Reservation | null> {
    return null;
  }

  public async getCheckoutState(): Promise<PageCheckoutState> {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const isInCheckout = url.includes('/checkout') || url.includes('/payment');

    return {
      isInCheckout,
      checkoutUrl: url,
    };
  }
}
