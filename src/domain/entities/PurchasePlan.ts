/**
 * PurchasePlan Domain Models
 *
 * Replaces free-text ticket/area/quantity configuration with a structured,
 * discovery-backed Purchase Plan.
 *
 * Rules:
 * - ticketId references a discovered TicketOption from the Ticket Catalog.
 * - Priority is determined by the index order of ticketRules[] (0 = highest).
 * - Quantity must be within discovered min/max bounds.
 * - areaId is optional and only applicable for AREA_BASED / SEATED modes.
 * - seatPolicy applies only when mode is SEATED.
 * - fallbackPolicy governs behavior when top-priority ticket is unavailable.
 *
 * Conforms to: docs/ticketbox/04-state-machine.md, 12-ai-engineering-rules.md
 */

/** Stable options for how to handle unavailability of the top-priority ticket. */
export type FallbackPolicy = 'NEXT_PRIORITY' | 'ANY_AVAILABLE' | 'STOP_AND_NOTIFY';

/** Seat selection policy for seated tickets. */
export type SeatPolicy = 'ANY_AVAILABLE' | 'ADJACENT_IF_POSSIBLE' | 'MANUAL';

/**
 * A single ticket rule within a PurchasePlan.
 * Represents one discovered ticket type the user wants to purchase.
 */
export interface TicketRule {
  /** Stable ticket ID from the Ticket Catalog (from TicketOption.id). Never null for user-configured rules. */
  ticketId: string;

  /** Human-readable name from Ticket Catalog for display only. */
  ticketName: string;

  /** Desired quantity. Must be within [minQuantity, maxQuantity] discovered from the catalog. */
  quantity: number;

  /**
   * Optional area ID for AREA_BASED or SEATED tickets.
   * Null for STANDING tickets or when no area selection has been made.
   */
  areaId?: string | null;

  /**
   * Optional area name for display (not persisted as authoritative; derive from areaId at runtime).
   */
  areaName?: string | null;

  /**
   * Seat selection policy for seated/area-based tickets.
   * Defaults to ANY_AVAILABLE.
   */
  seatPolicy?: SeatPolicy;
}

/**
 * The complete Purchase Plan configured by the user.
 * Built from discovered Ticket Catalog data; no free-text ticket names.
 */
export interface PurchasePlan {
  /**
   * Selected showing ID from the event catalog.
   * Null means "first/only available showing".
   */
  showingId: string | null;

  /**
   * Ordered list of ticket rules. Priority is index order (0 = highest priority).
   * Must have at least one rule to ARM.
   */
  ticketRules: TicketRule[];

  /**
   * Fallback policy applied when the top-priority rule cannot be satisfied.
   */
  fallbackPolicy: FallbackPolicy;

  /**
   * Whether to allow fallback at all. If false, STOP_AND_NOTIFY is implied.
   */
  allowFallback: boolean;
}

/**
 * Validation result for a PurchasePlan against a Ticket Catalog.
 */
export interface PurchasePlanValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Rules that have an invalid ticketId (not found in catalog). */
  invalidRuleIndices: number[];
  /** Rules where the ticket is currently unavailable. */
  unavailableRuleIndices: number[];
  /** Rules where the quantity is outside discovered bounds. */
  outOfRangeRuleIndices: number[];
  /** Whether at least one rule can potentially be attempted. */
  hasActionableRule: boolean;
}

/**
 * A Ticket Option as presented to the user in the popup.
 * Derived from TicketType/JourneyTicketType; enriched for UI rendering.
 */
export interface TicketOption {
  /** Stable ID from catalog. May be null for parsers that cannot extract IDs. */
  id: string | null;

  /** Display name. */
  name: string;

  /** Price in VND. */
  price: number;

  /** Currency (always VND for Ticketbox). */
  currency: 'VND';

  /** Ticket mode controlling which fields to show. */
  mode: 'STANDING' | 'SEATED' | 'AREA_BASED' | 'UNKNOWN';

  /** Availability status from the catalog. */
  availability:
    | 'AVAILABLE'
    | 'SOLD_OUT'
    | 'OFFLINE_SALE'
    | 'NOT_STARTED'
    | 'CLOSED'
    | 'UNKNOWN';

  /** Whether this option can be selected by the user. */
  selectable: boolean;

  /** Minimum quantity (null = unknown, default 1). */
  minQuantity: number | null;

  /** Maximum quantity (null = unknown, default assumed from platform). */
  maxQuantity: number | null;

  /** Where this option was discovered. */
  source: 'EVENT_PAGE' | 'BOOKING_PAGE';

  /** Provenance signals used to determine availability. */
  evidence: string[];
}

/**
 * Catalog state for the popup UI.
 */
export type CatalogLoadState =
  | 'IDLE'
  | 'LOADING'
  | 'LOADED'
  | 'EMPTY'
  | 'ERROR'
  | 'INVALID_URL';

/**
 * Snapshot of the discovered Ticket Catalog for popup display.
 */
export interface TicketCatalogSnapshot {
  eventId: string | null;
  eventTitle: string | null;
  showings: Array<{
    id: string | null;
    name: string | null;
    date: string | null;
    venue?: string | null;
  }>;
  tickets: TicketOption[];
  loadState: CatalogLoadState;
  loadMessage: string;
  discoveredAt: string | null;
}

/**
 * Factory to create an empty default PurchasePlan.
 */
export function createDefaultPurchasePlan(): PurchasePlan {
  return {
    showingId: null,
    ticketRules: [],
    fallbackPolicy: 'NEXT_PRIORITY',
    allowFallback: true,
  };
}

/**
 * Factory to create a default TicketCatalogSnapshot.
 */
export function createEmptyTicketCatalogSnapshot(): TicketCatalogSnapshot {
  return {
    eventId: null,
    eventTitle: null,
    showings: [],
    tickets: [],
    loadState: 'IDLE',
    loadMessage: 'Waiting for Ticketbox discovery...',
    discoveredAt: null,
  };
}
