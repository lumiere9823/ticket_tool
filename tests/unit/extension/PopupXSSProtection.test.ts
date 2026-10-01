import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('P3-3: Popup XSS Protection & Extension CSP', () => {
  it('enforces strict Content Security Policy in manifest.json', () => {
    const manifestPath = resolve(__dirname, '../../../public/manifest.json');
    const raw = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw) as Record<string, unknown>;

    expect(manifest).toHaveProperty('content_security_policy');
    const csp = manifest['content_security_policy'] as Record<string, string>;
    expect(csp).toHaveProperty('extension_pages');
    expect(csp.extension_pages).toContain("script-src 'self'");
    expect(csp.extension_pages).toContain("object-src 'self'");
  });

  it('contains zero dynamic innerHTML assignments with string interpolation in popup.ts', () => {
    const popupPath = resolve(__dirname, '../../../src/extension/popup/popup.ts');
    const content = readFileSync(popupPath, 'utf8');

    // Regex checking for innerHTML = `...${...}...` or innerHTML = "..." + var
    const dynamicInnerHTML = /innerHTML\s*=\s*(`[^`]*\${[\s\S]*?}[^`]*`|[^;]*\+[^;]*)/g;
    const matches = content.match(dynamicInnerHTML) || [];

    // All dynamic interpolations must be replaced with safe createElement/textContent/replaceChildren
    expect(matches).toEqual([]);
  });
});
