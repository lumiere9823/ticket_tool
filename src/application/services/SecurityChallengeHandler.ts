import { PurchaseState } from '../../domain/states/PurchaseState';
import { PurchaseStateMachine } from '../../domain/state-machine/PurchaseStateMachine';
import { SecurityChallengeResult } from '../ports/SecurityChallengeDetector';

export interface HandledChallengeResult {
  handled: boolean;
  targetState: PurchaseState;
  finalState: PurchaseState;
  requiresUserAction: boolean;
  details?: string | undefined;
}

/**
 * Single application-layer service for handling and transitioning security challenges.
 * Consolidates the repeated logic across ExecuteBookingJourneyUseCase and content.ts.
 * Pure TypeScript; zero Chrome or DOM dependencies.
 */
export class SecurityChallengeHandler {
  /**
   * Handles a SecurityChallengeResult by transitioning the PurchaseStateMachine
   * to the appropriate security intervention state and returning a standardized outcome.
   */
  public static handle(
    challenge: SecurityChallengeResult,
    stateMachine: PurchaseStateMachine
  ): HandledChallengeResult {
    if (!challenge.detected) {
      return {
        handled: false,
        targetState: stateMachine.state,
        finalState: stateMachine.state,
        requiresUserAction: false,
      };
    }

    const targetState = challenge.targetState ?? PurchaseState.HUMAN_INTERVENTION_REQUIRED;

    if (targetState === PurchaseState.CAPTCHA_REQUIRED) {
      stateMachine.transition({ type: 'CAPTCHA_REQUIRED' });
    } else if (targetState === PurchaseState.OTP_REQUIRED) {
      stateMachine.transition({ type: 'OTP_REQUIRED' });
    } else if (targetState === PurchaseState.SESSION_REAUTH_REQUIRED) {
      stateMachine.transition({ type: 'SESSION_EXPIRED' });
    } else if (targetState === PurchaseState.RATE_LIMITED) {
      stateMachine.transition({ type: 'RATE_LIMITED' });
    } else if (targetState === PurchaseState.UNKNOWN_SECURITY_CHALLENGE) {
      stateMachine.transition({ type: 'UNKNOWN_SECURITY_CHALLENGE' });
    } else {
      stateMachine.transition({
        type: 'SECURITY_CHALLENGE_DETECTED',
        challengeType: challenge.type,
      });
    }

    return {
      handled: true,
      targetState,
      finalState: stateMachine.state,
      requiresUserAction: true,
      details: challenge.details ?? 'Security challenge detected',
    };
  }
}
