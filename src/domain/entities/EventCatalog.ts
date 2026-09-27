/**
 * Normalized Event Ticket Catalog Domain Models.
 * Strictly separates passive catalog discovery from purchase execution.
 * Enforces Phase 8 Pre-Discovery Hardening & AI Engineering Rules 02, 03, 05.
 */

export type TicketAvailability = 'AVAILABLE' | 'SOLD_OUT' | 'NOT_STARTED' | 'CLOSED' | 'UNKNOWN';

export type TicketMode = 'STANDING' | 'SEATED' | 'ZONE' | 'UNKNOWN';

export interface TicketTypePrice {
  amount: number;
  currency: 'VND';
}

export interface TicketTypeSource {
  page: 'EVENT' | 'BOOKING';
  evidence: string[];
}

export interface TicketType {
  id: string | null;
  name: string;

  price: TicketTypePrice;

  mode: TicketMode;

  availability: TicketAvailability;

  minQuantity: number | null;
  maxQuantity: number | null;

  selectedQuantity: number;

  selectable: boolean;

  source: TicketTypeSource;

  rawLabel?: string | undefined;
}

export interface ShowingSnapshot {
  id: string | null;
  name: string | null;
  date: string | null;
  ticketTypes: TicketType[];
}

export interface EventCatalog {
  eventId: string | null;
  eventTitle: string | null;
  eventUrl: string;
  showings: ShowingSnapshot[];
}

export interface TicketCandidate {
  ticket: TicketType;

  requestedQuantity: number;

  priority: number;

  availability: TicketAvailability;

  canAttemptSelection: boolean;

  rejectionReasons: string[];
}

export type TicketboxPageType =
  'EVENT' | 'SHOWING_SELECTION' | 'TICKET_SELECTION' | 'QUESTION_FORM' | 'CHECKOUT' | 'UNKNOWN';
