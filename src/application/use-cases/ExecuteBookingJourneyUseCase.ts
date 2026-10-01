import { PurchaseStateMachine } from '../../domain/state-machine/PurchaseStateMachine';
import { TicketboxPageAdapter } from '../ports/TicketboxPageAdapter';
import { EventBus } from '../ports/EventBus';
import { LoggerPort } from '../ports/LoggerPort';
import { LatencyTracker } from '../services/LatencyTracker';
import { PurchaseState, FailureReason, canAutoReset } from '../../domain/states/PurchaseState';
import {
  BookingPreferences,
  CurrentSelection,
  FormSchema,
  JourneyTicketType,
} from '../../domain/entities/BookingJourneyModels';
import { PriorityCategoryEngine } from '../../domain/policies/PriorityCategoryEngine';
import { AdjacentSeatStrategy } from '../../domain/policies/AdjacentSeatStrategy';
import { BookingSummaryVerifier } from '../../domain/policies/BookingSummaryVerifier';
import { BookingError } from '../../domain/errors/BookingErrors';

export interface JourneyExecutionResult {
  success: boolean;
  finalState: PurchaseState;
  selection?: CurrentSelection | undefined;
  requiresUserAction: boolean;
  actionRequiredReason?: string | undefined;
  error?: string | undefined;
}

interface JourneyRetryContext {
  failedAreaIds: Set<string>;
  areaCollisionCounts: Map<string, number>;
  exhaustedTierNames: Set<string>;
  currentAreaId?: string | null;
  currentAreaName?: string | null;
}

export interface JourneyUseCaseConfig {
  maxRetries?: number;
  maxAreaCollisions?: number;
}

export class ExecuteBookingJourneyUseCase {
  private readonly MAX_RETRIES: number;
  private readonly MAX_AREA_COLLISIONS: number;
  private isExecuting = false;

  constructor(
    private readonly stateMachine: PurchaseStateMachine,
    private readonly adapter: TicketboxPageAdapter,
    private readonly eventBus: EventBus,
    private readonly logger: LoggerPort,
    config?: JourneyUseCaseConfig
  ) {
    this.MAX_RETRIES = config?.maxRetries ?? 8;
    this.MAX_AREA_COLLISIONS = config?.maxAreaCollisions ?? 2;
    if (
      this.adapter &&
      'setCurrentStateProvider' in this.adapter &&
      typeof (this.adapter as { setCurrentStateProvider?: (fn: () => PurchaseState) => void })
        .setCurrentStateProvider === 'function'
    ) {
      (
        this.adapter as { setCurrentStateProvider: (fn: () => PurchaseState) => void }
      ).setCurrentStateProvider(() => this.stateMachine.state);
    }
  }

  private getState(): PurchaseState {
    return this.stateMachine.state;
  }

  /**
   * Fail-closed guard: a detected question form must never be treated as "validated" unless the
   * assistant is actually able to fill it from a configured attendee profile.
   */
  private profileGate(
    formSchema: FormSchema,
    preferences: BookingPreferences,
    selection?: CurrentSelection | undefined
  ): JourneyExecutionResult | null {
    if (this.adapter.fillAttendeeForm && preferences.userProfile) return null;
    this.logger.warn(
      'Question form detected but no attendee profile is configured; stopping for the user',
      { fields: formSchema.fields.length }
    );
    return {
      success: true,
      finalState: PurchaseState.FILLING_ATTENDEE_FORM,
      selection,
      requiresUserAction: true,
      actionRequiredReason:
        'Question form needs to be filled: configure name/phone/email/consent in the popup or fill it manually',
    };
  }

  /**
   * After clicking "Tiếp tục" the page must actually leave /question-form. Returns false when the
   * form is still displayed (typically because of validation errors).
   */
  private async waitForQuestionFormToClose(timeoutMs = 6000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    do {
      const url = typeof window !== 'undefined' ? window.location.href : '';
      if (!url.includes('/question-form')) return true;
      await new Promise((r) => setTimeout(r, 80));
    } while (Date.now() < deadline);
    return false;
  }

  private formNotAdvancedResult(selection?: CurrentSelection | undefined): JourneyExecutionResult {
    this.logger.warn('Form was submitted but the page did not leave /question-form');
    return {
      success: true,
      finalState: PurchaseState.FILLING_ATTENDEE_FORM,
      selection,
      requiresUserAction: true,
      actionRequiredReason:
        'Form still displayed after submit (validation errors?). Please check the fields.',
    };
  }

