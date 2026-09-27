import { describe, it, expect } from 'vitest';
import {
  PurchaseStateMachine,
  PurchaseState,
  StateTransitionError,
  ActionGuard,
  DiscoverySnapshot,
  DiscoverySanitizer,
} from '../../../src/domain';
import { SafeStubAdapter } from '../../../src/infrastructure/ticketbox/SafeStubAdapter';
import { TicketboxDiscoveryAdapter } from '../../../src/infrastructure/ticketbox/TicketboxDiscoveryAdapter';
import { CandidateTicket } from '../../../src/domain/entities/CandidateTicket';
import { Money } from '../../../src/domain/value-objects/Money';

describe('Phase 8 Readiness Gate — Pre-Discovery Hardening', () => {
  const dummyCandidate: CandidateTicket = {
    id: 'ticket-1',
    categoryName: 'Standard',
    price: new Money(100000, 'VND'),
    availableQuantity: 5,
    isAvailable: true,
  };

  // =========================================================================
  // 1. TEST MATRIX (Section 17)
  // =========================================================================
  describe('Test Matrix: Observation vs Authoritative Evidence', () => {
    it('1. availability observation -> AVAILABLE_DETECTED', () => {
      const sm = new PurchaseStateMachine(PurchaseState.MONITORING);
      sm.transition({ type: 'INVENTORY_AVAILABLE' });

      expect(sm.state).toBe(PurchaseState.AVAILABLE_DETECTED);
    });

    it('2. availability observation -> NOT HELD', () => {
      const sm = new PurchaseStateMachine(PurchaseState.MONITORING);
      sm.transition({ type: 'INVENTORY_AVAILABLE' });
      expect(sm.state).toBe(PurchaseState.AVAILABLE_DETECTED);

      // Attempting to jump directly to HELD from AVAILABLE_DETECTED is rejected
      expect(() => {
        sm.transition({
          type: 'RESERVATION_SERVER_CONFIRMED',
          reservationId: 'RES-FAKED-FROM-OBSERVATION',
        });
      }).toThrow(StateTransitionError);

      expect(sm.state).toBe(PurchaseState.AVAILABLE_DETECTED);
      expect(sm.state).not.toBe(PurchaseState.HELD);
    });

    it('3. DOM mutation -> NOT HELD', () => {
      const sm = new PurchaseStateMachine(PurchaseState.RESERVING);

      // Raw DOM mutation signal must never be accepted as hold evidence
      expect(() => {
        sm.transition({ type: 'DOM_MUTATION_OBSERVED' as never });
      }).toThrow(StateTransitionError);

      expect(sm.state).toBe(PurchaseState.RESERVING);
      expect(sm.state).not.toBe(PurchaseState.HELD);
    });

    it('4. button click -> NOT HELD', () => {
      const sm = new PurchaseStateMachine(PurchaseState.RESERVING);

      // Button click event must never authorize HELD
      expect(() => {
        sm.transition({ type: 'BUTTON_CLICK_SUCCESS' as never });
      }).toThrow(StateTransitionError);

      expect(sm.state).toBe(PurchaseState.RESERVING);
      expect(sm.state).not.toBe(PurchaseState.HELD);
    });

    it('5. URL change -> NOT HELD', () => {
      const sm = new PurchaseStateMachine(PurchaseState.RESERVING);

      // URL changing or navigation signal alone must not authorize HELD
      expect(() => {
        sm.transition({ type: 'URL_CHANGED' as never });
      }).toThrow(StateTransitionError);

      expect(sm.state).toBe(PurchaseState.RESERVING);
      expect(sm.state).not.toBe(PurchaseState.HELD);
    });

    it('6. HTTP 200 without reservation evidence -> NOT HELD', () => {
      const sm = new PurchaseStateMachine(PurchaseState.RESERVING);

      // HTTP 200 without reservationId (empty string / whitespace) must fail closed
      expect(() => {
        sm.transition({
          type: 'RESERVATION_SERVER_CONFIRMED',
          reservationId: '',
        });
      }).toThrow(StateTransitionError);

      expect(() => {
        sm.transition({
          type: 'RESERVATION_SERVER_CONFIRMED',
          reservationId: '   ',
        });
      }).toThrow(StateTransitionError);

      expect(sm.state).toBe(PurchaseState.RESERVING);
      expect(sm.state).not.toBe(PurchaseState.HELD);
    });

    it('7. reservation evidence -> HELD', () => {
      const sm = new PurchaseStateMachine(PurchaseState.RESERVING);

      sm.transition({
        type: 'RESERVATION_SERVER_CONFIRMED',
        reservationId: 'RES-AUTH-882200',
        expiresAt: '2026-09-27T01:30:00Z',
        evidence: {
          reservationId: 'RES-AUTH-882200',
          holdId: 'HOLD-1122',
        },
      });

      expect(sm.state).toBe(PurchaseState.HELD);
      expect(sm.evidence?.['reservationId']).toBe('RES-AUTH-882200');
    });

    it('8. payment redirect -> NOT CONFIRMED', () => {
      const sm = new PurchaseStateMachine(PurchaseState.PAYMENT);

      // Gateway redirect or URL change must not confirm payment
      expect(() => {
        sm.transition({ type: 'GATEWAY_REDIRECT_OCCURRED' as never });
      }).toThrow(StateTransitionError);

      expect(sm.state).toBe(PurchaseState.PAYMENT);
      expect(sm.state).not.toBe(PurchaseState.CONFIRMED);
    });

    it('9. payment success text -> NOT CONFIRMED', () => {
      const sm = new PurchaseStateMachine(PurchaseState.PAYMENT);

      // DOM text "Thank you for your purchase" is not authoritative server evidence
      expect(() => {
        sm.transition({ type: 'SUCCESS_TEXT_DETECTED' as never });
      }).toThrow(StateTransitionError);

      // Empty or absent orderId/confirmationReference must be rejected
      expect(() => {
        sm.transition({
          type: 'PAYMENT_CONFIRMED',
          orderId: '',
          confirmationReference: '',
        });
      }).toThrow(StateTransitionError);

      expect(sm.state).toBe(PurchaseState.PAYMENT);
      expect(sm.state).not.toBe(PurchaseState.CONFIRMED);
    });

    it('10. order confirmation evidence -> CONFIRMED', () => {
      const sm = new PurchaseStateMachine(PurchaseState.PAYMENT);

      sm.transition({
        type: 'PAYMENT_CONFIRMED',
        orderId: 'ORDER-TKTBX-998877',
        confirmationReference: 'CONF-REF-112233',
      });

      expect(sm.state).toBe(PurchaseState.CONFIRMED);
      expect(sm.evidence?.['orderId']).toBe('ORDER-TKTBX-998877');
      expect(sm.evidence?.['confirmationReference']).toBe('CONF-REF-112233');
    });
  });

  // =========================================================================
  // 2. HUMAN INTERVENTION RESOLUTION (Section 5)
  // =========================================================================
  describe('Human Intervention Resolution Boundaries', () => {
    it('SESSION_REAUTH_REQUIRED -> HUMAN_INTERVENTION_RESOLVED -> AUTH_CHECK -> AUTHENTICATED -> EVENT_CHECK -> READY', () => {
      const sm = new PurchaseStateMachine(PurchaseState.SESSION_REAUTH_REQUIRED);

      // 1. User completes session reauth challenge
      sm.transition({ type: 'HUMAN_INTERVENTION_RESOLVED' });

      // Must route to AUTH_CHECK for authoritative verification, NOT READY
      expect(sm.state).toBe(PurchaseState.AUTH_CHECK);
      expect(sm.state).not.toBe(PurchaseState.READY);

      // 2. System validates actual authentication status
      sm.transition({ type: 'AUTHENTICATED' });
      expect(sm.state).toBe(PurchaseState.EVENT_CHECK);

      // 3. System validates event
      sm.transition({ type: 'EVENT_READY' });
      expect(sm.state).toBe(PurchaseState.READY);
    });

    it('SESSION_REAUTH_REQUIRED + HUMAN_INTERVENTION_RESOLVED must NOT transition directly to READY', () => {
      const sm = new PurchaseStateMachine(PurchaseState.SESSION_REAUTH_REQUIRED);

      expect(() => {
        sm.transition({
          type: 'STATE_VERIFIED',
          verifiedState: PurchaseState.READY,
        });
      }).toThrow(StateTransitionError);

      expect(sm.state).toBe(PurchaseState.SESSION_REAUTH_REQUIRED);
    });

    it('OTP_REQUIRED + HUMAN_INTERVENTION_RESOLVED must NOT produce CONFIRMED', () => {
      const sm = new PurchaseStateMachine(PurchaseState.OTP_REQUIRED);

      // User solves OTP -> transitions to STATE_RECHECK
      sm.transition({ type: 'HUMAN_INTERVENTION_RESOLVED' });
      expect(sm.state).toBe(PurchaseState.STATE_RECHECK);

      // STATE_RECHECK cannot directly authorize CONFIRMED
      expect(() => {
        sm.transition({
          type: 'STATE_VERIFIED',
          verifiedState: PurchaseState.CONFIRMED,
        });
      }).toThrow(StateTransitionError);

      expect(sm.state).toBe(PurchaseState.STATE_RECHECK);
    });

    it('STATE_RECHECK must NEVER authorize HELD or CONFIRMED', () => {
      const sm = new PurchaseStateMachine(PurchaseState.CAPTCHA_REQUIRED);
      sm.transition({ type: 'USER_COMPLETED_CHALLENGE' });
      expect(sm.state).toBe(PurchaseState.STATE_RECHECK);

      expect(() => {
        sm.transition({
          type: 'STATE_VERIFIED',
          verifiedState: PurchaseState.HELD,
        });
      }).toThrow(StateTransitionError);

      expect(() => {
        sm.transition({
          type: 'STATE_VERIFIED',
          verifiedState: PurchaseState.CONFIRMED,
        });
      }).toThrow(StateTransitionError);
    });
  });

  // =========================================================================
  // 3. CONTEXT REVALIDATION & FAIL-CLOSED CHECKS (Section 8)
  // =========================================================================
  describe('Context Revalidation Before Critical Actions', () => {
    it('expected account + missing current account -> REJECT', () => {
      const evaluation = ActionGuard.canExecuteAction({
        currentState: PurchaseState.SELECTING,
        action: 'RESERVE',
        expectedAccountId: 'account_vip_user',
        accountId: undefined,
      });

      expect(evaluation.allowed).toBe(false);
      expect(evaluation.reason).toContain('Account context mismatch');
    });

    it('expected profile + missing current profile -> REJECT', () => {
      const evaluation = ActionGuard.canExecuteAction({
        currentState: PurchaseState.CHECKOUT,
        action: 'CHECKOUT',
        expectedProfileId: 'profile_isolated_chrome_1',
        profileId: undefined,
      });

      expect(evaluation.allowed).toBe(false);
      expect(evaluation.reason).toContain('Profile context mismatch');
    });

    it('expected event + missing current event -> REJECT', () => {
      const evaluation = ActionGuard.canExecuteAction({
        currentState: PurchaseState.PAYMENT,
        action: 'PAYMENT',
        expectedEventId: 'evt_rock_fest_2026',
        eventId: undefined,
      });

      expect(evaluation.allowed).toBe(false);
      expect(evaluation.reason).toContain('Event context mismatch');
    });

    it('expected workflow + missing workflow -> REJECT', () => {
      const evaluation = ActionGuard.canExecuteAction({
        currentState: PurchaseState.SELECTING,
        action: 'RESERVE',
        expectedWorkflowId: 'wf_attempt_999',
        workflowId: undefined,
      });

      expect(evaluation.allowed).toBe(false);
      expect(evaluation.reason).toContain('Workflow context mismatch');
    });

    it('expected page identity + missing current page identity -> REJECT', () => {
      const evaluation = ActionGuard.canExecuteAction({
        currentState: PurchaseState.SELECTING,
        action: 'RESERVE',
        expectedPageIdentity: 'https://ticketbox.vn/event/live-concert',
        pageIdentity: undefined,
      });

      expect(evaluation.allowed).toBe(false);
      expect(evaluation.reason).toContain('Page identity context mismatch');
    });
  });

  // =========================================================================
  // 4. GLOBAL STOP RACE TESTS (Section 9)
  // =========================================================================
  describe('Global Stop Race Invariants', () => {
    it('RESERVING -> GLOBAL_STOP -> attempt next critical action => REJECT', () => {
      const sm = new PurchaseStateMachine(PurchaseState.SELECTING);
      sm.transition({ type: 'RESERVATION_INITIATED' });
      expect(sm.state).toBe(PurchaseState.RESERVING);

      // Global stop occurs while reservation is in flight
      sm.transition({ type: 'STOP_REQUESTED', reason: 'Global stop triggered by sibling profile' });
      expect(sm.state).toBe(PurchaseState.STOPPED);

      // Subsequent attempt to perform critical action is rejected
      const reserveEval = ActionGuard.canExecuteAction({
        currentState: sm.state,
        action: 'RESERVE',
        isGlobalStopped: true,
      });
      expect(reserveEval.allowed).toBe(false);
      expect(reserveEval.reason).toContain('Global stop is active');

      // Attempting to advance state machine from STOPPED is rejected
      expect(() => {
        sm.transition({
          type: 'RESERVATION_SERVER_CONFIRMED',
          reservationId: 'RES-LATE-ARRIVAL',
        });
      }).toThrow(StateTransitionError);
    });

    it('CHECKOUT -> GLOBAL_STOP -> PAYMENT => REJECT', () => {
      const sm = new PurchaseStateMachine(PurchaseState.CHECKOUT);

      // User or system requests global stop during checkout
      sm.transition({ type: 'STOP_REQUESTED', reason: 'User initiated global stop' });
      expect(sm.state).toBe(PurchaseState.STOPPED);

      const paymentEval = ActionGuard.canExecuteAction({
        currentState: sm.state,
        action: 'PAYMENT',
        isGlobalStopped: true,
      });
      expect(paymentEval.allowed).toBe(false);

      expect(() => {
        sm.transition({ type: 'PAYMENT_STARTED' });
      }).toThrow(StateTransitionError);
    });
  });

  // =========================================================================
  // 5. MULTI-ACCOUNT RACE TESTS (Section 10)
  // =========================================================================
  describe('Multi-Account Context Isolation', () => {
    it('A message from profile A with profile B context must be REJECTED', () => {
      const expectedContext = {
        profileId: 'profile_A',
        accountId: 'acc_A',
        eventId: 'event_concert',
        workflowId: 'wf_alpha',
      };

      const crossContaminatedMessage = {
        profileId: 'profile_B',
        accountId: 'acc_B',
        eventId: 'event_concert',
        workflowId: 'wf_beta',
      };

      const result = ActionGuard.validateCrossContext(expectedContext, crossContaminatedMessage);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Profile mismatch');
    });

    it('A reservation confirmation for event B received by workflow A must be REJECTED', () => {
      const workflowAContext = {
        profileId: 'profile_A',
        accountId: 'acc_A',
        eventId: 'event_A',
        workflowId: 'wf_A',
      };

      const eventBConfirmationContext = {
        profileId: 'profile_A',
        accountId: 'acc_A',
        eventId: 'event_B', // Wrong event!
        workflowId: 'wf_A',
      };

      const result = ActionGuard.validateCrossContext(workflowAContext, eventBConfirmationContext);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Event mismatch');
    });
  });

  // =========================================================================
  // 6. DISCOVERY DATA MODEL & ARTIFACT SECURITY (Sections 11 & 12)
  // =========================================================================
  describe('Discovery Snapshot & Sanitization Security', () => {
    it('DiscoverySnapshot separates observation from evidence and prevents synthesis of hold/order tokens', () => {
      const snapshot = new DiscoverySnapshot({
        observationId: 'obs_1001',
        timestamp: '2026-09-27T00:00:00Z',
        profileId: 'profile_1',
        accountId: 'account_1',
        eventId: 'event_live',
        pageUrl: 'https://ticketbox.vn/event/live',
        pageTitle: 'Live Event Title',
        observedElements: {
          buttonCount: 5,
          hasInteractiveElements: true,
          hasMainContent: true,
        },
        observedAvailability: true,
      });

      expect(snapshot.observationId).toBe('obs_1001');
      expect((snapshot as unknown as Record<string, unknown>)['reservationId']).toBeUndefined();
      expect((snapshot as unknown as Record<string, unknown>)['confirmedOrderRef']).toBeUndefined();

      // Architectural barrier prevents accidental synthesis
      expect(() => snapshot.toReservationEvidence()).toThrow(/Security Barrier/);
      expect(() => snapshot.toConfirmationEvidence()).toThrow(/Security Barrier/);
    });

    it('DiscoverySanitizer strips sensitive query parameters from URLs', () => {
      const taintedUrl =
        'https://ticketbox.vn/event/sample?token=secret_token_123&auth=bearer_abc&session=sid_99&code=oauth_code&ref=partner';
      const sanitized = DiscoverySanitizer.sanitizeUrl(taintedUrl);

      expect(sanitized).not.toContain('secret_token_123');
      expect(sanitized).not.toContain('bearer_abc');
      expect(sanitized).not.toContain('sid_99');
      expect(sanitized).not.toContain('oauth_code');
      expect(sanitized).toContain('ref=partner');
    });

    it('DiscoverySanitizer sanitizes headers and payloads', () => {
      const taintedHeaders = {
        authorization: 'Bearer secret_jwt_value',
        cookie: 'session_id=12345; auth=xyz',
        'x-requested-with': 'XMLHttpRequest',
      };

      const sanitizedHeaders = DiscoverySanitizer.sanitizeHeaders(taintedHeaders);
      expect(sanitizedHeaders['authorization']).toBe('[REDACTED]');
      expect(sanitizedHeaders['cookie']).toBe('[REDACTED]');
      expect(sanitizedHeaders['x-requested-with']).toBe('XMLHttpRequest');

      const taintedPayload = {
        user: 'alice',
        password: 'my_secret_password',
        card: '4111222233334444',
        paymentInfo: {
          cvv: '123',
          cardnumber: '4111222233334444',
        },
      };

      const sanitizedPayload = DiscoverySanitizer.sanitizePayload(taintedPayload);
      expect(sanitizedPayload.password).toBe('[REDACTED]');
      expect(sanitizedPayload.card).toBe('[REDACTED]');
      expect(sanitizedPayload.paymentInfo.cvv).toBe('[REDACTED]');
      expect(sanitizedPayload.paymentInfo.cardnumber).toBe('[REDACTED]');
      expect(sanitizedPayload.user).toBe('alice');
    });
  });

  // =========================================================================
  // 7. SAFE STUB & DISCOVERY ADAPTER BOUNDARIES (Sections 13 & 14)
  // =========================================================================
  describe('SafeStubAdapter and TicketboxDiscoveryAdapter Safety', () => {
    it('SafeStubAdapter returns explicit BLOCKED_BY_DISCOVERY and refuses to act as real adapter', async () => {
      const stub = new SafeStubAdapter();

      const reservationResult = await stub.submitReservation(dummyCandidate, 2);
      expect(reservationResult.isConfirmed).toBe(false);
      expect(reservationResult.errorMessage).toContain('BLOCKED_BY_DISCOVERY');

      const selectionResult = await stub.selectTicket('cat-1', 2);
      expect(selectionResult).toBe(false);

      const reservationState = await stub.getReservationState();
      expect(reservationState).toBeNull();
    });

    it('TicketboxDiscoveryAdapter returns explicit BLOCKED_BY_DISCOVERY and cannot modify state', async () => {
      const discovery = new TicketboxDiscoveryAdapter();

      const reservationResult = await discovery.submitReservation(dummyCandidate, 2);
      expect(reservationResult.isConfirmed).toBe(false);
      expect(reservationResult.errorMessage).toContain('BLOCKED_BY_DISCOVERY');

      const selectionResult = await discovery.selectTicket('cat-1', 2);
      expect(selectionResult).toBe(false);

      const reservationState = await discovery.getReservationState();
      expect(reservationState).toBeNull();
    });
  });
});
