import { describe, it, expect, beforeEach } from 'vitest';
import {
  PurchaseStateMachine,
  PurchaseState,
  TicketPreference,
  Quantity,
  Money,
  CandidateTicket,
  FailureReason,
} from '../../../src/domain';
import { ArmAssistantUseCase } from '../../../src/application/use-cases/ArmAssistantUseCase';
import { StartMonitoringUseCase } from '../../../src/application/use-cases/StartMonitoringUseCase';
import { EvaluateSelectionUseCase } from '../../../src/application/use-cases/EvaluateSelectionUseCase';
import { ExecuteReservationUseCase } from '../../../src/application/use-cases/ExecuteReservationUseCase';
import { StopAssistantUseCase } from '../../../src/application/use-cases/StopAssistantUseCase';
import { ChromeStorageRepository } from '../../../src/infrastructure/storage/ChromeStorageRepository';
import { ChromeMessageBus } from '../../../src/infrastructure/messaging/ChromeMessageBus';
import { SanitizedLogger } from '../../../src/infrastructure/logging/SanitizedLogger';
import { SafeStubAdapter } from '../../../src/infrastructure/ticketbox/SafeStubAdapter';

describe('Application Layer Use Cases', () => {
  let stateMachine: PurchaseStateMachine;
  let storage: ChromeStorageRepository;
  let eventBus: ChromeMessageBus;
  let logger: SanitizedLogger;

  beforeEach(() => {
    stateMachine = new PurchaseStateMachine(PurchaseState.READY);
    storage = new ChromeStorageRepository();
    eventBus = new ChromeMessageBus();
    logger = new SanitizedLogger();
  });

  it('ArmAssistantUseCase should configure preferences and transition READY -> ARMED', async () => {
    const useCase = new ArmAssistantUseCase(stateMachine, storage, eventBus, logger);

    const context = await useCase.execute({
      eventUrl: 'https://ticketbox.vn/event/sample-concert-1234',
      categoryPriority: ['VIP', 'CAT 1'],
      quantity: 2,
      allowFallback: true,
    });

    expect(context.currentState).toBe(PurchaseState.ARMED);
    const savedConfig = await storage.getConfiguration();
    expect(savedConfig?.targetEventUrl).toBe('https://ticketbox.vn/event/sample-concert-1234');
    expect(savedConfig?.preferences?.categoryPriority).toEqual(['VIP', 'CAT 1']);
  });

  it('StartMonitoringUseCase should assign attemptId and transition ARMED -> MONITORING', async () => {
    stateMachine = new PurchaseStateMachine(PurchaseState.ARMED);
    const useCase = new StartMonitoringUseCase(stateMachine, storage, eventBus, logger);

    const context = await useCase.execute('https://ticketbox.vn/event/sample-concert-1234');

    expect(context.currentState).toBe(PurchaseState.MONITORING);
    expect(context.attemptId).toBeDefined();
    expect(context.attemptId).toMatch(/^attempt_/);
  });

  it('EvaluateSelectionUseCase should detect candidate and transition MONITORING -> SELECTING', async () => {
    stateMachine = new PurchaseStateMachine(PurchaseState.MONITORING, 'attempt_test');
    const useCase = new EvaluateSelectionUseCase(stateMachine, eventBus, logger);

    const preference = new TicketPreference({
      categoryPriority: ['VIP'],
      quantity: new Quantity(2),
    });

    const mockCandidates: CandidateTicket[] = [
      {
        id: 'vip-1',
        categoryName: 'VIP',
        price: new Money(2500000),
        availableQuantity: 4,
        isAvailable: true,
      },
    ];

    const result = await useCase.execute(mockCandidates, preference);
    expect(result).not.toBeNull();
    expect(result?.candidate.id).toBe('vip-1');
    expect(stateMachine.state).toBe(PurchaseState.SELECTING);
  });

  it('ExecuteReservationUseCase should transition SELECTING -> HELD on authoritative confirmation', async () => {
    stateMachine = new PurchaseStateMachine(PurchaseState.SELECTING, 'attempt_test');

    class ConfirmedMockAdapter extends SafeStubAdapter {
      override async submitReservation(): Promise<{
        isConfirmed: boolean;
        reservationId: string;
        expiresAt: string;
      }> {
        return {
          isConfirmed: true,
          reservationId: 'RES-CONFIRMED-8899',
          expiresAt: '2026-09-27T00:00:00Z',
        };
      }
    }
    const mockAdapter = new ConfirmedMockAdapter();

    const useCase = new ExecuteReservationUseCase(stateMachine, mockAdapter, eventBus, logger);
    const candidate: CandidateTicket = {
      id: 'cat-1',
      categoryName: 'CAT 1',
      price: new Money(1000000),
      availableQuantity: 2,
      isAvailable: true,
    };

    const result = await useCase.execute(candidate, 2);
    expect(result.isConfirmed).toBe(true);
    expect(result.reservationId).toBe('RES-CONFIRMED-8899');
    expect(stateMachine.state).toBe(PurchaseState.HELD);
  });

  it('ExecuteReservationUseCase should transition to FAILED when reservation is rejected (Rule 4 & 5)', async () => {
    stateMachine = new PurchaseStateMachine(PurchaseState.SELECTING, 'attempt_test');

    class RejectedMockAdapter extends SafeStubAdapter {
      override async submitReservation(): Promise<{
        isConfirmed: boolean;
        errorMessage: string;
      }> {
        return {
          isConfirmed: false,
          errorMessage: 'Sold out or concurrency conflict',
        };
      }
    }
    const mockAdapter = new RejectedMockAdapter();

    const useCase = new ExecuteReservationUseCase(stateMachine, mockAdapter, eventBus, logger);
    const candidate: CandidateTicket = {
      id: 'cat-1',
      categoryName: 'CAT 1',
      price: new Money(1000000),
      availableQuantity: 2,
      isAvailable: true,
    };

    const result = await useCase.execute(candidate, 2);
    expect(result.isConfirmed).toBe(false);
    expect(stateMachine.state).toBe(PurchaseState.FAILED);
    expect(stateMachine.failureReason).toBe(FailureReason.RESERVATION_FAILED);
  });

  it('ExecuteReservationUseCase should transition to RATE_LIMITED when platform returns 429', async () => {
    stateMachine = new PurchaseStateMachine(PurchaseState.SELECTING, 'attempt_test');

    class RateLimitedMockAdapter extends SafeStubAdapter {
      override async submitReservation(): Promise<{
        isConfirmed: boolean;
        errorMessage: string;
      }> {
        return {
          isConfirmed: false,
          errorMessage: 'HTTP 429: Too many requests, rate limit exceeded',
        };
      }
    }
    const mockAdapter = new RateLimitedMockAdapter();

    const useCase = new ExecuteReservationUseCase(stateMachine, mockAdapter, eventBus, logger);
    const candidate: CandidateTicket = {
      id: 'cat-1',
      categoryName: 'CAT 1',
      price: new Money(1000000),
      availableQuantity: 2,
      isAvailable: true,
    };

    const result = await useCase.execute(candidate, 2);
    expect(result.isConfirmed).toBe(false);
    expect(stateMachine.state).toBe(PurchaseState.RATE_LIMITED);
    expect(stateMachine.failureReason).toBe(FailureReason.RATE_LIMITED);
  });

  it('ExecuteReservationUseCase should transition to SESSION_REAUTH_REQUIRED when 401 occurs', async () => {
    stateMachine = new PurchaseStateMachine(PurchaseState.SELECTING, 'attempt_test');

    class SessionExpiredMockAdapter extends SafeStubAdapter {
      override async submitReservation(): Promise<{
        isConfirmed: boolean;
        errorMessage: string;
      }> {
        return {
          isConfirmed: false,
          errorMessage: '401 Unauthorized: session expired',
        };
      }
    }
    const mockAdapter = new SessionExpiredMockAdapter();

    const useCase = new ExecuteReservationUseCase(stateMachine, mockAdapter, eventBus, logger);
    const candidate: CandidateTicket = {
      id: 'cat-1',
      categoryName: 'CAT 1',
      price: new Money(1000000),
      availableQuantity: 2,
      isAvailable: true,
    };

    const result = await useCase.execute(candidate, 2);
    expect(result.isConfirmed).toBe(false);
    expect(stateMachine.state).toBe(PurchaseState.SESSION_REAUTH_REQUIRED);
  });

  it('StopAssistantUseCase should transition active state to STOPPED and notify', async () => {
    stateMachine = new PurchaseStateMachine(PurchaseState.MONITORING, 'attempt_test');
    const useCase = new StopAssistantUseCase(stateMachine, storage, eventBus, logger);

    const context = await useCase.execute('User pressed stop button');
    expect(context.currentState).toBe(PurchaseState.STOPPED);
    expect(stateMachine.state).toBe(PurchaseState.STOPPED);
  });
});
