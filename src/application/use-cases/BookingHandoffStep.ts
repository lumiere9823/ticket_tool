import { EventBus } from '../ports/EventBus';
import { LoggerPort } from '../ports/LoggerPort';
import { TicketboxPageAdapter } from '../ports/TicketboxPageAdapter';
import { PurchaseStateMachine } from '../../domain/state-machine/PurchaseStateMachine';
import { PurchaseState } from '../../domain/states/PurchaseState';
import {
  BookingPreferences,
  CurrentSelection,
  FormSchema,
} from '../../domain/entities/BookingJourneyModels';
import { ActionGuard } from '../../domain/policies/ActionGuard';
import { BookingError } from '../../domain/errors/BookingErrors';
import { LatencyTracker } from '../services/LatencyTracker';
import { JourneyExecutionResult } from './ExecuteBookingJourneyUseCase';

export interface HandoffRetryContext {
  failedAreaIds: Set<string>;
  areaCollisionCounts: Map<string, number>;
  exhaustedTierNames: Set<string>;
  currentAreaId?: string | null;
  currentAreaName?: string | null;
}

export interface BookingHandoffStepOptions {
  stateMachine: PurchaseStateMachine;
  adapter: TicketboxPageAdapter;
  eventBus: EventBus;
  logger: LoggerPort;
  getPageUrl: () => string;
  profileGate: (
    schema: FormSchema,
    preferences: BookingPreferences,
    selection?: CurrentSelection
  ) => JourneyExecutionResult | null;
  waitForQuestionFormToClose: () => Promise<boolean>;
  formNotAdvancedResult: (selection?: CurrentSelection) => JourneyExecutionResult;
  recordSeatCollision: (context?: HandoffRetryContext, seatLabel?: string) => void;
}

export class BookingHandoffStep {
  constructor(private readonly options: BookingHandoffStepOptions) {}

  async handlePaymentGate(): Promise<JourneyExecutionResult> {
    const { stateMachine, logger, eventBus } = this.options;
    stateMachine.transition({ type: 'PAYMENT_GATE' });
    logger.info('Payment step reached — user action required.');
    await eventBus.publish({
      type: 'NOTIFICATION_EVENT',
      timestamp: new Date().toISOString(),
      category: 'PAYMENT_REQUIRED',
      title: 'Ticketbox Assistant',
      body: 'Payment step reached — user action required.',
    });
    return {
      success: true,
      finalState: PurchaseState.PAYMENT_GATE,
      requiresUserAction: true,
      actionRequiredReason: 'Payment step reached — user action required.',
    };
  }

  async handleQuestionForm(
    preferences: BookingPreferences,
    latencyTracker?: LatencyTracker,
    retryContext?: HandoffRetryContext,
    selection?: CurrentSelection
  ): Promise<JourneyExecutionResult> {
    const { stateMachine, adapter, eventBus, logger } = this.options;
    logger.info('Executing Question / Attendee Form step on question-form page');
    await this.throwForSeatCollision(retryContext);

    const formStart = Date.now();
    const formSchema = adapter.getFormSchema ? await adapter.getFormSchema() : null;
    latencyTracker?.recordFormDetection(Date.now() - formStart);

    if (formSchema && formSchema.fields.length > 0) {
      stateMachine.transition({
        type: 'QUESTION_FORM_DETECTED',
        fieldCount: formSchema.fields.length,
      });
      logger.info(`Question form detected: ${formSchema.fields.length} fields`);
      stateMachine.transition({ type: 'FILLING_ATTENDEE_FORM' });

      const blocked = this.options.profileGate(formSchema, preferences, selection);
      if (blocked) return blocked;

      if (adapter.fillAttendeeForm && preferences.userProfile) {
        const guard = ActionGuard.canExecuteAction({
          currentState: stateMachine.state,
          action: 'FILL_FORM',
        });
        if (!guard.allowed) {
          throw new BookingError({
            code: 'REQUIRED_FIELD_MISSING',
            message: guard.reason ?? 'ActionGuard rejected filling attendee form',
            state: stateMachine.state,
            recoverable: false,
          });
        }

        const fillResult = await adapter.fillAttendeeForm(preferences.userProfile);
        if (fillResult.isConsentBlocked) {
          stateMachine.transition({
            type: 'CONSENT_REQUIRED',
            consentLabel: formSchema.consentLabel,
          });
          logger.warn('User consent required for terms and conditions');
          await eventBus.publish({
            type: 'NOTIFICATION_EVENT',
            timestamp: new Date().toISOString(),
            category: 'CONSENT_REQUIRED',
            title: 'Ticketbox Assistant',
            body: 'User consent required to proceed with booking',
          });
          return {
            success: true,
            finalState: PurchaseState.CONSENT_REQUIRED,
            requiresUserAction: true,
            actionRequiredReason: 'User consent required',
          };
        }
        if (!fillResult.allSatisfied) {
          logger.warn('Form has unsatisfied required fields', {
            missing: fillResult.missingFields,
          });
          return {
            success: true,
            finalState: PurchaseState.FILLING_ATTENDEE_FORM,
            requiresUserAction: true,
            actionRequiredReason: `Required fields missing: ${fillResult.missingFields.join(', ')}`,
          };
        }
      }

      stateMachine.transition({ type: 'FORM_VALIDATED' });
      logger.info('Form validated successfully');
    }

    if (adapter.proceedToNextStep) {
      const guard = ActionGuard.canExecuteAction({
        currentState: stateMachine.state,
        action: 'PROCEED',
      });
      if (!guard.allowed) {
        throw new BookingError({
          code: 'PROCEED_FAILED',
          message: guard.reason ?? 'ActionGuard rejected proceeding to next step',
          state: stateMachine.state,
          recoverable: false,
        });
      }

      logger.info('Submitting attendee form / proceeding to payment step');
      await adapter.proceedToNextStep();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await this.throwForSeatCollision(retryContext);

      if (formSchema && formSchema.fields.length > 0) {
        const closed = await this.options.waitForQuestionFormToClose();
        if (!closed) {
          await this.throwForSeatCollision(retryContext);
          return this.options.formNotAdvancedResult(selection);
        }
      }
    }

    const afterSubmitUrl = this.options.getPageUrl();
    const isActualPayment =
      afterSubmitUrl.includes('/payment') ||
      afterSubmitUrl.includes('/checkout') ||
      !afterSubmitUrl.includes('ticketbox.vn');
    if (!isActualPayment) {
      logger.info('Question form submitted, waiting for navigation to payment page...', {
        currentUrl: afterSubmitUrl,
      });
      return {
        success: true,
        finalState: stateMachine.state,
        requiresUserAction: false,
        actionRequiredReason: 'Navigating to payment gate...',
      };
    }
    return this.handlePaymentGate();
  }

  private async throwForSeatCollision(context?: HandoffRetryContext): Promise<void> {
    const { adapter, stateMachine, logger } = this.options;
    if (!adapter.detectAndHandleErrorModal) return;
    const result = await adapter.detectAndHandleErrorModal();
    if (!result.hasError || !result.isSeatUnavailable) return;
    this.options.recordSeatCollision(context, result.seatLabel);
    logger.warn(
      'Seat unavailable modal detected while handling attendee form; retrying selection',
      {
        seat: result.seatLabel,
      }
    );
    throw new BookingError({
      code: 'SEAT_UNAVAILABLE',
      message: `Seat ${result.seatLabel ?? 'selected'} is already reserved. Retrying alternative seat.`,
      state: stateMachine.state,
      recoverable: true,
    });
  }
}
