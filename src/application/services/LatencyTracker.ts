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

  public getBreakdown(): LatencyBreakdown {
    const {
      t0AvailabilityObserved: t0,
      t1LocalDetected: t1,
      t2SelectionDecision: t2,
      t3ReservationInitiated: t3,
      t4ReservationResponse: t4,
      t5ServerConfirmedHold: t5,
    } = this.markers;

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
