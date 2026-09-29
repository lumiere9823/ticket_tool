import { PurchaseStateMachine } from '../../domain/state-machine/PurchaseStateMachine';
import { TicketboxPageAdapter } from '../ports/TicketboxPageAdapter';
import { EventBus } from '../ports/EventBus';
import { LoggerPort } from '../ports/LoggerPort';
import { LatencyTracker } from '../services/LatencyTracker';
import { PurchaseState, FailureReason } from '../../domain/states/PurchaseState';
import {
  BookingPreferences,
  CurrentSelection,
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

export class ExecuteBookingJourneyUseCase {
  private readonly MAX_RETRIES = 3;

  constructor(
    private readonly stateMachine: PurchaseStateMachine,
    private readonly adapter: TicketboxPageAdapter,
    private readonly eventBus: EventBus,
    private readonly logger: LoggerPort
  ) {}

  private getState(): PurchaseState {
    return this.stateMachine.state;
  }

  public async execute(
    preferences: BookingPreferences,
    latencyTracker?: LatencyTracker
  ): Promise<JourneyExecutionResult> {
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

    if (currentState === PurchaseState.CONFIRMED || currentState === PurchaseState.HELD) {
      this.logger.info(`State machine already ${currentState}. Halting.`);
      return {
        success: true,
        finalState: currentState,
        requiresUserAction: true,
      };
    }

    // Reset if in stale terminal state on non-payment page
    if (
      currentState === PurchaseState.PAYMENT_GATE ||
      currentState === PurchaseState.FAILED ||
      currentState === PurchaseState.STOPPED
    ) {
      try {
        this.stateMachine.transition({ type: 'RESET_REQUESTED' });
        this.stateMachine.transition({ type: 'ARM' });
        this.stateMachine.transition({ type: 'MONITORING_STARTED' });
      } catch {
        // ignore
      }
    }

    let retries = 0;
    let lastError: unknown;

    while (retries <= this.MAX_RETRIES) {
      if (retries > 0) {
        const retryState = this.getState();
        if (
          retryState === PurchaseState.PAYMENT_GATE ||
          retryState === PurchaseState.CONFIRMED ||
          retryState === PurchaseState.HELD ||
          retryState === PurchaseState.CONSENT_REQUIRED
        ) {
          this.logger.info(`Target state ${retryState} reached during journey. Halting retries.`);
          return {
            success: true,
            finalState: retryState,
            requiresUserAction: true,
          };
        }

        try {
          if (retryState !== PurchaseState.STOPPED && retryState !== PurchaseState.FAILED) {
            this.stateMachine.transition({ type: 'STOP_REQUESTED', reason: 'Journey retry reset' });
          }
          this.stateMachine.transition({ type: 'RESET_REQUESTED' });
          this.stateMachine.transition({ type: 'ARM' });
          this.stateMachine.transition({ type: 'MONITORING_STARTED' });
        } catch {
          // ignore
        }
      }
      try {
        return await this.runJourney(preferences, latencyTracker);
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
        await new Promise((r) => setTimeout(r, 400 * retries));

        // Return to ticket discovery on stale element / DOM refresh
        if (
          this.stateMachine.state !== PurchaseState.STOPPED &&
          this.stateMachine.state !== PurchaseState.FAILED
        ) {
          try {
            this.stateMachine.transition({ type: 'TICKETS_DETECTED' });
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
  }

  private async runJourney(
    preferences: BookingPreferences,
    latencyTracker?: LatencyTracker
  ): Promise<JourneyExecutionResult> {
    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
    const isOnPayment = currentUrl.includes('/payment') || currentUrl.includes('/checkout');
    const isOnQuestionForm = currentUrl.includes('/question-form');
    const isOnSelectTicket =
      currentUrl.includes('/select-ticket') || currentUrl.includes('/booking');

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
        await new Promise((r) => setTimeout(r, 600));
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

    // 1. EVENT & SHOWING DETECTION
    const eventState = await this.adapter.getEventState();
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
      const activeShowing = meaningfulShowings[0]!;
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
      ? await this.adapter.discoverJourneyTickets()
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

    const decision = PriorityCategoryEngine.evaluate(
      tickets,
      preferences.categoryPriority,
      preferences.allowFallback,
      preferences.quantity
    );
    const tDecisionEnd = Date.now();
    latencyTracker?.recordTicketDecision(tDecisionEnd - tDecisionStart);

    if (!decision.selectedTicket) {
      this.logger.warn(`No ticket selected: ${decision.reason}`);
      this.stateMachine.transition({
        type: 'WAITING',
        reason: decision.reason,
      });
      return {
        success: false,
        finalState: PurchaseState.WAITING,
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
    const selectedSuccess = await this.adapter.selectTicket(ticketId, preferences.quantity);
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
      if (this.adapter.discoverAreas) {
        const areas = await this.adapter.discoverAreas();
        if (areas.length > 0) {
          this.stateMachine.transition({ type: 'AREA_SELECTION_REQUIRED' });
          const matchingArea = areas.find(
            (a) =>
              (a.name.toLowerCase() === chosenTicket.name.toLowerCase() ||
                a.id === chosenTicket.id ||
                a.name.toLowerCase().includes(chosenTicket.name.toLowerCase()) ||
                chosenTicket.name.toLowerCase().includes(a.name.toLowerCase())) &&
              a.selectable &&
              a.availability === 'AVAILABLE'
          );
          const targetArea =
            matchingArea || areas.find((a) => a.selectable && a.availability === 'AVAILABLE');

          if (!targetArea) {
            throw new BookingError({
              code: 'NO_AVAILABLE_SEATS',
              message: `No available seat areas found matching '${chosenTicket.name}'`,
              state: this.stateMachine.state,
              recoverable: false,
            });
          }

          const tAreaStart = Date.now();
          this.stateMachine.transition({
            type: 'SELECTING_AREA',
            areaId: targetArea.id,
            areaName: targetArea.name,
          });

          if (this.adapter.selectArea) {
            await this.adapter.selectArea(targetArea.id);
          }
          latencyTracker?.recordAreaSelection(Date.now() - tAreaStart);
          currentSelection.areaId = targetArea.id;
          currentSelection.areaName = targetArea.name;
          this.logger.info(`Target area selected: ${targetArea.name}`);
        }
      }

      // B. Seat Discovery
      const tSeatDiscStart = Date.now();
      this.stateMachine.transition({ type: 'SEAT_MAP_DETECTED' });
      const targetAreaOrName =
        currentSelection.areaId || currentSelection.areaName || chosenTicket.name;
      const availableSeats = this.adapter.discoverSeats
        ? await this.adapter.discoverSeats(targetAreaOrName)
        : [];
      latencyTracker?.recordSeatDiscovery(Date.now() - tSeatDiscStart);

      this.logger.info(`Available seats detected: ${availableSeats.length}`);

      if (availableSeats.length === 0) {
        throw new BookingError({
          code: 'NO_AVAILABLE_SEATS',
          message: 'No available seats discovered on seat map',
          state: this.stateMachine.state,
          recoverable: true,
        });
      }

      // Check if user already has selected seat(s) on the seat map (e.g. L-28)
      const alreadySelected = availableSeats.filter((s) => s.status === 'SELECTED');
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

        const seatDecision = AdjacentSeatStrategy.selectSeats(
          availableSeats,
          preferences.quantity,
          currentSelection.areaId ?? undefined,
          preferences.seatPreference ?? 'ANY_AVAILABLE',
          preferences.nonAdjacentFallback ?? 'SELECT_NON_ADJACENT'
        );

        if (seatDecision.status === 'WAIT') {
          this.stateMachine.transition({
            type: 'WAITING',
            reason: seatDecision.reason,
          });
          return {
            success: false,
            finalState: PurchaseState.WAITING,
            requiresUserAction: false,
            actionRequiredReason: seatDecision.reason,
          };
        }

        if (seatDecision.status !== 'SUCCESS' || seatDecision.selectedSeats.length === 0) {
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

    // Advance to next step if applicable (e.g. click "Tiếp tục" / "Đặt vé")
    if (this.adapter.proceedToNextStep) {
      const proceedOk = await this.adapter.proceedToNextStep();
      if (proceedOk) {
        await new Promise((r) => setTimeout(r, 400));
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
