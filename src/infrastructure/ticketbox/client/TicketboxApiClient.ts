/**
 * Ticketbox API Client
 *
 * Handles HTTP/network fetching and caching for Ticketbox endpoints:
 * - /event/api/v1/events/showings/{showingId}/seatmap
 * - /gin/api/v2/events/showings/{showingId}
 * - /gin/api/v2/events/{eventId}
 * - /event/api/v1/events/{eventId}/question-form
 */

import { LoggerPort } from '../../../application/ports/LoggerPort';
import { safeTicketboxFetch } from '../../../extension/shared/NetworkSafety';
import { SeatmapApiResponse } from '../parsing/TicketboxSeatMapParser';
import {
  TicketboxEventApiResponse,
  TicketboxQuestionFormApiResponse,
  TicketboxShowingApiResponse,
} from '../types/TicketboxApiTypes';

export class TicketboxApiClient {
  private cachedSeatmapData: SeatmapApiResponse | null = null;
  private cachedShowingId: string | null = null;
  private failedSeatmapShowingIds = new Map<string, number>();

  private cachedShowingApiData: TicketboxShowingApiResponse | null = null;
  private cachedShowingApiId: string | null = null;

  private cachedEventApiData: TicketboxEventApiResponse | null = null;
  private cachedEventApiId: string | null = null;

  private cachedQuestionFormData: TicketboxQuestionFormApiResponse | null = null;
  private cachedQuestionFormEventId: string | null = null;

  private allowedShowingIds?: Set<string> | null = null;

  constructor(private readonly logger?: LoggerPort) {}

  public setAllowedShowingIds(ids: Set<string> | string[] | null): void {
    if (!ids) {
      this.allowedShowingIds = null;
    } else if (ids instanceof Set) {
      this.allowedShowingIds = ids;
    } else {
      this.allowedShowingIds = new Set(ids);
    }
  }

  public getCachedSeatmapData(): SeatmapApiResponse | null {
    return this.cachedSeatmapData;
  }

  public setCachedSeatmapData(data: SeatmapApiResponse | null): void {
    this.cachedSeatmapData = data;
  }

  public invalidateSeatmapCache(): void {
    this.cachedSeatmapData = null;
    this.failedSeatmapShowingIds.clear();
  }

  public getCachedShowingApiData(): TicketboxShowingApiResponse | null {
    return this.cachedShowingApiData;
  }

  public setCachedShowingApiData(data: TicketboxShowingApiResponse | null): void {
    this.cachedShowingApiData = data;
  }

  public getCachedQuestionFormData(): TicketboxQuestionFormApiResponse | null {
    return this.cachedQuestionFormData;
  }

  public getCachedEventApiData(): TicketboxEventApiResponse | null {
    return this.cachedEventApiData;
  }

