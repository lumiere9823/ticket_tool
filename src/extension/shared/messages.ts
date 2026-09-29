import { PurchaseState, FailureReason, StateContext } from '../../domain/states/PurchaseState';
import { CandidateTicket } from '../../domain/entities/CandidateTicket';
import { TicketCatalogSnapshot } from '../../domain/entities/PurchasePlan';

export type ExtensionMessageType =
  | 'STATE_CHANGED'
  | 'ARM_REQUESTED'
  | 'START_MONITORING'
  | 'STOP_REQUESTED'
  | 'AVAILABILITY_DETECTED'
  | 'SELECTION_STARTED'
  | 'RESERVATION_STARTED'
  | 'RESERVATION_CONFIRMED'
  | 'RESERVATION_FAILED'
  | 'HUMAN_INTERVENTION_REQUIRED'
  | 'USER_COMPLETED_INTERVENTION'
  | 'NOTIFICATION_EVENT'
  | 'PAGE_DISCOVERY_SNAPSHOT'
  | 'SYNC_STATE_REQUEST'
  | 'SYNC_STATE_RESPONSE'
  | 'JOURNEY_UPDATE'
  | 'REQUEST_DISCOVERY_SCAN'
  | 'FETCH_SEATMAP_REQUEST'
  | 'FETCH_SEATMAP_RESPONSE'
  | 'RESET_CONFIG_REQUESTED'
  | 'RESET_CONFIG_DONE'
  | 'SCHEDULED_ARM_CONFIRMED'
  | 'CANCEL_SCHEDULED_ARM';

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

export interface HumanInterventionRequiredMessage extends BaseExtensionMessage {
  type: 'HUMAN_INTERVENTION_REQUIRED';
  challengeType:
    'CAPTCHA' | 'OTP' | 'PAYMENT_ACTION' | 'SESSION_REAUTH' | 'UNKNOWN_SECURITY_CHALLENGE';
  interventionId: string;
  instructions: string;
}

export interface UserCompletedInterventionMessage extends BaseExtensionMessage {
  type: 'USER_COMPLETED_INTERVENTION';
  interventionId: string;
}

export interface NotificationEventMessage extends BaseExtensionMessage {
  type: 'NOTIFICATION_EVENT';
  title: string;
  body: string;
  category:
    | 'TICKET_AVAILABLE'
    | 'TICKET_SELECTED'
    | 'SEAT_SELECTION_REQUIRED'
    | 'SEATS_SELECTED'
    | 'FORM_REQUIRED'
    | 'CONSENT_REQUIRED'
    | 'PAYMENT_REQUIRED'
    | 'BOOKING_CONFIRMED'
    | 'BOOKING_FAILED'
    | string;
  eventTitle?: string | undefined;
  showing?: string | undefined;
  ticketName?: string | undefined;
  quantity?: number | undefined;
  profileContext?: string | undefined;
}

export interface PageDiscoverySnapshotMessage extends BaseExtensionMessage {
  type: 'PAGE_DISCOVERY_SNAPSHOT';
  observationId?: string | undefined;
  url: string;
  pageTitle?: string | undefined;
  profileId?: string | undefined;
  accountId?: string | undefined;
  eventId?: string | undefined;
  observedElements?:
    | {
        buttonCount: number;
        hasInteractiveElements: boolean;
        hasMainContent: boolean;
      }
    | undefined;
  observedAvailability?: boolean | undefined;
  domSummary?:
    | {
        title: string;
        hasButtons?: boolean | undefined;
        hasBuyButton?: boolean | undefined;
        ticketElementsCount: number;
      }
    | undefined;
  timingMs: number;
}

export interface SyncStateRequestMessage extends BaseExtensionMessage {
  type: 'SYNC_STATE_REQUEST';
}

export interface SyncStateResponseMessage extends BaseExtensionMessage {
  type: 'SYNC_STATE_RESPONSE';
  context: StateContext;
  /** Full catalog snapshot for popup rendering. */
  catalogSnapshot?: TicketCatalogSnapshot | undefined;
  journeyDetails?: {
    eventTitle?: string;
    showingInfo?: string;
    tickets?: Array<{ name: string; price: number; mode: string; availability: string }>;
    selection?: {
      ticket: string;
      mode: string;
      area?: string;
      seats?: string[];
      quantity: number;
    };
    summary?: {
      subtotal: number;
      fees: number;
      total: number;
    };
    blockingReason?: string;
  };
}

