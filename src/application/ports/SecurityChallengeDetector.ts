import { PurchaseState } from '../../domain/states/PurchaseState';

export type ChallengeType =
  'RECAPTCHA' | 'HCAPTCHA' | 'TURNSTILE' | 'OTP' | 'AUTH_CHALLENGE' | 'RATE_LIMIT' | 'UNKNOWN';

export interface SecurityChallengeResult {
  detected: boolean;
  type?: ChallengeType | undefined;
  details?: string | undefined;
  targetState?: PurchaseState | undefined;
}

/**
 * Port for strictly passive, read-only security challenge detection.
 * Conforms to docs/ticketbox/08-security-and-compliance.md Section 31.
 * MUST NEVER mutate the DOM, click challenges, or attempt automated bypass.
 */
export interface SecurityChallengeDetector {
  detectChallenge(root?: unknown): SecurityChallengeResult;
  setBypassWindow?(durationMs: number): void;
  isBypassed?(): boolean;
}
