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
import { ScopedPurchasePlan } from '../../domain/entities/ScopedPurchasePlan';
import { DOMElementLike, wrapBrowserElement } from './parsing/DOMElementLike';

import { TicketboxCatalogParser } from './parsing/TicketboxCatalogParser';
import { SeatmapApiResponse } from './parsing/TicketboxSeatMapParser';
import { TicketboxSummaryParser } from './parsing/TicketboxSummaryParser';
import { PurchaseState } from '../../domain/states/PurchaseState';

import {
  CancelOrderConfirmationResult,
  MAX_SEAT_SET_SIZE,
  addBoundedSetItem,
  TicketboxEventApiResponse,
  TicketboxQuestionFormApiResponse,
  TicketboxQuestionItem,
  TicketboxQuestionOption,
  TicketboxShowingApiResponse,
  TicketboxShowingApiTicket,
} from './types/TicketboxApiTypes';
import { TicketboxApiClient } from './client/TicketboxApiClient';
import { TicketboxModalHandler } from './modal/TicketboxModalHandler';
import { TicketboxCatalogAdapter } from './catalog/TicketboxCatalogAdapter';
import { TicketboxSeatmapAdapter } from './seatmap/TicketboxSeatmapAdapter';
import { TicketboxFormAdapter } from './form/TicketboxFormAdapter';
import { TicketboxNavigationAdapter } from './navigation/TicketboxNavigationAdapter';
import { TicketboxCatalogDiscovery } from './catalog/TicketboxCatalogDiscovery';
import { SeatBlacklistManager } from './seatmap/SeatBlacklistManager';
import { PageBridgeClient } from './bridge/PageBridgeClient';
import { dispatchSyntheticClick } from './dom/DOMEventHelpers';

