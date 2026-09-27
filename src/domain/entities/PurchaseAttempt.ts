import { AttemptId } from '../value-objects/AttemptId';
import { ProfileId } from '../value-objects/ProfileId';
import { PurchaseState } from '../states/PurchaseState';

export interface LatencyMarkers {
  t0AvailabilityObserved?: number | undefined;
  t1LocalDetected?: number | undefined;
  t2SelectionDecision?: number | undefined;
  t3ReservationInitiated?: number | undefined;
  t4ReservationResponse?: number | undefined;
  t5ServerConfirmedHold?: number | undefined;

  // Extended Journey Timings (Section 30)
  ticketDiscoveryStart?: number | undefined;
  ticketDiscoveryEnd?: number | undefined;
  ticketDecisionStart?: number | undefined;
  ticketDecisionEnd?: number | undefined;
  ticketSelectionStart?: number | undefined;
  ticketSelectionEnd?: number | undefined;
  areaSelectionStart?: number | undefined;
  areaSelectionEnd?: number | undefined;
  seatDiscoveryStart?: number | undefined;
  seatDiscoveryEnd?: number | undefined;
  seatSelectionStart?: number | undefined;
  seatSelectionEnd?: number | undefined;
  summaryVerificationStart?: number | undefined;
  summaryVerificationEnd?: number | undefined;
  formDetectionStart?: number | undefined;
  formDetectionEnd?: number | undefined;
  ticketDiscoveryDurationMs?: number | undefined;
  ticketDecisionDurationMs?: number | undefined;
  ticketSelectionDurationMs?: number | undefined;
  areaSelectionDurationMs?: number | undefined;
  seatDiscoveryDurationMs?: number | undefined;
  seatSelectionDurationMs?: number | undefined;
  summaryVerificationDurationMs?: number | undefined;
  formDetectionDurationMs?: number | undefined;
}

export interface LatencyBreakdown {
  detectionLatencyMs?: number | undefined;
  decisionLatencyMs?: number | undefined;
  actionLatencyMs?: number | undefined;
  reservationLatencyMs?: number | undefined;
  confirmationLatencyMs?: number | undefined;
  totalCriticalLatencyMs?: number | undefined;
  isT0Authoritative: boolean;

  // Extended Journey Durations (Section 30)
  ticketDiscoveryDurationMs?: number | undefined;
  ticketDecisionDurationMs?: number | undefined;
  ticketSelectionDurationMs?: number | undefined;
  areaSelectionDurationMs?: number | undefined;
  seatDiscoveryDurationMs?: number | undefined;
  seatSelectionDurationMs?: number | undefined;
  summaryVerificationDurationMs?: number | undefined;
  formDetectionDurationMs?: number | undefined;
}

/**
 * Tracks the execution lifecycle, latency telemetry, and correlation of a single purchase attempt.
 */
export class PurchaseAttempt {
  public readonly attemptId: AttemptId;
  public readonly eventId: string;
  public readonly accountId?: string | undefined;
  public readonly profileId?: ProfileId | undefined;
  private _state: PurchaseState;
  private readonly _markers: LatencyMarkers = {};
  public isT0Authoritative = false;

  constructor(eventId: string, attemptId?: AttemptId, profileId?: ProfileId, accountId?: string) {
    this.attemptId = attemptId ?? new AttemptId();
    this.eventId = eventId;
    this.profileId = profileId;
    this.accountId = accountId;
    this._state = PurchaseState.INIT;
  }

  public get state(): PurchaseState {
    return this._state;
  }

  public setState(state: PurchaseState): void {
    this._state = state;
  }

  public markT0(timestampMs: number = Date.now(), isAuthoritative = false): void {
    this._markers.t0AvailabilityObserved = timestampMs;
    this.isT0Authoritative = isAuthoritative;
  }

  public markT1(timestampMs: number = Date.now()): void {
    this._markers.t1LocalDetected = timestampMs;
  }

  public markT2(timestampMs: number = Date.now()): void {
    this._markers.t2SelectionDecision = timestampMs;
  }

  public markT3(timestampMs: number = Date.now()): void {
    this._markers.t3ReservationInitiated = timestampMs;
  }

  public markT4(timestampMs: number = Date.now()): void {
    this._markers.t4ReservationResponse = timestampMs;
  }

  public markT5(timestampMs: number = Date.now()): void {
    this._markers.t5ServerConfirmedHold = timestampMs;
  }

  public getMarkers(): Readonly<LatencyMarkers> {
    return { ...this._markers };
  }

  public getLatencyBreakdown(): LatencyBreakdown {
    const {
      t0AvailabilityObserved: t0,
      t1LocalDetected: t1,
      t2SelectionDecision: t2,
      t3ReservationInitiated: t3,
      t4ReservationResponse: t4,
      t5ServerConfirmedHold: t5,
    } = this._markers;

    return {
      ...(t0 !== undefined && t1 !== undefined ? { detectionLatencyMs: t1 - t0 } : {}),
      ...(t1 !== undefined && t2 !== undefined ? { decisionLatencyMs: t2 - t1 } : {}),
      ...(t2 !== undefined && t3 !== undefined ? { actionLatencyMs: t3 - t2 } : {}),
      ...(t3 !== undefined && t4 !== undefined ? { reservationLatencyMs: t4 - t3 } : {}),
      ...(t4 !== undefined && t5 !== undefined ? { confirmationLatencyMs: t5 - t4 } : {}),
      ...(t0 !== undefined && t5 !== undefined ? { totalCriticalLatencyMs: t5 - t0 } : {}),
      isT0Authoritative: this.isT0Authoritative,
    };
  }
}
