import { ClockSyncEstimate } from '../../domain/policies/ServerClock';

/**
 * Port for server clock synchronization.
 * Clean architecture boundary for obtaining estimated server time offset.
 */
export interface ServerClockPort {
  /**
   * Synchronizes clock with authoritative server and returns offset estimate.
   * If synchronization fails or is unmeasured, returns null or fallback estimate.
   */
  synchronize(sampleCount?: number): Promise<ClockSyncEstimate | null>;

  /**
   * Gets the last known clock sync estimate.
   */
  getLastEstimate(): ClockSyncEstimate | null;
}
