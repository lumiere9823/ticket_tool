export type MutationCategory = 'IRRELEVANT' | 'COSMETIC' | 'STRUCTURAL' | 'INVENTORY_RELEVANT';

export type MutationClassification = MutationCategory;
export const MutationClassification = {
  IRRELEVANT: 'IRRELEVANT' as const,
  COSMETIC: 'COSMETIC' as const,
  STRUCTURAL: 'STRUCTURAL' as const,
  INVENTORY_RELEVANT: 'INVENTORY_RELEVANT' as const,
};

export interface ClassifiedMutation {
  category: MutationCategory;
  reason: string;
}

export function classifyMutations(mutations: MutationLike[]): MutationCategory {
  return MutationClassifier.classifyBatch(mutations).category;
}

export interface MutationLike {
  type: string;
  target?: unknown;
  addedNodes?: ArrayLike<unknown>;
  removedNodes?: ArrayLike<unknown>;
  attributeName?: string | null;
}

const IRRELEVANT_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'LINK',
  'NOSCRIPT',
  'IFRAME',
  'META',
  'HEAD',
  'SVG',
  'PATH',
  'G',
  'DEFS',
  'SYMBOL',
  'USE',
]);

const INVENTORY_KEYWORDS = [
  'mua vé',
  'mua ngay',
  'đặt vé',
  'sold out',
  'hết vé',
  'còn vé',
  'chọn ghế',
  'chọn vé',
  'hạng vé',
  'tiếp tục',
  'tạm hết',
];

const INVENTORY_TOKEN_REGEX =
  /(ticket|seat|showing|price|tier|zone|area|booking|stepper|quantity|session|date-tab|ant-collapse|seat-map|konvajs)/i;

const CURRENCY_REGEX = /(đ|vnd|₫|\d{1,3}(?:\.\d{3})+)/i;

/**
 * Classifies DOM mutations to separate noise (cosmetic/structural churn)
 * from urgent inventory-relevant state changes on Ticketbox pages.
 */
export class MutationClassifier {
  /**
   * Classifies a single mutation record.
   */
  public static classify(mutation: MutationLike): ClassifiedMutation {
    // 1. Attribute churn analysis
    if (mutation.type === 'attributes') {
      const attr = mutation.attributeName;
      if (!attr) {
        return { category: 'IRRELEVANT', reason: 'Empty attribute name' };
      }

      if (
        attr === 'disabled' ||
        attr === 'aria-disabled' ||
        attr === 'aria-pressed' ||
        attr === 'value'
      ) {
        return {
          category: 'INVENTORY_RELEVANT',
          reason: `Critical inventory interactive attribute changed: ${attr}`,
        };
      }

      if (attr === 'class') {
        const target = mutation.target as HTMLElement | null;
        const className = target?.className ?? '';
        if (typeof className === 'string') {
          if (
            INVENTORY_TOKEN_REGEX.test(className) ||
            /disabled|sold-out|available|active|selected/i.test(className)
          ) {
            return {
              category: 'INVENTORY_RELEVANT',
              reason: `Inventory-related element class changed: ${className.slice(0, 40)}`,
            };
          }
          if (/hover|focus|transition|animation/i.test(className)) {
            return { category: 'COSMETIC', reason: 'Cosmetic style class transition' };
          }
        }
      }

      if (
        attr === 'style' ||
        attr === 'data-theme' ||
        attr.startsWith('data-v-') ||
        attr === 'aria-hidden'
      ) {
        return { category: 'COSMETIC', reason: `Cosmetic attribute mutation: ${attr}` };
      }

      return { category: 'IRRELEVANT', reason: `Irrelevant attribute: ${attr}` };
    }

    // 2. ChildList additions / removals analysis
    if (mutation.type === 'childList') {
      const added = mutation.addedNodes ? Array.from(mutation.addedNodes) : [];
      if (added.length === 0) {
        return { category: 'STRUCTURAL', reason: 'Node removal or empty childList' };
      }

      let allIrrelevant = true;
      let hasStructural = false;

      for (const node of added) {
        const el = node as HTMLElement;
        if (!el || typeof el !== 'object' || !('nodeType' in el) || el.nodeType !== 1) {
          continue;
        }

        const tag = (el.tagName || '').toUpperCase();
        if (IRRELEVANT_TAGS.has(tag)) {
          continue;
        }

        allIrrelevant = false;

        const className = el.className || '';
        const id = el.id || '';
        const text = (el.textContent || '').toLowerCase();

        // Check inventory identifiers
        if (
          tag === 'BUTTON' ||
          tag === 'INPUT' ||
          INVENTORY_TOKEN_REGEX.test(className) ||
          INVENTORY_TOKEN_REGEX.test(id)
        ) {
          return {
            category: 'INVENTORY_RELEVANT',
            reason: `Inventory element added: <${tag.toLowerCase()} class="${className}">`,
          };
        }

        if (CURRENCY_REGEX.test(text)) {
          return {
            category: 'INVENTORY_RELEVANT',
            reason: `Price or currency symbol detected in added node`,
          };
        }

        for (const kw of INVENTORY_KEYWORDS) {
          if (text.includes(kw)) {
            return {
              category: 'INVENTORY_RELEVANT',
              reason: `Inventory keyword detected: "${kw}"`,
            };
          }
        }

        hasStructural = true;
      }

      if (allIrrelevant) {
        return {
          category: 'IRRELEVANT',
          reason: 'All added nodes are non-content or scripts/styles',
        };
      }

      if (hasStructural) {
        return {
          category: 'STRUCTURAL',
          reason: 'Layout / container element added without inventory markers',
        };
      }
    }

    return { category: 'IRRELEVANT', reason: 'Unclassified mutation' };
  }

  /**
   * Classifies an entire batch of mutations and returns the highest priority classification.
   * Priority: INVENTORY_RELEVANT > STRUCTURAL > COSMETIC > IRRELEVANT.
   */
  public static classifyBatch(mutations: MutationLike[]): ClassifiedMutation {
    let highest: ClassifiedMutation = { category: 'IRRELEVANT', reason: 'No mutations' };

    for (const m of mutations) {
      const res = this.classify(m);
      if (res.category === 'INVENTORY_RELEVANT') {
        return res; // Fast return on highest priority
      }
      if (res.category === 'STRUCTURAL' && highest.category !== 'STRUCTURAL') {
        highest = res;
      } else if (res.category === 'COSMETIC' && highest.category === 'IRRELEVANT') {
        highest = res;
      }
    }

    return highest;
  }
}
