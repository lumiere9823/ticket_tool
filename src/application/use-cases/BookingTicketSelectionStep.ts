import { PurchaseStateMachine } from '../../domain/state-machine/PurchaseStateMachine';
import { PurchaseState } from '../../domain/states/PurchaseState';
import {
  BookingPreferences,
  CurrentSelection,
  JourneyTicketType,
} from '../../domain/entities/BookingJourneyModels';
import { PriorityCategoryEngine } from '../../domain/policies/PriorityCategoryEngine';
import { AdjacentSeatStrategy } from '../../domain/policies/AdjacentSeatStrategy';
import { ActionGuard } from '../../domain/policies/ActionGuard';
import { BookingError } from '../../domain/errors/BookingErrors';
import { TicketboxPageAdapter } from '../ports/TicketboxPageAdapter';
import { EventBus } from '../ports/EventBus';
import { LoggerPort } from '../ports/LoggerPort';
import { LatencyTracker } from '../services/LatencyTracker';
import type { JourneyExecutionResult } from './ExecuteBookingJourneyUseCase';
import type { HandoffRetryContext } from './BookingHandoffStep';

export interface BookingTicketSelectionStepOptions {
  stateMachine: PurchaseStateMachine;
  adapter: TicketboxPageAdapter;
  eventBus: EventBus;
  logger: LoggerPort;
  getState: () => PurchaseState;
}

export class BookingTicketSelectionStep {
  constructor(private readonly options: BookingTicketSelectionStepOptions) {}