  public async execute(
    preferences: BookingPreferences,
    latencyTracker?: LatencyTracker
  ): Promise<JourneyExecutionResult> {
    if (this.isExecuting) {
      this.logger.warn(
        'ExecuteBookingJourneyUseCase is already executing; rejecting concurrent execution',
        {
          attemptId: this.stateMachine.attemptId,
        }
      );
      return {
        success: false,
        finalState: this.getState(),
        requiresUserAction: false,
        error: 'Concurrent journey execution rejected',
      };
    }
    this.isExecuting = true;
    try {
      this.logger.info('Starting ExecuteBookingJourneyUseCase', {
        attemptId: this.stateMachine.attemptId,
        preferences: {
          priorities: preferences.categoryPriority,
          quantity: preferences.quantity,
          allowFallback: preferences.allowFallback,
        },
      });

      const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
      const isOnPaymentPage = currentUrl.includes('/payment') || currentUrl.includes('/checkout');
      const currentState = this.getState();

      // If on actual payment page and state is PAYMENT_GATE, halt safely
      if (isOnPaymentPage && currentState === PurchaseState.PAYMENT_GATE) {
        this.logger.info(`Already on payment page with state ${currentState}. Halting.`);
        return {
          success: true,
          finalState: currentState,
          requiresUserAction: true,
        };
      }

      if (!canAutoReset(currentState)) {
        this.logger.info(
          `State machine is in protected state ${currentState} (canAutoReset is false). Halting journey for user action.`
        );
        return {
          success: true,
          finalState: currentState,
          requiresUserAction: true,
        };
      }

      // Reset if in intermediate or stale state on non-payment page
      if (
        currentState !== PurchaseState.READY &&
        currentState !== PurchaseState.MONITORING &&
        currentState !== PurchaseState.INIT
      ) {
        try {
          if (currentState !== PurchaseState.STOPPED && currentState !== PurchaseState.FAILED) {
            this.stateMachine.transition({
              type: 'STOP_REQUESTED',
              reason: 'Journey initial clean reset',
            });
          }
          this.stateMachine.transition({ type: 'RESET_REQUESTED' });
          this.stateMachine.transition({ type: 'ARM' });
          this.stateMachine.transition({ type: 'MONITORING_STARTED' });
        } catch {
          // ignore
        }
      }

      let retries = 0;
      let lastError: unknown;
      const retryContext: JourneyRetryContext = {
        failedAreaIds: new Set<string>(),
        areaCollisionCounts: new Map<string, number>(),
        exhaustedTierNames: new Set<string>(),
      };

      while (retries <= this.MAX_RETRIES) {
        if (retries > 0) {
          const retryState = this.getState();
          if (!canAutoReset(retryState)) {
            this.logger.info(
              `Guarded state ${retryState} reached during journey (canAutoReset is false). Halting retries.`
            );
            return {
              success: true,
              finalState: retryState,
              requiresUserAction: true,
            };
          }

          try {
            if (
              retryState !== PurchaseState.STOPPED &&
              retryState !== PurchaseState.FAILED &&
              retryState !== PurchaseState.RETRYING_TARGET
            ) {
              this.stateMachine.transition({
                type: 'RETRY_TARGET',
                reason: `Journey retry attempt ${retries}`,
              });
            }
          } catch {
            // ignore
          }
        }
        try {
          return await this.runJourney(preferences, latencyTracker, retryContext);
        } catch (err: unknown) {
          retries++;
          lastError = err;
          this.logger.warn(`Journey execution encountered error on attempt ${retries}`, {
            error: err instanceof Error ? err.message : String(err),
            retries,
          });

          if (err instanceof BookingError && !err.recoverable) {
            this.stateMachine.transition({
              type: 'FAILURE_OCCURRED',
              reason: FailureReason.INVALID_SELECTION,
              message: err.message,
            });
            return {
              success: false,
              finalState: this.stateMachine.state,
              requiresUserAction: false,
              error: err.message,
            };
          }

          if (retries > this.MAX_RETRIES) {
            const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
            this.stateMachine.transition({
              type: 'FAILURE_OCCURRED',
              reason: FailureReason.UNKNOWN,
              message: `Max retries exceeded: ${errMsg}`,
            });
            return {
              success: false,
              finalState: this.stateMachine.state,
              requiresUserAction: false,
              error: errMsg,
            };
          }

          // Delay before retry to allow DOM / React state to settle
          await new Promise((r) => setTimeout(r, 200 * retries));

          // Attempt clean transition to RETRY_TARGET
          if (
            this.stateMachine.state !== PurchaseState.STOPPED &&
            this.stateMachine.state !== PurchaseState.FAILED &&
            this.stateMachine.state !== PurchaseState.RETRYING_TARGET
          ) {
            try {
              this.stateMachine.transition({
                type: 'RETRY_TARGET',
                reason: `Preparing retry attempt ${retries}`,
              });
            } catch {
              // ignore if invalid transition
            }
          }
        }
      }

      return {
        success: false,
        finalState: this.stateMachine.state,
        requiresUserAction: false,
        error: 'Max retries exhausted',
      };
    } finally {
      this.isExecuting = false;
    }
  }

  private recordSeatCollision(
    retryContext?: JourneyRetryContext,
    seatLabel?: string | undefined
  ): void {
    if (!retryContext) return;
    if (seatLabel) {
      this.adapter.blacklistSeat?.(seatLabel);
    }
    if (retryContext.currentAreaId) {
      const count = (retryContext.areaCollisionCounts.get(retryContext.currentAreaId) || 0) + 1;
      retryContext.areaCollisionCounts.set(retryContext.currentAreaId, count);
      if (count >= this.MAX_AREA_COLLISIONS) {
        this.logger.warn(
          `Area '${retryContext.currentAreaName || retryContext.currentAreaId}' reached collision threshold (${count} retries). Marking area exhausted to try next section.`
        );
        retryContext.failedAreaIds.add(retryContext.currentAreaId);
        if (retryContext.currentAreaName) {
          retryContext.failedAreaIds.add(retryContext.currentAreaName);
        }
      }
    }
  }

