import {
  SecurityChallengeDetector,
  SecurityChallengeResult,
} from '../../application/ports/SecurityChallengeDetector';
import { PurchaseState } from '../../domain/states/PurchaseState';
import { DOMElementLike } from '../ticketbox/parsing/DOMElementLike';

/**
 * DOM-based passive security challenge detector.
 * Strictly read-only, conforming to docs/ticketbox/08-security-and-compliance.md.
 * Detects:
 * - reCAPTCHA
 * - hCaptcha
 * - Cloudflare Turnstile
 * - OTP inputs
 * - 401/403 Session re-authentication
 * - 429 Rate limiting
 */
export class DomSecurityChallengeDetector implements SecurityChallengeDetector {
  public detectChallenge(root?: unknown): SecurityChallengeResult {
    const doc = this.resolveDocument(root);
    if (!doc) {
      return { detected: false };
    }

    // 1. Cloudflare Turnstile
    if (
      this.hasElement(doc, '.cf-turnstile') ||
      this.hasElement(doc, '#challenge-stage') ||
      this.hasElement(doc, '[name="cf-turnstile-response"]') ||
      this.hasIframeWithSrc(doc, 'challenges.cloudflare.com') ||
      this.hasElement(doc, '#cf-wrapper')
    ) {
      return {
        detected: true,
        type: 'TURNSTILE',
        details: 'Cloudflare Turnstile challenge detected',
        targetState: PurchaseState.CAPTCHA_REQUIRED,
      };
    }

    // 2. Google reCAPTCHA
    if (
      this.hasElement(doc, '.g-recaptcha') ||
      this.hasElement(doc, '#g-recaptcha-response') ||
      this.hasIframeWithSrc(doc, 'google.com/recaptcha') ||
      this.hasIframeWithSrc(doc, 'recaptcha.net') ||
      this.hasIframeWithTitle(doc, 'recaptcha')
    ) {
      return {
        detected: true,
        type: 'RECAPTCHA',
        details: 'Google reCAPTCHA challenge detected',
        targetState: PurchaseState.CAPTCHA_REQUIRED,
      };
    }

    // 3. hCaptcha
    if (
      this.hasElement(doc, '.h-captcha') ||
      this.hasElement(doc, '[data-hcaptcha-widget-id]') ||
      this.hasIframeWithSrc(doc, 'hcaptcha.com') ||
      this.hasIframeWithTitle(doc, 'hcaptcha')
    ) {
      return {
        detected: true,
        type: 'HCAPTCHA',
        details: 'hCaptcha challenge detected',
        targetState: PurchaseState.CAPTCHA_REQUIRED,
      };
    }

    // 4. OTP verification inputs
    if (
      this.hasElement(doc, 'input[autocomplete="one-time-code"]') ||
      this.hasElement(doc, 'input[id*="otp" i]') ||
      this.hasElement(doc, 'input[name*="otp" i]') ||
      this.hasElement(doc, 'input[placeholder*="otp" i]') ||
      this.hasElement(doc, 'input[placeholder*="mã xác thực" i]') ||
      this.hasElement(doc, '.otp-input') ||
      this.hasElement(doc, '#otp-input')
    ) {
      return {
        detected: true,
        type: 'OTP',
        details: 'OTP verification challenge detected',
        targetState: PurchaseState.OTP_REQUIRED,
      };
    }

    // 5. 401 / 403 / Session Re-auth
    const bodyText = this.getBodyText(doc).toLowerCase();
    if (
      bodyText.includes('403 forbidden') ||
      bodyText.includes('401 unauthorized') ||
      bodyText.includes('phiên đăng nhập hết hạn') ||
      bodyText.includes('vui lòng đăng nhập lại')
    ) {
      return {
        detected: true,
        type: 'AUTH_CHALLENGE',
        details: 'Authentication or access forbidden challenge detected',
        targetState: PurchaseState.SESSION_REAUTH_REQUIRED,
      };
    }

    // 6. 429 Rate Limit
    if (
      bodyText.includes('429 too many requests') ||
      bodyText.includes('quá nhiều yêu cầu') ||
      bodyText.includes('rate limit exceeded')
    ) {
      return {
        detected: true,
        type: 'RATE_LIMIT',
        details: 'Rate limit challenge detected',
        targetState: PurchaseState.RATE_LIMITED,
      };
    }

    return { detected: false };
  }

  private resolveDocument(root?: unknown): Document | Element | DOMElementLike | null {
    if (root) {
      return root as Document | Element | DOMElementLike;
    }
    if (typeof document !== 'undefined') {
      return document;
    }
    return null;
  }

  private hasElement(doc: Document | Element | DOMElementLike, selector: string): boolean {
    try {
      if ('querySelector' in doc && typeof doc.querySelector === 'function') {
        return doc.querySelector(selector) !== null;
      }
    } catch {
      // Ignored
    }
    return false;
  }

  private hasIframeWithSrc(doc: Document | Element | DOMElementLike, srcFragment: string): boolean {
    try {
      if ('querySelectorAll' in doc && typeof doc.querySelectorAll === 'function') {
        const iframes = doc.querySelectorAll('iframe');
        for (let i = 0; i < iframes.length; i++) {
          const iframe = iframes[i];
          if (!iframe) continue;
          const src =
            'getAttribute' in iframe && typeof iframe.getAttribute === 'function'
              ? iframe.getAttribute('src')
              : (iframe as HTMLIFrameElement).src;
          if (src && src.toLowerCase().includes(srcFragment.toLowerCase())) {
            return true;
          }
        }
      }
    } catch {
      // Ignored
    }
    return false;
  }

  private hasIframeWithTitle(
    doc: Document | Element | DOMElementLike,
    titleFragment: string
  ): boolean {
    try {
      if ('querySelectorAll' in doc && typeof doc.querySelectorAll === 'function') {
        const iframes = doc.querySelectorAll('iframe');
        for (let i = 0; i < iframes.length; i++) {
          const iframe = iframes[i];
          if (!iframe) continue;
          const title =
            'getAttribute' in iframe && typeof iframe.getAttribute === 'function'
              ? iframe.getAttribute('title')
              : (iframe as HTMLIFrameElement).title;
          if (title && title.toLowerCase().includes(titleFragment.toLowerCase())) {
            return true;
          }
        }
      }
    } catch {
      // Ignored
    }
    return false;
  }

  private getBodyText(doc: Document | Element | DOMElementLike): string {
    try {
      if ('body' in doc && doc.body) {
        return doc.body.textContent ?? '';
      }
      if ('textContent' in doc && doc.textContent) {
        return doc.textContent;
      }
    } catch {
      // Ignored
    }
    return '';
  }
}
