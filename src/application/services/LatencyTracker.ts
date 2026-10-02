import { LatencyBreakdown, LatencyMarkers } from '../../domain/entities/PurchaseAttempt';
import { LoggerPort } from '../ports/LoggerPort';

export class LatencyTracker {
  private readonly markers: LatencyMarkers = {};
  private isT0Authoritative = false;

  constructor(
    private readonly attemptId: string,
    private readonly logger?: LoggerPort
  ) {}

  public recordT0(timestampMs: number = Date.now(), isAuthoritative = false): void {
    this.markers.t0AvailabilityObserved = timestampMs;
    this.isT0Authoritative = isAuthoritative;
    this.logger?.debug('Recorded T0 (availability)', {
      attemptId: this.attemptId,
      t0: timestampMs,
      isAuthoritative,
    });
  }

  public recordT1(timestampMs: number = Date.now()): void {
    this.markers.t1LocalDetected = timestampMs;
    this.logger?.debug('Recorded T1 (detection)', { attemptId: this.attemptId, t1: timestampMs });
  }

  public recordT2(timestampMs: number = Date.now()): void {
    this.markers.t2SelectionDecision = timestampMs;
    this.logger?.debug('Recorded T2 (decision)', { attemptId: this.attemptId, t2: timestampMs });
  }

  public recordT3(timestampMs: number = Date.now()): void {
    this.markers.t3ReservationInitiated = timestampMs;
    this.logger?.debug('Recorded T3 (action)', { attemptId: this.attemptId, t3: timestampMs });
  }

  public recordT4(timestampMs: number = Date.now()): void {
    this.markers.t4ReservationResponse = timestampMs;
    this.logger?.debug('Recorded T4 (reservation response)', {
      attemptId: this.attemptId,
      t4: timestampMs,
    });
  }

  public recordT5(timestampMs: number = Date.now()): void {
    this.markers.t5ServerConfirmedHold = timestampMs;
    this.logger?.info('Recorded T5 (server-confirmed hold)', {
      attemptId: this.attemptId,
      t5: timestampMs,
      breakdown: this.getBreakdown(),
    });
  }

  // Real Runtime T_EVENT Telemetry Model (Phase 2.1)
  public recordTEvent(timestampMs: number = Date.now()): void {
    this.markers.tEvent = timestampMs;
    if (this.markers.t0AvailabilityObserved === undefined) {
      this.markers.t0AvailabilityObserved = timestampMs;
    }
    this.logger?.debug('Recorded T_EVENT (earliest observable inventory change)', {
      attemptId: this.attemptId,
      tEvent: timestampMs,
    });
  }

  public recordTDetected(timestampMs: number = Date.now()): void {
    this.markers.tDetected = timestampMs;
    if (this.markers.t1LocalDetected === undefined) {
      this.markers.t1LocalDetected = timestampMs;
    }
    this.logger?.debug('Recorded T_DETECTED (assistant observed event)', {
      attemptId: this.attemptId,
      tDetected: timestampMs,
    });
  }

  public recordTDiscovery(timestampMs: number = Date.now()): void {
    this.markers.tDiscovery = timestampMs;
    this.logger?.debug('Recorded T_DISCOVERY (catalog/inventory discovery complete)', {
      attemptId: this.attemptId,
      tDiscovery: timestampMs,
    });
  }

  public recordTCandidate(timestampMs: number = Date.now()): void {
    this.markers.tCandidate = timestampMs;
    if (this.markers.t2SelectionDecision === undefined) {
      this.markers.t2SelectionDecision = timestampMs;
    }
    this.logger?.debug('Recorded T_CANDIDATE (candidate ranking and selection decided)', {
      attemptId: this.attemptId,
      tCandidate: timestampMs,
    });
  }

  public recordTReservation(timestampMs: number = Date.now()): void {
    this.markers.tReservation = timestampMs;
    if (this.markers.t3ReservationInitiated === undefined) {
      this.markers.t3ReservationInitiated = timestampMs;
    }
    this.logger?.debug('Recorded T_RESERVATION (reservation action initiated)', {
      attemptId: this.attemptId,
      tReservation: timestampMs,
    });
  }

  public recordTResult(timestampMs: number = Date.now()): void {
    this.markers.tResult = timestampMs;
    if (this.markers.t4ReservationResponse === undefined) {
      this.markers.t4ReservationResponse = timestampMs;
    }
    if (this.markers.t5ServerConfirmedHold === undefined) {
      this.markers.t5ServerConfirmedHold = timestampMs;
    }
    this.logger?.info('Recorded T_RESULT (authoritative reservation confirmation received)', {
      attemptId: this.attemptId,
      tResult: timestampMs,
      breakdown: this.getBreakdown(),
    });
  }

  public getMarkers(): Readonly<LatencyMarkers> {
    return { ...this.markers };
  }

  // Extended Journey Timings (Section 30)
  public recordTicketDiscovery(durationMs: number): void {
    this.markers.ticketDiscoveryDurationMs = durationMs;
  }

  public recordTicketDecision(durationMs: number): void {
    this.markers.ticketDecisionDurationMs = durationMs;
  }

  public recordTicketSelection(durationMs: number): void {
    this.markers.ticketSelectionDurationMs = durationMs;
  }

  public recordAreaSelection(durationMs: number): void {
    this.markers.areaSelectionDurationMs = durationMs;
  }

  public recordSeatDiscovery(durationMs: number): void {
    this.markers.seatDiscoveryDurationMs = durationMs;
  }

  public recordSeatSelection(durationMs: number): void {
    this.markers.seatSelectionDurationMs = durationMs;
  }

  public recordSummaryVerification(durationMs: number): void {
    this.markers.summaryVerificationDurationMs = durationMs;
  }

  public recordFormDetection(durationMs: number): void {
    this.markers.formDetectionDurationMs = durationMs;
  }

  public getBreakdown(): LatencyBreakdown {
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
    } = this.markers;

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