  public async fetchSeatmapApi(showingId: string): Promise<SeatmapApiResponse | null> {
    // BR-S01 & AC-10 Scope Guard: strictly forbid fetching seatmaps for showings outside the whitelist
    if (this.allowedShowingIds && !this.allowedShowingIds.has(showingId)) {
      this.logger?.info(
        `Skipping seatmap fetch for showing '${showingId}' because it is outside the whitelist (BR-S01 / AC-10)`,
        { showingId }
      );
      return null;
    }

    if (this.cachedShowingId === showingId && this.cachedSeatmapData) {
      return this.cachedSeatmapData;
    }

    // Skip recently failed seatmap fetches for 5 minutes
    const lastFailedAt = this.failedSeatmapShowingIds.get(showingId);
    if (lastFailedAt && Date.now() - lastFailedAt < 300_000) {
      return null;
    }

    const url = `https://api-v2.ticketbox.vn/event/api/v1/events/showings/${showingId}/seatmap`;
    this.logger?.info('Fetching seatmap API', { showingId, url });

    // 1. Direct fetch if in browser or node
    if (typeof fetch !== 'undefined') {
      try {
        const res = await safeTicketboxFetch(url);
        if (res.ok) {
          const json = (await res.json()) as SeatmapApiResponse;
          if (json && json.data?.result?.sections) {
            this.cachedShowingId = showingId;
            this.cachedSeatmapData = json;
            this.logger?.info('Seatmap API fetched successfully via direct fetch', {
              sectionsCount: json.data.result.sections.length,
            });
            return json;
          }
        } else {
          this.failedSeatmapShowingIds.set(showingId, Date.now());
        }
      } catch (err: unknown) {
        this.logger?.debug('Direct fetch failed, falling back to background message', {
          err: String(err),
        });
      }
    }

    // 2. Background service worker fetch fallback
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        const response = await new Promise<SeatmapApiResponse | null>((resolve) => {
          const timeout = setTimeout(() => resolve(null), 3000);
          const listener = (msg: unknown) => {
            const m = msg as {
              type?: string;
              showingId?: string;
              success?: boolean;
              data?: SeatmapApiResponse;
            };
            if (m && m.type === 'FETCH_SEATMAP_RESPONSE' && m.showingId === showingId) {
              clearTimeout(timeout);
              chrome.runtime.onMessage.removeListener(listener);
              resolve(m.success && m.data ? m.data : null);
            }
          };
          chrome.runtime.onMessage.addListener(listener);
          chrome.runtime.sendMessage({
            type: 'FETCH_SEATMAP_REQUEST',
            timestamp: new Date().toISOString(),
            showingId,
          });
        });

        if (response && response.data?.result?.sections) {
          this.cachedShowingId = showingId;
          this.cachedSeatmapData = response;
          this.logger?.info('Seatmap API fetched successfully via background worker', {
            sectionsCount: response.data.result.sections.length,
          });
          return response;
        } else {
          this.failedSeatmapShowingIds.set(showingId, Date.now());
        }
      } catch (err: unknown) {
        this.logger?.warn('Background message fetch failed', { err: String(err) });
        this.failedSeatmapShowingIds.set(showingId, Date.now());
      }
    }

    this.failedSeatmapShowingIds.set(showingId, Date.now());
    return null;
  }

  public async fetchShowingApi(showingId: string): Promise<TicketboxShowingApiResponse | null> {
    // BR-S01 & AC-10 Scope Guard: strictly forbid fetching showings outside the whitelist
    if (this.allowedShowingIds && !this.allowedShowingIds.has(showingId)) {
      this.logger?.info(
        `Skipping showing fetch for showing '${showingId}' because it is outside the whitelist (BR-S01 / AC-10)`,
        { showingId }
      );
      return null;
    }

    if (this.cachedShowingApiId === showingId && this.cachedShowingApiData) {
      return this.cachedShowingApiData;
    }

    const url = `https://api-v2.ticketbox.vn/gin/api/v2/events/showings/${showingId}`;
    this.logger?.info('Fetching showing API', { showingId, url });

    // 1. Direct fetch if in browser or node
    if (typeof fetch !== 'undefined') {
      try {
        const res = await safeTicketboxFetch(url);
        if (res.ok) {
          const json = (await res.json()) as TicketboxShowingApiResponse;
          if (json && json.data?.result?.ticketTypes) {
            this.cachedShowingApiId = showingId;
            this.cachedShowingApiData = json;
            this.logger?.info('Showing API fetched successfully via direct fetch', {
              showingId,
              seatMapId: json.data.result.seatMapId,
              ticketCount: json.data.result.ticketTypes.length,
            });
            return json;
          }
        }
      } catch (err: unknown) {
        this.logger?.debug('Direct showing fetch failed, falling back to background message', {
          err: String(err),
        });
      }
    }

    // 2. Background service worker fetch fallback
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        const response = await new Promise<TicketboxShowingApiResponse | null>((resolve) => {
          const timeout = setTimeout(() => resolve(null), 3000);
          const listener = (msg: unknown) => {
            const m = msg as {
              type?: string;
              showingId?: string;
              success?: boolean;
              data?: TicketboxShowingApiResponse;
            };
            if (m && m.type === 'FETCH_SHOWING_RESPONSE' && m.showingId === showingId) {
              clearTimeout(timeout);
              chrome.runtime.onMessage.removeListener(listener);
              resolve(m.success && m.data ? m.data : null);
            }
          };
          chrome.runtime.onMessage.addListener(listener);
          chrome.runtime.sendMessage({
            type: 'FETCH_SHOWING_REQUEST',
            timestamp: new Date().toISOString(),
            showingId,
          });
        });

        if (response && response.data?.result?.ticketTypes) {
          this.cachedShowingApiId = showingId;
          this.cachedShowingApiData = response;
          this.logger?.info('Showing API fetched successfully via background worker', {
            showingId,
            seatMapId: response.data.result.seatMapId,
            ticketCount: response.data.result.ticketTypes.length,
          });
          return response;
        }
      } catch (err: unknown) {
        this.logger?.warn('Background message fetch for showing failed', { err: String(err) });
      }
    }

    return null;
  }

  public async fetchEventApi(eventId: string): Promise<TicketboxEventApiResponse | null> {
    if (this.cachedEventApiId === eventId && this.cachedEventApiData) {
      return this.cachedEventApiData;
    }
    const url = `https://api-v2.ticketbox.vn/gin/api/v2/events/${eventId}`;
    this.logger?.info('Fetching Event API for showings', { eventId, url });
    try {
      const res = await safeTicketboxFetch(url);
      if (res.ok) {
        const json = (await res.json()) as TicketboxEventApiResponse;
        if (json?.data?.result?.showings) {
          this.cachedEventApiId = eventId;
          this.cachedEventApiData = json;
          this.logger?.info('Event API fetched successfully', {
            eventId,
            showingsCount: json.data.result.showings.length,
          });
          return json;
        }
      }
    } catch (err) {
      this.logger?.debug('Event API direct fetch failed, falling back to DOM', {
        err: String(err),
      });
    }
    return null;
  }

  public async fetchQuestionFormApi(
    eventId: string
  ): Promise<TicketboxQuestionFormApiResponse | null> {
    if (this.cachedQuestionFormEventId === eventId && this.cachedQuestionFormData) {
      return this.cachedQuestionFormData;
    }
    const url = `https://api-v2.ticketbox.vn/event/api/v1/events/${eventId}/question-form`;
    this.logger?.info('Fetching Question Form API', { eventId, url });
    try {
      const res = await safeTicketboxFetch(url);
      if (res.ok) {
        const json = (await res.json()) as TicketboxQuestionFormApiResponse;
        if (json?.data?.result?.questionCollection) {
          this.cachedQuestionFormEventId = eventId;
          this.cachedQuestionFormData = json;
          this.logger?.info('Question Form API fetched successfully', {
            eventId,
            questionCount: json.data.result.questionCollection.length,
          });
          return json;
        }
      }
    } catch (err) {
      this.logger?.warn('Question Form API fetch failed', { err: String(err) });
    }
    return null;
  }
}
