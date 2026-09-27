/**
 * Passive discovery snapshot model.
 * Strictly separates observational page data from authoritative server evidence.
 * Enforces Phase 8 Pre-Discovery Hardening & AI Engineering Rules 02, 03, 05, 06.
 */

export interface ObservedElementsSummary {
  buttonCount: number;
  hasInteractiveElements: boolean;
  hasMainContent: boolean;
  containerCount?: number | undefined;
}

export interface SanitizedNetworkMetadata {
  method?: string | undefined;
  sanitizedUrl?: string | undefined;
  statusCode?: number | undefined;
  contentType?: string | undefined;
}

export interface DiscoverySnapshotProps {
  observationId: string;
  timestamp: string;
  profileId: string;
  accountId: string;
  eventId: string;
  pageUrl: string;
  pageTitle: string;
  observedElements: ObservedElementsSummary;
  observedAvailability: boolean;
  sanitizedNetworkMetadata?: SanitizedNetworkMetadata | undefined;
}

/**
 * Pure domain representation of a passive discovery snapshot.
 * GUARANTEE: This model NEVER contains reservationId or confirmedOrderRef.
 * Reservation and confirmation evidence must NEVER be synthesized from discovery snapshots.
 */
export class DiscoverySnapshot {
  public readonly observationId: string;
  public readonly timestamp: string;
  public readonly profileId: string;
  public readonly accountId: string;
  public readonly eventId: string;
  public readonly pageUrl: string;
  public readonly pageTitle: string;
  public readonly observedElements: ObservedElementsSummary;
  public readonly observedAvailability: boolean;
  public readonly sanitizedNetworkMetadata?: SanitizedNetworkMetadata | undefined;

  constructor(props: DiscoverySnapshotProps) {
    if (!props.observationId || props.observationId.trim() === '') {
      throw new Error('DiscoverySnapshot requires a non-empty observationId');
    }
    if (!props.profileId || props.profileId.trim() === '') {
      throw new Error('DiscoverySnapshot requires a non-empty profileId');
    }
    if (!props.accountId || props.accountId.trim() === '') {
      throw new Error('DiscoverySnapshot requires a non-empty accountId');
    }
    if (!props.eventId || props.eventId.trim() === '') {
      throw new Error('DiscoverySnapshot requires a non-empty eventId');
    }

    this.observationId = props.observationId;
    this.timestamp = props.timestamp;
    this.profileId = props.profileId;
    this.accountId = props.accountId;
    this.eventId = props.eventId;
    this.pageUrl = props.pageUrl;
    this.pageTitle = props.pageTitle;
    this.observedElements = props.observedElements;
    this.observedAvailability = props.observedAvailability;
    this.sanitizedNetworkMetadata = props.sanitizedNetworkMetadata;
  }

  /**
   * Explicit architectural barrier preventing accidental conversion of
   * passive discovery data into purchase authorization.
   */
  public toReservationEvidence(): never {
    throw new Error(
      'Security Barrier: Reservation evidence cannot be synthesized from a discovery snapshot. Authoritative server response is required.'
    );
  }

  /**
   * Explicit architectural barrier preventing accidental conversion of
   * passive discovery data into order confirmation.
   */
  public toConfirmationEvidence(): never {
    throw new Error(
      'Security Barrier: Order confirmation evidence cannot be synthesized from a discovery snapshot. Authoritative server response is required.'
    );
  }

  public toJSON(): DiscoverySnapshotProps {
    return {
      observationId: this.observationId,
      timestamp: this.timestamp,
      profileId: this.profileId,
      accountId: this.accountId,
      eventId: this.eventId,
      pageUrl: this.pageUrl,
      pageTitle: this.pageTitle,
      observedElements: this.observedElements,
      observedAvailability: this.observedAvailability,
      ...(this.sanitizedNetworkMetadata !== undefined
        ? { sanitizedNetworkMetadata: this.sanitizedNetworkMetadata }
        : {}),
    };
  }
}
