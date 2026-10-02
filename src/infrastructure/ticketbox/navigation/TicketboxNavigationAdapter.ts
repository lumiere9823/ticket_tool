/**
 * Ticketbox Navigation Adapter
 *
 * Handles forward progression actions on Ticketbox pages:
 * - Identifies primary proceed/continue/checkout buttons
 * - Employs polling retries to wait for React state/cart calculation
 * - Strictly avoids /payment and /checkout mutations
 * - Strictly avoids breadcrumb, tab, step title, or instructional elements
 */

import { LoggerPort } from '../../../application/ports/LoggerPort';
import { DOMElementLike, wrapBrowserElement } from '../parsing/DOMElementLike';

export interface NavigationAdapterContext {
  getRoot: () => DOMElementLike | null;
  getPageUrl: () => string;
  clickElement: (el: DOMElementLike) => void;
  isElementDisabled: (el: DOMElementLike) => boolean;
  setNavigationPending: (pending: boolean) => void;
}

export class TicketboxNavigationAdapter {
  constructor(
    private readonly ctx: NavigationAdapterContext,
    private readonly logger?: LoggerPort
  ) {}

  public async proceedToNextStep(): Promise<boolean> {
    const root = this.ctx.getRoot();
    if (!root) return false;

    // P2-9: URL-based page guard — resolve pathname using URL constructor, not string .includes()
    const rawUrl = this.ctx.getPageUrl();
    let pathname = '';
    try {
      pathname = new URL(rawUrl).pathname.toLowerCase();
    } catch {
      pathname = rawUrl.toLowerCase();
    }

    // ABSOLUTE BLOCK: never click any button on /payment or /checkout pages
    if (pathname.includes('/payment') || pathname.includes('/checkout')) {
      this.logger?.warn('proceedToNextStep blocked: page is /payment or /checkout', {
        url: rawUrl,
      });
      return false;
    }

    // P2-9: Per-page keyword allowlist — only safe forward-navigation labels, NO payment keywords
    let targetKeywords: string[];
    if (pathname.includes('/select-ticket')) {
      targetKeywords = ['tiếp tục', 'tiếp theo'];
    } else if (pathname.includes('/question-form')) {
      targetKeywords = ['tiếp tục'];
    } else {
      targetKeywords = ['tiếp tục', 'tiếp theo', 'bước tiếp theo', 'continue', 'next', 'next step'];
    }

    const promptOrBackPhrases = [
      'vui lòng',
      'hãy chọn',
      'bấm vào khu vực',
      'bấm vào',
      'hướng dẫn',
      'quay lại',
      'trở về',
      'back',
      'đăng nhập',
      'login',
      'sign in',
    ];

    const selectionOnlyPhrases = ['chọn vé', 'chọn khu vực', 'chọn ghế', 'chọn chỗ'];

    const maxAttempts = typeof window !== 'undefined' || root.rawElement ? 25 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const seenRaw = new Set<unknown>();

      const isCandidateValid = (el: DOMElementLike): boolean => {
        const raw = (el.rawElement || el) as HTMLElement;
        if (!raw) return false;

        const tag = (el.tagName || '').toUpperCase();
        if (['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'NAV', 'UL', 'OL', 'LI'].includes(tag)) {
          return false;
        }

        if (typeof raw.closest === 'function') {
          const inNav = raw.closest(
            '[class*="breadcrumb"], [class*="step-"], [class*="steps"], [class*="ant-steps"], [class*="navbar"], [class*="nav-"], [role="tab"], [role="tablist"], [role="navigation"], header, nav'
          );
          if (inNav) return false;
        } else {
          let cur: DOMElementLike | null | undefined = el.parentElement;
          while (cur) {
            const curTag = (cur.tagName || '').toUpperCase();
            if (curTag === 'HEADER' || curTag === 'NAV') return false;
            const curCls = (cur.className || '').toLowerCase();
            if (
              curCls.includes('breadcrumb') ||
              curCls.includes('step') ||
              curCls.includes('navbar') ||
              curCls.includes('nav-')
            ) {
              return false;
            }
            cur = cur.parentElement;
          }
        }

        const text = (
          el.textContent ||
          el.getAttribute('aria-label') ||
          el.getAttribute('value') ||
          el.getAttribute('title') ||
          ''
        )
          .toLowerCase()
          .trim();
        if (!text || text.length > 80) return false;

        const isSelectTicketPage = pathname.includes('/select-ticket');
        const isBottomBarOrActionBtn =
          typeof raw.closest === 'function' &&
          raw.closest('.bottom-bar, [class*="bottom-bar"], [class*="bottomBar"], [class*="action-bar"], [class*="booking-bar"], #btn-continue') !== null;

        const hasPromptOrBack = promptOrBackPhrases.some((phrase) => text.includes(phrase));
        if (hasPromptOrBack) {
          const isAllowedSelectTicketPrompt =
            isSelectTicketPage &&
            isBottomBarOrActionBtn &&
            (text.includes('chọn vé') || text.includes('tiếp tục') || text.includes('>>'));
          if (!isAllowedSelectTicketPrompt) {
            return false;
          }
        }

        const hasForwardKeyword =
          targetKeywords.some((kw) => text.includes(kw)) ||
          (isSelectTicketPage && isBottomBarOrActionBtn && (text.includes('chọn vé') || text.includes('>>')));
        if (!hasForwardKeyword) {
          return false;
        }

        if (selectionOnlyPhrases.some((phrase) => text.includes(phrase)) && !hasForwardKeyword && !isBottomBarOrActionBtn) {
          return false;
        }

        return true;
      };

      const tier1Candidates: DOMElementLike[] = [];
      const tier1Selector =
        '#btn-continue, [id*="continue"], .btn-continue, [id*="next"], [class*="next-btn"], [class*="btn-next"], button.ant-btn-primary, .ant-modal button, .ant-modal-footer button, [role="dialog"] button, [class*="modal"] button, .ant-drawer-footer button, .sidebar-footer button, [class*="sidebar"] footer button, .bottom-bar button, [class*="bottom-bar"] button, [class*="bottomBar"] button, [class*="bottom"] button, [class*="booking-bar"] button, [class*="bookingBar"] button, [class*="action-bar"] button, [class*="actionBar"] button, [class*="checkout-bar"] button, [class*="checkoutBar"] button, [class*="summary"] button, [class*="summary-bar"] button, [class*="footer"] button, [class*="checkout"] button, [data-testid*="continue"], [data-testid*="next"], [data-testid*="checkout"], button[type="submit"], .ant-layout-footer button, footer button';

      for (const el of root.querySelectorAll(tier1Selector)) {
        const raw = el.rawElement || el;
        if (!seenRaw.has(raw)) {
          seenRaw.add(raw);
          tier1Candidates.push(el);
        }
      }

      if (typeof document !== 'undefined') {
        for (const el of Array.from(document.querySelectorAll(tier1Selector))) {
          if (!seenRaw.has(el)) {
            seenRaw.add(el);
            tier1Candidates.push(wrapBrowserElement(el));
          }
        }
      }

      const tier2Candidates: DOMElementLike[] = [];
      const tier2Selector =
        'button, input[type="submit"], a.btn, a[class*="button"], a[role="button"]';

      for (const el of root.querySelectorAll(tier2Selector)) {
        const raw = el.rawElement || el;
        if (!seenRaw.has(raw)) {
          seenRaw.add(raw);
          tier2Candidates.push(el);
        }
      }

      if (typeof document !== 'undefined') {
        for (const el of Array.from(document.querySelectorAll(tier2Selector))) {
          if (!seenRaw.has(el)) {
            seenRaw.add(el);
            tier2Candidates.push(wrapBrowserElement(el));
          }
        }
      }

      const tier3Candidates: DOMElementLike[] = [];
      const tier3Selector =
        '[role="button"], div[class*="btn"], div[class*="button"], div[class*="continue"], div[class*="next"], div.cursor-pointer';

      for (const el of root.querySelectorAll(tier3Selector)) {
        const raw = el.rawElement || el;
        if (!seenRaw.has(raw)) {
          seenRaw.add(raw);
          tier3Candidates.push(el);
        }
      }

      if (typeof document !== 'undefined') {
        for (const el of Array.from(document.querySelectorAll(tier3Selector))) {
          if (!seenRaw.has(el)) {
            seenRaw.add(el);
            tier3Candidates.push(wrapBrowserElement(el));
          }
        }
      }

      const candidateDebugInfo: Array<{
        tag: string;
        text: string;
        disabled: boolean;
        tier: number;
      }> = [];

      for (const tierList of [
        { tier: 1, list: tier1Candidates },
        { tier: 2, list: tier2Candidates },
        { tier: 3, list: tier3Candidates },
      ]) {
        for (const btn of tierList.list) {
          const text = (btn.textContent || btn.getAttribute('aria-label') || '')
            .toLowerCase()
            .trim();
          const disabled = this.ctx.isElementDisabled(btn);

          if (!isCandidateValid(btn)) {
            continue;
          }

          candidateDebugInfo.push({
            tag: btn.tagName,
            text: text.slice(0, 40),
            disabled,
            tier: tierList.tier,
          });

          if (disabled) {
            continue;
          }

          this.logger?.info('Clicking next step / continue button', {
            buttonText: text,
            tagName: btn.tagName,
            tier: tierList.tier,
            attempt,
          });

          this.ctx.clickElement(btn);
          this.ctx.setNavigationPending(true);

          const rawBtn = (btn.rawElement || btn) as HTMLElement;
          const isInsideModal =
            rawBtn &&
            typeof rawBtn.closest === 'function' &&
            rawBtn.closest('.ant-modal, [role="dialog"], [class*="modal"]') !== null;

          if (isInsideModal) {
            const doc = typeof document !== 'undefined' ? document : null;
            let modalClosed = false;
            for (let w = 0; w < 5; w++) {
              await new Promise((r) => setTimeout(r, 60));
              const openModal = doc?.querySelector(
                '.ant-modal, [role="dialog"], [class*="modal"]'
              ) as HTMLElement | null;
              if (
                !openModal ||
                openModal.offsetParent === null ||
                openModal.style.display === 'none'
              ) {
                modalClosed = true;
                break;
              }
            }
            if (modalClosed) {
              const bottomBtn = doc?.querySelector(
                '.bottom-bar button, [class*="bottom-bar"] button, [class*="bottomBar"] button, [class*="bottom"] button, #btn-continue'
              ) as HTMLElement | null;
              if (bottomBtn) {
                const bText = (bottomBtn.textContent || '').toLowerCase().trim();
                const isBottomValid =
                  (targetKeywords.some((kw) => bText.includes(kw)) ||
                    (pathname.includes('/select-ticket') && (bText.includes('chọn vé') || bText.includes('>>')))) &&
                  !this.ctx.isElementDisabled(wrapBrowserElement(bottomBtn));
                if (isBottomValid) {
                  this.logger?.info('Modal closed; also clicked bottom bar continue button', {
                    buttonText: bText,
                  });
                  this.ctx.clickElement(wrapBrowserElement(bottomBtn));
                }
              }
            }
          }

          await new Promise((r) => setTimeout(r, 50));
          return true;
        }
      }

      this.logger?.debug(`Attempt ${attempt}/${maxAttempts}: evaluated continue candidates`, {
        candidates: candidateDebugInfo.filter((c) => c.text.length > 0).slice(0, 10),
      });

      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 75));
      }
    }

    this.logger?.warn('Proceed / continue button not found or remained disabled after polling');
    return false;
  }
}
