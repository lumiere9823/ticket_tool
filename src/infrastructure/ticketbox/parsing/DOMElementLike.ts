/**
 * Lightweight, zero-dependency DOM abstraction.
 * Allows TicketboxCatalogParser to run identically in:
 * 1. Native Chrome Browser Extension (MV3 Content Script) wrapping live Element
 * 2. Deterministic Node / Vitest test fixtures parsing HTML strings
 */

export interface DOMElementLike {
  tagName: string;
  id?: string | undefined;
  className?: string | undefined;
  textContent: string;
  parentElement?: DOMElementLike | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  setAttribute?(name: string, value: string): void;
  querySelector(selector: string): DOMElementLike | null;
  querySelectorAll(selector: string): DOMElementLike[];
  click?(): void;
  value?: string;
  rawElement?: Element | Document | undefined;
}

/**
 * Wraps a native browser Element (or Document) into DOMElementLike.
 */
export function wrapBrowserElement(el: Element | Document): DOMElementLike {
  const isDoc = el.nodeType === 9; // Node.DOCUMENT_NODE
  const element = isDoc ? (el as Document).documentElement : (el as Element);

  return {
    tagName: element.tagName ? element.tagName.toLowerCase() : 'document',
    id: element.id || undefined,
    className:
      typeof element.className === 'string'
        ? element.className
        : (element as SVGElement).className?.baseVal || element.getAttribute('class') || undefined,
    get parentElement(): DOMElementLike | null {
      return element.parentElement ? wrapBrowserElement(element.parentElement) : null;
    },
    get textContent() {
      return element.textContent || '';
    },
    getAttribute(name: string): string | null {
      if (
        name.toLowerCase() === 'value' &&
        (element as Element & { value?: unknown }).value !== undefined
      ) {
        return String((element as Element & { value?: unknown }).value);
      }
      return element.getAttribute(name);
    },
    hasAttribute(name: string): boolean {
      return element.hasAttribute(name);
    },
    setAttribute(name: string, value: string): void {
      element.setAttribute(name, value);
    },
    querySelector(selector: string): DOMElementLike | null {
      try {
        const found = element.querySelector(selector);
        return found ? wrapBrowserElement(found) : null;
      } catch {
        return null;
      }
    },
    querySelectorAll(selector: string): DOMElementLike[] {
      try {
        const list = element.querySelectorAll(selector);
        const result: DOMElementLike[] = [];
        for (let i = 0; i < list.length; i++) {
          const item = list[i];
          if (item) result.push(wrapBrowserElement(item));
        }
        return result;
      } catch {
        return [];
      }
    },
    click(): void {
      if (typeof (element as HTMLElement).click === 'function') {
        (element as HTMLElement).click();
      }
      if (typeof window !== 'undefined' && typeof window.MouseEvent === 'function') {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
    },
    get value(): string {
      return (element as HTMLInputElement).value !== undefined
        ? String((element as HTMLInputElement).value)
        : '';
    },
    set value(v: string) {
      if ('value' in element) {
        (element as HTMLInputElement).value = v;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
    },
    rawElement: element,
  };
}

/**
 * Pure TypeScript AST node representing a parsed element from an HTML string.
 */
class SimpleDOMNode implements DOMElementLike {
  public tagName: string;
  public id?: string | undefined;
  public className?: string | undefined;
  public attributes: Record<string, string> = {};
  public children: SimpleDOMNode[] = [];
  public parentElement: SimpleDOMNode | null = null;
  public rawText = '';

  constructor(tagName: string) {
    this.tagName = tagName.toLowerCase();
  }

  public get textContent(): string {
    if (this.children.length === 0) {
      return this.rawText;
    }
    return (
      this.children.map((c) => c.textContent).join(' ') + (this.rawText ? ' ' + this.rawText : '')
    );
  }

  public getAttribute(name: string): string | null {
    const val = this.attributes[name.toLowerCase()];
    return val !== undefined ? val : null;
  }

  public hasAttribute(name: string): boolean {
    return this.attributes[name.toLowerCase()] !== undefined;
  }

  public setAttribute(name: string, value: string): void {
    this.attributes[name.toLowerCase()] = value;
  }

  public click(): void {
    this.attributes['aria-pressed'] = 'true';
    if (!this.className?.includes('selected')) {
      this.className = ((this.className || '') + ' selected').trim();
    }
  }

  public get value(): string {
    return this.attributes['value'] ?? '';
  }

  public set value(v: string) {
    this.attributes['value'] = v;
  }

  public querySelector(selector: string): DOMElementLike | null {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0]! : null;
  }

  public querySelectorAll(selector: string): DOMElementLike[] {
    const selectors = selector
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const results: SimpleDOMNode[] = [];

    for (const sel of selectors) {
      this.collectMatches(sel, results);
    }

    // Deduplicate by reference
    return Array.from(new Set(results));
  }

  private collectMatches(selector: string, accumulator: SimpleDOMNode[]): void {
    const parts = selector.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return;

    if (parts.length === 1) {
      this.matchSinglePart(parts[0]!, accumulator);
    } else {
      // Descendant selector (e.g. "#ticket-info button" or ".card h3")
      const firstPart = parts[0]!;
      const remaining = parts.slice(1).join(' ');
      const intermediates: SimpleDOMNode[] = [];
      this.matchSinglePart(firstPart, intermediates);

      for (const inter of intermediates) {
        inter.collectMatches(remaining, accumulator);
      }
    }
  }

  private matchSinglePart(part: string, accumulator: SimpleDOMNode[]): void {
    for (const child of this.children) {
      if (child.matchesPart(part)) {
        accumulator.push(child);
      }
      child.matchSinglePart(part, accumulator);
    }
  }

  private matchesPart(part: string): boolean {
    let remaining = part.trim();

    // 1. Tag name if present at start (e.g. input in input[type="number"])
    const tagMatch = remaining.match(/^([a-zA-Z0-9-]+)/);
    if (tagMatch) {
      if (this.tagName !== tagMatch[1]!.toLowerCase()) {
        return false;
      }
      remaining = remaining.substring(tagMatch[0].length);
    }

    // 2. ID if present (e.g. #ticket-info)
    const idMatch = remaining.match(/#([a-zA-Z0-9-_]+)/);
    if (idMatch) {
      if ((this.id || '').toLowerCase() !== idMatch[1]!.toLowerCase()) {
        return false;
      }
      remaining = remaining.replace(idMatch[0], '');
    }

    // 3. Classes if present (e.g. .ticket-item.active)
    const classMatches = Array.from(remaining.matchAll(/\.([a-zA-Z0-9-_]+)/g));
    if (classMatches.length > 0) {
      const classes = (this.className || '').toLowerCase().split(/\s+/);
      for (const cm of classMatches) {
        if (!classes.includes(cm[1]!.toLowerCase())) {
          return false;
        }
      }
      remaining = remaining.replace(/\.([a-zA-Z0-9-_]+)/g, '');
    }

    // 4. Attributes if present (e.g. [type="number"] or [disabled])
    const attrMatches = Array.from(
      remaining.matchAll(/\[([a-zA-Z0-9-_:]+)(?:([*]?=)(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/g)
    );
    for (const am of attrMatches) {
      const attrKey = am[1]!.toLowerCase();
      const op = am[2];
      const expectedVal = (am[3] ?? am[4] ?? am[5] ?? '').replace(/^["']|["']$/g, '').toLowerCase();

      if (!this.hasAttribute(attrKey)) {
        return false;
      }

      if (op) {
        const actualVal = (this.getAttribute(attrKey) || '').toLowerCase();
        if (op === '*=') {
          if (!actualVal.includes(expectedVal)) return false;
        } else {
          if (actualVal !== expectedVal) return false;
        }
      }
    }

    return true;
  }
}

/**
 * Parses an HTML string into a lightweight DOMElementLike tree.
 * Deterministic, resilient to malformed HTML, and zero-dependency.
 */
export function parseHtmlToDOMElementLike(html: string): DOMElementLike {
  const root = new SimpleDOMNode('root');
  const stack: SimpleDOMNode[] = [root];

  // Regex matching tags or text
  const tagRegex = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z0-9-]+)([^>]*)>|([^<]+)/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    const [fullMatch, isClosing, tagName, rawAttrs, textContent] = match;

    if (fullMatch.startsWith('<!--')) {
      continue; // Skip comments
    }

    if (textContent) {
      const trimmed = textContent.replace(/\s+/g, ' ');
      if (trimmed && stack.length > 0) {
        stack[stack.length - 1]!.rawText +=
          (stack[stack.length - 1]!.rawText ? ' ' : '') + trimmed.trim();
      }
      continue;
    }

    if (tagName) {
      if (isClosing) {
        // Closing tag: pop until matching tag
        const lowerTag = tagName.toLowerCase();
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i]!.tagName === lowerTag) {
            stack.length = i;
            break;
          }
        }
      } else {
        // Opening tag
        const node = new SimpleDOMNode(tagName);
        if (rawAttrs) {
          parseAttributes(rawAttrs, node);
        }

        const parent = stack[stack.length - 1]!;
        node.parentElement = parent;
        parent.children.push(node);

        // Self-closing void tags in HTML
        const isSelfClosing =
          fullMatch.endsWith('/>') ||
          ['img', 'input', 'br', 'hr', 'meta', 'link'].includes(node.tagName);

        if (!isSelfClosing) {
          stack.push(node);
        }
      }
    }
  }

  return root;
}

function parseAttributes(rawAttrs: string, node: SimpleDOMNode): void {
  const attrRegex = /([a-zA-Z0-9-_:]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let attrMatch: RegExpExecArray | null;

  while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
    const key = attrMatch[1]!.toLowerCase();
    const value = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';

    node.attributes[key] = value;
    if (key === 'id') {
      node.id = value;
    } else if (key === 'class') {
      node.className = value;
    }
  }
}
