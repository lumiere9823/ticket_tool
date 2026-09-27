import {
  TicketboxPageAdapter,
  PageEventState,
  PageInventoryState,
  PageSelectionState,
  PageReservationResult,
  PageCheckoutState,
} from '../../application/ports/TicketboxPageAdapter';
import { CandidateTicket } from '../../domain/entities/CandidateTicket';
import { Reservation } from '../../domain/entities/Reservation';
import { LoggerPort } from '../../application/ports/LoggerPort';
import { Event } from '../../domain/entities/Event';
import { DiscoverySanitizer } from '../../domain/policies/DiscoverySanitizer';

export interface StructuredDiscoveryEvidence {
  observation: string;
  evidence: {
    pageUrl: string;
    documentTitle: string;
    detectedElements: Record<string, number | boolean | string>;
    timestamp: string;
  };
  interpretation: string;
  confidence: 'VERIFIED' | 'OBSERVED' | 'HYPOTHESIS' | 'TBD';
  implementationConsequence: string;
}

/**
 * Passive, safe discovery adapter for exploring the Ticketbox application.
 * Gathers page metadata and logs structured evidence without attempting automated clicks.
 * Enforces Phase 8 & Security Rule 10/11 (zero credential/session collection).
 */
export class TicketboxDiscoveryAdapter implements TicketboxPageAdapter {
  private readonly evidenceLog: StructuredDiscoveryEvidence[] = [];

  constructor(private readonly logger?: LoggerPort) {}

  public getEvidenceLog(): readonly StructuredDiscoveryEvidence[] {
    return this.evidenceLog;
  }

  public async getEventState(): Promise<PageEventState> {
    const pageUrl =
      typeof window !== 'undefined' ? window.location.href : 'http://localhost/discovery';
    const title = typeof document !== 'undefined' ? document.title : 'Discovery Event Page';

    const evidence: StructuredDiscoveryEvidence = {
      observation: 'Observed Ticketbox event page header and title',
      evidence: {
        pageUrl: DiscoverySanitizer.sanitizeUrl(pageUrl),
        documentTitle: title,
        detectedElements: {
          hasEventContainer:
            typeof document !== 'undefined' &&
            !!document.querySelector('main, article, [role="main"]'),
        },
        timestamp: new Date().toISOString(),
      },
      interpretation: 'Event page is loaded in the browser DOM',
      confidence: 'OBSERVED',
      implementationConsequence:
        'Event ready state can be inferred once authoritative selector is confirmed',
    };

    this.recordEvidence(evidence);

    const event = new Event({
      id: 'discovered_event',
      name: title,
      url: pageUrl,
      status: 'ON_SALE',
    });

    return {
      event,
      isEventReady: true,
      pageUrl,
    };
  }

  public async getInventoryState(): Promise<PageInventoryState> {
    const pageUrl =
      typeof window !== 'undefined' ? window.location.href : 'http://localhost/discovery';

    const evidence: StructuredDiscoveryEvidence = {
      observation: 'Scanning DOM for visible ticket tier elements in discovery mode',
      evidence: {
        pageUrl: DiscoverySanitizer.sanitizeUrl(pageUrl),
        documentTitle: typeof document !== 'undefined' ? document.title : '',
        detectedElements: {
          buttonsCount:
            typeof document !== 'undefined' ? document.querySelectorAll('button').length : 0,
        },
        timestamp: new Date().toISOString(),
      },
      interpretation: 'Passive DOM scan completed without mutation',
      confidence: 'TBD',
      implementationConsequence:
        'Real inventory state requires verifying Ticketbox inventory network endpoint or confirmed DOM selector',
    };

    this.recordEvidence(evidence);

    return {
      candidates: [],
      isAvailable: false,
      observedAt: new Date().toISOString(),
      isAuthoritativeT0: false,
    };
  }

  public async getSelectionState(): Promise<PageSelectionState> {
    return {
      selectedTicket: null,
      isSelectedInUi: false,
    };
  }

  public async selectTicket(candidateId: string, quantity: number): Promise<boolean> {
    this.logger?.info('Discovery mode: logged selection intent (no automated action performed)', {
      candidateId,
      quantity,
    });
    return false;
  }

  public async submitReservation(
    candidate: CandidateTicket,
    quantity: number
  ): Promise<PageReservationResult> {
    this.logger?.warn(
      'TicketboxDiscoveryAdapter: submitReservation rejected — Discovery mode cannot dispatch purchase requests',
      {
        candidateId: candidate.id,
        quantity,
      }
    );
    return {
      isConfirmed: false,
      errorMessage:
        'BLOCKED_BY_DISCOVERY: Discovery Mode — automated purchase dispatch is disabled until network evidence is verified',
    };
  }

