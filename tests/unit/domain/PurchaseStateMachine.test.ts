import { describe, it, expect, vi } from 'vitest';
import {
  PurchaseStateMachine,
  PurchaseState,
  FailureReason,
  StateTransitionError,
} from '../../../src/domain';

describe('PurchaseStateMachine', () => {
  it('should initialize in INIT state', () => {
    const sm = new PurchaseStateMachine();
    expect(sm.state).toBe(PurchaseState.INIT);
    expect(sm.getContext().currentState).toBe(PurchaseState.INIT);
  });

  it('should follow canonical valid lifecycle transitions to HELD and CONFIRMED', () => {
    const sm = new PurchaseStateMachine(PurchaseState.INIT, 'attempt_123');

    // INIT -> AUTH_CHECK
    sm.transition({ type: 'EXTENSION_READY' });
    expect(sm.state).toBe(PurchaseState.AUTH_CHECK);

    // AUTH_CHECK -> EVENT_CHECK
    sm.transition({ type: 'AUTHENTICATED' });
    expect(sm.state).toBe(PurchaseState.EVENT_CHECK);

    // EVENT_CHECK -> READY
    sm.transition({ type: 'EVENT_READY' });
    expect(sm.state).toBe(PurchaseState.READY);

    // READY -> ARMED
    sm.transition({ type: 'ARM' });
    expect(sm.state).toBe(PurchaseState.ARMED);

    // ARMED -> MONITORING
    sm.transition({ type: 'MONITORING_STARTED' });
    expect(sm.state).toBe(PurchaseState.MONITORING);

    // MONITORING -> AVAILABLE_DETECTED
    sm.transition({ type: 'INVENTORY_AVAILABLE' });
    expect(sm.state).toBe(PurchaseState.AVAILABLE_DETECTED);

    // AVAILABLE_DETECTED -> SELECTING
    sm.transition({ type: 'CANDIDATE_FOUND' });
    expect(sm.state).toBe(PurchaseState.SELECTING);

    // SELECTING -> RESERVING
    sm.transition({ type: 'RESERVATION_INITIATED' });
    expect(sm.state).toBe(PurchaseState.RESERVING);

    // RESERVING -> HELD (Requires server-confirmed reservation ID)
    sm.transition({
      type: 'RESERVATION_SERVER_CONFIRMED',
      reservationId: 'RES-998877',
      expiresAt: '2026-09-26T23:59:59Z',
    });
    expect(sm.state).toBe(PurchaseState.HELD);

    // HELD -> CHECKOUT
    sm.transition({ type: 'CHECKOUT_OPENED' });
    expect(sm.state).toBe(PurchaseState.CHECKOUT);

    // CHECKOUT -> PAYMENT
    sm.transition({ type: 'PAYMENT_STARTED' });
    expect(sm.state).toBe(PurchaseState.PAYMENT);

    // PAYMENT -> CONFIRMED (Requires authoritative confirmation evidence)
    sm.transition({
      type: 'PAYMENT_CONFIRMED',
      confirmationReference: 'CONF-PAY-998877',
    });
    expect(sm.state).toBe(PurchaseState.CONFIRMED);
  });

  it('should REJECT transition to HELD without authoritative reservationId (Rule 4 & 5)', () => {
    const sm = new PurchaseStateMachine(PurchaseState.RESERVING, 'attempt_123');

    expect(() => {
      sm.transition({
        type: 'RESERVATION_SERVER_CONFIRMED',
        reservationId: '',
      });
    }).toThrow(StateTransitionError);

    expect(sm.state).toBe(PurchaseState.RESERVING);
  });

  it('should reject invalid skip transitions', () => {
    const sm = new PurchaseStateMachine(PurchaseState.INIT);

    expect(() => {
      sm.transition({ type: 'ARM' });
    }).toThrow(StateTransitionError);

    const smMonitoring = new PurchaseStateMachine(PurchaseState.MONITORING);
    expect(() => {
      smMonitoring.transition({ type: 'PAYMENT_CONFIRMED' });
    }).toThrow(StateTransitionError);
  });

  it('should transition to FAILED when reservation is rejected with failure reason', () => {
    const sm = new PurchaseStateMachine(PurchaseState.RESERVING);

    sm.transition({
      type: 'RESERVATION_REJECTED',
      reason: FailureReason.RESERVATION_FAILED,
    });

    expect(sm.state).toBe(PurchaseState.FAILED);
    expect(sm.failureReason).toBe(FailureReason.RESERVATION_FAILED);
  });

  it('should handle universal STOP_REQUESTED from active states', () => {
    const sm = new PurchaseStateMachine(PurchaseState.MONITORING);

    sm.transition({ type: 'STOP_REQUESTED', reason: 'User cancelled' });
    expect(sm.state).toBe(PurchaseState.STOPPED);
    expect(sm.failureMessage).toBe('User cancelled');
  });

  it('should allow reset only from STOPPED, FAILED, or CONFIRMED state', () => {
    const smActive = new PurchaseStateMachine(PurchaseState.SELECTING);
    expect(() => {
      smActive.transition({ type: 'RESET_REQUESTED' });
    }).toThrow(StateTransitionError);

    const smStopped = new PurchaseStateMachine(PurchaseState.STOPPED);
    smStopped.transition({ type: 'RESET_REQUESTED' });
    expect(smStopped.state).toBe(PurchaseState.READY);

    const smFailed = new PurchaseStateMachine(PurchaseState.FAILED);
    smFailed.transition({ type: 'RESET_REQUESTED' });
    expect(smFailed.state).toBe(PurchaseState.READY);
  });

  it('should notify registered listeners on every transition', () => {
    const sm = new PurchaseStateMachine(PurchaseState.INIT);
    const listener = vi.fn();
    const unsubscribe = sm.subscribe(listener);

    sm.transition({ type: 'EXTENSION_READY' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        currentState: PurchaseState.AUTH_CHECK,
        previousState: PurchaseState.INIT,
      })
    );

    unsubscribe();
    sm.transition({ type: 'AUTHENTICATED' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should permit page navigation and forward transitions from TICKET_SELECTED', () => {
    const sm = new PurchaseStateMachine(PurchaseState.TICKET_SELECTED);

    // Re-entrant TICKET_SELECTED
    sm.transition({ type: 'TICKET_SELECTED', ticketId: 't1' });
    expect(sm.state).toBe(PurchaseState.TICKET_SELECTED);

    // Re-scan during page transition emits EVENT_DETECTED
    sm.transition({ type: 'EVENT_DETECTED', eventId: 'evt-100' });
    expect(sm.state).toBe(PurchaseState.EVENT_DETECTED);

    // Advance back to TICKET_SELECTED
    sm.transition({ type: 'SHOWING_DETECTED' });
    sm.transition({ type: 'TICKETS_DETECTED' });
    sm.transition({ type: 'TICKET_SELECTED' });
    expect(sm.state).toBe(PurchaseState.TICKET_SELECTED);

    // Advance to SHOWING_DETECTED
    sm.transition({ type: 'SHOWING_DETECTED', showingId: 'show-200' });
    expect(sm.state).toBe(PurchaseState.SHOWING_DETECTED);

    // Direct progression from TICKET_SELECTED to SEATS_SELECTED
    const sm2 = new PurchaseStateMachine(PurchaseState.TICKET_SELECTED);
    sm2.transition({ type: 'SEATS_SELECTED', seats: ['A1', 'A2'] });
    expect(sm2.state).toBe(PurchaseState.SEATS_SELECTED);

    // Direct progression from TICKET_SELECTED to PAYMENT_GATE
    const sm3 = new PurchaseStateMachine(PurchaseState.TICKET_SELECTED);
    sm3.transition({ type: 'PAYMENT_GATE' });
    expect(sm3.state).toBe(PurchaseState.PAYMENT_GATE);
  });
});
