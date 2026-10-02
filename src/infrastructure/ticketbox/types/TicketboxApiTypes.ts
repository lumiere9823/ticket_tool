/**
 * Ticketbox API and Journey Data Types
 */

import { DOMElementLike } from '../parsing/DOMElementLike';

export const MAX_SEAT_SET_SIZE = 500;

export function addBoundedSetItem<T>(
  set: Set<T>,
  item: T,
  maxSize: number = MAX_SEAT_SET_SIZE
): void {
  if (set.has(item)) {
    return;
  }
  while (set.size >= maxSize) {
    const oldest = set.values().next().value;
    if (oldest !== undefined) {
      set.delete(oldest);
    } else {
      break;
    }
  }
  set.add(item);
}

export type CancelOrderConfirmationResult =
  { status: 'confirmed' } | { status: 'blocked'; reason: string } | { status: 'not_found' };

/**
 * Internal typed interface for DOM elements that support mutations (click, value assignment).
 * Used to avoid `any` casts when interacting with DOMElementLike in the journey adapter.
 */
export interface MutableDOMElement extends DOMElementLike {
  click?: () => void;
  value?: string;
  attributes: Record<string, string>;
}

/** Shape of the /gin/api/v2/events/{id} response */
export interface TicketboxEventApiShowingTicket {
  id: number;
  name: string;
  price: number;
  status: string;
  maxQtyPerOrder: number;
  minQtyPerOrder: number;
}

export interface TicketboxEventApiShowing {
  id: number;
  status: string;
  isSalable: boolean;
  showingTime: string;
  ticketTypes: TicketboxEventApiShowingTicket[];
}

export interface TicketboxEventApiResponse {
  status: number;
  data: {
    result: {
      id: number;
      title: string;
      showings: TicketboxEventApiShowing[];
    };
  };
}

export interface TicketboxShowingApiTicket {
  id: number;
  name: string;
  price: number;
  status: string; // 'book_now' | 'sold_out'
  minQtyPerOrder: number;
  maxQtyPerOrder: number;
  description?: string;
}

export interface TicketboxShowingApiResponse {
  status: number;
  message?: string;
  data: {
    result: {
      id: number;
      status: string;
      seatMapId: number;
      isSalable: boolean;
      showingTime?: string;
      event?: {
        id: number;
        title: string;
        venue?: string;
        address?: string;
      };
      ticketTypes: TicketboxShowingApiTicket[];
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
