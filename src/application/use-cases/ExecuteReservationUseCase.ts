import { PurchaseStateMachine } from '../../domain/state-machine/PurchaseStateMachine';
import { TicketboxPageAdapter } from '../ports/TicketboxPageAdapter';
import { CandidateTicket } from '../../domain/entities/CandidateTicket';
import { EventBus } from '../ports/EventBus';
import { LoggerPort } from '../ports/LoggerPort';
import { LatencyTracker } from '../services/LatencyTracker';
import { FailureReason, PurchaseState } from '../../domain/states/PurchaseState';
import { StateTransitionError } from '../../domain/errors/DomainError';

export interface ExecuteReservationResult {
  isConfirmed: boolean;
  reservationId?: string | undefined;
  expiresAt?: string | undefined;
  failureReason?: FailureReason | undefined;
  errorMessage?: string | undefined;
}

export class ExecuteReservationUseCase {
  constructor(
    private readonly stateMachine: PurchaseStateMachine,
    private readonly adapter: TicketboxPageAdapter,
    private readonly eventBus: EventBus,
    private readonly logger: LoggerPort
  ) {}

  public async execute(
    candidate: CandidateTicket,
    quantity: number,
    latencyTracker?: LatencyTracker
  ): Promise<ExecuteReservationResult> {
    if (this.stateMachine.state !== PurchaseState.SELECTING) {
      throw new StateTransitionError(
        this.stateMachine.state,
        PurchaseState.RESERVING,
        'RESERVATION_INITIATED',
        'Reservation can only be executed from SELECTING state'
      );
    }

    this.logger.info('Initiating reservation attempt', {
      attemptId: this.stateMachine.attemptId,
      candidateId: candidate.id,
      quantity,
    });

    // 1. Transition state: SELECTING -> RESERVING
    this.stateMachine.transition({ type: 'RESERVATION_INITIATED' });
    latencyTracker?.recordT3();

    await this.eventBus.publish({
      type: 'RESERVATION_STARTED',
      timestamp: new Date().toISOString(),
      attemptId: this.stateMachine.attemptId,
      state: PurchaseState.RESERVING,
      candidate,
      quantity,
    });

    try {
      // 2. Delegate to adapter (no DOM assumptions in use case)
      const adapterResult = await this.adapter.submitReservation(candidate, quantity);
      latencyTracker?.recordT4();

      // 3. Strict verification of server-confirmed evidence (Rule 4 & 5)
      if (adapterResult.isConfirmed && adapterResult.reservationId) {
        latencyTracker?.recordT5();

        const context = this.stateMachine.transition({
          type: 'RESERVATION_SERVER_CONFIRMED',
          reservationId: adapterResult.reservationId,
          expiresAt: adapterResult.expiresAt,
        });

        this.logger.info('Reservation successfully confirmed by server', {
          reservationId: adapterResult.reservationId,
          state: context.currentState,
        });

        await this.eventBus.publish({
          type: 'RESERVATION_CONFIRMED',
          timestamp: new Date().toISOString(),
          attemptId: this.stateMachine.attemptId,
          state: PurchaseState.HELD,
          reservationId: adapterResult.reservationId,
          expiresAt: adapterResult.expiresAt,
        });

        return {
          isConfirmed: true,
          reservationId: adapterResult.reservationId,
          expiresAt: adapterResult.expiresAt,
        };
      } else {
        // Server rejected or evidence absent
        const failureReason = FailureReason.RESERVATION_FAILED;
        this.stateMachine.transition({
          type: 'RESERVATION_REJECTED',
          reason: failureReason,
        });

        this.logger.warn('Reservation rejected or unconfirmed by server', {
          reason: failureReason,
          error: adapterResult.errorMessage,
        });

        await this.eventBus.publish({
          type: 'RESERVATION_FAILED',
          timestamp: new Date().toISOString(),
          attemptId: this.stateMachine.attemptId,
          state: PurchaseState.FAILED,
          reason: failureReason,
          errorMessage: adapterResult.errorMessage,
          canRetry: true,
        });

        return {
          isConfirmed: false,
          failureReason,
          errorMessage: adapterResult.errorMessage ?? 'Reservation unconfirmed',
        };
      }
    } catch (error) {
      // Handle network or unexpected platform error
      const failureReason = FailureReason.UNKNOWN;
      this.stateMachine.transition({
        type: 'FAILURE_OCCURRED',
        reason: failureReason,
        message: error instanceof Error ? error.message : String(error),
      });

      this.logger.error('Unexpected error during reservation execution', error);

      await this.eventBus.publish({
        type: 'RESERVATION_FAILED',
        timestamp: new Date().toISOString(),
        attemptId: this.stateMachine.attemptId,
        state: PurchaseState.FAILED,
        reason: failureReason,
        errorMessage: error instanceof Error ? error.message : String(error),
        canRetry: false,
      });

      return {
        isConfirmed: false,
        failureReason,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
