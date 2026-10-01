/**
 * Benchmark runner utility for high-resolution timing and statistical distribution reporting.
 * Reports iterations, min, median (p50), p75, p90, p95, p99, and max.
 */
export interface BenchmarkStats {
  iterations: number;
  min: number;
  median: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
  stdDev: number;
}

export class BenchmarkRunner {
  /**
   * Runs synchronous or asynchronous iterations and computes statistical percentiles.
   */
  public static async run(
    fn: (iteration: number) => Promise<void> | void,
    options: {
      iterations: number;
      warmupIterations?: number;
      setup?: () => Promise<void> | void;
      teardown?: () => Promise<void> | void;
    }
  ): Promise<BenchmarkStats> {
    const { iterations, warmupIterations = 5, setup, teardown } = options;

    // Warm-up phase (JIT optimization)
    for (let i = 0; i < warmupIterations; i++) {
      if (setup) await setup();
      await fn(i);
      if (teardown) await teardown();
    }

    const timesMs: number[] = new Array(iterations);

    // Measurement phase
    for (let i = 0; i < iterations; i++) {
      if (setup) await setup();
      const start = performance.now();
      await fn(i);
      const end = performance.now();
      if (teardown) await teardown();
      timesMs[i] = end - start;
    }

    timesMs.sort((a, b) => a - b);

    const min = timesMs[0]!;
    const max = timesMs[timesMs.length - 1]!;
    const median = this.percentile(timesMs, 50);
    const p75 = this.percentile(timesMs, 75);
    const p90 = this.percentile(timesMs, 90);
    const p95 = this.percentile(timesMs, 95);
    const p99 = this.percentile(timesMs, 99);

    const sum = timesMs.reduce((acc, t) => acc + t, 0);
    const mean = sum / timesMs.length;
    const variance = timesMs.reduce((acc, t) => acc + Math.pow(t - mean, 2), 0) / timesMs.length;
    const stdDev = Math.sqrt(variance);

    return {
      iterations,
      min: Number(min.toFixed(4)),
      median: Number(median.toFixed(4)),
      p75: Number(p75.toFixed(4)),
      p90: Number(p90.toFixed(4)),
      p95: Number(p95.toFixed(4)),
      p99: Number(p99.toFixed(4)),
      max: Number(max.toFixed(4)),
      mean: Number(mean.toFixed(4)),
      stdDev: Number(stdDev.toFixed(4)),
    };
  }

  private static percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    if (p <= 0) return sorted[0]!;
    if (p >= 100) return sorted[sorted.length - 1]!;

    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;

    if (upper === lower) return sorted[lower]!;
    return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
  }
}
