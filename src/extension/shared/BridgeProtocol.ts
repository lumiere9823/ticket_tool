/**
 * Secure Bridge Protocol for communication between Content Script (Isolated World)
 * and Page Bridge (Main/Page World).
 *
 * Requirements (P3-1):
 * - Nonce handshake and per-message nonce verification.
 * - Cryptographic UUID for request correlation.
 * - Target origin restricted to window.location.origin (no wildcard '*').
 * - Strict schema validation on both sides.
 * - Single postMessage channel (no parallel CustomEvent channel).
 */

export const ALLOWED_BRIDGE_ACTIONS = [
  'CHECK_READY',
  'GET_SEATMAP_STATE',
  'SELECT_AREA',
  'SELECT_SEATS',
  'DESELECT_SEATS',
  'CONFIRM_AREA_MODAL',
  'CLICK_ELEMENT',
] as const;

export type BridgeAction = (typeof ALLOWED_BRIDGE_ACTIONS)[number];

export interface BridgeSeatPayload {
  id: string;
  label?: string;
  x?: number;
  y?: number;
  row?: string;
  number?: number;
}

export interface BridgeRequestPayload {
  areaId?: string;
  areaName?: string;
  ticketTypeId?: string;
  quantity?: number;
  ticketName?: string;
  selector?: string;
  text?: string;
  coords?: { x?: number; y?: number; width?: number; height?: number };
  seats?: BridgeSeatPayload[];
}

export interface BridgeRequestMessage {
  source: 'TICKETBOX_ASSISTANT_CONTENT';
  type: BridgeAction | string;
  requestId: string;
  nonce: string;
  payload?: BridgeRequestPayload | undefined;
}

export interface BridgeResponseMessage {
  source: 'TICKETBOX_ASSISTANT_PAGE';
  type: string;
  requestId: string;
  nonce: string;
  success: boolean;
  data?: unknown | undefined;
  error?: string | undefined;
}

export const ALLOWED_CLICK_SELECTORS = [
  '#btn-next',
  '#btn-continue',
  '#btn-submit',
  '#btn-proceed',
  '#continue-button',
  '#checkout-button',
  'button[type="submit"]',
  'button.btn-next',
  'button.btn-continue',
  'button.btn-primary',
  'button.primary',
] as const;

/**
 * Validates that a CSS selector supplied to CLICK_ELEMENT matches the restricted allowlist
 * or safe IDs/classes (#... or button[...]). Disallows arbitrary or dangerous DOM manipulation selectors.
 */
export function isValidClickSelector(selector: unknown): boolean {
  if (typeof selector !== 'string') return false;
  const trimmed = selector.trim();
  if (trimmed.length === 0 || trimmed.length > 100) return false;

  // Exact allowlist match
  if (ALLOWED_CLICK_SELECTORS.includes(trimmed as (typeof ALLOWED_CLICK_SELECTORS)[number])) {
    return true;
  }

  // Safe pattern: strictly safe button IDs (#btn-*, #continue*, #submit*) or safe button classes
  const safePattern = /^#(?:btn-[\w-]+|[\w-]+-(?:btn|button|next|continue|submit))$/i;
  return safePattern.test(trimmed);
}

export function isValidClickText(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 50) return false;
  // Disallow tags or executable injection scripts
  return !/[<>{}]/.test(trimmed);
}

/**
 * Generates a high-entropy cryptographic nonce (32 hex characters).
 * Fails closed if WebCrypto is unavailable (no Math.random fallback).
 */
export function generateBridgeNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  throw new Error(
    'FAIL_CLOSED: Cryptographic PRNG (crypto.getRandomValues) is required but unavailable.'
  );
}

/**
 * Generates a cryptographic UUID v4 string.
 * Fails closed if WebCrypto is unavailable (no Math.random fallback).
 */
export function generateBridgeRequestId(): string {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    if (typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      // Per RFC 4122 v4
      bytes[6] = (bytes[6]! & 0x0f) | 0x40;
      bytes[8] = (bytes[8]! & 0x3f) | 0x80;
      const hex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  }
  throw new Error('FAIL_CLOSED: Cryptographic PRNG is required for requestId generation.');
}

/**
 * Validates that an incoming action string belongs to the allowlist.
 */
export function isValidBridgeAction(action: unknown): action is BridgeAction {
  return typeof action === 'string' && ALLOWED_BRIDGE_ACTIONS.includes(action as BridgeAction);
}

/**
 * Validates the schema of an incoming BridgeRequestMessage.
 * Strict check: source, type, requestId, nonce, and payload schema if present.
 */
export function isValidBridgeRequest(msg: unknown): msg is BridgeRequestMessage {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  if (
    m.source !== 'TICKETBOX_ASSISTANT_CONTENT' ||
    typeof m.type !== 'string' ||
    !isValidBridgeAction(m.type) ||
    typeof m.requestId !== 'string' ||
    m.requestId.length === 0 ||
    typeof m.nonce !== 'string' ||
    m.nonce.length === 0
  ) {
    return false;
  }

  // Validate payload schema if present
  if (m.payload !== undefined) {
    if (typeof m.payload !== 'object' || m.payload === null) {
      return false;
    }
    const p = m.payload as Record<string, unknown>;
    if (p.selector !== undefined && typeof p.selector !== 'string') return false;
    if (p.text !== undefined && typeof p.text !== 'string') return false;
    if (p.areaId !== undefined && typeof p.areaId !== 'string') return false;
    if (p.quantity !== undefined && (typeof p.quantity !== 'number' || isNaN(p.quantity)))
      return false;
    if (p.seats !== undefined && !Array.isArray(p.seats)) return false;
  }

  return true;
}

/**
 * Validates the schema of an incoming BridgeResponseMessage.
 */
export function isValidBridgeResponse(msg: unknown): msg is BridgeResponseMessage {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  return (
    m.source === 'TICKETBOX_ASSISTANT_PAGE' &&
    typeof m.type === 'string' &&
    typeof m.requestId === 'string' &&
    m.requestId.length > 0 &&
    typeof m.nonce === 'string' &&
    m.nonce.length > 0 &&
    typeof m.success === 'boolean'
  );
}

/**
 * Safe determination of target origin for window.postMessage.
 * Returns window.location.origin or throws / returns null if invalid. NEVER returns '*'.
 */
export function getSafeBridgeTargetOrigin(): string | null {
  if (typeof window !== 'undefined' && window.location) {
    if (
      window.location.origin &&
      window.location.origin !== 'null' &&
      window.location.origin.startsWith('http')
    ) {
      return window.location.origin;
    }
    if (window.location.href && window.location.href.startsWith('http')) {
      try {
        const parsed = new URL(window.location.href).origin;
        if (parsed && parsed !== 'null' && parsed.startsWith('http')) {
          return parsed;
        }
      } catch {
        // invalid URL
      }
    }
  }
  return null;
}
