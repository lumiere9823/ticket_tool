import { PurchaseState } from '../states/PurchaseState';

export enum HumanInterventionStatus {
  PENDING = 'PENDING',
  USER_ACTION = 'USER_ACTION',
  RESOLVED = 'RESOLVED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export interface HumanInterventionRecordProps {
  id: string;
  accountId: string;
  profileId?: string | undefined;
  eventId: string;
  workflowId: string;
  state: PurchaseState;
  reason: string;
  detectedAt: string;
  notificationSentAt?: string | undefined;
  userActionAt?: string | undefined;
  resolvedAt?: string | undefined;
  previousState: PurchaseState;
  nextState?: PurchaseState | undefined;
  status: HumanInterventionStatus;
  [key: string]: unknown;
}

/**
 * Human Intervention Record tracking paused automation awaiting user interaction.
 * Defined in docs/ticketbox/04-state-machine.md Section 27 and docs/ticketbox/08-security-and-compliance.md Section 8.
 */
export class HumanInterventionRecord {
  public readonly id: string;
  public readonly accountId: string;
  public readonly profileId?: string | undefined;
  public readonly eventId: string;
  public readonly workflowId: string;
  public readonly state: PurchaseState;
  public readonly reason: string;
  public readonly detectedAt: string;
  public notificationSentAt?: string | undefined;
  public userActionAt?: string | undefined;
  public resolvedAt?: string | undefined;
  public readonly previousState: PurchaseState;
  public nextState?: PurchaseState | undefined;
  private _status: HumanInterventionStatus;

  constructor(props: HumanInterventionRecordProps) {
    this.id = props.id;
    this.accountId = props.accountId;
    this.profileId = props.profileId;
    this.eventId = props.eventId;
    this.workflowId = props.workflowId;
    this.state = props.state;
    this.reason = props.reason;
    this.detectedAt = props.detectedAt;
    this.notificationSentAt = props.notificationSentAt;
    this.userActionAt = props.userActionAt;
    this.resolvedAt = props.resolvedAt;
    this.previousState = props.previousState;
    this.nextState = props.nextState;
    this._status = props.status;
  }

  public get status(): HumanInterventionStatus {
    return this._status;
  }

  public markNotificationSent(timestamp = new Date().toISOString()): void {
    this.notificationSentAt = timestamp;
  }

  public markUserAction(timestamp = new Date().toISOString()): void {
    this.userActionAt = timestamp;
    this._status = HumanInterventionStatus.USER_ACTION;
  }

  public resolve(nextState: PurchaseState, timestamp = new Date().toISOString()): void {
    this.nextState = nextState;
    this.resolvedAt = timestamp;
    this._status = HumanInterventionStatus.RESOLVED;
  }

  public cancel(timestamp = new Date().toISOString()): void {
    this.resolvedAt = timestamp;
    this._status = HumanInterventionStatus.CANCELLED;
  }

  public toJSON(): HumanInterventionRecordProps {
    return {
      id: this.id,
      accountId: this.accountId,
      ...(this.profileId ? { profileId: this.profileId } : {}),
      eventId: this.eventId,
      workflowId: this.workflowId,
      state: this.state,
      reason: this.reason,
      detectedAt: this.detectedAt,
      ...(this.notificationSentAt ? { notificationSentAt: this.notificationSentAt } : {}),
      ...(this.userActionAt ? { userActionAt: this.userActionAt } : {}),
      ...(this.resolvedAt ? { resolvedAt: this.resolvedAt } : {}),
      previousState: this.previousState,
      ...(this.nextState ? { nextState: this.nextState } : {}),
      status: this._status,
    };
  }
}
