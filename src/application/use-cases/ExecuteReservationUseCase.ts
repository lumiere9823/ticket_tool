import { PurchaseStateMachine } from '../../domain/state-machine/PurchaseStateMachine';
import { TicketboxPageAdapter } from '../ports/TicketboxPageAdapter';
import { CandidateTicket } from '../../domain/entities/CandidateTicket';
import { EventBus } from '../ports/EventBus';
import { LoggerPort } from '../ports/LoggerPort';
import { LatencyTracker } from '../services/LatencyTracker';
import { FailureReason, PurchaseState } from '../../domain/states/PurchaseState';
import { StateTransitionError } from '../../domain/errors/DomainError';
import { ActionGuard } from '../../domain/policies/ActionGuard';
import { ErrorClassifier } from '../../domain/policies/ErrorClassifier';

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
    const guardResult = ActionGuard.canExecuteAction({
      currentState: this.stateMachine.state,
      action: 'RESERVE',
      profileId: this.stateMachine.profileId,
      accountId: this.stateMachine.accountId,
      eventId: this.stateMachine.eventId,
      workflowId: this.stateMachine.workflowId,
    });

    if (!guardResult.allowed || this.stateMachine.state !== PurchaseState.SELECTING) {
      throw new StateTransitionError(
        this.stateMachine.state,
        PurchaseState.RESERVING,
        'RESERVATION_INITIATED',
        guardResult.reason ?? 'Reservation can only be executed from SELECTING state'
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
        const classified = ErrorClassifier.classify(adapterResult.errorMessage);

        if (classified.reason === FailureReason.RATE_LIMITED) {
          this.stateMachine.transition({ type: 'RATE_LIMITED' });
          await this.eventBus.publish({
            type: 'RESERVATION_FAILED',
            timestamp: new Date().toISOString(),
            attemptId: this.stateMachine.attemptId,
            state: PurchaseState.RATE_LIMITED,
            reason: FailureReason.RATE_LIMITED,
            errorMessage: adapterResult.errorMessage,
            canRetry: false,
          });
          return {
            isConfirmed: false,
            failureReason: FailureReason.RATE_LIMITED,
            errorMessage: adapterResult.errorMessage ?? 'Rate limited by platform',
          };
        }

        if (classified.reason === FailureReason.SESSION_EXPIRED) {
          this.stateMachine.transition({ type: 'SESSION_EXPIRED' });
          await this.eventBus.publish({
            type: 'RESERVATION_FAILED',
            timestamp: new Date().toISOString(),
            attemptId: this.stateMachine.attemptId,
            state: PurchaseState.SESSION_REAUTH_REQUIRED,
            reason: FailureReason.SESSION_EXPIRED,
            errorMessage: adapterResult.errorMessage,
            canRetry: false,
          });
          return {
            isConfirmed: false,
            failureReason: FailureReason.SESSION_EXPIRED,
            errorMessage: adapterResult.errorMessage ?? 'Session expired',
          };
        }

        const failureReason = FailureReason.RESERVATION_FAILED;
        this.stateMachine.transition({
          type: 'RESERVATION_REJECTED',
          reason: failureReason,
          message: adapterResult.errorMessage,
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
          canRetry: classified.isRetryable,
        });

        return {
          isConfirmed: false,
          failureReason,
          errorMessage: adapterResult.errorMessage ?? 'Reservation unconfirmed',
        };
      }
    } catch (error) {
      const classified = ErrorClassifier.classify(error);
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (classified.reason === FailureReason.RATE_LIMITED) {
        this.stateMachine.transition({ type: 'RATE_LIMITED' });
        await this.eventBus.publish({
          type: 'RESERVATION_FAILED',
          timestamp: new Date().toISOString(),
          attemptId: this.stateMachine.attemptId,
          state: PurchaseState.RATE_LIMITED,
          reason: FailureReason.RATE_LIMITED,
          errorMessage,
          canRetry: false,
        });
        return {
          isConfirmed: false,
          failureReason: FailureReason.RATE_LIMITED,
          errorMessage,
        };
      }

      if (classified.reason === FailureReason.SESSION_EXPIRED) {
        this.stateMachine.transition({ type: 'SESSION_EXPIRED' });
        await this.eventBus.publish({
          type: 'RESERVATION_FAILED',
          timestamp: new Date().toISOString(),
          attemptId: this.stateMachine.attemptId,
          state: PurchaseState.SESSION_REAUTH_REQUIRED,
          reason: FailureReason.SESSION_EXPIRED,
          errorMessage,
          canRetry: false,
        });
        return {
          isConfirmed: false,
          failureReason: FailureReason.SESSION_EXPIRED,
          errorMessage,
        };
      }

      // Handle network or unexpected platform error
      const failureReason = FailureReason.UNKNOWN;
      this.stateMachine.transition({
        type: 'FAILURE_OCCURRED',
        reason: failureReason,
        message: errorMessage,
      });

      this.logger.error('Unexpected error during reservation execution', error);

      await this.eventBus.publish({
        type: 'RESERVATION_FAILED',
        timestamp: new Date().toISOString(),
        attemptId: this.stateMachine.attemptId,
        state: PurchaseState.FAILED,
        reason: failureReason,
        errorMessage,
        canRetry: classified.isRetryable,
      });

      return {
        isConfirmed: false,
        failureReason,
        errorMessage,
      };
    }
  }
}
