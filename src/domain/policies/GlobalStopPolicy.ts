import { FailureReason } from '../states/PurchaseState';
import { ExecutionPolicy } from './ExecutionPolicy';

export interface GlobalStopEvaluation {
  shouldBroadcastStop: boolean;
  reason: string;
}

/**
 * Determines when global termination must be broadcast across coordinated profiles.
 * Strictly implements docs/ticketbox/06-multi-account-orchestration.md Section 13.
 */
export class GlobalStopPolicy {
  constructor(private readonly executionPolicy: ExecutionPolicy) {}

  /**
   * Evaluates if a profile success warrants stopping other profiles.
   */
  public evaluateSuccess(): GlobalStopEvaluation {
    if (this.executionPolicy.shouldStopOthersOnSuccess()) {
      return {
        shouldBroadcastStop: true,
        reason: 'Global stop: Reservation secured under ONE_SUCCESS policy',
      };
    }
    return {
      shouldBroadcastStop: false,
      reason: 'Multiple reservations permitted under MULTIPLE_SUCCESS policy',
    };
  }

  /**
   * Evaluates if a profile failure warrants stopping other profiles.
   */
  public evaluateFailure(reason: FailureReason): GlobalStopEvaluation {
    // Platform abuse signals (rate-limit) or global authentication revocations mandate immediate global shutdown
    if (reason === FailureReason.RATE_LIMITED) {
      return {
        shouldBroadcastStop: true,
        reason: 'Immediate global stop: Rate limit detected on platform',
      };
    }

    return {
      shouldBroadcastStop: false,
      reason: 'Individual failure isolated to failing profile',
    };
  }
}
