import { describe, it, expect } from 'vitest';
import { BenchmarkRunner } from './BenchmarkUtils';

class CoalescedMutationScanner {
  private scanCount = 0;
  private isScanScheduled = false;
  private isScanning = false;
  private scheduledTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly cooldownMs: number;

  constructor(cooldownMs = 50) {
    this.cooldownMs = cooldownMs;
  }

  public get runs(): number {
    return this.scanCount;
  }

  public reset(): void {
    this.scanCount = 0;
    this.isScanScheduled = false;
    this.isScanning = false;
    if (this.scheduledTimer) {
      clearTimeout(this.scheduledTimer);
      this.scheduledTimer = null;
    }
  }

  public onMutation(mutation: { type: string; target: string }): void {
    // Filter noise: ignore style, script, irrelevant attribute churn
    if (mutation.type === 'attributes' && mutation.target === 'SCRIPT') {
      return;
    }

    if (this.isScanScheduled) {
      return; // Already scheduled, coalesce storm
    }

    this.isScanScheduled = true;
    this.scheduledTimer = setTimeout(() => {
      this.isScanScheduled = false;
      this.executeScan();
    }, this.cooldownMs);
  }

  public executeScan(): void {
    if (this.isScanning) return;
    this.isScanning = true;
    try {
      this.scanCount++;
    } finally {
      this.isScanning = false;
    }
  }

  public async flush(): Promise<void> {
    if (this.isScanScheduled) {
      if (this.scheduledTimer) clearTimeout(this.scheduledTimer);
      this.isScanScheduled = false;
      this.executeScan();
    }
  }
}

describe('Performance Benchmark: Mutation Storms and Event Coalescing', () => {
  it('handles 100 mutations and coalesces to a single scan run', async () => {
    const scanner = new CoalescedMutationScanner(10);
    const mutations = Array.from({ length: 100 }, (_, i) => ({
      type: 'childList',
      target: `DIV_${i}`,
    }));

    const stats = await BenchmarkRunner.run(
      async () => {
        scanner.reset();
        for (const m of mutations) {
          scanner.onMutation(m);
        }
        await new Promise((r) => setTimeout(r, 25));
        await scanner.flush();
        expect(scanner.runs).toBe(1);
      },
      { iterations: 20, warmupIterations: 3 }
    );

    console.info('[PERF] 100 Mutations Coalesce Stats (ms):', stats);
    expect(stats.median).toBeLessThan(40);
  });

  it('handles 1,000 mutations without event storm (runs <= 2)', async () => {
    const scanner = new CoalescedMutationScanner(10);
    const mutations = Array.from({ length: 1000 }, (_, i) => ({
      type: i % 2 === 0 ? 'childList' : 'attributes',
      target: `SPAN_${i}`,
    }));

    const stats = await BenchmarkRunner.run(
      async () => {
        scanner.reset();
        for (const m of mutations) {
          scanner.onMutation(m);
        }
        await new Promise((r) => setTimeout(r, 25));
        await scanner.flush();
        expect(scanner.runs).toBeLessThanOrEqual(2);
      },
      { iterations: 10, warmupIterations: 2 }
    );

    console.info('[PERF] 1,000 Mutations Coalesce Stats (ms):', stats);
    expect(stats.median).toBeLessThan(50);
  });

  it('handles 10,000 mutations storm: 10,000 mutations != 10,000 discovery runs (runs <= 3)', async () => {
    const scanner = new CoalescedMutationScanner(10);
    const mutations = Array.from({ length: 10000 }, (_, i) => ({
      type: i % 3 === 0 ? 'childList' : 'attributes',
      target: `ELEMENT_${i}`,
    }));

    const stats = await BenchmarkRunner.run(
      async () => {
        scanner.reset();
        for (const m of mutations) {
          scanner.onMutation(m);
        }
        await new Promise((r) => setTimeout(r, 25));
        await scanner.flush();
        // 10,000 mutations must NOT cause 10,000 scans!
        expect(scanner.runs).toBeLessThanOrEqual(3);
        expect(scanner.runs).toBeGreaterThan(0);
      },
      { iterations: 5, warmupIterations: 1 }
    );

    console.info('[PERF] 10,000 Mutations Coalesce Stats (ms):', stats);
    expect(stats.median).toBeLessThan(100);
  });
});
