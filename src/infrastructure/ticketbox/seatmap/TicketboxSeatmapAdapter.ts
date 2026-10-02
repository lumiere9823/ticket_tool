/**
 * Ticketbox Seatmap Adapter
 *
 * Handles seat map discovery, zone/area picking, Konva bridge communication,
 * and individual seat selection/deselection.
 */

import { LoggerPort } from '../../../application/ports/LoggerPort';
import { Seat, SeatArea } from '../../../domain/entities/BookingJourneyModels';
import { DOMElementLike } from '../parsing/DOMElementLike';
import { SeatmapApiResponse, TicketboxSeatMapParser } from '../parsing/TicketboxSeatMapParser';
import { TicketboxShowingApiResponse } from '../types/TicketboxApiTypes';
import { AreaSelector } from './AreaSelector';
import { CoordinateSeatSelector } from './CoordinateSeatSelector';
import { SeatDeselector } from './SeatDeselector';
import { SvgSeatFinder } from './SvgSeatFinder';

export interface SeatmapAdapterContext {
  getRoot: () => DOMElementLike | null;
  getShowingId: () => string | null;
  getCachedSeatmapData: () => SeatmapApiResponse | null;
  fetchSeatmapApi: (showingId: string) => Promise<SeatmapApiResponse | null>;
  getCachedShowingApiData: () => TicketboxShowingApiResponse | null;
  isSeatBlacklisted: (seatIdOrLabel?: string | null) => boolean;
  blacklistSeat: (seatIdOrLabel: string) => void;
  sendPageBridgeRequest: <T>(
    action: string,
    payload: Record<string, unknown>,
    timeoutMs?: number
  ) => Promise<{ success: boolean; data?: T; error?: string }>;
  clickElement: (el: DOMElementLike) => void;
  invalidateSeatmapCache: () => void;
}

export class TicketboxSeatmapAdapter {
  private cachedSeats: Seat[] = [];
  private selectedSeatIds = new Set<string>();

  constructor(
    private readonly ctx: SeatmapAdapterContext,
    private readonly logger?: LoggerPort
  ) {}

  public getCachedSeats(): Seat[] {
    return this.cachedSeats;
  }

  public setCachedSeats(seats: Seat[]): void {
    this.cachedSeats = seats;
  }

  public getSelectedSeatIds(): Set<string> {
    return this.selectedSeatIds;
  }

  public findSeatmapSvg(): SVGSVGElement | null {
    return SvgSeatFinder.findSeatmapSvg();
  }

  public async detectSeatMap(): Promise<{ hasSeatMap: boolean; zones?: string[] }> {
    const root = this.ctx.getRoot();
    if (!root) return { hasSeatMap: false };

    const showingData = this.ctx.getCachedShowingApiData();
    if (showingData?.data?.result && showingData.data.result.seatMapId === 0) {
      this.logger?.info(
        'Authoritative Showing API indicates seatMapId: 0 (standing event, no seat map)',
        { showingId: showingData.data.result.id }
      );
      return { hasSeatMap: false, zones: [] };
    }

    const hasKonva = root.querySelector('.konvajs-content, [class*="konvajs"]') !== null;
    const mapEl =
      this.findSeatmapSvg() ||
      root.querySelector(
        '.seat-map, #seat-map, svg.seatmap, [data-seat-map], [data-seatmap], .seat-plan, [class*="seatmap"], [class*="seat-map"]'
      );
    const areas = TicketboxSeatMapParser.parseAreas(root);
    const hasSeatMap = mapEl !== null || hasKonva || areas.length > 0;

    return {
      hasSeatMap,
      zones: areas.map((a) => a.name),
    };
  }

  public async discoverAreas(): Promise<SeatArea[]> {
    const root = this.ctx.getRoot();
    const cachedSeatmap = this.ctx.getCachedSeatmapData();
    if (cachedSeatmap) {
      const apiAreas = TicketboxSeatMapParser.parseAreasFromSeatmapApi(cachedSeatmap);
      if (apiAreas.length > 0) return apiAreas;
    }
    if (!root) return [];
    return TicketboxSeatMapParser.parseAreas(root);
  }