  private async runJourney(
    preferences: BookingPreferences,
    latencyTracker?: LatencyTracker,
    retryContext?: JourneyRetryContext
  ): Promise<JourneyExecutionResult> {
    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
    const isOnPayment = currentUrl.includes('/payment') || currentUrl.includes('/checkout');
    const isOnQuestionForm = currentUrl.includes('/question-form');
    const isOnSelectTicket =
      currentUrl.includes('/select-ticket') || currentUrl.includes('/booking');

    // Error modal check at journey entry (e.g. -1242 seat unavailable popup)
    if (this.adapter.detectAndHandleErrorModal) {
      const modalResult = await this.adapter.detectAndHandleErrorModal();
      if (modalResult.hasError && modalResult.isSeatUnavailable) {
        this.logger.warn(
          'Seat unavailable modal detected on page (-1242). Retrying alternative seat...',
          {
            seat: modalResult.seatLabel,
          }
        );
        this.recordSeatCollision(retryContext, modalResult.seatLabel);
        throw new BookingError({
          code: 'SEAT_UNAVAILABLE',
          message: `Seat ${modalResult.seatLabel ?? 'selected'} is already reserved by another user. Retrying alternative seat.`,
          state: this.stateMachine.state,
          recoverable: true,
        });
      }
    }

    if (isOnPayment) {
      this.stateMachine.transition({ type: 'PAYMENT_GATE' });
      this.logger.info('Payment step reached — user action required.');
      await this.eventBus.publish({
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

    if (isOnQuestionForm) {
      this.logger.info('Executing Question / Attendee Form step on question-form page');
      if (this.adapter.detectAndHandleErrorModal) {
        const modalResult = await this.adapter.detectAndHandleErrorModal();
        if (modalResult.hasError && modalResult.isSeatUnavailable) {
          this.recordSeatCollision(retryContext, modalResult.seatLabel);
          throw new BookingError({
            code: 'SEAT_UNAVAILABLE',
            message: `Seat ${modalResult.seatLabel ?? 'selected'} is already reserved. Retrying alternative seat.`,
            state: this.stateMachine.state,
            recoverable: true,
          });
        }
      }

      const tFormStart = Date.now();
      const formSchema = this.adapter.getFormSchema ? await this.adapter.getFormSchema() : null;
      latencyTracker?.recordFormDetection(Date.now() - tFormStart);

      if (formSchema && formSchema.fields.length > 0) {
        this.stateMachine.transition({
          type: 'QUESTION_FORM_DETECTED',
          fieldCount: formSchema.fields.length,
        });
        this.logger.info(`Question form detected: ${formSchema.fields.length} fields`);

        this.stateMachine.transition({ type: 'FILLING_ATTENDEE_FORM' });

        const blocked = this.profileGate(formSchema, preferences);
        if (blocked) return blocked;

        if (this.adapter.fillAttendeeForm && preferences.userProfile) {
          const fillResult = await this.adapter.fillAttendeeForm(preferences.userProfile);

          if (fillResult.isConsentBlocked) {
            this.stateMachine.transition({
              type: 'CONSENT_REQUIRED',
              consentLabel: formSchema.consentLabel,
            });
            this.logger.warn('User consent required for terms and conditions');
            await this.eventBus.publish({
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
            this.logger.warn('Form has unsatisfied required fields', {
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

        this.stateMachine.transition({ type: 'FORM_VALIDATED' });
        this.logger.info('Form validated successfully');
      }

      // Submit question form by clicking "Tiếp tục"
      if (this.adapter.proceedToNextStep) {
        this.logger.info('Submitting attendee form / proceeding to payment step');
        await this.adapter.proceedToNextStep();
        await new Promise((r) => setTimeout(r, 100));

        // Check for error modal right after click
        if (this.adapter.detectAndHandleErrorModal) {
          const modalResult = await this.adapter.detectAndHandleErrorModal();
          if (modalResult.hasError && modalResult.isSeatUnavailable) {
            this.recordSeatCollision(retryContext, modalResult.seatLabel);
            throw new BookingError({
              code: 'SEAT_UNAVAILABLE',
              message: `Seat ${modalResult.seatLabel ?? 'selected'} is already reserved. Retrying alternative seat.`,
              state: this.stateMachine.state,
              recoverable: true,
            });
          }
        }

        if (formSchema && formSchema.fields.length > 0) {
          const closed = await this.waitForQuestionFormToClose();
          if (!closed) {
            if (this.adapter.detectAndHandleErrorModal) {
              const modalResult = await this.adapter.detectAndHandleErrorModal();
              if (modalResult.hasError && modalResult.isSeatUnavailable) {
                this.recordSeatCollision(retryContext, modalResult.seatLabel);
                throw new BookingError({
                  code: 'SEAT_UNAVAILABLE',
                  message: `Seat ${modalResult.seatLabel ?? 'selected'} is already reserved. Retrying alternative seat.`,
                  state: this.stateMachine.state,
                  recoverable: true,
                });
              }
            }
            return this.formNotAdvancedResult();
          }
        }
      }

      // Verify URL before claiming PAYMENT_GATE
      const afterSubmitUrl = typeof window !== 'undefined' ? window.location.href : '';
      const isActualPayment =
        afterSubmitUrl.includes('/payment') ||
        afterSubmitUrl.includes('/checkout') ||
        !afterSubmitUrl.includes('ticketbox.vn');

      if (!isActualPayment) {
        this.logger.info('Question form submitted, waiting for navigation to payment page...', {
          currentUrl: afterSubmitUrl,
        });
        return {
          success: true,
          finalState: this.stateMachine.state,
          requiresUserAction: false,
          actionRequiredReason: 'Navigating to payment gate...',
        };
      }

      this.stateMachine.transition({ type: 'PAYMENT_GATE' });
      this.logger.info('Payment step reached — user action required.');
      await this.eventBus.publish({
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

    if (this.adapter.setScopedPlan) {
      this.adapter.setScopedPlan(preferences.scopedPurchasePlan ?? null);
    }

    // 1. EVENT & SHOWING DETECTION
    const eventState = this.adapter.getEventState
      ? await this.adapter.getEventState()
      : { event: null, showing: null, ticketTypes: [] };

    if (eventState.event) {
      this.stateMachine.transition({
        type: 'EVENT_DETECTED',
        eventId: eventState.event.id,
        eventTitle: eventState.event.name,
      });
      this.logger.info(`Event detected: ${eventState.event.name}`);
    }

    const showings = await this.adapter.discoverShowings();
    const meaningfulShowings = showings.filter(
      (s) => s.id !== null || s.name !== null || s.date !== null || s.ticketTypes.length > 0
    );
    if (meaningfulShowings.length > 0) {
      const activeShowing =
        (preferences.preferredShowingId
          ? meaningfulShowings.find((s) => s.id === preferences.preferredShowingId)
          : null) || meaningfulShowings[0]!;
      this.stateMachine.transition({
        type: 'SHOWING_DETECTED',
        showingId: activeShowing.id ?? undefined,
        date: activeShowing.date ?? undefined,
      });
      this.logger.info(
        `Showing detected: ${activeShowing.name ?? activeShowing.date ?? 'Default'}`
      );
    }

    // 2. TICKET DISCOVERY
    const tDiscoveryStart = Date.now();
    const tickets: JourneyTicketType[] = this.adapter.discoverJourneyTickets
      ? await this.adapter.discoverJourneyTickets(preferences.preferredShowingId)
      : [];

    const tDiscoveryEnd = Date.now();
    latencyTracker?.recordTicketDiscovery(tDiscoveryEnd - tDiscoveryStart);

    this.stateMachine.transition({
      type: 'TICKETS_DETECTED',
      ticketCount: tickets.length,
    });
    this.logger.info(`Tickets detected: ${tickets.length}`);

    if (tickets.length === 0) {
      throw new BookingError({
        code: 'NO_TICKETS',
        message: 'No ticket tiers detected on page',
        state: this.stateMachine.state,
        recoverable: true,
      });
    }

    for (const t of tickets) {
      this.logger.info(`Ticket tier: ${t.name} — ${t.availability} — ${t.mode} — ${t.price} VND`);
    }

    // 3. AVAILABILITY EVALUATION & PRIORITY DECISION
    const tDecisionStart = Date.now();
    this.stateMachine.transition({ type: 'EVALUATING_TICKETS' });

    const effectiveTickets = retryContext
      ? tickets.filter(
          (t) =>
            !retryContext.exhaustedTierNames.has(t.name) &&
            (!t.id || !retryContext.exhaustedTierNames.has(t.id))
        )
      : tickets;

    const decision = PriorityCategoryEngine.evaluate(
      effectiveTickets.length > 0 ? effectiveTickets : tickets,
      preferences.categoryPriority,
      preferences.allowFallback,
      preferences.quantity,
      preferences.scopedPurchasePlan
    );
    const tDecisionEnd = Date.now();
    latencyTracker?.recordTicketDecision(tDecisionEnd - tDecisionStart);

    if (!decision.selectedTicket) {
      this.logger.warn(`No ticket selected: ${decision.reason}`);
      const waitType = preferences.scopedPurchasePlan ? 'WAITING_FOR_STOCK' : 'WAITING';
      const waitState = preferences.scopedPurchasePlan
        ? PurchaseState.WAITING_FOR_STOCK
        : PurchaseState.WAITING;
      this.stateMachine.transition({
        type: waitType,
        reason: decision.reason,
      });
      return {
        success: false,
        finalState: waitState,
        requiresUserAction: false,
        actionRequiredReason: decision.reason,
      };
    }

    const chosenTicket = decision.selectedTicket;
    this.logger.info(`Selected ticket: ${chosenTicket.name}`, {
      reason: decision.reason,
      fallbackUsed: decision.fallbackUsed,
    });

    // 4. TICKET SELECTION & VERIFICATION (Section 7)
    const tSelectionStart = Date.now();
    const ticketId = chosenTicket.id ?? chosenTicket.name;
    const targetShowingId = chosenTicket.showingId ?? preferences.preferredShowingId ?? null;
    const selectedSuccess = await this.adapter.selectTicket(
      ticketId,
      preferences.quantity,
      targetShowingId
    );
    const tSelectionEnd = Date.now();
    latencyTracker?.recordTicketSelection(tSelectionEnd - tSelectionStart);

    if (!selectedSuccess) {
      throw new BookingError({
        code: 'TICKET_SELECTION_FAILED',
        message: `Failed to select ticket '${chosenTicket.name}' or verification failed`,
        state: this.stateMachine.state,
        recoverable: true,
      });
    }

    this.stateMachine.transition({
      type: 'TICKET_SELECTED',
      ticketId,
      ticketName: chosenTicket.name,
      price: chosenTicket.price,
    });

    await this.eventBus.publish({
      type: 'NOTIFICATION_EVENT',
      timestamp: new Date().toISOString(),
      category: 'TICKET_SELECTED',
      title: 'Ticketbox Assistant',
      body: `Ticket selected: ${chosenTicket.name} (Qty: ${preferences.quantity})`,
    });

    // If navigation to /select-ticket was initiated from event page, yield for page navigation
    if (
      this.adapter.isNavigationPending &&
      this.adapter.isNavigationPending() &&
      !isOnSelectTicket
    ) {
      this.logger.info(
        'Navigation to seat selection page initiated. Yielding for page transition.'
      );
      return {
        success: true,
        finalState: PurchaseState.TICKET_SELECTED,
        selection: {
          ticketId,
          name: chosenTicket.name,
          price: chosenTicket.price,
          currency: chosenTicket.currency,
          mode: chosenTicket.mode,
          quantity: preferences.quantity,
          seats: [],
          selectedAt: new Date().toISOString(),
        },
        requiresUserAction: false,
        actionRequiredReason: 'Navigating to booking / seat selection page...',
      };
    }

    // 5. BOOKING MODE DETECTION (Section 8)
    let bookingMode = chosenTicket.mode;
    const seatMapInfo = await this.adapter.detectSeatMap();
    if (seatMapInfo && seatMapInfo.hasSeatMap) {
      bookingMode = 'SEATED';
      this.logger.info('Seat map detected on page; classifying mode as SEATED');
    } else if (bookingMode === 'UNKNOWN') {
      bookingMode = 'STANDING';
      this.logger.info('No seat map detected on page; defaulting general admission to STANDING');
    }

    this.stateMachine.transition({
      type: 'BOOKING_MODE_DETECTED',
      mode: bookingMode,
    });
    this.logger.info(`Booking mode: ${bookingMode}`);

    const currentSelection: CurrentSelection = {
      ticketId,
      name: chosenTicket.name,
      price: chosenTicket.price,
      currency: chosenTicket.currency,
      mode: bookingMode,
      quantity: preferences.quantity,
      seats: [],
      selectedAt: new Date().toISOString(),
      allowPartialQuantity: preferences.scopedPurchasePlan?.allowPartialQuantity ?? false,
    };

    // 6. STANDING FLOW vs SEATED FLOW
    if (bookingMode === 'STANDING') {
      // STANDING FLOW (Section 9)
      this.stateMachine.transition({
        type: 'SELECTING_QUANTITY',
        quantity: preferences.quantity,
      });

      const qtySuccess = await this.adapter.selectQuantity(
        {
          id: chosenTicket.id,
          name: chosenTicket.name,
          price: { amount: chosenTicket.price, currency: 'VND' },
          mode: 'STANDING',
          availability: 'AVAILABLE',
          minQuantity: chosenTicket.minQuantity,
          maxQuantity: chosenTicket.maxQuantity,
          selectedQuantity: preferences.quantity,
          selectable: true,
          source: { page: 'BOOKING', evidence: [] },
        },
        preferences.quantity
      );

      if (!qtySuccess) {
        throw new BookingError({
          code: 'QUANTITY_CONTROL_NOT_FOUND',
          message: `Setting quantity to ${preferences.quantity} failed`,
          state: this.stateMachine.state,
          recoverable: true,
        });
      }
      this.logger.info(`Quantity set: ${preferences.quantity}`);
    } else {
      // SEATED FLOW (Section 10, 11, 12, 13)
      // A. Area Selection check
      const seatMapInfo = await this.adapter.detectSeatMap();
      this.logger.debug('Seat map layout inspected', { hasSeatMap: seatMapInfo.hasSeatMap });
      let chosenArea: import('../../domain/entities/BookingJourneyModels').SeatArea | null = null;
      if (this.adapter.discoverAreas) {
        const areas = await this.adapter.discoverAreas();
        if (areas.length > 0) {
          this.stateMachine.transition({ type: 'AREA_SELECTION_REQUIRED' });
          const matchingAreas = areas.filter(
            (a) =>
              (a.ticketTypeId === chosenTicket.id ||
                a.id === chosenTicket.id ||
                (a.ticketTypeName &&
                  a.ticketTypeName.toLowerCase().trim() ===
                    chosenTicket.name.toLowerCase().trim()) ||
                a.name.toLowerCase().trim() === chosenTicket.name.toLowerCase().trim() ||
                a.name.replace(/_/g, ' ').toLowerCase().trim() ===
                  chosenTicket.name.toLowerCase().trim() ||
                a.name.toLowerCase().includes(chosenTicket.name.toLowerCase()) ||
                chosenTicket.name.toLowerCase().includes(a.name.toLowerCase())) &&
              a.selectable &&
              a.availability === 'AVAILABLE'
          );

          // Select first available area that has not failed or been exhausted in this cycle
          let targetArea = matchingAreas.find(
            (a) =>
              !retryContext?.failedAreaIds.has(a.id) && !retryContext?.failedAreaIds.has(a.name)
          );

          // If all matching areas for this ticket tier are exhausted, fall back to next ticket tier
          if (!targetArea && matchingAreas.length > 0) {
            this.logger.warn(
              `All areas for ticket tier '${chosenTicket.name}' exhausted (${matchingAreas.map((a) => a.name).join(', ')}). Falling back to next available ticket tier.`
            );
            if (retryContext) {
              retryContext.exhaustedTierNames.add(chosenTicket.name);
              if (chosenTicket.id) retryContext.exhaustedTierNames.add(chosenTicket.id);
            }
            throw new BookingError({
              code: 'ALL_AREAS_EXHAUSTED',
              message: `All sections/areas for '${chosenTicket.name}' are exhausted`,
              state: this.stateMachine.state,
              recoverable: true,
            });
          }

          if (!targetArea) {
            targetArea = areas.find(
              (a) =>
                a.selectable &&
                a.availability === 'AVAILABLE' &&
                !retryContext?.failedAreaIds.has(a.id)
            );
          }

          if (!targetArea) {
            throw new BookingError({
              code: 'NO_AVAILABLE_SEATS',
              message: `No available seat areas found matching '${chosenTicket.name}'`,
              state: this.stateMachine.state,
              recoverable: false,
            });
          }

          chosenArea = targetArea;
          if (retryContext) {
            retryContext.currentAreaId = targetArea.id;
            retryContext.currentAreaName = targetArea.name;
          }
          const tAreaStart = Date.now();
          this.stateMachine.transition({
            type: 'SELECTING_AREA',
            areaId: targetArea.id,
            areaName: targetArea.name,
          });

          if (this.adapter.selectArea) {
            await this.adapter.selectArea(
              targetArea.id,
              targetArea.name,
              targetArea.ticketTypeId,
              targetArea.x !== undefined
                ? {
                    x: targetArea.x,
                    y: targetArea.y,
                    width: targetArea.width,
                    height: targetArea.height,
                  }
                : undefined
            );
          }
          latencyTracker?.recordAreaSelection(Date.now() - tAreaStart);
          currentSelection.areaId = targetArea.id;
          currentSelection.areaName = targetArea.name;
          this.logger.info(`Target area selected: ${targetArea.name}`);
        }
      }

      // B. Seat Discovery
      const tSeatDiscStart = Date.now();
      const targetAreaOrName =
        currentSelection.areaId || currentSelection.areaName || chosenTicket.name;
      const availableSeats = this.adapter.discoverSeats
        ? await this.adapter.discoverSeats(targetAreaOrName)
        : [];
      latencyTracker?.recordSeatDiscovery(Date.now() - tSeatDiscStart);

      this.logger.info(`Available seats detected: ${availableSeats.length}`);

      // Area-based / Non-reserving seat selection (e.g. ULTRA VIP - L2, STARDOM - L, FANZONE)
      // Also handles the case where discoverAreas() returned 0 results (Konva canvas not parsed
      // by DOM selectors) so chosenArea is null, but the chosen ticket zone has no individual
      // seats — e.g. FANZONE standing zones on a Konva seatmap.
      const isAreaBased =
        chosenArea?.isReservingSeat === false ||
        (availableSeats.length === 0 && chosenArea && chosenArea.mode === 'AREA_BASED') ||
        (availableSeats.length === 0 && chosenArea === null);

      if (isAreaBased && availableSeats.length === 0) {
        this.logger.info(
          `Target area '${chosenArea?.name ?? chosenTicket.name}' is an area-based ticket tier (no individual seats to pick).`
        );

        if (this.adapter.selectQuantity) {
          try {
            await this.adapter.selectQuantity(
              {
                id: chosenTicket.id,
                name: chosenTicket.name,
                price: { amount: chosenTicket.price, currency: 'VND' },
                mode: 'SEATED',
                availability: 'AVAILABLE',
                minQuantity: chosenTicket.minQuantity,
                maxQuantity: chosenTicket.maxQuantity,
                selectedQuantity: preferences.quantity,
                selectable: true,
                source: { page: 'BOOKING', evidence: [] },
              },
              preferences.quantity
            );
          } catch {
            // ignore if quantity control not rendered in area view
          }
        }

        const seatLabel = chosenArea ? chosenArea.name : chosenTicket.name;
        currentSelection.seats = [seatLabel];
        if (this.stateMachine.state === PurchaseState.BOOKING_MODE_DETECTED) {
          try {
            this.stateMachine.transition({ type: 'AREA_SELECTION_REQUIRED' });
            this.stateMachine.transition({ type: 'SELECTING_AREA' });
          } catch {
            // ignore
          }
        } else if (this.stateMachine.state === PurchaseState.AREA_SELECTION_REQUIRED) {
          try {
            this.stateMachine.transition({ type: 'SELECTING_AREA' });
          } catch {
            // ignore
          }
        }
        this.stateMachine.transition({
          type: 'SEATS_SELECTED',
          seats: [seatLabel],
        });
        this.logger.info(`Area-based seat selection confirmed: ${seatLabel}`);
        await this.eventBus.publish({
          type: 'NOTIFICATION_EVENT',
          timestamp: new Date().toISOString(),
          category: 'SEATS_SELECTED',
          title: 'Ticketbox Assistant',
          body: `Area selected: ${seatLabel}`,
        });
      } else {
        this.stateMachine.transition({ type: 'SEAT_MAP_DETECTED' });

        const validAvailableSeats = availableSeats.filter(
          (s) =>
            !this.adapter.isSeatBlacklisted?.(s.id) && !this.adapter.isSeatBlacklisted?.(s.label)
        );

        if (validAvailableSeats.length === 0) {
          if (retryContext && currentSelection.areaId) {
            retryContext.failedAreaIds.add(currentSelection.areaId);
            if (currentSelection.areaName) {
              retryContext.failedAreaIds.add(currentSelection.areaName);
            }
          }
          // Use chosenTicket.name as fallback so the log never shows 'undefined'
          const areaLabel =
            currentSelection.areaName ?? currentSelection.areaId ?? chosenTicket.name;
          this.logger.warn(
            `No available seats in area '${areaLabel}' (all taken or blacklisted). Retrying next area.`
          );
          throw new BookingError({
            code: 'NO_AVAILABLE_SEATS',
            message: `No available seats discovered on seat map for '${areaLabel}' (all taken or blacklisted)`,
            state: this.stateMachine.state,
            recoverable: true,
          });
        }

        // Check if user already has selected seat(s) on the seat map (e.g. L-28), excluding blacklisted
        const alreadySelected = validAvailableSeats.filter((s) => s.status === 'SELECTED');
        if (alreadySelected.length >= preferences.quantity) {
          const seatLabels = alreadySelected.slice(0, preferences.quantity).map((s) => s.label);
          currentSelection.seats = seatLabels;
          this.stateMachine.transition({
            type: 'SEATS_SELECTED',
            seats: seatLabels,
          });
          this.logger.info(`Existing selected seats recognized: ${seatLabels.join(', ')}`);
          await this.eventBus.publish({
            type: 'NOTIFICATION_EVENT',
            timestamp: new Date().toISOString(),
            category: 'SEATS_SELECTED',
            title: 'Ticketbox Assistant',
            body: `Seats selected: ${seatLabels.join(', ')}`,
          });
        } else {
          // C. Adjacent Seat Selection Strategy
          const tSeatSelStart = Date.now();
          this.stateMachine.transition({ type: 'SELECTING_SEATS' });

          const blacklisted = this.adapter.getBlacklistedSeats
            ? this.adapter.getBlacklistedSeats()
            : undefined;
          const seatDecision = AdjacentSeatStrategy.selectSeats(
            validAvailableSeats,
            preferences.quantity,
            currentSelection.areaId ?? undefined,
            preferences.seatPreference ?? 'ANY_AVAILABLE',
            preferences.nonAdjacentFallback ?? 'SELECT_NON_ADJACENT',
            blacklisted
          );

          if (seatDecision.status === 'WAIT') {
            const waitType = preferences.scopedPurchasePlan ? 'WAITING_FOR_STOCK' : 'WAITING';
            const waitState = preferences.scopedPurchasePlan
              ? PurchaseState.WAITING_FOR_STOCK
              : PurchaseState.WAITING;
            this.stateMachine.transition({
              type: waitType,
              reason: seatDecision.reason,
            });
            return {
              success: false,
              finalState: waitState,
              requiresUserAction: false,
              actionRequiredReason: seatDecision.reason,
            };
          }

          if (seatDecision.status !== 'SUCCESS' || seatDecision.selectedSeats.length === 0) {
            if (retryContext && currentSelection.areaId) {
              retryContext.failedAreaIds.add(currentSelection.areaId);
              if (currentSelection.areaName) {
                retryContext.failedAreaIds.add(currentSelection.areaName);
              }
            }
            throw new BookingError({
              code: 'SEAT_SELECTION_FAILED',
              message: seatDecision.reason,
              state: this.stateMachine.state,
              recoverable: true,
            });
          }

          const seatIds = seatDecision.selectedSeats.map((s) => s.id);
          const seatLabels = seatDecision.selectedSeats.map((s) => s.label);

          if (this.adapter.selectSpecificSeats) {
            const seatsOk = await this.adapter.selectSpecificSeats(seatIds);
            if (!seatsOk) {
              throw new BookingError({
                code: 'SEAT_SELECTION_FAILED',
                message: 'Seat selection click or verification failed',
                state: this.stateMachine.state,
                recoverable: true,
              });
            }
          }

          latencyTracker?.recordSeatSelection(Date.now() - tSeatSelStart);
          currentSelection.seats = seatLabels;

          this.stateMachine.transition({
            type: 'SEATS_SELECTED',
            seats: seatLabels,
          });
          this.logger.info(`Seats selected: ${seatLabels.join(', ')}`);

          await this.eventBus.publish({
            type: 'NOTIFICATION_EVENT',
            timestamp: new Date().toISOString(),
            category: 'SEATS_SELECTED',
            title: 'Ticketbox Assistant',
            body: `Seats selected: ${seatLabels.join(', ')}`,
          });
        }
      }
    }

    // Advance to next step if applicable (e.g. click "Tiếp tục" / "Đặt vé")
    if (this.adapter.proceedToNextStep) {
      const proceedOk = await this.adapter.proceedToNextStep();
      if (proceedOk) {
        // Fast-poll for error modal (e.g. -1242 seat collision) that appears immediately after clicking proceed
        for (let i = 0; i < 3; i++) {
          await new Promise((r) => setTimeout(r, 120));
          if (this.adapter.detectAndHandleErrorModal) {
            const modalResult = await this.adapter.detectAndHandleErrorModal();
            if (modalResult.hasError && modalResult.isSeatUnavailable) {
              this.logger.warn(
                'Seat unavailable error modal detected after proceeding (-1242). Retrying alternative seat...',
                { seat: modalResult.seatLabel }
              );
              this.recordSeatCollision(retryContext, modalResult.seatLabel);
              throw new BookingError({
                code: 'SEAT_UNAVAILABLE',
                message: `Seat ${modalResult.seatLabel ?? 'selected'} was already booked (-1242). Reselecting another seat.`,
                state: this.stateMachine.state,
                recoverable: true,
              });
            }
          }
        }
      } else if (isOnSelectTicket) {
        this.logger.warn('Failed to proceed to next step after seat selection on select-ticket');
        throw new BookingError({
          code: 'PROCEED_FAILED',
          message: 'Failed to click continue button after seat selection',
          state: this.stateMachine.state,
          recoverable: true,
        });
      }
    }

    // If on /select-ticket, clicking proceed navigates to /question-form
    if (isOnSelectTicket) {
      if (this.adapter.detectAndHandleErrorModal) {
        const modalResult = await this.adapter.detectAndHandleErrorModal();
        if (modalResult.hasError && modalResult.isSeatUnavailable) {
          this.logger.warn(
            'Seat unavailable error modal detected on select-ticket before yield (-1242). Retrying alternative seat...',
            { seat: modalResult.seatLabel }
          );
          this.recordSeatCollision(retryContext, modalResult.seatLabel);
          throw new BookingError({
            code: 'SEAT_UNAVAILABLE',
            message: `Seat ${modalResult.seatLabel ?? 'selected'} was already booked (-1242). Reselecting another seat.`,
            state: this.stateMachine.state,
            recoverable: true,
          });
        }
      }

      this.logger.info(
        'Seat selection submitted on select-ticket page. Yielding for question form navigation.'
      );
      return {
        success: true,
        finalState: PurchaseState.SEATS_SELECTED,
        selection: currentSelection,
        requiresUserAction: false,
        actionRequiredReason: 'Seats selected. Navigating to question form...',
      };
    }

    // 7. BOOKING SUMMARY VERIFICATION (Section 15, 16)
    const tSumStart = Date.now();
    const summary = this.adapter.getBookingSummary ? await this.adapter.getBookingSummary() : null;
    latencyTracker?.recordSummaryVerification(Date.now() - tSumStart);

    if (summary) {
      this.stateMachine.transition({
        type: 'BOOKING_SUMMARY_DETECTED',
        summary: summary as unknown as Record<string, unknown>,
      });

      const verification = BookingSummaryVerifier.verify(summary, currentSelection);
      if (!verification.isValid) {
        this.logger.error('Booking summary mismatch', { errors: verification.errors });
        throw new BookingError({
          code: 'SUMMARY_MISMATCH',
          message: `Summary mismatch: ${verification.errors.join('; ')}`,
          state: this.stateMachine.state,
          recoverable: false,
        });
      }
      this.logger.info('Booking summary verified successfully');
    }

    // 8. QUESTION / ATTENDEE FORM (Section 17, 18, 19, 20)
    const tFormStart = Date.now();
    const formSchema = this.adapter.getFormSchema ? await this.adapter.getFormSchema() : null;
    latencyTracker?.recordFormDetection(Date.now() - tFormStart);

    if (formSchema && formSchema.fields.length > 0) {
      this.stateMachine.transition({
        type: 'QUESTION_FORM_DETECTED',
        fieldCount: formSchema.fields.length,
      });
      this.logger.info(`Question form detected: ${formSchema.fields.length} fields`);

      this.stateMachine.transition({ type: 'FILLING_ATTENDEE_FORM' });

      const blocked = this.profileGate(formSchema, preferences, currentSelection);
      if (blocked) return blocked;

      if (this.adapter.fillAttendeeForm && preferences.userProfile) {
        const fillResult = await this.adapter.fillAttendeeForm(preferences.userProfile);

        if (fillResult.isConsentBlocked) {
          // Consent Gate (Section 20)
          this.stateMachine.transition({
            type: 'CONSENT_REQUIRED',
            consentLabel: formSchema.consentLabel,
          });
          this.logger.warn('User consent required for terms and conditions');

          await this.eventBus.publish({
            type: 'NOTIFICATION_EVENT',
            timestamp: new Date().toISOString(),
            category: 'CONSENT_REQUIRED',
            title: 'Ticketbox Assistant',
            body: 'User consent required to proceed with booking',
          });

          return {
            success: true,
            finalState: PurchaseState.CONSENT_REQUIRED,
            selection: currentSelection,
            requiresUserAction: true,
            actionRequiredReason: 'User consent required',
          };
        }

        if (!fillResult.allSatisfied) {
          this.logger.warn('Form has unsatisfied required fields', {
            missing: fillResult.missingFields,
          });
          return {
            success: true,
            finalState: PurchaseState.FILLING_ATTENDEE_FORM,
            selection: currentSelection,
            requiresUserAction: true,
            actionRequiredReason: `Required fields missing: ${fillResult.missingFields.join(', ')}`,
          };
        }
      }

      this.stateMachine.transition({ type: 'FORM_VALIDATED' });
      this.logger.info('Form validated successfully');
    }

    // 9. PAYMENT GATE (Section 21)
    const afterAllUrl = typeof window !== 'undefined' ? window.location.href : '';
    const isActualPayment =
      afterAllUrl.includes('/payment') ||
      afterAllUrl.includes('/checkout') ||
      !afterAllUrl.includes('ticketbox.vn');

    if (!isActualPayment) {
      this.logger.info('Awaiting navigation to payment page...', { currentUrl: afterAllUrl });
      return {
        success: true,
        finalState: this.stateMachine.state,
        selection: currentSelection,
        requiresUserAction: false,
        actionRequiredReason: 'Waiting for navigation to payment gate...',
      };
    }

    this.stateMachine.transition({ type: 'PAYMENT_GATE' });
    this.logger.info('Payment step reached — user action required.');

    await this.eventBus.publish({
      type: 'NOTIFICATION_EVENT',
      timestamp: new Date().toISOString(),
      category: 'PAYMENT_REQUIRED',
      title: 'Ticketbox Assistant',
      body: 'Payment step reached — user action required.',
    });

    return {
      success: true,
      finalState: PurchaseState.PAYMENT_GATE,
      selection: currentSelection,
      requiresUserAction: true,
      actionRequiredReason: 'Payment step reached — user action required.',
    };
  }
}