  public async getReservationState(): Promise<Reservation | null> {
    return null;
  }

  public async getCheckoutState(): Promise<PageCheckoutState> {
    const pageUrl = typeof window !== 'undefined' ? window.location.href : '';
    const sanitizedUrl = DiscoverySanitizer.sanitizeUrl(pageUrl);
    const isInCheckout = sanitizedUrl.includes('/checkout') || sanitizedUrl.includes('/payment');

    return {
      isInCheckout,
      checkoutUrl: sanitizedUrl,
    };
  }

  public async detectPage(): Promise<
    import('../../domain/entities/EventCatalog').TicketboxPageType
  > {
    const pageUrl = typeof window !== 'undefined' ? window.location.href : '';
    const root =
      typeof document !== 'undefined'
        ? (await import('./parsing/DOMElementLike')).wrapBrowserElement(document)
        : undefined;

    const { TicketboxCatalogParser } = await import('./parsing/TicketboxCatalogParser');
    return TicketboxCatalogParser.detectPageType(pageUrl, root);
  }

  public async discoverEvent(): Promise<Event | null> {
    const state = await this.getEventState();
    return state.event;
  }

  public async discoverShowings(): Promise<
    import('../../domain/entities/EventCatalog').ShowingSnapshot[]
  > {
    const catalog = await this.discoverTicketCatalog();
    return catalog.showings;
  }

  public async discoverTicketCatalog(
    showingId?: string | null
  ): Promise<import('../../domain/entities/EventCatalog').EventCatalog> {
    const pageUrl = typeof window !== 'undefined' ? window.location.href : '';
    const sanitizedUrl = DiscoverySanitizer.sanitizeUrl(pageUrl);

    if (typeof document !== 'undefined') {
      const { wrapBrowserElement } = await import('./parsing/DOMElementLike');
      const { TicketboxCatalogParser } = await import('./parsing/TicketboxCatalogParser');
      const root = wrapBrowserElement(document);
      const catalog = TicketboxCatalogParser.parseCatalog(root, sanitizedUrl);

      if (showingId) {
        return {
          ...catalog,
          showings: catalog.showings.filter((s) => s.id === showingId),
        };
      }
      return catalog;
    }

    return {
      eventId: null,
      eventTitle: null,
      eventUrl: sanitizedUrl,
      showings: [],
    };
  }

  public async revalidateTicket(
    candidate: import('../../domain/entities/EventCatalog').TicketCandidate
  ): Promise<{ isValid: boolean; reason?: string }> {
    const catalog = await this.discoverTicketCatalog();
    const matched = catalog.showings
      .flatMap((s) => s.ticketTypes)
      .find((t) => t.name === candidate.ticket.name || (t.id && t.id === candidate.ticket.id));

    if (!matched) {
      return {
        isValid: false,
        reason: 'Ticket category not observed in current catalog',
      };
    }

    if (matched.availability !== 'AVAILABLE' || !matched.selectable) {
      return {
        isValid: false,
        reason: `Ticket category status is '${matched.availability}' and not selectable`,
      };
    }

    return { isValid: true };
  }

  public async selectQuantity(
    ticket: import('../../domain/entities/EventCatalog').TicketType,
    quantity: number
  ): Promise<boolean> {
    this.logger?.warn(
      'TicketboxDiscoveryAdapter: selectQuantity rejected (BLOCKED_BY_DISCOVERY: Discovery mode cannot mutate form state)',
      {
        ticketName: ticket.name,
        quantity,
      }
    );
    return false;
  }

  public async detectSeatMap(): Promise<{ hasSeatMap: boolean; zones?: string[] }> {
    const hasSeatMap =
      typeof document !== 'undefined' &&
      !!document.querySelector('.seat-map, #seat-map, svg.seatmap, [data-seatmap]');

    return { hasSeatMap };
  }

  public async selectSeats(selection: { zoneId?: string; seatIds: string[] }): Promise<boolean> {
    this.logger?.warn(
      'TicketboxDiscoveryAdapter: selectSeats rejected (BLOCKED_BY_DISCOVERY: Discovery mode cannot select seats)',
      selection
    );
    return false;
  }

  private recordEvidence(item: StructuredDiscoveryEvidence): void {
    this.evidenceLog.push(item);
    this.logger?.info(`[DISCOVERY] ${item.observation}`, {
      confidence: item.confidence,
      consequence: item.implementationConsequence,
    });
  }
}
