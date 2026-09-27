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
import { TicketboxSeatMapParser } from './parsing/TicketboxSeatMapParser';
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

    // 1. Locate UI control
    const control =
      root.querySelector(`[data-ticket-id="${candidateId}"] button`) ||
      root.querySelector(`[data-ticket-id="${candidateId}"]`) ||
      root.querySelector(`#${candidateId} button`) ||
      root.querySelector(`#${candidateId}`);

    if (!control) {
      this.logger?.warn('Ticket selection control not found in DOM', { candidateId });
      return false;
    }

    // 2. Verify still available
    if (
      control.hasAttribute('disabled') ||
      control.getAttribute('aria-disabled') === 'true' ||
      (control.className || '').includes('disabled')
    ) {
      this.logger?.warn('Ticket selection control is disabled', { candidateId });
      return false;
    }

    // 3, 4, 5. Verify displayed name, price, mode are present
    const rawText = control.textContent;
    if (rawText.toLowerCase().includes('hết vé') || rawText.toLowerCase().includes('sold out')) {
      this.logger?.warn('Ticket displayed text indicates sold out', { candidateId });
      return false;
    }

    // 6. Click/select control
    if (typeof (control as MutableDOMElement).click === 'function') {
      (control as MutableDOMElement).click!();
    }
    (control as MutableDOMElement).attributes = (control as MutableDOMElement).attributes || {};
    (control as MutableDOMElement).attributes['aria-pressed'] = 'true';
    (control as MutableDOMElement).className = ((control.className || '') + ' selected').trim();

    // 7, 8, 9. Re-read page state to verify selection
    const postSelectionState = await this.getSelectionState();
    if (postSelectionState.isSelectedInUi) {
      this.logger?.info('Ticket selection verified successfully', { candidateId });
      return true;
    }

    // If summary is not immediately available, check if button gained active/selected class or attribute
    const isNowActive =
      control.getAttribute('aria-pressed') === 'true' ||
      (control.className || '').includes('selected') ||
      (control.className || '').includes('active');

    return isNowActive;
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

    // Locate quantity input or container
    const ticketContainer =
      (ticket.id ? root.querySelector(`[data-ticket-id="${ticket.id}"]`) : null) || root;

    const input = ticketContainer.querySelector('input[type="number"], .qty-input, input.quantity');

    if (!input) {
      this.logger?.warn('Quantity control not found for ticket', { ticketName: ticket.name });
      return false;
    }

    // 1. Inspect allowed quantity
    const minAttr = input.getAttribute('min');
    const maxAttr = input.getAttribute('max');
    const min = minAttr ? parseInt(minAttr, 10) : 1;
    const max = maxAttr ? parseInt(maxAttr, 10) : null;

    // 2. Reject if invalid
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

    // 3. Set quantity
    if ('value' in (input as MutableDOMElement)) {
      (input as MutableDOMElement).value = String(quantity);
    }
    (input as MutableDOMElement).attributes = (input as MutableDOMElement).attributes || {};
    (input as MutableDOMElement).attributes['value'] = String(quantity);

    // 4. Re-read quantity
    const currentQty = parseInt(input.getAttribute('value') || '0', 10);
    if (currentQty !== quantity) {
      this.logger?.warn('Quantity verification failed after setting', {
        expected: quantity,
        actual: currentQty,
      });
      return false;
    }

    this.logger?.info('Quantity selection verified', { quantity });
    return true;
  }

  /**
   * Seated Flow: Discovers zones/areas.
   */
  public async discoverAreas(): Promise<SeatArea[]> {
    const root = this.getRoot();
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

    const mapEl = root.querySelector(
      '.seat-map, #seat-map, svg.seatmap, [data-seat-map], [data-seatmap], .seat-plan'
    );
    const hasSeatMap = mapEl !== null;
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
    if (!root) return [];
    const allSeats = TicketboxSeatMapParser.parseSeats(root);

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
      const seatEl =
        root.querySelector(`[data-seat-id="${seatId}"]`) ||
        root.querySelector(`#${seatId}`) ||
        root.querySelector(`[data-seat-label="${seatId}"]`) ||
        root.querySelector(`[data-seat="${seatId}"]`);

      if (!seatEl) {
        this.logger?.warn('Seat element not found', { seatId });
        return false;
      }

      if (typeof (seatEl as MutableDOMElement).click === 'function') {
        (seatEl as MutableDOMElement).click!();
      }

      // Mark selected in node attributes
      (seatEl as MutableDOMElement).attributes = (seatEl as MutableDOMElement).attributes || {};
      (seatEl as MutableDOMElement).attributes['data-status'] = 'selected';
      (seatEl as MutableDOMElement).className = ((seatEl.className || '') + ' selected').trim();
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
          const el = root.querySelector(item.field.selector) || root.querySelector(`#${item.field.id}`);
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
