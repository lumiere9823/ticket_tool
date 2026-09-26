import { CandidateTicket } from './CandidateTicket';

export type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'EXPIRED' | 'FAILED' | 'CANCELLED';

export interface ReservationProps {
  id: string;
  accountId?: string | undefined;
  eventId: string;
  candidate: CandidateTicket;
  quantity: number;
  status: ReservationStatus;
  createdAt: string;
  expiresAt?: string | undefined;
  checkoutReference?: string | undefined;
}

/**
 * Domain entity representing a server-confirmed reservation.
 * Strictly implements docs/ticketbox/05-reservation-boundary.md
 */
export class Reservation {
  public readonly id: string;
  public readonly accountId?: string | undefined;
  public readonly eventId: string;
  public readonly candidate: CandidateTicket;
  public readonly quantity: number;
  private _status: ReservationStatus;
  public readonly createdAt: string;
  public readonly expiresAt?: string | undefined;
  public readonly checkoutReference?: string | undefined;

  constructor(props: ReservationProps) {
    if (!props.id.trim()) {
      throw new Error('Reservation requires an authoritative server identifier');
    }
    if (!props.eventId.trim()) {
      throw new Error('Reservation requires a valid event ID');
    }
    if (props.quantity <= 0) {
      throw new Error('Reservation quantity must be greater than zero');
    }

    this.id = props.id;
    this.accountId = props.accountId;
    this.eventId = props.eventId;
    this.candidate = props.candidate;
    this.quantity = props.quantity;
    this._status = props.status;
    this.createdAt = props.createdAt;
    this.expiresAt = props.expiresAt;
    this.checkoutReference = props.checkoutReference;
  }

  public get status(): ReservationStatus {
    return this._status;
  }

  public isConfirmed(): boolean {
    return this._status === 'CONFIRMED';
  }

  public isExpired(): boolean {
    if (this._status === 'EXPIRED') return true;
    if (!this.expiresAt) return false;
    return new Date(this.expiresAt).getTime() <= Date.now();
  }

  public markExpired(): void {
    this._status = 'EXPIRED';
  }
}
