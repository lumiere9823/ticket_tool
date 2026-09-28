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

import {
  EventCatalog,
  ShowingSnapshot,
  TicketCandidate,
  TicketType,
  TicketboxPageType,
} from '../../domain/entities/EventCatalog';

/**
 * Port representing interaction with the Ticketbox web application page.
 * Isolates all DOM, scraping, and reverse-engineered network logic.
 */
export interface TicketboxPageAdapter {
  // Existing methods preserved for backward compatibility
  getEventState(): Promise<PageEventState>;
  getInventoryState(): Promise<PageInventoryState>;
  getSelectionState(): Promise<PageSelectionState>;
  selectTicket(candidateId: string, quantity: number): Promise<boolean>;
  submitReservation(candidate: CandidateTicket, quantity: number): Promise<PageReservationResult>;
  getReservationState(): Promise<Reservation | null>;
  getCheckoutState(): Promise<PageCheckoutState>;

  // Extended catalog discovery and verification methods
  detectPage(): Promise<TicketboxPageType>;
  discoverEvent(): Promise<Event | null>;
  discoverShowings(): Promise<ShowingSnapshot[]>;
  discoverTicketCatalog(showingId?: string | null): Promise<EventCatalog>;
  revalidateTicket(candidate: TicketCandidate): Promise<{ isValid: boolean; reason?: string }>;
  selectQuantity(ticket: TicketType, quantity: number): Promise<boolean>;
  detectSeatMap(): Promise<{ hasSeatMap: boolean; zones?: string[] }>;
  selectSeats(selection: { zoneId?: string; seatIds: string[] }): Promise<boolean>;

  // Complete Booking Journey Port Methods
  discoverJourneyTickets?(): Promise<
    import('../../domain/entities/BookingJourneyModels').JourneyTicketType[]
  >;
  discoverAreas?(): Promise<import('../../domain/entities/BookingJourneyModels').SeatArea[]>;
  discoverSeats?(
    areaId?: string
  ): Promise<import('../../domain/entities/BookingJourneyModels').Seat[]>;
  selectArea?(areaId: string): Promise<boolean>;
  selectSpecificSeats?(seatIds: string[]): Promise<boolean>;
  getBookingSummary?(): Promise<
    import('../../domain/entities/BookingJourneyModels').BookingSummary | null
  >;
  getFormSchema?(): Promise<import('../../domain/entities/BookingJourneyModels').FormSchema | null>;
  fillAttendeeForm?(
    profile: import('../../domain/entities/BookingJourneyModels').UserProfileData
  ): Promise<{
    allSatisfied: boolean;
    missingFields: string[];
    isConsentBlocked: boolean;
  }>;
  proceedToNextStep?(): Promise<boolean>;
  isNavigationPending?(): boolean;
}