export {
  CancelOrderConfirmationResult,
  MAX_SEAT_SET_SIZE,
  addBoundedSetItem,
  TicketboxEventApiResponse,
  TicketboxQuestionFormApiResponse,
  TicketboxQuestionItem,
  TicketboxQuestionOption,
  TicketboxShowingApiResponse,
  TicketboxShowingApiTicket,
};

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
  public navigationPending = false;
  private scopedPlan?: ScopedPurchasePlan | null = null;
  private recoveryInitiatedAt: number | null = null;
  private customUrl?: string;
  private stateProvider?: () => PurchaseState;

  private logger?: LoggerPort;
  private apiClient: TicketboxApiClient;
  private bridgeClient: PageBridgeClient;
  private blacklistManager: SeatBlacklistManager;
  private modalHandler: TicketboxModalHandler;
  private catalogAdapter: TicketboxCatalogAdapter;
  private seatmapAdapter: TicketboxSeatmapAdapter;
  private formAdapter: TicketboxFormAdapter;
  private navigationAdapter: TicketboxNavigationAdapter;
  private catalogDiscovery: TicketboxCatalogDiscovery;

  constructor(
    firstArg?: LoggerPort | DOMElementLike | Document | Element,
    secondArg?: DOMElementLike | Document | Element | LoggerPort
  ) {
    let resolvedLogger: LoggerPort | undefined;
    let resolvedRoot: DOMElementLike | Document | Element | undefined;

    const isDOM = (arg: unknown): boolean =>
      !!arg &&
      typeof arg === 'object' &&
      ('querySelector' in arg || 'tagName' in arg || 'attributes' in arg || 'nodeType' in arg);

    const isLog = (arg: unknown): boolean =>
      !!arg &&
      typeof arg === 'object' &&
      typeof (arg as LoggerPort).info === 'function';

    if (isDOM(firstArg)) {
      resolvedRoot = firstArg as DOMElementLike | Document | Element;
      resolvedLogger = isLog(secondArg) ? (secondArg as LoggerPort) : undefined;
    } else if (isDOM(secondArg)) {
      resolvedRoot = secondArg as DOMElementLike | Document | Element;
      resolvedLogger = isLog(firstArg) ? (firstArg as LoggerPort) : undefined;
    } else {
      resolvedLogger = isLog(firstArg) ? (firstArg as LoggerPort) : undefined;
    }

    this.logger = resolvedLogger;
    if (resolvedRoot) {
      this.setRoot(resolvedRoot);
    }

    this.apiClient = new TicketboxApiClient(this.logger);
    this.bridgeClient = new PageBridgeClient(this.logger);
    this.blacklistManager = new SeatBlacklistManager(this.logger);

    this.seatmapAdapter = new TicketboxSeatmapAdapter(
      {
        getRoot: () => this.getRoot(),
        getShowingId: () => this.getShowingId(),
        getCachedSeatmapData: () => this.apiClient.getCachedSeatmapData(),
        fetchSeatmapApi: (id) => this.apiClient.fetchSeatmapApi(id),
        getCachedShowingApiData: () => this.apiClient.getCachedShowingApiData(),
        isSeatBlacklisted: (seat) => this.isSeatBlacklisted(seat),
        blacklistSeat: (seat) => this.blacklistSeat(seat),
        sendPageBridgeRequest: (act, pay, to) => this.sendPageBridgeRequest(act, pay, to),
        clickElement: (el) => this.clickElement(el),
        invalidateSeatmapCache: () => this.apiClient.invalidateSeatmapCache(),
      },
      this.logger
    );

    this.modalHandler = new TicketboxModalHandler(
      {
        getRoot: () => this.getRoot(),
        getPageUrl: () => this.getPageUrl(),
        getCurrentState: () => (this.stateProvider ? this.stateProvider() : undefined),
        getRecoveryInitiatedAt: () => this.recoveryInitiatedAt,
        markRecoveryInitiated: () => this.markRecoveryInitiated(),
        clearRecoveryInitiated: () => {
          this.recoveryInitiatedAt = null;
        },
        blacklistSeat: (seat) => this.blacklistSeat(seat),
        deselectSeat: (label) => this.deselectSeat(label),
        invalidateSeatmapCache: () => this.apiClient.invalidateSeatmapCache(),
        getSelectedSeatIds: () => this.seatmapAdapter.getSelectedSeatIds(),
        clickElement: (el) => this.clickElement(el),
      },
      this.logger
    );

    this.catalogAdapter = new TicketboxCatalogAdapter(
      {
        getRoot: () => this.getRoot(),
        getPageUrl: () => this.getPageUrl(),
        getShowingId: () => this.getShowingId(),
        getCachedEventApiData: () => this.apiClient.getCachedEventApiData(),
        getScopedPlan: () => this.scopedPlan,
        sendPageBridgeRequest: (act, pay, to) => this.sendPageBridgeRequest(act, pay, to),
        clickElement: (el) => this.clickElement(el),
        findSeatmapSvg: () => this.seatmapAdapter.findSeatmapSvg(),
      },
      this.logger
    );

    this.formAdapter = new TicketboxFormAdapter(
      {
        getRoot: () => this.getRoot(),
        getEventId: () => this.getEventId(),
        ensureQuestionFormCached: (eventId) => this.apiClient.fetchQuestionFormApi(eventId),
        getFormSchema: () => this.getFormSchema(),
      },
      this.logger
    );

    this.navigationAdapter = new TicketboxNavigationAdapter(
      {
        getRoot: () => this.getRoot(),
        getPageUrl: () => this.getPageUrl(),
        clickElement: (el) => this.clickElement(el),
        isElementDisabled: (el) => this.catalogAdapter.isElementDisabled(el),
        setNavigationPending: (pending) => {
          this.navigationPending = pending;
        },
      },
      this.logger
    );

    this.catalogDiscovery = new TicketboxCatalogDiscovery(
      {
        getRoot: () => this.getRoot(),
        getPageUrl: () => this.getPageUrl(),
        getShowingId: () => this.getShowingId(),
        getEventId: () => this.getEventId(),
        apiClient: this.apiClient,
        getScopedPlan: () => this.scopedPlan,
        clickElement: (el) => this.clickElement(el),
      },
      this.logger
    );
  }

  public markRecoveryInitiated(): void {
    this.recoveryInitiatedAt = Date.now();
    this.logger?.info(
      'Assistant recovery initiated (window <= 5000ms for cancel order confirmation)'
    );
  }

  public setCustomUrl(url: string): void {
    this.customUrl = url;
  }

  public getBridgeNonce(): string {
    return this.bridgeClient.getBridgeNonce();
  }

  public setBridgeNonce(nonce: string): void {
    this.bridgeClient.setBridgeNonce(nonce);
  }

  public setCurrentStateProvider(provider: () => PurchaseState): void {
    this.stateProvider = provider;
  }

  public getPageUrl(): string {
    if (this.customUrl) return this.customUrl;
    if (typeof window !== 'undefined' && window.location?.href) {
      return window.location.href;
    }
    return '';
  }

  public blacklistSeat(seatIdOrLabel: string): void {
    this.blacklistManager.blacklistSeat(seatIdOrLabel);
  }

  public isSeatBlacklisted(seatIdOrLabel?: string | null): boolean {
    return this.blacklistManager.isSeatBlacklisted(seatIdOrLabel);
  }

  public getBlacklistedSeats(): Set<string> {
    return this.blacklistManager.getBlacklistedSeats();
  }

  public setAllowedShowingIds(ids: string[] | null): void {
    this.apiClient.setAllowedShowingIds(ids ? new Set(ids) : null);
  }

  public setScopedPlan(plan: ScopedPurchasePlan | null): void {
    this.scopedPlan = plan;
  }

  public getRoot(): DOMElementLike | null {
    if (this.customRoot) return this.customRoot;
    if (typeof document !== 'undefined') {
      return wrapBrowserElement(document.body || document.documentElement);
    }
    return null;
  }

  public setRoot(root: DOMElementLike | Document | Element): void {
    if ('tagName' in root && typeof (root as DOMElementLike).querySelector === 'function') {
      this.customRoot = root as DOMElementLike;
    } else {
      this.customRoot = wrapBrowserElement(root as Element | Document);
    }
  }

  public get cachedSeatmapData(): SeatmapApiResponse | null {
    return this.apiClient.getCachedSeatmapData();
  }

  public set cachedSeatmapData(data: SeatmapApiResponse | null) {
    this.apiClient.setCachedSeatmapData(data);
  }

  public setSeatmapData(data: SeatmapApiResponse | null): void {
    this.apiClient.setCachedSeatmapData(data);
  }

  public setShowingData(data: TicketboxShowingApiResponse | null): void {
    this.apiClient.setCachedShowingApiData(data);
  }

  public isNavigationPending(): boolean {
    return this.navigationPending;
  }

  public getShowingId(): string | null {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const root = this.getRoot();
    return TicketboxCatalogParser.extractShowingId(url, root);
  }

  private getEventId(): string | null {
    const url = this.getPageUrl();
    const root = this.getRoot();
    const baseCatalog = root ? TicketboxCatalogParser.parseCatalog(root, url) : null;
    return (
      baseCatalog?.eventId ||
      url.match(/events\/(\d+)/)?.[1] ||
      url.match(/-(\d+)(?:\?|$)/)?.[1] ||
      null
    );
  }

  public async fetchSeatmapApi(showingId: string): Promise<SeatmapApiResponse | null> {
    return this.apiClient.fetchSeatmapApi(showingId);
  }

  public async fetchShowingApi(showingId: string): Promise<TicketboxShowingApiResponse | null> {
    return this.apiClient.fetchShowingApi(showingId);
  }

  public async fetchEventApi(eventId: string): Promise<TicketboxEventApiResponse | null> {
    return this.apiClient.fetchEventApi(eventId);
  }

  public async fetchQuestionFormApi(
    eventId: string
  ): Promise<TicketboxQuestionFormApiResponse | null> {
    return this.apiClient.fetchQuestionFormApi(eventId);
  }

  public async sendPageBridgeRequest<T>(
    action: string,
    payload: Record<string, unknown>,
    timeoutMs = 3500
  ): Promise<{ success: boolean; data?: T; error?: string }> {
    return this.bridgeClient.sendPageBridgeRequest(action, payload, timeoutMs);
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

  public async discoverEvent(): Promise<Event | null> {
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
    return this.catalogDiscovery.discoverTicketCatalog(showingId, allowedShowingIds);
  }

  public async revalidateTicket(
    candidate: TicketCandidate
  ): Promise<{ isValid: boolean; reason?: string }> {
    return this.catalogDiscovery.revalidateTicket(candidate);
  }

  public async discoverJourneyTickets(
    targetShowingId?: string | null
  ): Promise<JourneyTicketType[]> {
    return this.catalogDiscovery.discoverJourneyTickets(targetShowingId);
  }

  public async clickCalendarShowingDate(showingId: string | null): Promise<boolean> {
    return this.catalogDiscovery.clickCalendarShowingDate(showingId);
  }

  public async selectTicket(
    candidateId: string,
    quantity: number,
    showingId?: string | null
  ): Promise<boolean> {
    return this.catalogAdapter.selectTicket(candidateId, quantity, showingId);
  }

  public async selectQuantity(ticket: TicketType, quantity: number): Promise<boolean> {
    return this.catalogAdapter.selectQuantity(ticket, quantity);
  }

  public clickElement(btn: DOMElementLike): void {
    const nativeEl = (btn.rawElement || btn) as HTMLElement;

    if (typeof nativeEl.focus === 'function') {
      try {
        nativeEl.focus();
      } catch {
        // ignore
      }
    }

    dispatchSyntheticClick(btn);

    if (typeof window !== 'undefined') {
      const txt = (nativeEl.innerText || nativeEl.textContent || '').trim();
      const id = nativeEl.id ? `#${nativeEl.id}` : '';
      if (id || (txt && txt.length < 50)) {
        this.sendPageBridgeRequest('CLICK_ELEMENT', {
          selector: id || undefined,
          text: txt || undefined,
        }).catch(() => {});
      }
    }
  }

  public async proceedToNextStep(): Promise<boolean> {
    return this.navigationAdapter.proceedToNextStep();
  }

  public detectCancelOrderModal(): boolean {
    return this.modalHandler.detectCancelOrderModal();
  }

  public async confirmCancelOrderForReselect(): Promise<CancelOrderConfirmationResult> {
    return this.modalHandler.confirmCancelOrderForReselect();
  }

  public async dismissCancelOrderModal(): Promise<boolean> {
    return this.modalHandler.dismissCancelOrderModal();
  }

  public async detectAndHandleErrorModal(): Promise<{
    hasError: boolean;
    isSeatUnavailable: boolean;
    seatLabel?: string | undefined;
  }> {
    return this.modalHandler.detectAndHandleErrorModal();
  }

  public async discoverAreas(): Promise<SeatArea[]> {
    return this.seatmapAdapter.discoverAreas();
  }

  public async selectArea(
    areaId: string,
    areaName?: string | undefined,
    ticketTypeId?: string | undefined,
    coords?:
      | {
          x?: number | undefined;
          y?: number | undefined;
          width?: number | undefined;
          height?: number | undefined;
        }
      | undefined
  ): Promise<boolean> {
    return this.seatmapAdapter.selectArea(areaId, areaName, ticketTypeId, coords);
  }

  public async detectSeatMap(): Promise<{ hasSeatMap: boolean; zones?: string[] }> {
    return this.seatmapAdapter.detectSeatMap();
  }

  public async discoverSeats(areaId?: string): Promise<Seat[]> {
    return this.seatmapAdapter.discoverSeats(areaId);
  }

  public async selectSpecificSeats(seatIds: string[]): Promise<boolean> {
    return this.seatmapAdapter.selectSpecificSeats(seatIds);
  }

  public async selectSeats(selection: { zoneId?: string; seatIds: string[] }): Promise<boolean> {
    return this.seatmapAdapter.selectSeats(selection);
  }

  public async deselectSeat(seatLabel?: string): Promise<boolean> {
    return this.seatmapAdapter.deselectSeat(seatLabel);
  }

  public async getBookingSummary(): Promise<BookingSummary | null> {
    const root = this.getRoot();
    if (!root) return null;
    return TicketboxSummaryParser.parseSummary(root);
  }

  public async getFormSchema(): Promise<FormSchema | null> {
    return this.formAdapter.getFormSchema();
  }

  public async fillAttendeeForm(profile: UserProfileData): Promise<{
    allSatisfied: boolean;
    missingFields: string[];
    isConsentBlocked: boolean;
  }> {
    return this.formAdapter.fillAttendeeForm(profile);
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
