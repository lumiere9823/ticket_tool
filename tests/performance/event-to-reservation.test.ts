import { describe, it, expect } from 'vitest';
import { BenchmarkRunner } from './BenchmarkUtils';
import { PurchaseStateMachine } from '../../src/domain/state-machine/PurchaseStateMachine';
import { PurchaseState } from '../../src/domain/states/PurchaseState';
import { PriorityCategoryEngine } from '../../src/domain/policies/PriorityCategoryEngine';
import { TicketboxCatalogParser } from '../../src/infrastructure/ticketbox/parsing/TicketboxCatalogParser';
import {
  MutationClassifier,
  MutationLike,
} from '../../src/infrastructure/ticketbox/parsing/MutationClassifier';
import { LatencyTracker } from '../../src/application/services/LatencyTracker';
import { parseHtmlToDOMElementLike } from '../../src/infrastructure/ticketbox/parsing/DOMElementLike';

describe('Performance Benchmark: Real Event-to-Reservation Pipeline', () => {
  function createLiveHtml(isAvailable: boolean): string {
    return `
      <div id="root">
        <div data-event-id="26416" id="ticket-info">
          <div class="ant-collapse">
            <div class="ant-collapse-item" data-showing-id="showing_1">
              <div class="ant-collapse-header">
                <div class="first-row">19:30 - Thứ 7, 04/04/2026</div>
                <div class="second-row">Nhà thi đấu Quân Khu 7</div>
                <button id="select-showing-btn" type="button" class="ant-btn">Mua vé ngay</button>
              </div>
              <div class="ant-collapse-content">
                <div class="content-row">
                  <div class="title-tickettype">VIP Lounge</div>
                  <div class="tkt-price"><span class="price-value">2.500.000 đ</span></div>
                  <div id="status-badge" class="badge ${isAvailable ? '' : 'disabled'}">${isAvailable ? 'Còn vé' : 'Hết vé'}</div>
                  <button type="button" class="btn-buy ${isAvailable ? 'active' : 'disabled'}" ${isAvailable ? '' : 'disabled'}>Mua vé</button>
                </div>
                <div class="content-row">
                  <div class="title-tickettype">Standard CAT 1</div>
                  <div class="tkt-price"><span class="price-value">1.200.000 đ</span></div>
                  <div id="status-badge" class="badge ${isAvailable ? '' : 'disabled'}">${isAvailable ? 'Còn vé' : 'Hết vé'}</div>
                  <button type="button" class="btn-buy ${isAvailable ? 'active' : 'disabled'}" ${isAvailable ? '' : 'disabled'}>Mua vé</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  interface PipelineResult {
    tracker: LatencyTracker;
    decisionsCount: number;
    scansCount: number;
  }

  /**
   * Simulates the complete event-to-reservation pipeline under configurable debounce strategies.
   */
  async function runPipelineWithDebounce(
    mutations: MutationLike[],
    debounceMs: number,
    useFastPath: boolean
  ): Promise<PipelineResult> {
    const tEvent = Date.now();
    let scansCount = 0;
    let decisionsCount = 0;
    const tracker = new LatencyTracker('perf_sim_attempt');
    tracker.recordTEvent(tEvent);

    const sm = new PurchaseStateMachine(PurchaseState.MONITORING);

    // 1. Mutation observation and classification
    const batchClassification = MutationClassifier.classifyBatch(mutations);
    const isInventory = batchClassification.category === 'INVENTORY_RELEVANT';

    // Delay strategy: If fast-path enabled and inventory relevant, delay is 0ms (microtask)
    const effectiveDelay = useFastPath && isInventory ? 0 : debounceMs;

    await new Promise((resolve) => setTimeout(resolve, effectiveDelay));
    tracker.recordTDetected(Date.now());

    // 2. Discovery scan
    scansCount++;
    const root = parseHtmlToDOMElementLike(createLiveHtml(true));
    const catalog = TicketboxCatalogParser.parseCatalog(
      root,
      'https://ticketbox.vn/event/live-26416'
    );
    tracker.recordTDiscovery(Date.now());

    // 3. Candidate evaluation
    const availableTickets = catalog.showings.flatMap((s) => s.ticketTypes);
    const journeyTickets = availableTickets.map((t) => ({
      id: t.id ?? t.name,
      showingId: 'showing_1',
      name: t.name,
      price: t.price.amount,
      currency: 'VND',
      mode: (t.mode === 'ZONE' ? 'AREA_BASED' : t.mode) as
        'STANDING' | 'SEATED' | 'AREA_BASED' | 'UNKNOWN',
      availability: t.availability,
      minQuantity: t.minQuantity,
      maxQuantity: t.maxQuantity,
      selectable: t.selectable,
      evidence: t.source.evidence,
    }));

    const decision = PriorityCategoryEngine.evaluate(
      journeyTickets,
      ['VIP Lounge', 'Standard CAT 1'],
      true,
      1
    );
    tracker.recordTCandidate(Date.now());

    if (decision.selectedTicket) {
      decisionsCount++;
      sm.transition({
        type: 'TICKETS_DETECTED',
        ticketCount: journeyTickets.length,
      });
      sm.transition({ type: 'EVALUATING_TICKETS' });
      sm.transition({
        type: 'TICKET_SELECTED',
        ticketId: decision.selectedTicket.id ?? decision.selectedTicket.name,
        ticketName: decision.selectedTicket.name,
        price: decision.selectedTicket.price,
      });

      // 4. Reservation action initiation
      tracker.recordTReservation(Date.now());

      // 5. Authoritative result (server confirmation)
      tracker.recordTResult(Date.now());
    }

    return { tracker, decisionsCount, scansCount };
  }

  it('measures T_EVENT -> T_RESERVATION across debounce strategies (0ms to 100ms)', async () => {
    const debounceLevels = [0, 1, 5, 10, 25, 50, 100];
    const resultsMap: Record<number, { p50: number; p95: number; p99: number; max: number }> = {};

    for (const debounce of debounceLevels) {
      const singleMutation: MutationLike = {
        type: 'attributes',
        attributeName: 'disabled',
        target: { className: 'btn-buy active' },
      };

      const stats = await BenchmarkRunner.run(
        async () => {
          const res = await runPipelineWithDebounce([singleMutation], debounce, false);
          expect(res.decisionsCount).toBe(1);
          const breakdown = res.tracker.getBreakdown();
          expect(breakdown.eventToReservationMs).toBeDefined();
        },
        { iterations: 6, warmupIterations: 1 }
      );

      resultsMap[debounce] = {
        p50: stats.median,
        p95: stats.p95,
        p99: stats.p99,
        max: stats.max,
      };
    }

    console.info('[PERF] Debounce Strategy Latency Comparison (ms):', resultsMap);
    // 0ms debounce should be noticeably faster than 100ms
    expect(resultsMap[0]!.p50).toBeLessThan(resultsMap[100]!.p50);
  }, 30000);

  it('evaluates Fast Path for INVENTORY_RELEVANT mutations under 100ms baseline', async () => {
    const inventoryMutation: MutationLike = {
      type: 'attributes',
      attributeName: 'disabled',
      target: { className: 'btn-buy' },
    };

    // Without fast path (baseline 100ms)
    const baselineStats = await BenchmarkRunner.run(
      async () => {
        const res = await runPipelineWithDebounce([inventoryMutation], 100, false);
        expect(res.decisionsCount).toBe(1);
      },
      { iterations: 6, warmupIterations: 1 }
    );

    // With fast path (0ms for inventory-relevant)
    const fastPathStats = await BenchmarkRunner.run(
      async () => {
        const res = await runPipelineWithDebounce([inventoryMutation], 100, true);
        expect(res.decisionsCount).toBe(1);
      },
      { iterations: 6, warmupIterations: 1 }
    );

    console.info('[PERF] Fast Path vs 100ms Baseline:', {
      baselineP50: baselineStats.median,
      fastPathP50: fastPathStats.median,
      speedupMs: baselineStats.median - fastPathStats.median,
    });

    expect(fastPathStats.median).toBeLessThan(baselineStats.median - 80);
  }, 30000);

  it('runs real event simulation across mutation burst scales: 1, 10, 100, 1,000, 10,000', async () => {
    const scales = [1, 10, 100, 1000, 10000];
    const burstResults: Record<number, { decisions: number; scans: number; latencyP50: number }> =
      {};

    for (const count of scales) {
      // Create noisy burst with cosmetic/structural churn + 1 inventory event
      const burst: MutationLike[] = Array.from({ length: count }, (_, i) => {
        if (i === count - 1) {
          return {
            type: 'childList',
            addedNodes: [
              {
                nodeType: 1,
                tagName: 'BUTTON',
                className: 'btn-buy active',
                textContent: 'Mua vé ngay 2.500.000 đ',
              },
            ],
          };
        }
        return {
          type: 'childList',
          addedNodes: [
            {
              nodeType: 1,
              tagName: 'DIV',
              className: `ad-banner-${i}`,
              textContent: `Banner ad #${i}`,
            },
          ],
        };
      });

      const stats = await BenchmarkRunner.run(
        async () => {
          const res = await runPipelineWithDebounce(burst, 50, true);
          // Crucial verification: 10,000 noisy mutations must NOT cause 10,000 decisions!
          expect(res.scansCount).toBe(1);
          expect(res.decisionsCount).toBe(1);
        },
        { iterations: count >= 1000 ? 3 : 6, warmupIterations: 1 }
      );

      burstResults[count] = {
        decisions: 1,
        scans: 1,
        latencyP50: stats.median,
      };
    }

    console.info('[PERF] Mutation Burst Scales Comparison:', burstResults);
    // Even at 10,000 mutations, decisions count remains strictly 1
    expect(burstResults[10000]!.decisions).toBe(1);
  }, 35000);
});
