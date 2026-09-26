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
        'TBD: Reservation request implementation is pending verified Ticketbox network evidence',
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
}
