import {
  TicketboxPageAdapter,
  PageEventState,
  PageInventoryState,
  PageSelectionState,
  PageReservationResult,
  PageCheckoutState,
} from '../../application/ports/TicketboxPageAdapter';
import { CandidateTicket } from '../../domain/entities/CandidateTicket';
import { Reservation } from '../../domain/entities/Reservation';
import { LoggerPort } from '../../application/ports/LoggerPort';
import { Event } from '../../domain/entities/Event';

export interface StructuredDiscoveryEvidence {
  observation: string;
  evidence: {
    pageUrl: string;
    documentTitle: string;
    detectedElements: Record<string, number | boolean | string>;
    timestamp: string;
  };
  interpretation: string;
  confidence: 'VERIFIED' | 'OBSERVED' | 'HYPOTHESIS' | 'TBD';
  implementationConsequence: string;
}

/**
 * Passive, safe discovery adapter for exploring the Ticketbox application.
 * Gathers page metadata and logs structured evidence without attempting automated clicks.
 * Enforces Phase 8 & Security Rule 10/11 (zero credential/session collection).
 */
export class TicketboxDiscoveryAdapter implements TicketboxPageAdapter {
  private readonly evidenceLog: StructuredDiscoveryEvidence[] = [];

  constructor(private readonly logger?: LoggerPort) {}

  public getEvidenceLog(): readonly StructuredDiscoveryEvidence[] {
    return this.evidenceLog;
  }

  public async getEventState(): Promise<PageEventState> {
    const pageUrl =
      typeof window !== 'undefined' ? window.location.href : 'http://localhost/discovery';
    const title = typeof document !== 'undefined' ? document.title : 'Discovery Event Page';

    const evidence: StructuredDiscoveryEvidence = {
      observation: 'Observed Ticketbox event page header and title',
      evidence: {
        pageUrl: this.sanitizeUrl(pageUrl),
        documentTitle: title,
        detectedElements: {
          hasEventContainer:
            typeof document !== 'undefined' &&
            !!document.querySelector('.event-container, #event-detail, main'),
        },
        timestamp: new Date().toISOString(),
      },
      interpretation: 'Event page is loaded in the browser DOM',
      confidence: 'OBSERVED',
      implementationConsequence:
        'Event ready state can be inferred once authoritative selector is confirmed',
    };

    this.recordEvidence(evidence);

    const event = new Event({
      id: 'discovered_event',
      name: title,
      url: pageUrl,
      status: 'ON_SALE',
    });

    return {
      event,
      isEventReady: true,
      pageUrl,
    };
  }

  public async getInventoryState(): Promise<PageInventoryState> {
    const pageUrl =
      typeof window !== 'undefined' ? window.location.href : 'http://localhost/discovery';

    const evidence: StructuredDiscoveryEvidence = {
      observation: 'Scanning DOM for visible ticket tier elements in discovery mode',
      evidence: {
        pageUrl: this.sanitizeUrl(pageUrl),
        documentTitle: typeof document !== 'undefined' ? document.title : '',
        detectedElements: {
          buttonsCount:
            typeof document !== 'undefined' ? document.querySelectorAll('button').length : 0,
        },
        timestamp: new Date().toISOString(),
      },
      interpretation: 'Passive DOM scan completed without mutation',
      confidence: 'TBD',
      implementationConsequence:
        'Real inventory state requires verifying Ticketbox inventory network endpoint or confirmed DOM selector',
    };

    this.recordEvidence(evidence);

    return {
      candidates: [],
      isAvailable: false,
      observedAt: new Date().toISOString(),
      isAuthoritativeT0: false,
    };
  }

  public async getSelectionState(): Promise<PageSelectionState> {
    return {
      selectedTicket: null,
      isSelectedInUi: false,
    };
  }

  public async selectTicket(candidateId: string, quantity: number): Promise<boolean> {
    this.logger?.info('Discovery mode: logged selection intent (no automated action performed)', {
      candidateId,
      quantity,
    });
    return false;
  }

  public async submitReservation(
    candidate: CandidateTicket,
    quantity: number
  ): Promise<PageReservationResult> {
    this.logger?.info(
      'Discovery mode: logged reservation intent (no automated request dispatched)',
      {
        candidateId: candidate.id,
        quantity,
      }
    );
    return {
      isConfirmed: false,
      errorMessage:
        'Discovery Mode: Automated purchase dispatch is disabled until network evidence is verified',
    };
  }

  public async getReservationState(): Promise<Reservation | null> {
    return null;
  }

  public async getCheckoutState(): Promise<PageCheckoutState> {
    const pageUrl = typeof window !== 'undefined' ? window.location.href : '';
    const isInCheckout = pageUrl.includes('/checkout') || pageUrl.includes('/payment');

    return {
      isInCheckout,
      checkoutUrl: pageUrl,
    };
  }

  private recordEvidence(item: StructuredDiscoveryEvidence): void {
    this.evidenceLog.push(item);
    this.logger?.info(`[DISCOVERY] ${item.observation}`, {
      confidence: item.confidence,
      consequence: item.implementationConsequence,
    });
  }

  private sanitizeUrl(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
      // Remove any sensitive query parameters like token, auth, session
      parsed.searchParams.delete('token');
      parsed.searchParams.delete('auth');
      parsed.searchParams.delete('session');
      parsed.searchParams.delete('code');
      return parsed.toString();
    } catch {
      return rawUrl;
    }
  }
}
