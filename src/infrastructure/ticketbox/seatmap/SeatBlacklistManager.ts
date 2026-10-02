/**
 * Seat Blacklist Manager
 *
 * Tracks blacklisted seats with bounded set size to prevent unbounded memory growth.
 */

import { LoggerPort } from '../../../application/ports/LoggerPort';
import { addBoundedSetItem } from '../types/TicketboxApiTypes';

export class SeatBlacklistManager {
  private blacklistedSeatKeys = new Set<string>();

  constructor(private readonly logger?: LoggerPort) {}

  public blacklistSeat(seatIdOrLabel: string): void {
    if (!seatIdOrLabel) return;
    const raw = seatIdOrLabel.trim();
    const upper = raw.toUpperCase();
    const normalized = upper.replace(/[^A-Z0-9]/g, '');

    addBoundedSetItem(this.blacklistedSeatKeys, raw);
    addBoundedSetItem(this.blacklistedSeatKeys, upper);
    if (normalized) {
      addBoundedSetItem(this.blacklistedSeatKeys, normalized);
    }
    this.logger?.warn('Seat blacklisted from future selection in journey', {
      seatIdOrLabel: raw,
      normalized,
      totalBlacklisted: this.blacklistedSeatKeys.size,
    });
  }

  public isSeatBlacklisted(seatIdOrLabel?: string | null): boolean {
    if (!seatIdOrLabel) return false;
    const raw = seatIdOrLabel.trim();
    const upper = raw.toUpperCase();
    const normalized = upper.replace(/[^A-Z0-9]/g, '');
    return (
      this.blacklistedSeatKeys.has(raw) ||
      this.blacklistedSeatKeys.has(upper) ||
      (normalized.length > 0 && this.blacklistedSeatKeys.has(normalized))
    );
  }

  public getBlacklistedSeats(): Set<string> {
    return new Set(this.blacklistedSeatKeys);
  }
}
