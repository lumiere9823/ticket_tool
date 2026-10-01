import { describe, it, expect } from 'vitest';
import { BenchmarkRunner } from './BenchmarkUtils';
import { ChromeStorageRepository } from '../../src/infrastructure/storage/ChromeStorageRepository';
import { AssistantConfiguration } from '../../src/application/ports/StorageRepository';

describe('Performance Benchmark: Storage Access Latency & Hot Path Cache', () => {
  const sampleConfig: AssistantConfiguration = {
    targetEventUrl: 'https://ticketbox.vn/event/live-26416',
    discoveryMode: false,
    preferences: {
      categoryPriority: ['VIP', 'CAT 1'],
      quantity: 2,
      allowFallback: true,
    },
    userProfile: {
      fullName: 'Nguyen Van A',
      email: 'a@example.com',
      phone: '0901234567',
      allowSensitivePii: true,
    },
  };

  it('measures un-cached storage reads and writes', async () => {
    const storage = new ChromeStorageRepository();
    await storage.saveConfiguration(sampleConfig);

    const stats = await BenchmarkRunner.run(
      async () => {
        const config = await storage.getConfiguration();
        expect(config?.targetEventUrl).toBe(sampleConfig.targetEventUrl);
      },
      { iterations: 500, warmupIterations: 50 }
    );

    console.info('[PERF] Storage Read Stats (ms):', stats);
    expect(stats.median).toBeLessThan(2);
  });
});