  public async selectArea(
    areaId: string,
    areaName?: string | undefined,
    ticketTypeId?: string | undefined,
    coords?:
      | {
          x?: number | undefined;
          y?: number | undefined;
          width?: number | undefined;
          height?: number | undefined;
        }
      | undefined
  ): Promise<boolean> {
    return AreaSelector.selectArea(
      areaId,
      areaName,
      ticketTypeId,
      coords,
      {
        getRoot: () => this.ctx.getRoot(),
        sendPageBridgeRequest: this.ctx.sendPageBridgeRequest,
        clickElement: this.ctx.clickElement,
      },
      this.logger
    );
  }

  public async discoverSeats(areaId?: string): Promise<Seat[]> {
    const root = this.ctx.getRoot();
    const showingId = this.ctx.getShowingId();

    let seatmapData = this.ctx.getCachedSeatmapData();
    if (!seatmapData && showingId) {
      seatmapData = await this.ctx.fetchSeatmapApi(showingId);
    }

    if (seatmapData) {
      const apiSeats = TicketboxSeatMapParser.parseSeatsFromSeatmapApi(seatmapData, areaId);
      if (apiSeats.length > 0) {
        if (root) {
          this.reconcileSelectedSeatsFromDOM(apiSeats, root);
        }
        for (const s of apiSeats) {
          if (this.ctx.isSeatBlacklisted(s.id) || this.ctx.isSeatBlacklisted(s.label)) {
            s.status = 'UNAVAILABLE';
            s.selectable = false;
          } else if (this.selectedSeatIds.has(s.id) || this.selectedSeatIds.has(s.label)) {
            s.status = 'SELECTED';
          }
        }
        this.cachedSeats = apiSeats;
        this.logger?.info('Discovered seats from authoritative Seatmap API', {
          totalSeats: apiSeats.length,
          availableCount: apiSeats.filter((s) => s.selectable && s.status === 'AVAILABLE').length,
          selectedCount: apiSeats.filter((s) => s.status === 'SELECTED').length,
          blacklistedCount: apiSeats.filter(
            (s) => this.ctx.isSeatBlacklisted(s.id) || this.ctx.isSeatBlacklisted(s.label)
          ).length,
          areaId,
        });
        return apiSeats;
      }
    }

    if (!root) return [];
    const allSeats = TicketboxSeatMapParser.parseSeats(root);

    const selectedBadge = root.querySelector(
      '[class*="selected"], [class*="seat-selected"], [class*="seat-info"], [class*="bottom"], footer, .bottom-bar'
    );
    const selectedBadgeText = selectedBadge ? selectedBadge.textContent : '';
    const seatMatches = selectedBadgeText.match(/\b([A-Z0-9]+[-_]\d+)\b/gi);

    if (seatMatches) {
      for (const rawLabel of seatMatches) {
        const seatLabel = rawLabel.toUpperCase();
        if (this.ctx.isSeatBlacklisted(seatLabel)) {
          continue;
        }
        const existing = allSeats.find(
          (s) => s.label.toUpperCase() === seatLabel || s.id.toUpperCase() === seatLabel
        );
        if (existing) {
          existing.status = 'SELECTED';
        } else {
          const parsed = TicketboxSeatMapParser.parseRowAndNumber(seatLabel);
          allSeats.unshift({
            id: seatLabel,
            label: seatLabel,
            row: parsed.row,
            number: parsed.number,
            area: 'DEFAULT',
            status: 'SELECTED',
            selectable: true,
          });
        }
      }
    }

    for (const s of allSeats) {
      if (this.ctx.isSeatBlacklisted(s.id) || this.ctx.isSeatBlacklisted(s.label)) {
        s.status = 'UNAVAILABLE';
        s.selectable = false;
      }
    }

    this.cachedSeats = allSeats;

    if (areaId) {
      return allSeats.filter(
        (s) =>
          !s.area ||
          s.area === areaId ||
          s.area.toLowerCase() === areaId.toLowerCase() ||
          s.areaId === areaId
      );
    }
    return allSeats;
  }

