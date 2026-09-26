import { CandidateTicket } from '../../domain/entities/CandidateTicket';
import { Event } from '../../domain/entities/Event';
import { Reservation } from '../../domain/entities/Reservation';

export interface PageEventState {
  event: Event | null;
  isEventReady: boolean;
  pageUrl: string;
}

export interface PageInventoryState {
  candidates: CandidateTicket[];
  isAvailable: boolean;
  observedAt: string;
  isAuthoritativeT0: boolean;
}

export interface PageSelectionState {
  selectedTicket: CandidateTicket | null;
  isSelectedInUi: boolean;
}

export interface PageReservationResult {
  isConfirmed: boolean;
  reservationId?: string;
  expiresAt?: string;
  errorMessage?: string;
}

export interface PageCheckoutState {
  isInCheckout: boolean;
  checkoutUrl?: string;
  orderReference?: string;
}

/**
 * Port representing interaction with the Ticketbox web application page.
 * Isolates all DOM, scraping, and reverse-engineered network logic.
 */
export interface TicketboxPageAdapter {
  getEventState(): Promise<PageEventState>;
  getInventoryState(): Promise<PageInventoryState>;
  getSelectionState(): Promise<PageSelectionState>;
  selectTicket(candidateId: string, quantity: number): Promise<boolean>;
  submitReservation(candidate: CandidateTicket, quantity: number): Promise<PageReservationResult>;
  getReservationState(): Promise<Reservation | null>;
  getCheckoutState(): Promise<PageCheckoutState>;
}
