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

  // Real Runtime T_EVENT Telemetry Model (Phase 2.1)
  tEvent?: number | undefined;
  tDetected?: number | undefined;
  tDiscovery?: number | undefined;
  tCandidate?: number | undefined;
  tReservation?: number | undefined;
  tResult?: number | undefined;

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

  // Real Runtime T_EVENT Breakdown Intervals
  eventToDetectionMs?: number | undefined;
  detectionToDiscoveryMs?: number | undefined;
  discoveryToCandidateMs?: number | undefined;
  candidateToReservationMs?: number | undefined;
  reservationToResultMs?: number | undefined;
  eventToReservationMs?: number | undefined; // Primary Objective
  totalEventToResultMs?: number | undefined;

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

  // Real Runtime T_EVENT Telemetry Model (Phase 2.1)
  public markTEvent(timestampMs: number = Date.now()): void {
    this._markers.tEvent = timestampMs;
    if (this._markers.t0AvailabilityObserved === undefined) {
      this._markers.t0AvailabilityObserved = timestampMs;
    }
  }

  public markTDetected(timestampMs: number = Date.now()): void {
    this._markers.tDetected = timestampMs;
    if (this._markers.t1LocalDetected === undefined) {
      this._markers.t1LocalDetected = timestampMs;
    }
  }

  public markTDiscovery(timestampMs: number = Date.now()): void {
    this._markers.tDiscovery = timestampMs;
  }

  public markTCandidate(timestampMs: number = Date.now()): void {
    this._markers.tCandidate = timestampMs;
    if (this._markers.t2SelectionDecision === undefined) {
      this._markers.t2SelectionDecision = timestampMs;
    }
  }

  public markTReservation(timestampMs: number = Date.now()): void {
    this._markers.tReservation = timestampMs;
    if (this._markers.t3ReservationInitiated === undefined) {
      this._markers.t3ReservationInitiated = timestampMs;
    }
  }

  public markTResult(timestampMs: number = Date.now()): void {
    this._markers.tResult = timestampMs;
    if (this._markers.t4ReservationResponse === undefined) {
      this._markers.t4ReservationResponse = timestampMs;
    }
    if (this._markers.t5ServerConfirmedHold === undefined) {
      this._markers.t5ServerConfirmedHold = timestampMs;
    }
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
      tEvent,
      tDetected,
      tDiscovery,
      tCandidate,
      tReservation,
      tResult,
      ticketDiscoveryDurationMs,
      ticketDecisionDurationMs,
      ticketSelectionDurationMs,
      areaSelectionDurationMs,
      seatDiscoveryDurationMs,
      seatSelectionDurationMs,
      summaryVerificationDurationMs,
      formDetectionDurationMs,
    } = this._markers;

    return {
      ...(t0 !== undefined && t1 !== undefined ? { detectionLatencyMs: t1 - t0 } : {}),
      ...(t1 !== undefined && t2 !== undefined ? { decisionLatencyMs: t2 - t1 } : {}),
      ...(t2 !== undefined && t3 !== undefined ? { actionLatencyMs: t3 - t2 } : {}),
      ...(t3 !== undefined && t4 !== undefined ? { reservationLatencyMs: t4 - t3 } : {}),
      ...(t4 !== undefined && t5 !== undefined ? { confirmationLatencyMs: t5 - t4 } : {}),
      ...(t0 !== undefined && t5 !== undefined ? { totalCriticalLatencyMs: t5 - t0 } : {}),
      isT0Authoritative: this.isT0Authoritative,

      // Real Runtime T_EVENT intervals
      ...(tEvent !== undefined && tDetected !== undefined
        ? { eventToDetectionMs: tDetected - tEvent }
        : {}),
      ...(tDetected !== undefined && tDiscovery !== undefined
        ? { detectionToDiscoveryMs: tDiscovery - tDetected }
        : {}),
      ...(tDiscovery !== undefined && tCandidate !== undefined
        ? { discoveryToCandidateMs: tCandidate - tDiscovery }
        : {}),
      ...(tCandidate !== undefined && tReservation !== undefined
        ? { candidateToReservationMs: tReservation - tCandidate }
        : {}),
      ...(tReservation !== undefined && tResult !== undefined
        ? { reservationToResultMs: tResult - tReservation }
        : {}),
      ...(tEvent !== undefined && tReservation !== undefined
        ? { eventToReservationMs: tReservation - tEvent }
        : {}),
      ...(tEvent !== undefined && tResult !== undefined
        ? { totalEventToResultMs: tResult - tEvent }
        : {}),

      ...(ticketDiscoveryDurationMs !== undefined ? { ticketDiscoveryDurationMs } : {}),
      ...(ticketDecisionDurationMs !== undefined ? { ticketDecisionDurationMs } : {}),
      ...(ticketSelectionDurationMs !== undefined ? { ticketSelectionDurationMs } : {}),
      ...(areaSelectionDurationMs !== undefined ? { areaSelectionDurationMs } : {}),
      ...(seatDiscoveryDurationMs !== undefined ? { seatDiscoveryDurationMs } : {}),
      ...(seatSelectionDurationMs !== undefined ? { seatSelectionDurationMs } : {}),
      ...(summaryVerificationDurationMs !== undefined ? { summaryVerificationDurationMs } : {}),
      ...(formDetectionDurationMs !== undefined ? { formDetectionDurationMs } : {}),
    };
  }
}
