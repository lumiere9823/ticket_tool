/**
 * Network safety policies for Ticketbox Purchase Assistant.
 * Enforces host domain validation and credential omission to prevent token/cookie leakage.
 */

export const ALLOWED_HOST_SUFFIX = 'ticketbox.vn';

/**
 * Validates that a given URL string belongs strictly to ticketbox.vn or its subdomains.
 */
export function isAllowedTicketboxHost(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== 'string') return false;
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();
    return hostname === ALLOWED_HOST_SUFFIX || hostname.endsWith(`.${ALLOWED_HOST_SUFFIX}`);
  } catch {
    return false;
  }
}

/**
 * Safe fetch wrapper that enforces:
 * 1. Host strictly on ticketbox.vn domain
 * 2. Credentials strictly omitted ({ credentials: 'omit' })
 */
export async function safeTicketboxFetch(
  input: string | URL,
  init?: RequestInit
): Promise<Response> {
  const urlStr = typeof input === 'string' ? input : input.toString();
  if (!isAllowedTicketboxHost(urlStr)) {
    throw new Error(`Network request blocked: host outside allowed Ticketbox domain: ${urlStr}`);
  }

  const safeInit: RequestInit = {
    ...init,
    credentials: 'omit',
  };

  return fetch(input, safeInit);
}
