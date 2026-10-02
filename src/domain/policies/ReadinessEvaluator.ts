/**
 * Evaluates readiness before T0 opening moment.
 * Checks:
 * 1. Clock synchronized with server (offset measured)
 * 2. Tab is in foreground (not background throttled)
 * 3. User logged in (session active)
 * 4. User profile complete (name, phone, email)
 * 5. Terms and conditions agreed/ticked by user
 */

export interface ReadinessCheckInput {
  isClockSynchronized: boolean;
  isTabForeground: boolean;
  isAuthenticated: boolean;
  userProfile?:
    | {
        fullName?: string | undefined;
        phone?: string | undefined;
        email?: string | undefined;
        agreeToTerms?: boolean | undefined;
      }
    | undefined;
}

export interface ReadinessCheckResult {
  isReady: boolean;
  checks: {
    clockSynchronized: boolean;
    tabForeground: boolean;
    authenticated: boolean;
    profileComplete: boolean;
    termsAgreed: boolean;
  };
  warnings: string[];
}

export function evaluatePreT0Readiness(input: ReadinessCheckInput): ReadinessCheckResult {
  const clockSynchronized = Boolean(input.isClockSynchronized);
  const tabForeground = Boolean(input.isTabForeground);
  const authenticated = Boolean(input.isAuthenticated);

  const profile = input.userProfile;
  const profileComplete = Boolean(
    profile &&
    profile.fullName &&
    profile.fullName.trim().length > 0 &&
    profile.phone &&
    profile.phone.trim().length > 0 &&
    profile.email &&
    profile.email.trim().length > 0
  );

  const termsAgreed = Boolean(profile?.agreeToTerms);

  const warnings: string[] = [];
  if (!clockSynchronized) {
    warnings.push('Chưa đồng bộ giờ máy chủ (sử dụng giờ máy nội bộ)');
  }
  if (!tabForeground) {
    warnings.push('Tab chưa ở foreground (hãy giữ tab Ticketbox hiển thị)');
  }
  if (!authenticated) {
    warnings.push('Chưa đăng nhập Ticketbox');
  }
  if (!profileComplete) {
    warnings.push('Hồ sơ người nhận chưa đầy đủ (Họ tên, SĐT, Email)');
  }
  if (!termsAgreed) {
    warnings.push('Chưa xác nhận đồng ý điều khoản mua vé');
  }

  const isReady =
    clockSynchronized && tabForeground && authenticated && profileComplete && termsAgreed;

  return {
    isReady,
    checks: {
      clockSynchronized,
      tabForeground,
      authenticated,
      profileComplete,
      termsAgreed,
    },
    warnings,
  };
}
