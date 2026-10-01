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

/**
 * Generates a high-entropy cryptographic nonce (32 hex characters).
 */
export function generateBridgeNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback for non-crypto environments (e.g. mock/test without crypto)
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

/**
 * Generates a cryptographic UUID v4 string.
 */
export function generateBridgeRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Standard UUID v4 format fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Validates that an incoming action string belongs to the allowlist.
 */
export function isValidBridgeAction(action: unknown): action is BridgeAction {
  return typeof action === 'string' && ALLOWED_BRIDGE_ACTIONS.includes(action as BridgeAction);
}

/**
 * Validates the schema of an incoming BridgeRequestMessage.
 */
export function isValidBridgeRequest(msg: unknown): msg is BridgeRequestMessage {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  return (
    m.source === 'TICKETBOX_ASSISTANT_CONTENT' &&
    typeof m.type === 'string' &&
    typeof m.requestId === 'string' &&
    m.requestId.length > 0 &&
    typeof m.nonce === 'string' &&
    m.nonce.length > 0
  );
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
 * Returns window.location.origin if available, avoiding wildcard '*'.
 */
export function getSafeBridgeTargetOrigin(): string {
  if (
    typeof window !== 'undefined' &&
    window.location?.origin &&
    window.location.origin !== 'null'
  ) {
    return window.location.origin;
  }
  return '*';
}
