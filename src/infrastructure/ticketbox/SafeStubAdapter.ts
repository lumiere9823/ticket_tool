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

/**
 * Explicit TBD / NotImplemented adapter implementation.
 * Enforces Rule 02 ("Never Invent Ticketbox APIs") and Rule 03 ("Evidence Before Implementation").
 */
export class SafeStubAdapter implements TicketboxPageAdapter {
  constructor(private readonly logger?: LoggerPort) {}

  public async getEventState(): Promise<PageEventState> {
    this.logger?.debug('SafeStubAdapter: getEventState called (TBD)');
    return {
      event: null,
      isEventReady: false,
      pageUrl: typeof window !== 'undefined' ? window.location.href : 'unknown',
    };
  }

  public async getInventoryState(): Promise<PageInventoryState> {
    this.logger?.debug('SafeStubAdapter: getInventoryState called (TBD)');
    return {
      candidates: [],
      isAvailable: false,
      observedAt: new Date().toISOString(),
      isAuthoritativeT0: false,
    };
  }

  public async getSelectionState(): Promise<PageSelectionState> {
    this.logger?.debug('SafeStubAdapter: getSelectionState called (TBD)');
    return {
      selectedTicket: null,
      isSelectedInUi: false,
    };
  }

  public async selectTicket(candidateId: string, quantity: number): Promise<boolean> {
    this.logger?.warn(
      'SafeStubAdapter: selectTicket rejected — DOM interaction requires verified discovery evidence',
      {
        candidateId,
        quantity,
      }
    );
    return false;
  }

  public async submitReservation(
    candidate: CandidateTicket,
    quantity: number
  ): Promise<PageReservationResult> {
    this.logger?.warn(
      'SafeStubAdapter: submitReservation rejected — Reservation request requires verified discovery evidence',
      {
        candidateId: candidate.id,
        quantity,
      }
    );
    return {
      isConfirmed: false,
      errorMessage:
        'BLOCKED_BY_DISCOVERY: Reservation request implementation is pending verified Ticketbox network evidence',
    };
  }

  public async getReservationState(): Promise<Reservation | null> {
    this.logger?.debug('SafeStubAdapter: getReservationState called (TBD)');
    return null;
  }

  public async getCheckoutState(): Promise<PageCheckoutState> {
    this.logger?.debug('SafeStubAdapter: getCheckoutState called (TBD)');
    return {
      isInCheckout: false,
    };
  }

  public async detectPage(): Promise<
    import('../../domain/entities/EventCatalog').TicketboxPageType
  > {
    return 'UNKNOWN';
  }

  public async discoverEvent(): Promise<import('../../domain/entities/Event').Event | null> {
    return null;
  }

  public async discoverShowings(): Promise<
    import('../../domain/entities/EventCatalog').ShowingSnapshot[]
  > {
    return [];
  }

  public async discoverTicketCatalog(
    showingId?: string | null
  ): Promise<import('../../domain/entities/EventCatalog').EventCatalog> {
    this.logger?.debug('SafeStubAdapter: discoverTicketCatalog called (TBD)', { showingId });
    return {
      eventId: null,
      eventTitle: null,
      eventUrl: '',
      showings: [],
    };
  }

  public async revalidateTicket(
    _candidate: import('../../domain/entities/EventCatalog').TicketCandidate
  ): Promise<{ isValid: boolean; reason?: string }> {
    return {
      isValid: false,
      reason: 'BLOCKED_BY_DISCOVERY: Safe stub does not perform live booking revalidation',
    };
  }

  public async selectQuantity(
    ticket: import('../../domain/entities/EventCatalog').TicketType,
    quantity: number
  ): Promise<boolean> {
    this.logger?.warn('SafeStubAdapter: selectQuantity rejected (BLOCKED_BY_DISCOVERY)', {
      ticketName: ticket.name,
      quantity,
    });
    return false;
  }

  public async detectSeatMap(): Promise<{ hasSeatMap: boolean; zones?: string[] }> {
    return { hasSeatMap: false };
  }

  public async selectSeats(selection: { zoneId?: string; seatIds: string[] }): Promise<boolean> {
    this.logger?.warn('SafeStubAdapter: selectSeats rejected (BLOCKED_BY_DISCOVERY)', selection);
    return false;
  }
}