  public reconcileSelectedSeatsFromDOM(seats: Seat[], root: DOMElementLike): void {
    try {
      const selectedNodes = root.querySelectorAll(
        '[class*="selected"], [class*="active"], [data-status="selected"], [aria-pressed="true"], svg circle[fill="#4CAF50"], svg circle[fill*="green"], svg circle[style*="green"], svg [fill*="green"]'
      );

      for (const node of selectedNodes) {
        const id =
          node.getAttribute('data-seat-id') ||
          node.getAttribute('data-id') ||
          node.getAttribute('id');
        const label =
          node.getAttribute('data-seat-label') ||
          node.getAttribute('aria-label') ||
          node.textContent.trim();
        const cxAttr = node.getAttribute('cx') || node.getAttribute('x');
        const cyAttr = node.getAttribute('cy') || node.getAttribute('y');
        const cx = cxAttr ? parseFloat(cxAttr) : NaN;
        const cy = cyAttr ? parseFloat(cyAttr) : NaN;

        for (const s of seats) {
          if (
            (id && s.id === id) ||
            (label && (s.label === label || s.id === label)) ||
            (!isNaN(cx) &&
              !isNaN(cy) &&
              typeof s.x === 'number' &&
              typeof s.y === 'number' &&
              Math.hypot(s.x - cx, s.y - cy) < 15)
          ) {
            if (this.ctx.isSeatBlacklisted(s.id) || this.ctx.isSeatBlacklisted(s.label)) {
              s.status = 'UNAVAILABLE';
              s.selectable = false;
            } else {
              s.status = 'SELECTED';
            }
          }
        }
      }

      const bar = root.querySelector(
        '[class*="bottom"], [class*="footer"], .checkout-bar, .booking-bar, [class*="seat-info"]'
      );
      if (bar) {
        const barText = bar.textContent.toUpperCase();
        for (const s of seats) {
          if (s.label && s.label.length >= 2 && barText.includes(s.label.toUpperCase())) {
            if (this.ctx.isSeatBlacklisted(s.id) || this.ctx.isSeatBlacklisted(s.label)) {
              s.status = 'UNAVAILABLE';
              s.selectable = false;
            } else {
              s.status = 'SELECTED';
            }
          }
        }
      }
    } catch {
      // Ignore inspection errors
    }
  }

  public async selectSpecificSeats(seatIds: string[]): Promise<boolean> {
    const root = this.ctx.getRoot();
    if (!root) return false;

    this.logger?.info('Selecting specific seats', { seatIds });

    if (typeof window !== 'undefined') {
      const seatsToSelect = seatIds.map((id) => {
        const cached = this.cachedSeats.find((s) => s.id === id || s.label === id);
        return {
          id,
          label: cached?.label || id,
          x: cached?.x,
          y: cached?.y,
          row: cached?.row,
          number: cached?.number,
        };
      });

      const bridgeRes = await this.ctx.sendPageBridgeRequest<{ selectedCount: number }>(
        'SELECT_SEATS',
        { seats: seatsToSelect },
        4000
      );

      if (bridgeRes.success && bridgeRes.data && bridgeRes.data.selectedCount > 0) {
        this.logger?.info('Seats selected successfully via Page Bridge (Konva)', {
          selectedCount: bridgeRes.data.selectedCount,
          seatIds,
        });

        for (const id of seatIds) {
          this.selectedSeatIds.add(id);
          const seat = this.cachedSeats.find((s) => s.id === id || s.label === id);
          if (seat) {
            seat.status = 'SELECTED';
            if (seat.label) this.selectedSeatIds.add(seat.label);
          }
        }

        await new Promise((r) => setTimeout(r, 300));
        return true;
      }
    }

    for (const seatId of seatIds) {
      const ok = await CoordinateSeatSelector.selectSeatByCoordinates(
        seatId,
        {
          getRoot: () => this.ctx.getRoot(),
          getCachedSeats: () => this.cachedSeats,
          getSelectedSeatIds: () => this.selectedSeatIds,
          findSeatmapSvg: () => this.findSeatmapSvg(),
        },
        this.logger
      );
      if (!ok) return false;
    }

    return true;
  }

  public async selectSeats(selection: { zoneId?: string; seatIds: string[] }): Promise<boolean> {
    return this.selectSpecificSeats(selection.seatIds);
  }

  public async deselectSeat(seatLabel?: string): Promise<boolean> {
    return SeatDeselector.deselectSeat(
      seatLabel,
      {
        getRoot: () => this.ctx.getRoot(),
        getSelectedSeatIds: () => this.selectedSeatIds,
        getCachedSeats: () => this.cachedSeats,
        invalidateSeatmapCache: this.ctx.invalidateSeatmapCache,
        sendPageBridgeRequest: this.ctx.sendPageBridgeRequest,
        clickElement: this.ctx.clickElement,
      },
      this.logger
    );
  }
}
