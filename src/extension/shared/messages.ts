import { PurchaseState, FailureReason, StateContext } from '../../domain/states/PurchaseState';
import { CandidateTicket } from '../../domain/entities/CandidateTicket';

export type ExtensionMessageType =
  | 'STATE_CHANGED'
  | 'START_MONITORING'
  | 'STOP_REQUESTED'
  | 'AVAILABILITY_DETECTED'
  | 'SELECTION_STARTED'
  | 'RESERVATION_STARTED'
  | 'RESERVATION_CONFIRMED'
  | 'RESERVATION_FAILED'
  | 'PAGE_DISCOVERY_SNAPSHOT'
  | 'SYNC_STATE_REQUEST'
  | 'SYNC_STATE_RESPONSE';

export interface BaseExtensionMessage {
  type: ExtensionMessageType;
  timestamp: string;
  attemptId?: string | undefined;
  state?: PurchaseState | undefined;
}

export interface StateChangedMessage extends BaseExtensionMessage {
  type: 'STATE_CHANGED';
  context: StateContext;
}

export interface StartMonitoringMessage extends BaseExtensionMessage {
  type: 'START_MONITORING';
  eventUrl: string;
  attemptId: string;
}

export interface StopRequestedMessage extends BaseExtensionMessage {
  type: 'STOP_REQUESTED';
  reason?: string | undefined;
}

export interface AvailabilityDetectedMessage extends BaseExtensionMessage {
  type: 'AVAILABILITY_DETECTED';
  candidates: CandidateTicket[];
  observedAt: string;
  isAuthoritativeT0: boolean;
}

export interface SelectionStartedMessage extends BaseExtensionMessage {
  type: 'SELECTION_STARTED';
  candidate: CandidateTicket;
}

export interface ReservationStartedMessage extends BaseExtensionMessage {
  type: 'RESERVATION_STARTED';
  candidate: CandidateTicket;
  quantity: number;
}

export interface ReservationConfirmedMessage extends BaseExtensionMessage {
  type: 'RESERVATION_CONFIRMED';
  reservationId: string;
  expiresAt?: string | undefined;
  checkoutReference?: string | undefined;
}

export interface ReservationFailedMessage extends BaseExtensionMessage {
  type: 'RESERVATION_FAILED';
  reason: FailureReason;
  errorMessage?: string | undefined;
  canRetry: boolean;
}

export interface PageDiscoverySnapshotMessage extends BaseExtensionMessage {
  type: 'PAGE_DISCOVERY_SNAPSHOT';
  url: string;
  domSummary: {
    title: string;
    hasBuyButton: boolean;
    ticketElementsCount: number;
  };
  timingMs: number;
}

export interface SyncStateRequestMessage extends BaseExtensionMessage {
  type: 'SYNC_STATE_REQUEST';
}

export interface SyncStateResponseMessage extends BaseExtensionMessage {
  type: 'SYNC_STATE_RESPONSE';
  context: StateContext;
}

export type ExtensionMessage =
  | StateChangedMessage
  | StartMonitoringMessage
  | StopRequestedMessage
  | AvailabilityDetectedMessage
  | SelectionStartedMessage
  | ReservationStartedMessage
  | ReservationConfirmedMessage
  | ReservationFailedMessage
  | PageDiscoverySnapshotMessage
  | SyncStateRequestMessage
  | SyncStateResponseMessage;
