/**
 * Pure domain functions for server clock synchronization and countdown calculations.
 * Zero external dependencies.
 */

export interface ClockSample {
  /** Client timestamp (ms) right before sending the request (t_start) */
  clientRequestStartMs: number;
  /** Server timestamp (ms) parsed from response (e.g. Date header) */
  serverTimeMs: number;
  /** Client timestamp (ms) upon receiving response (t_end) */
  clientResponseEndMs: number;
}

export interface ClockSyncEstimate {
  /** Estimated server clock offset: serverTime = clientTime + offsetMs */
  offsetMs: number;
  /** Round-trip time (ms) of the best sample */
  roundTripTimeMs: number;
  /** Estimated uncertainty in ms (e.g. Date header 1-second resolution adds 1000ms + rtt/2) */
  uncertaintyMs: number;
  /** Total valid samples collected */
  sampleCount: number;
  /** Timestamp when sync was performed */
  syncedAtMs: number;
}

/**
 * Calculates estimated server time from local client time and offset.
 */
export function toServerTime(clientNowMs: number, offsetMs: number): number {
  return clientNowMs + offsetMs;
}

/**
 * Calculates remaining milliseconds from client now until target server time.
 * If target is given in server time reference, target - toServerTime(clientNowMs, offsetMs)
 * which equals target - (clientNowMs + offsetMs) = (target - offsetMs) - clientNowMs.
 */
export function msUntil(targetServerTimeMs: number, offsetMs: number, clientNowMs: number = Date.now()): number {
  const currentServerTime = toServerTime(clientNowMs, offsetMs);
  return targetServerTimeMs - currentServerTime;
}

/**
 * Estimates the server clock offset from an array of clock samples.
 * Selects the sample with the lowest RTT to minimize network jitter impact.
 * Takes into account HTTP Date header 1000ms granularity.
 */
export function estimateClockOffset(samples: ClockSample[]): ClockSyncEstimate | null {
  if (!samples || samples.length === 0) {
    return null;
  }

  // Filter out invalid samples (e.g. negative RTT or NaN)
  const validSamples = samples.filter((s) => {
    const rtt = s.clientResponseEndMs - s.clientRequestStartMs;
    return (
      Number.isFinite(s.clientRequestStartMs) &&
      Number.isFinite(s.serverTimeMs) &&
      Number.isFinite(s.clientResponseEndMs) &&
      rtt >= 0
    );
  });

  if (validSamples.length === 0) {
    return null;
  }

  // Sort by lowest RTT
  validSamples.sort((a, b) => {
    const rttA = a.clientResponseEndMs - a.clientRequestStartMs;
    const rttB = b.clientResponseEndMs - b.clientRequestStartMs;
    return rttA - rttB;
  });

  const bestSample = validSamples[0];
  if (!bestSample) {
    return null;
  }
  const rtt = bestSample.clientResponseEndMs - bestSample.clientRequestStartMs;
  // Standard NTP formula: offset = serverTime + RTT/2 - clientResponseEnd
  // Equivalent: clientMidpoint = (t_start + t_end) / 2; offset = serverTime - clientMidpoint
  const clientMidpoint = bestSample.clientRequestStartMs + rtt / 2;
  const offsetMs = Math.round(bestSample.serverTimeMs - clientMidpoint);

  // Uncertainty accounts for HTTP Date resolution (up to 1000ms) plus RTT/2 network delay uncertainty
  const uncertaintyMs = Math.round(1000 + rtt / 2);

  return {
    offsetMs,
    roundTripTimeMs: rtt,
    uncertaintyMs,
    sampleCount: validSamples.length,
    syncedAtMs: bestSample.clientResponseEndMs,
  };
}
