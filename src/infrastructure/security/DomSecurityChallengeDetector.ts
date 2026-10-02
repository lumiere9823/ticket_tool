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
  private bypassUntil = 0;

  public setBypassWindow(durationMs: number): void {
    this.bypassUntil = Date.now() + Math.max(0, durationMs);
  }

  public isBypassed(): boolean {
    return Date.now() < this.bypassUntil;
  }

  public detectChallenge(root?: unknown): SecurityChallengeResult {
    if (this.isBypassed()) {
      return { detected: false };
    }

    const doc = this.resolveDocument(root);
    if (!doc) {
      return { detected: false };
    }

    // 1. Cloudflare Turnstile: if response token is already populated, challenge is resolved
    const turnstileToken =
      this.getElementValue(doc, '[name="cf-turnstile-response"]') ||
      this.getElementValue(doc, '[name="cf_turnstile_response"]') ||
      this.getElementValue(doc, '#cf-turnstile-response');

    const hasTurnstileActive =
      !turnstileToken &&
      (this.hasVisibleElement(doc, '.cf-turnstile') ||
        this.hasVisibleElement(doc, '#challenge-stage') ||
        this.hasVisibleElement(doc, '#cf-wrapper') ||
        this.hasVisibleIframeWithSrc(doc, 'challenges.cloudflare.com'));

    if (hasTurnstileActive) {
      return {
        detected: true,
        type: 'TURNSTILE',
        details: 'Cloudflare Turnstile challenge detected',
        targetState: PurchaseState.CAPTCHA_REQUIRED,
      };
    }

    // 2. Google reCAPTCHA: if response token is already populated, challenge is resolved
    const recaptchaToken =
      this.getElementValue(doc, '#g-recaptcha-response') ||
      this.getElementValue(doc, '[name="g-recaptcha-response"]') ||
      this.getElementValue(doc, '.g-recaptcha-response');

    const hasRecaptchaActive =
      !recaptchaToken &&
      (this.hasVisibleElement(doc, '.g-recaptcha') ||
        this.hasVisibleIframeWithSrc(doc, 'google.com/recaptcha') ||
        this.hasVisibleIframeWithSrc(doc, 'recaptcha.net') ||
        this.hasVisibleIframeWithTitle(doc, 'recaptcha'));

    if (hasRecaptchaActive) {
      return {
        detected: true,
        type: 'RECAPTCHA',
        details: 'Google reCAPTCHA challenge detected',
        targetState: PurchaseState.CAPTCHA_REQUIRED,
      };
    }

    // 3. hCaptcha: if response token is already populated, challenge is resolved
    // Strictly isolate hCaptcha response token (do not fall back to g-recaptcha-response)
    const hcaptchaToken = this.getElementValue(doc, '[name="h-captcha-response"]');

    const hasHcaptchaActive =
      !hcaptchaToken &&
      (this.hasVisibleElement(doc, '.h-captcha') ||
        this.hasVisibleElement(doc, '[data-hcaptcha-widget-id]') ||
        this.hasVisibleIframeWithSrc(doc, 'hcaptcha.com') ||
        this.hasVisibleIframeWithTitle(doc, 'hcaptcha'));

    if (hasHcaptchaActive) {
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

    // 5. 401 / 403 / Session Re-auth: inspect targeted error containers, modals, banners, headings
    const targetedErrorText = this.getTargetedErrorText(doc).toLowerCase();
    if (
      targetedErrorText.includes('403 forbidden') ||
      targetedErrorText.includes('401 unauthorized') ||
      targetedErrorText.includes('phiên đăng nhập hết hạn') ||
      targetedErrorText.includes('vui lòng đăng nhập lại')
    ) {
      return {
        detected: true,
        type: 'AUTH_CHALLENGE',
        details: 'Authentication or access forbidden challenge detected',
        targetState: PurchaseState.SESSION_REAUTH_REQUIRED,
      };
    }

    // 6. 429 Rate Limit: inspect targeted error containers, modals, banners, headings
    if (
      targetedErrorText.includes('429 too many requests') ||
      targetedErrorText.includes('quá nhiều yêu cầu') ||
      targetedErrorText.includes('rate limit exceeded')
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

  private hasVisibleElement(doc: Document | Element | DOMElementLike, selector: string): boolean {
    try {
      if ('querySelectorAll' in doc && typeof doc.querySelectorAll === 'function') {
        const elements = doc.querySelectorAll(selector);
        for (let i = 0; i < elements.length; i++) {
          const el = elements[i];
          if (el && this.isElementVisuallyActive(el)) {
            return true;
          }
        }
        return false;
      }
      if ('querySelector' in doc && typeof doc.querySelector === 'function') {
        const el = doc.querySelector(selector);
        return el !== null && this.isElementVisuallyActive(el);
      }
    } catch {
      // Ignored
    }
    return false;
  }

  private isElementVisuallyActive(el: unknown): boolean {
    if (!el) return false;
    try {
      const raw = 'rawElement' in (el as DOMElementLike) ? (el as DOMElementLike).rawElement : el;
      if (raw && typeof HTMLElement !== 'undefined' && raw instanceof HTMLElement) {
        // Invisible reCAPTCHA v2 / v3 or Turnstile badge container
        if (
          raw.classList.contains('grecaptcha-badge') ||
          raw.closest?.('.grecaptcha-badge') !== null
        ) {
          // grecaptcha-badge is the invisible badge widget, not an interactive blocking modal
          return false;
        }

        if (raw.offsetParent === null && raw.style.position !== 'fixed') {
          // Element is not in layout flow (e.g. display: none or within hidden container)
          return false;
        }

        const rect = raw.getBoundingClientRect ? raw.getBoundingClientRect() : null;
        if (rect) {
          // Zero dimension or positioned completely offscreen (common for invisible challenge badges)
          if (rect.width === 0 && rect.height === 0) {
            return false;
          }
          if (rect.right < 0 || rect.bottom < 0 || rect.top > (window.innerHeight || 10000)) {
            return false;
          }
        }

        if (typeof window !== 'undefined' && window.getComputedStyle) {
          const style = window.getComputedStyle(raw);
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.opacity === '0' ||
            (parseFloat(style.width) === 0 && parseFloat(style.height) === 0)
          ) {
            return false;
          }
        }
      }
      if (typeof (el as DOMElementLike).getAttribute === 'function') {
        const styleAttr = (el as DOMElementLike).getAttribute('style') || '';
        const classAttr = (el as DOMElementLike).getAttribute('class') || '';
        if (classAttr.includes('grecaptcha-badge')) {
          return false;
        }
        if (
          styleAttr.includes('display: none') ||
          styleAttr.includes('display:none') ||
          styleAttr.includes('visibility: hidden') ||
          styleAttr.includes('visibility:hidden') ||
          styleAttr.includes('width: 0px') ||
          styleAttr.includes('width:0px') ||
          styleAttr.includes('height: 0px') ||
          styleAttr.includes('height:0px')
        ) {
          return false;
        }
      }
    } catch {
      // If visibility cannot be evaluated, assume true to fail safe
      return true;
    }
    return true;
  }

  private getElementValue(
    doc: Document | Element | DOMElementLike,
    selector: string
  ): string | null {
    try {
      if ('querySelector' in doc && typeof doc.querySelector === 'function') {
        const el = doc.querySelector(selector);
        if (!el) return null;
        if ('value' in el && typeof el.value === 'string' && el.value.trim().length > 0) {
          return el.value.trim();
        }
        if ('getAttribute' in el && typeof el.getAttribute === 'function') {
          const attrVal = el.getAttribute('value');
          if (attrVal && attrVal.trim().length > 0) return attrVal.trim();
        }
        if (
          'textContent' in el &&
          typeof el.textContent === 'string' &&
          el.textContent.trim().length > 0
        ) {
          return el.textContent.trim();
        }
      }
    } catch {
      // Ignored
    }
    return null;
  }

  private hasVisibleIframeWithSrc(
    doc: Document | Element | DOMElementLike,
    srcFragment: string
  ): boolean {
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
            if (this.isElementVisuallyActive(iframe)) {
              return true;
            }
          }
        }
      }
    } catch {
      // Ignored
    }
    return false;
  }

  private hasVisibleIframeWithTitle(
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
            if (this.isElementVisuallyActive(iframe)) {
              return true;
            }
          }
        }
      }
    } catch {
      // Ignored
    }
    return false;
  }

  /**
   * Targets specific error containers, modal dialogs, alert banners, toast notifications,
   * or page-level error headings (h1, h2, title). Strictly avoids entire page descriptions or body text.
   */
  private getTargetedErrorText(doc: Document | Element | DOMElementLike): string {
    const errorSelectors = [
      'h1',
      'h2',
      '.error-container',
      '.error-page',
      '.error-message',
      '.error-description',
      '.ant-modal-confirm-error',
      '.ant-modal-confirm-body',
      '.ant-notification-notice-error',
      '.ant-alert-error',
      '.toast-error',
      '[role="alert"]',
      '.rate-limit',
      '#challenge-error-title',
      '#cf-error-details',
    ];

    const collectedText: string[] = [];

    for (const selector of errorSelectors) {
      try {
        if ('querySelectorAll' in doc && typeof doc.querySelectorAll === 'function') {
          const elements = doc.querySelectorAll(selector);
          for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            if (el && this.isElementVisuallyActive(el) && el.textContent) {
              collectedText.push(el.textContent.trim());
            }
          }
        } else if ('querySelector' in doc && typeof doc.querySelector === 'function') {
          const el = doc.querySelector(selector);
          if (el && this.isElementVisuallyActive(el) && el.textContent) {
            collectedText.push(el.textContent.trim());
          }
        }
      } catch {
        // Ignored
      }
    }

    // Also include document.title if it exists and indicates error/challenge
    try {
      if ('title' in doc && typeof (doc as Document).title === 'string') {
        const title = (doc as Document).title;
        if (/401|403|429|forbidden|unauthorized|too many requests/i.test(title)) {
          collectedText.push(title);
        }
      }
    } catch {
      // Ignored
    }

    return collectedText.join(' ');
  }
}