  async execute(
    chosenTicket: JourneyTicketType,
    bookingMode: JourneyTicketType['mode'],
    preferences: BookingPreferences,
    currentSelection: CurrentSelection,
    latencyTracker?: LatencyTracker,
    retryContext?: HandoffRetryContext
  ): Promise<JourneyExecutionResult | null> {
    const { stateMachine, adapter, logger } = this.options;
    if (bookingMode === 'STANDING') {
      stateMachine.transition({ type: 'SELECTING_QUANTITY', quantity: preferences.quantity });
      const quantitySelected = await adapter.selectQuantity(
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
      if (!quantitySelected) {
        throw new BookingError({
          code: 'QUANTITY_CONTROL_NOT_FOUND',
          message: `Setting quantity to ${preferences.quantity} failed`,
          state: stateMachine.state,
          recoverable: true,
        });
      }
      logger.info(`Quantity set: ${preferences.quantity}`);
      return null;
    }

    const seatMapInfo = await adapter.detectSeatMap();
    logger.debug('Seat map layout inspected', { hasSeatMap: seatMapInfo.hasSeatMap });
    let chosenArea: import('../../domain/entities/BookingJourneyModels').SeatArea | null = null;
    if (adapter.discoverAreas) {
      const areas = await adapter.discoverAreas();
      if (areas.length > 0) {
        stateMachine.transition({ type: 'AREA_SELECTION_REQUIRED' });
        const matchingAreas = areas.filter(
          (area) =>
            PriorityCategoryEngine.isAreaMatchingTier(
              area.name,
              chosenTicket.name,
              area.ticketTypeId,
              chosenTicket.id,
              area.ticketTypeName
            ) &&
            area.selectable &&
            area.availability === 'AVAILABLE'
        );
        const targetArea = matchingAreas.find(
          (area) =>
            !retryContext?.failedAreaIds.has(area.id) && !retryContext?.failedAreaIds.has(area.name)
        );

        if (!targetArea && matchingAreas.length > 0) {
          logger.warn(
            `All areas for ticket tier '${chosenTicket.name}' exhausted (${matchingAreas.map((area) => area.name).join(', ')}). Falling back to next ticket tier.`
          );
          if (retryContext) {
            retryContext.exhaustedTierNames.add(chosenTicket.name);
            if (chosenTicket.id) retryContext.exhaustedTierNames.add(chosenTicket.id);
          }
          throw new BookingError({
            code: 'ALL_AREAS_EXHAUSTED',
            message: `All sections/areas for '${chosenTicket.name}' are exhausted`,
            state: stateMachine.state,
            recoverable: true,
          });
        }
        if (!targetArea) {
          throw new BookingError({
            code: 'NO_AVAILABLE_SEATS',
            message: `No available seat areas found matching '${chosenTicket.name}'`,
            state: stateMachine.state,
            recoverable: false,
          });
        }

        chosenArea = targetArea;
        if (retryContext) {
          retryContext.currentAreaId = targetArea.id;
          retryContext.currentAreaName = targetArea.name;
        }
        const areaStart = Date.now();
        stateMachine.transition({
          type: 'SELECTING_AREA',
          areaId: targetArea.id,
          areaName: targetArea.name,
        });
        if (adapter.selectArea) {
          const guard = ActionGuard.canExecuteAction({
            currentState: stateMachine.state,
            action: 'SELECT_AREA',
          });
          if (!guard.allowed) {
            throw new BookingError({
              code: 'AREA_SELECTION_FAILED',
              message: guard.reason ?? 'ActionGuard rejected area selection',
              state: stateMachine.state,
              recoverable: false,
            });
          }
          await adapter.selectArea(
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
        latencyTracker?.recordAreaSelection(Date.now() - areaStart);
        currentSelection.areaId = targetArea.id;
        currentSelection.areaName = targetArea.name;
        logger.info(`Target area selected: ${targetArea.name}`);
      }
    }

    const seatDiscoveryStart = Date.now();
    const targetAreaOrName =
      currentSelection.areaId || currentSelection.areaName || chosenTicket.name;
    const availableSeats = adapter.discoverSeats
      ? await adapter.discoverSeats(targetAreaOrName)
      : [];
    latencyTracker?.recordSeatDiscovery(Date.now() - seatDiscoveryStart);
    logger.info(`Available seats detected: ${availableSeats.length}`);

    const isAreaBased =
      chosenArea?.isReservingSeat === false ||
      (availableSeats.length === 0 && chosenArea?.mode === 'AREA_BASED') ||
      (availableSeats.length === 0 && chosenArea === null);

    if (isAreaBased && availableSeats.length === 0) {
      logger.info(
        `Target area '${chosenArea?.name ?? chosenTicket.name}' is an area-based ticket tier (no individual seats to pick).`
      );
      if (adapter.selectQuantity) {
        try {
          await adapter.selectQuantity(
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
        } catch (error: unknown) {
          logger.warn('Quantity control not rendered in area view; skipping quantity set', {
            state: this.options.getState(),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const seatLabel = chosenArea ? chosenArea.name : chosenTicket.name;
      currentSelection.seats = [seatLabel];
      if (stateMachine.state === PurchaseState.BOOKING_MODE_DETECTED) {
        try {
          stateMachine.transition({ type: 'AREA_SELECTION_REQUIRED' });
          stateMachine.transition({ type: 'SELECTING_AREA' });
        } catch (error: unknown) {
          logger.warn('AREA_SELECTION_REQUIRED/SELECTING_AREA transition skipped', {
            state: this.options.getState(),
            event: 'AREA_SELECTION_REQUIRED + SELECTING_AREA',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } else if (stateMachine.state === PurchaseState.AREA_SELECTION_REQUIRED) {
        try {
          stateMachine.transition({ type: 'SELECTING_AREA' });
        } catch (error: unknown) {
          logger.warn('SELECTING_AREA transition skipped', {
            state: this.options.getState(),
            event: 'SELECTING_AREA',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      stateMachine.transition({ type: 'SEATS_SELECTED', seats: [seatLabel] });
      logger.info(`Area-based seat selection confirmed: ${seatLabel}`);
      await this.publishSeatSelection(`Area selected: ${seatLabel}`);
      return null;
    }

    stateMachine.transition({ type: 'SEAT_MAP_DETECTED' });
    const validSeats = availableSeats.filter(
      (seat) => !adapter.isSeatBlacklisted?.(seat.id) && !adapter.isSeatBlacklisted?.(seat.label)
    );
    if (validSeats.length === 0) {
      if (retryContext && currentSelection.areaId) {
        retryContext.failedAreaIds.add(currentSelection.areaId);
        if (currentSelection.areaName) retryContext.failedAreaIds.add(currentSelection.areaName);
      }
      const areaLabel = currentSelection.areaName ?? currentSelection.areaId ?? chosenTicket.name;
      logger.warn(
        `No available seats in area '${areaLabel}' (all taken or blacklisted). Retrying next area.`
      );
      throw new BookingError({
        code: 'NO_AVAILABLE_SEATS',
        message: `No available seats discovered on seat map for '${areaLabel}' (all taken or blacklisted)`,
        state: stateMachine.state,
        recoverable: true,
      });
    }

    const alreadySelected = validSeats.filter((seat) => seat.status === 'SELECTED');
    if (alreadySelected.length >= preferences.quantity) {
      const seatLabels = alreadySelected.slice(0, preferences.quantity).map((seat) => seat.label);
      currentSelection.seats = seatLabels;
      stateMachine.transition({ type: 'SEATS_SELECTED', seats: seatLabels });
      logger.info(`Existing selected seats recognized: ${seatLabels.join(', ')}`);
      await this.publishSeatSelection(`Seats selected: ${seatLabels.join(', ')}`);
      return null;
    }

    const seatSelectionStart = Date.now();
    stateMachine.transition({ type: 'SELECTING_SEATS' });
    const blacklisted = adapter.getBlacklistedSeats ? adapter.getBlacklistedSeats() : undefined;
    const decision = AdjacentSeatStrategy.selectSeats(
      validSeats,
      preferences.quantity,
      currentSelection.areaId ?? undefined,
      preferences.seatPreference ?? 'ANY_AVAILABLE',
      preferences.nonAdjacentFallback ?? 'SELECT_NON_ADJACENT',
      blacklisted
    );
    if (decision.status === 'WAIT') {
      const waitingState = preferences.scopedPurchasePlan
        ? PurchaseState.WAITING_FOR_STOCK
        : PurchaseState.WAITING;
      stateMachine.transition({
        type: preferences.scopedPurchasePlan ? 'WAITING_FOR_STOCK' : 'WAITING',
        reason: decision.reason,
      });
      return {
        success: false,
        finalState: waitingState,
        requiresUserAction: false,
        actionRequiredReason: decision.reason,
      };
    }
    if (decision.status !== 'SUCCESS' || decision.selectedSeats.length === 0) {
      if (retryContext && currentSelection.areaId) {
        retryContext.failedAreaIds.add(currentSelection.areaId);
        if (currentSelection.areaName) retryContext.failedAreaIds.add(currentSelection.areaName);
      }
      throw new BookingError({
        code: 'SEAT_SELECTION_FAILED',
        message: decision.reason,
        state: stateMachine.state,
        recoverable: true,
      });
    }

    const seatIds = decision.selectedSeats.map((seat) => seat.id);
    const seatLabels = decision.selectedSeats.map((seat) => seat.label);
    if (adapter.selectSpecificSeats) {
      const guard = ActionGuard.canExecuteAction({
        currentState: stateMachine.state,
        action: 'SELECT_SEATS',
      });
      if (!guard.allowed) {
        throw new BookingError({
          code: 'SEAT_SELECTION_FAILED',
          message: guard.reason ?? 'ActionGuard rejected seat selection',
          state: stateMachine.state,
          recoverable: false,
        });
      }
      const seatsSelected = await adapter.selectSpecificSeats(seatIds);
      if (!seatsSelected) {
        throw new BookingError({
          code: 'SEAT_SELECTION_FAILED',
          message: 'Seat selection click or verification failed',
          state: stateMachine.state,
          recoverable: true,
        });
      }
    }
    latencyTracker?.recordSeatSelection(Date.now() - seatSelectionStart);
    currentSelection.seats = seatLabels;
    stateMachine.transition({ type: 'SEATS_SELECTED', seats: seatLabels });
    logger.info(`Seats selected: ${seatLabels.join(', ')}`);
    await this.publishSeatSelection(`Seats selected: ${seatLabels.join(', ')}`);
    return null;
  }

  private async publishSeatSelection(body: string): Promise<void> {
    await this.options.eventBus.publish({
      type: 'NOTIFICATION_EVENT',
      timestamp: new Date().toISOString(),
      category: 'SEATS_SELECTED',
      title: 'Ticketbox Assistant',
      body,
    });
  }
}