export interface JourneyUpdateMessage extends BaseExtensionMessage {
  type: 'JOURNEY_UPDATE';
  eventTitle?: string | undefined;
  /** Showing info string for display (legacy). */
  showingInfo?: string | undefined;
  /** Showing ID for dropdown selection. */
  showingId?: string | null | undefined;
  /**
   * Full Ticket Catalog snapshot.
   * Replaces the legacy simple tickets array for the popup UI.
   */
  catalogSnapshot?: TicketCatalogSnapshot | undefined;
  /**
   * Legacy simple ticket array kept for backwards compatibility.
   * Use catalogSnapshot.tickets for full data including IDs, minQty, maxQty.
   */
  tickets?: Array<{ name: string; price: number; mode: string; availability: string }> | undefined;
  selection?:
    | {
        ticket: string;
        mode: string;
        area?: string;
        seats?: string[];
        quantity: number;
      }
    | undefined;
  summary?:
    | {
        subtotal: number;
        fees: number;
        total: number;
      }
    | undefined;
  blockingReason?: string | undefined;
}

export interface ArmRequestedMessage extends BaseExtensionMessage {
  type: 'ARM_REQUESTED';
  eventUrl: string;
  categoryPriority: string[];
  quantity: number;
  allowFallback?: boolean | undefined;
  seatPreference?:
    'ANY_AVAILABLE' | 'SAME_ROW' | 'NEAREST_STAGE' | 'AREA_PRIORITY' | 'SPECIFIC_SEAT' | undefined;
  nonAdjacentFallback?: 'WAIT' | 'SELECT_NON_ADJACENT' | 'STOP' | undefined;
  userProfile?:
    | {
        fullName: string;
        phone: string;
        email: string;
        agreeToTerms?: boolean | undefined;
      }
    | undefined;
  scopedPurchasePlan?:
    import('../../domain/entities/ScopedPurchasePlan').ScopedPurchasePlan | undefined;
}

export interface RequestDiscoveryScanMessage extends BaseExtensionMessage {
  type: 'REQUEST_DISCOVERY_SCAN';
}

export interface FetchSeatmapRequestMessage extends BaseExtensionMessage {
  type: 'FETCH_SEATMAP_REQUEST';
  showingId: string;
}

export interface FetchSeatmapResponseMessage extends BaseExtensionMessage {
  type: 'FETCH_SEATMAP_RESPONSE';
  showingId: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface ResetConfigRequestedMessage extends BaseExtensionMessage {
  type: 'RESET_CONFIG_REQUESTED';
}

export interface ResetConfigDoneMessage extends BaseExtensionMessage {
  type: 'RESET_CONFIG_DONE';
}

export interface ScheduledArmConfirmedMessage extends BaseExtensionMessage {
  type: 'SCHEDULED_ARM_CONFIRMED';
  scheduledAt: string;
}

export interface CancelScheduledArmMessage extends BaseExtensionMessage {
  type: 'CANCEL_SCHEDULED_ARM';
}

export type ExtensionMessage =
  | StateChangedMessage
  | ArmRequestedMessage
  | StartMonitoringMessage
  | StopRequestedMessage
  | AvailabilityDetectedMessage
  | SelectionStartedMessage
  | ReservationStartedMessage
  | ReservationConfirmedMessage
  | ReservationFailedMessage
  | HumanInterventionRequiredMessage
  | UserCompletedInterventionMessage
  | NotificationEventMessage
  | PageDiscoverySnapshotMessage
  | SyncStateRequestMessage
  | SyncStateResponseMessage
  | JourneyUpdateMessage
  | RequestDiscoveryScanMessage
  | FetchSeatmapRequestMessage
  | FetchSeatmapResponseMessage
  | ResetConfigRequestedMessage
  | ResetConfigDoneMessage
  | ScheduledArmConfirmedMessage
  | CancelScheduledArmMessage;

