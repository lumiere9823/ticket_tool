import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PurchaseStateMachine, PurchaseState } from '../../../src/domain';
import { DomSecurityChallengeDetector } from '../../../src/infrastructure/security/DomSecurityChallengeDetector';
import { ExecuteBookingJourneyUseCase } from '../../../src/application/use-cases/ExecuteBookingJourneyUseCase';
import { SanitizedLogger } from '../../../src/infrastructure/logging/SanitizedLogger';
import { TicketboxJourneyAdapter } from '../../../src/infrastructure/ticketbox/TicketboxJourneyAdapter';
import { parseHtmlToDOMElementLike } from '../../../src/infrastructure/ticketbox/parsing/DOMElementLike';

describe('Security Challenge Detection & Resume Workflow (P1-4)', () => {
  let detector: DomSecurityChallengeDetector;

  beforeEach(() => {
    detector = new DomSecurityChallengeDetector();
  });

  describe('Passive Challenge Detection', () => {
    it('detects Google reCAPTCHA iframe and container', () => {
      const html = `
        <div id="content">
          <div class="g-recaptcha" data-sitekey="test-key"></div>
          <iframe src="https://www.google.com/recaptcha/api2/anchor?k=123" title="reCAPTCHA"></iframe>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);

      const result = detector.detectChallenge(root);
      expect(result.detected).toBe(true);
      expect(result.type).toBe('RECAPTCHA');
      expect(result.targetState).toBe(PurchaseState.CAPTCHA_REQUIRED);
    });

    it('detects hCaptcha container and iframe', () => {
      const html = `
        <div class="h-captcha" data-sitekey="test-key">
          <iframe src="https://newassets.hcaptcha.com/captcha/v1/widget" title="hCaptcha checkbox"></iframe>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);

      const result = detector.detectChallenge(root);
      expect(result.detected).toBe(true);
      expect(result.type).toBe('HCAPTCHA');
      expect(result.targetState).toBe(PurchaseState.CAPTCHA_REQUIRED);
    });

    it('detects Cloudflare Turnstile challenge', () => {
      const html = `
        <div class="cf-turnstile">
          <iframe src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv0/0/dummy" title="Cloudflare Turnstile"></iframe>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);

      const result = detector.detectChallenge(root);
      expect(result.detected).toBe(true);
      expect(result.type).toBe('TURNSTILE');
      expect(result.targetState).toBe(PurchaseState.CAPTCHA_REQUIRED);
    });

    it('detects Cloudflare Turnstile challenge-stage container', () => {
      const html = `
        <div id="cf-wrapper">
          <div id="challenge-stage">
            <span class="cf-submitting">Please verify you are human</span>
          </div>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);

      const result = detector.detectChallenge(root);
      expect(result.detected).toBe(true);
      expect(result.type).toBe('TURNSTILE');
      expect(result.targetState).toBe(PurchaseState.CAPTCHA_REQUIRED);
    });

    it('detects OTP verification input', () => {
      const html = `
        <form>
          <label>Nhập mã xác thực OTP</label>
          <input type="text" autocomplete="one-time-code" id="otp-input" placeholder="Mã xác thực" />
        </form>
      `;
      const root = parseHtmlToDOMElementLike(html);

      const result = detector.detectChallenge(root);
      expect(result.detected).toBe(true);
      expect(result.type).toBe('OTP');
      expect(result.targetState).toBe(PurchaseState.OTP_REQUIRED);
    });

    it('detects 401 / 403 Session Reauthentication challenge', () => {
      const html = `
        <div class="error-container">
          <h1>403 Forbidden</h1>
          <p>Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.</p>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);

      const result = detector.detectChallenge(root);
      expect(result.detected).toBe(true);
      expect(result.type).toBe('AUTH_CHALLENGE');
      expect(result.targetState).toBe(PurchaseState.SESSION_REAUTH_REQUIRED);
    });

    it('detects 429 Rate Limit page', () => {
      const html = `
        <div class="rate-limit">
          <h1>429 Too Many Requests</h1>
          <p>Quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.</p>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);

      const result = detector.detectChallenge(root);
      expect(result.detected).toBe(true);
      expect(result.type).toBe('RATE_LIMIT');
      expect(result.targetState).toBe(PurchaseState.RATE_LIMITED);
    });

    it('returns detected: false on clean ticketing page', () => {
      const html = `
        <div class="ticketbox-container">
          <h2>Danh sách vé</h2>
          <div class="ticket-row">Hạng Melody</div>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(html);

      const result = detector.detectChallenge(root);
      expect(result.detected).toBe(false);
      expect(result.type).toBeUndefined();
    });

    it('remains completely passive and never mutates the DOM', () => {
      const htmlBefore = `
        <div class="g-recaptcha" data-sitekey="123">
          <iframe src="https://www.google.com/recaptcha/api2" title="reCAPTCHA"></iframe>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(htmlBefore);
      const originalText = root.textContent;

      detector.detectChallenge(root);

      expect(root.textContent).toBe(originalText);
    });
  });

  describe('Integration with ExecuteBookingJourneyUseCase', () => {
    it('halts journey execution and pauses in CAPTCHA_REQUIRED when challenge is detected', async () => {
      const html = `
        <div class="g-recaptcha" data-sitekey="key123"></div>
      `;
      const root = parseHtmlToDOMElementLike(html);

      const sm = new PurchaseStateMachine(PurchaseState.MONITORING);
      const logger = new SanitizedLogger();
      const adapter = new TicketboxJourneyAdapter(logger, root);
      const eventBus = {
        publish: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn().mockReturnValue(() => {}),
      };
      const useCase = new ExecuteBookingJourneyUseCase(
        sm,
        adapter,
        eventBus,
        logger,
        undefined,
        detector
      );

      const result = await useCase.execute({
        categoryPriority: ['VIP'],
        quantity: 1,
        allowFallback: false,
      });

      expect(result.success).toBe(true);
      expect(result.finalState).toBe(PurchaseState.CAPTCHA_REQUIRED);
      expect(result.requiresUserAction).toBe(true);
      expect(sm.state).toBe(PurchaseState.CAPTCHA_REQUIRED);
    });
  });

  describe('Human Intervention Resume Workflow', () => {
    it('fails resume to STATE_UNVERIFIED when challenge is still present in DOM', () => {
      const html = `
        <div class="g-recaptcha" data-sitekey="key123"></div>
      `;
      const root = parseHtmlToDOMElementLike(html);

      const sm = new PurchaseStateMachine(PurchaseState.CAPTCHA_REQUIRED);

      // User triggers challenge completion
      sm.transition({ type: 'USER_COMPLETED_CHALLENGE' });
      expect(sm.state).toBe(PurchaseState.STATE_RECHECK);

      // Verification check runs
      const challengeCheck = detector.detectChallenge(root);
      expect(challengeCheck.detected).toBe(true);

      // Assistant safely rejects resume because challenge is still active
      sm.transition({
        type: 'STATE_UNVERIFIED',
        reason: 'Security challenge is still present on page',
      });
      expect(sm.state).toBe(PurchaseState.UNKNOWN);
    });

    it('successfully resumes to MONITORING when challenge is cleared from DOM', () => {
      const htmlClean = `
        <div class="ticket-list">
          <div class="ticket-item">VIP Ticket</div>
        </div>
      `;
      const root = parseHtmlToDOMElementLike(htmlClean);

      const sm = new PurchaseStateMachine(PurchaseState.CAPTCHA_REQUIRED);

      // User completes challenge
      sm.transition({ type: 'USER_COMPLETED_CHALLENGE' });
      expect(sm.state).toBe(PurchaseState.STATE_RECHECK);

      // Verification check confirms challenge is gone
      const challengeCheck = detector.detectChallenge(root);
      expect(challengeCheck.detected).toBe(false);

      // Assistant verifies safe state and returns to MONITORING
      sm.transition({
        type: 'STATE_VERIFIED',
        verifiedState: PurchaseState.MONITORING,
      });
      expect(sm.state).toBe(PurchaseState.MONITORING);
    });
  });
});
