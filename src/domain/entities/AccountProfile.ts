import { ProfileId } from '../value-objects/ProfileId';
import { PurchaseState } from '../states/PurchaseState';
import { TicketPreference } from './TicketPreference';

export interface EventAssignment {
  readonly eventId: string;
  readonly eventUrl: string;
  readonly preferences: TicketPreference;
}

export interface AccountContext {
  readonly profileId: ProfileId;
  readonly accountId: string;
  readonly displayName: string;
  readonly assignedEvent?: EventAssignment;
}

/**
 * Domain entity representing an isolated Account Profile.
 * Strictly enforces Profile Isolation (ADR-003).
 */
export class AccountProfile {
  public readonly profileId: ProfileId;
  public readonly accountId: string;
  public readonly displayName: string;
  private _status: PurchaseState;
  private _assignedEvent?: EventAssignment;

  constructor(
    profileId: ProfileId,
    accountId: string,
    displayName: string,
    initialStatus: PurchaseState = PurchaseState.INIT
  ) {
    if (!accountId.trim()) {
      throw new Error('AccountId cannot be empty');
    }
    this.profileId = profileId;
    this.accountId = accountId;
    this.displayName = displayName;
    this._status = initialStatus;
  }

  public get status(): PurchaseState {
    return this._status;
  }

  public setStatus(status: PurchaseState): void {
    this._status = status;
  }

  public get assignedEvent(): EventAssignment | undefined {
    return this._assignedEvent;
  }

  public assignEvent(assignment: EventAssignment): void {
    this._assignedEvent = assignment;
  }

  public toContext(): AccountContext {
    return {
      profileId: this.profileId,
      accountId: this.accountId,
      displayName: this.displayName,
      ...(this._assignedEvent ? { assignedEvent: this._assignedEvent } : {}),
    };
  }
}
