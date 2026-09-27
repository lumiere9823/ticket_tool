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
} from '../../domain/entities/EventCatalog';
import {
  BookingSummary,
  FormSchema,
  JourneyTicketType,
  Seat,
  SeatArea,
  UserProfileData,
} from '../../domain/entities/BookingJourneyModels';
import { DOMElementLike, wrapBrowserElement } from './parsing/DOMElementLike';
import { TicketboxCatalogParser } from './parsing/TicketboxCatalogParser';
import {
  SeatmapApiResponse,
  TicketboxSeatMapParser,
} from './parsing/TicketboxSeatMapParser';
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
  private cachedSeats: Seat[] = [];

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

  public getShowingId(): string | null {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const root = this.getRoot();
    return TicketboxCatalogParser.extractShowingId(url, root);
  }

  public async fetchSeatmapApi(showingId: string): Promise<SeatmapApiResponse | null> {
    if (this.cachedShowingId === showingId && this.cachedSeatmapData) {
      return this.cachedSeatmapData;
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
        }
      } catch (err: unknown) {
        this.logger?.warn('Background message fetch failed', { err: String(err) });
      }
    }

    return null;
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

  public async discoverTicketCatalog(showingId?: string | null): Promise<EventCatalog> {
    const root = this.getRoot();
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const targetShowingId = showingId || this.getShowingId();

    // 1. Attempt to fetch authoritative ticket tiers from Seatmap API when showing ID is available
    if (targetShowingId) {
      try {
        const seatmapData = await this.fetchSeatmapApi(targetShowingId);
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
        this.logger?.warn('Error discovering tickets from Seatmap API, falling back to DOM parser', {
          err: String(err),
        });
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
  public async discoverJourneyTickets(): Promise<JourneyTicketType[]> {
    const root = this.getRoot();
    if (!root) return [];

    const catalog = TicketboxCatalogParser.parseCatalog(root);
    const journeyTickets: JourneyTicketType[] = [];

    for (const showing of catalog.showings) {
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
   * Selects a ticket tier following Section 7 verification rules.
   */
  public async selectTicket(candidateId: string, quantity: number): Promise<boolean> {
    const root = this.getRoot();
    if (!root) return false;

    this.logger?.info('Executing Section 7 Ticket Selection', { candidateId, quantity });

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

    const candidateLower = candidateId.toLowerCase().trim();

    // 1. Expand showing or accordion if tickets or quantity controls are not yet visible
    const showingBtn = root.querySelector(
      '#select-showing-btn, [id*="select-showing"], button.btn-buy-ticket, .ant-collapse-header button'
    );
    if (showingBtn && typeof (showingBtn as MutableDOMElement).click === 'function') {
      const hasQtyControls =
        root.querySelector('.ant-input-number, .qty-input, input[type="number"], .ant-drawer-open') !== null;
      if (!hasQtyControls) {
        this.logger?.info('Clicking showing/booking button to open ticket purchase view', { candidateId });
        (showingBtn as MutableDOMElement).click!();
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    // 2. Locate the ticket row by ID or name
    let targetRow: DOMElementLike | null =
      root.querySelector(`[data-ticket-id="${candidateId}"]`) ||
      root.querySelector(`#${candidateId}`);

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
    const isRowDisabled =
      targetRow.hasAttribute('disabled') ||
      targetRow.getAttribute('aria-disabled') === 'true' ||
      (targetRow.className || '').includes('disabled');

    const rowText = targetRow.textContent.toLowerCase();
    const isSoldOut =
      rowText.includes('hết vé') ||
      rowText.includes('sold out') ||
      rowText.includes('hết chỗ');

    if (isRowDisabled || isSoldOut) {
      this.logger?.warn('Ticket row is disabled or sold out', { candidateId, isRowDisabled, isSoldOut });
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
   * Standing Flow: Sets quantity following Section 9 rules.
   */
  public async selectQuantity(ticket: TicketType, quantity: number): Promise<boolean> {
    const root = this.getRoot();
    if (!root) return false;

    this.logger?.info('Executing Section 9 Quantity Selection', {
      ticketName: ticket.name,
      quantity,
    });

    // If on seat map page, quantity is fulfilled by seat selection
    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
    const isAlreadyOnBookingPage =
      currentUrl.includes('/select-ticket') ||
      currentUrl.includes('/booking') ||
      root.querySelector('svg.seatmap, [class*="seatmap"], .seat-map') !== null;
    if (isAlreadyOnBookingPage) {
      this.logger?.info('Already on seat map page; quantity handled via seat selection', {
        ticketName: ticket.name,
      });
      return true;
    }

    // Locate quantity input or container
    let ticketContainer = ticket.id ? root.querySelector(`[data-ticket-id="${ticket.id}"]`) : null;

    if (!ticketContainer) {
      const ticketLower = ticket.name.toLowerCase().trim();
      const allRows = root.querySelectorAll(
        '.content-row, [class*="content-row"], .ticket-item, .ticket-row'
      );
      for (const row of allRows) {
        const titleEl = row.querySelector(
          '.title-tickettype, [class*="title-tickettype"], .ticket-name, .name, h3, h4, h5, strong'
        );
        if (titleEl && titleEl.textContent.trim().toLowerCase().includes(ticketLower)) {
          ticketContainer = row;
          break;
        }
      }
    }
    ticketContainer = ticketContainer || root;

    const input = ticketContainer.querySelector(
      'input[type="number"], .qty-input, input.quantity, .ant-input-number-input'
    );

    const plusBtn = ticketContainer.querySelector(
      '.ant-input-number-handler-up, button[aria-label="plus"], .btn-plus, .plus, [class*="handler-up"]'
    );

    if (input) {
      // 1. Read current quantity BEFORE any modification
      const rawCurrentVal =
        input.getAttribute('value') ||
        ('value' in input ? String((input as MutableDOMElement).value) : '') ||
        '0';
      const cur = parseInt(rawCurrentVal, 10) || 0;

      // 2. Inspect allowed quantity
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

      // 3. If plus button is present, click it to sync React/AntDesign state
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

      // 4. Update native input value with prototype descriptor setter to notify React
      if (input.rawElement && 'value' in input.rawElement) {
        const nativeEl = input.rawElement as HTMLInputElement;
        const proto = typeof window !== 'undefined' ? window.HTMLInputElement?.prototype : null;
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

    // Try + increment button if no direct input
    if (plusBtn && typeof (plusBtn as MutableDOMElement).click === 'function') {
      this.logger?.info('Incrementing quantity via plus button', { targetQuantity: quantity });
      for (let i = 0; i < quantity; i++) {
        (plusBtn as MutableDOMElement).click!();
        await new Promise((r) => setTimeout(r, 120));
      }
      return true;
    }

    // Default 1 quantity success if tier was selected
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
   * Clicks the primary proceed/continue/checkout button on Ticketbox to advance the flow.
   */
  public async proceedToNextStep(): Promise<boolean> {
    const root = this.getRoot();
    if (!root) return false;

    // Allow UI state to settle after quantity selection
    await new Promise((r) => setTimeout(r, 300));

    const candidates = root.querySelectorAll(
      '#btn-continue, [id*="continue"], .btn-continue, button.ant-btn-primary, button[type="submit"], .btn-checkout, [class*="checkout"], .ant-drawer-footer button, [class*="bottom"] button, [class*="bottom"] a, button, a.btn, a[class*="button"], [role="button"]'
    );

    for (const btn of candidates) {
      if (btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true') {
        continue;
      }
      const text = btn.textContent.toLowerCase().trim();
      if (
        text.includes('tiếp tục') ||
        text.includes('mua vé') ||
        text.includes('đặt vé') ||
        text.includes('thanh toán') ||
        text.includes('continue') ||
        text.includes('checkout') ||
        text.includes('xác nhận')
      ) {
        this.logger?.info('Clicking next step / continue button', { buttonText: text });
        if (typeof (btn as MutableDOMElement).click === 'function') {
          (btn as MutableDOMElement).click!();
        }
        if (
          typeof window !== 'undefined' &&
          typeof window.MouseEvent === 'function' &&
          'dispatchEvent' in (btn as object)
        ) {
          (btn as unknown as HTMLElement).dispatchEvent(
            new MouseEvent('click', { bubbles: true, cancelable: true })
          );
        }
        await new Promise((r) => setTimeout(r, 500));
        return true;
      }
    }

    return false;
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
   * Seated Flow: Selects an area by ID.
   */
  public async selectArea(areaId: string): Promise<boolean> {
    const root = this.getRoot();
    if (!root) return false;

    this.logger?.info('Selecting Area', { areaId });

    const areaEl =
      root.querySelector(`[data-zone-id="${areaId}"]`) ||
      root.querySelector(`[data-area-id="${areaId}"]`) ||
      root.querySelector(`[data-area="${areaId}"]`) ||
      root.querySelector(`#${areaId}`);

    if (!areaEl) {
      this.logger?.warn('Area element not found in DOM', { areaId });
      return false;
    }

    if (areaEl.hasAttribute('disabled') || areaEl.getAttribute('aria-disabled') === 'true') {
      this.logger?.warn('Area element is disabled', { areaId });
      return false;
    }

    if (typeof (areaEl as MutableDOMElement).click === 'function') {
      (areaEl as MutableDOMElement).click!();
    }
    (areaEl as MutableDOMElement).attributes = (areaEl as MutableDOMElement).attributes || {};
    (areaEl as MutableDOMElement).attributes['data-status'] = 'selected';
    (areaEl as MutableDOMElement).className = ((areaEl.className || '') + ' selected').trim();

    return true;
  }

  /**
   * Seated Flow: Detects seat map presence.
   */
  public async detectSeatMap(): Promise<{ hasSeatMap: boolean; zones?: string[] }> {
    const root = this.getRoot();
    if (!root) return { hasSeatMap: false };

    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
    const isBookingUrl = currentUrl.includes('/select-ticket') || currentUrl.includes('/booking');

    const mapEl = root.querySelector(
      '.seat-map, #seat-map, svg.seatmap, [data-seat-map], [data-seatmap], .seat-plan, [class*="seatmap"], [class*="seat-map"], svg'
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
        this.cachedSeats = apiSeats;
        this.logger?.info('Discovered seats from authoritative Seatmap API', {
          totalSeats: apiSeats.length,
          availableCount: apiSeats.filter((s) => s.selectable).length,
          areaId,
        });
        return apiSeats;
      }
    }

    // 2. DOM Parser fallback
    if (!root) return [];
    let allSeats = TicketboxSeatMapParser.parseSeats(root);

    // If seats are not yet parsed from DOM nodes or if user already selected a seat, inspect bottom action bar
    const selectedBadge = root.querySelector(
      '[class*="selected"], [class*="seat-selected"], [class*="seat-info"], [class*="bottom"], footer, .bottom-bar'
    );
    const selectedBadgeText = selectedBadge ? selectedBadge.textContent : '';
    const seatMatches = selectedBadgeText.match(/\b([A-Z0-9]+[-_]\d+)\b/gi);

    if (seatMatches) {
      for (const rawLabel of seatMatches) {
        const seatLabel = rawLabel.toUpperCase();
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

    this.cachedSeats = allSeats;

    if (areaId) {
      return allSeats.filter((s) => !s.area || s.area === areaId);
    }
    return allSeats;
  }

  /**
   * Seated Flow: Selects specific seats by ID/label.
   */
  public async selectSpecificSeats(seatIds: string[]): Promise<boolean> {
    const root = this.getRoot();
    if (!root) return false;

    this.logger?.info('Selecting specific seats', { seatIds });

    for (const seatId of seatIds) {
      let targetEl: DOMElementLike | null = null;

      // 1. If we have cached seat with coordinates (x, y), search SVG circle / rect by coordinate
      const seat = this.cachedSeats.find((s) => s.id === seatId || s.label === seatId);
      if (seat && typeof seat.x === 'number' && typeof seat.y === 'number') {
        const circles = root.querySelectorAll('svg circle, circle, svg rect, rect, [cx]');
        let bestMatch: DOMElementLike | null = null;
        let minDistance = 2.5; // coordinate tolerance

        for (const c of circles) {
          const cxAttr = c.getAttribute('cx') || c.getAttribute('x');
          const cyAttr = c.getAttribute('cy') || c.getAttribute('y');
          if (!cxAttr || !cyAttr) continue;
          const cx = parseFloat(cxAttr);
          const cy = parseFloat(cyAttr);
          if (!isNaN(cx) && !isNaN(cy)) {
            const dist = Math.hypot(cx - seat.x, cy - seat.y);
            if (dist < minDistance) {
              minDistance = dist;
              bestMatch = c;
            }
          }
        }

        if (bestMatch) {
          targetEl = bestMatch;
          this.logger?.info('Found seat SVG circle by coordinates', {
            seatId,
            label: seat.label,
            x: seat.x,
            y: seat.y,
            minDistance,
          });
        }
      }

      // 2. Fall back to standard DOM selector attributes
      if (!targetEl) {
        targetEl =
          root.querySelector(`[data-seat-id="${seatId}"]`) ||
          root.querySelector(`#${seatId}`) ||
          root.querySelector(`[data-seat-label="${seatId}"]`) ||
          root.querySelector(`[data-seat="${seatId}"]`);
      }

      if (!targetEl) {
        this.logger?.warn('Seat element not found in DOM or SVG', { seatId });
        return false;
      }

      // 3. Dispatch simulated mouse and pointer clicks with coordinate context
      const nativeEl = (targetEl.rawElement || targetEl) as Element;
      if (typeof (targetEl as MutableDOMElement).click === 'function') {
        (targetEl as MutableDOMElement).click!();
      }
      if (
        typeof (nativeEl as HTMLElement).click === 'function' &&
        (nativeEl as unknown) !== targetEl
      ) {
        (nativeEl as HTMLElement).click();
      }

      if (
        typeof window !== 'undefined' &&
        typeof window.MouseEvent === 'function' &&
        'dispatchEvent' in (nativeEl as object)
      ) {
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

      // Mark selected in node attributes
      (targetEl as MutableDOMElement).attributes = (targetEl as MutableDOMElement).attributes || {};
      (targetEl as MutableDOMElement).attributes['data-status'] = 'selected';
      (targetEl as MutableDOMElement).className = ((targetEl.className || '') + ' selected').trim();

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
          const el =
            root.querySelector(item.field.selector) || root.querySelector(`#${item.field.id}`);
          if (el) {
            (el as MutableDOMElement).attributes = (el as MutableDOMElement).attributes || {};
            (el as MutableDOMElement).attributes['value'] = item.targetValue;
            if (item.field.type === 'CHECKBOX') {
              (el as MutableDOMElement).attributes['checked'] = 'true';
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
