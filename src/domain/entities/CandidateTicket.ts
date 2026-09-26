import { Money } from '../value-objects/Money';

/**
 * Represents an observable available ticket category/seat on the page.
 */
export interface CandidateTicket {
  readonly id: string;
  readonly categoryName: string;
  readonly price: Money;
  readonly availableQuantity: number;
  readonly section?: string;
  readonly seatNumber?: string;
  readonly isAvailable: boolean;
}
