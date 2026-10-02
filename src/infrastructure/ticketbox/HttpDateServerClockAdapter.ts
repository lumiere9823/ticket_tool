import { ServerClockPort } from '../../application/ports/ServerClockPort';
import { LoggerPort } from '../../application/ports/LoggerPort';
import {
  ClockSample,
  ClockSyncEstimate,
  estimateClockOffset,
} from '../../domain/policies/ServerClock';
import { safeTicketboxFetch } from '../../extension/shared/NetworkSafety';

export interface HttpDateClockAdapterOptions {
  /**
   * Endpoint URL to query. Must be strictly within ticketbox.vn domain.
   * Default lightweight endpoint: https://api-v2.ticketbox.vn/gin/api/v2/events/0
   * (or other documented lightweight endpoint).
   */
  endpointUrl?: string;
  /** Max samples per synchronization cycle (default: 3) */
  maxSamples?: number;
  /** Inter-sample pause in milliseconds (default: 300ms) */
  sampleIntervalMs?: number;
}

export class HttpDateServerClockAdapter implements ServerClockPort {
  private lastEstimate: ClockSyncEstimate | null = null;
  private readonly endpointUrl: string;
  private readonly maxSamples: number;
  private readonly sampleIntervalMs: number;

  constructor(
    private readonly logger?: LoggerPort,
    options?: HttpDateClockAdapterOptions
  ) {
    this.endpointUrl =
      options?.endpointUrl ?? 'https://api-v2.ticketbox.vn/gin/api/v2/events/0';
    this.maxSamples = options?.maxSamples ?? 3;
    this.sampleIntervalMs = options?.sampleIntervalMs ?? 300;
  }

  public getLastEstimate(): ClockSyncEstimate | null {
    return this.lastEstimate;
  }

  public async synchronize(sampleCount: number = this.maxSamples): Promise<ClockSyncEstimate | null> {
    const samples: ClockSample[] = [];
    const count = Math.min(Math.max(1, sampleCount), 5);

    for (let i = 0; i < count; i++) {
      if (i > 0 && this.sampleIntervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.sampleIntervalMs));
      }

      const sample = await this.takeSample();
      if (sample) {
        samples.push(sample);
      }
    }

    if (samples.length === 0) {
      this.logger?.warn('Server clock synchronization failed: no valid samples obtained');
      return null;
    }

    const estimate = estimateClockOffset(samples);
    if (estimate) {
      this.lastEstimate = estimate;
      this.logger?.info('Server clock synchronized successfully', {
        offsetMs: estimate.offsetMs,
        rttMs: estimate.roundTripTimeMs,
        uncertaintyMs: estimate.uncertaintyMs,
        samples: estimate.sampleCount,
      });
    }

    return estimate;
  }

  private async takeSample(): Promise<ClockSample | null> {
    try {
      const start = Date.now();
      const res = await safeTicketboxFetch(this.endpointUrl, {
        method: 'HEAD',
        headers: { Accept: 'application/json' },
      }).catch(async (headErr) => {
        // Some proxies/servers don't support HEAD or return 405; fallback to GET
        this.logger?.debug('HEAD failed, trying GET for Date header', { err: String(headErr) });
        return safeTicketboxFetch(this.endpointUrl, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
      });

      const end = Date.now();
      const dateHeader = res.headers.get('date');
      if (!dateHeader) {
        this.logger?.debug('Server response missing Date header');
        return null;
      }

      const serverTimeMs = new Date(dateHeader).getTime();
      if (!Number.isFinite(serverTimeMs)) {
        this.logger?.debug('Invalid server Date header parsed', { dateHeader });
        return null;
      }

      return {
        clientRequestStartMs: start,
        serverTimeMs,
        clientResponseEndMs: end,
      };
    } catch (err) {
      this.logger?.debug('Failed to take clock sync sample', { err: String(err) });
      return null;
    }
  }
}
