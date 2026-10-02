import { TicketboxPageAdapter } from '../ports/TicketboxPageAdapter';
import { LoggerPort } from '../ports/LoggerPort';
import { ScopedPurchasePlan } from '../../domain/entities/ScopedPurchasePlan';

export interface PreWarmPlanRequest {
  eventId?: string | undefined;
  scopedPurchasePlan?: ScopedPurchasePlan | undefined;
}

export interface PreWarmResult {
  warmedShowings: string[];
  warmedSeatmaps: string[];
  warmedEvent: boolean;
  warmedQuestionForm: boolean;
}

/**
 * Pre-warms read-only API and catalog data before T0.
 * Strictly read-only: NEVER mutates the DOM, NEVER clicks buttons, NEVER reserves tickets.
 * Respects Scope Guard whitelist (only warm showings within whitelist).
 */
export class PreWarmPurchasePlanUseCase {
  constructor(
    private readonly adapter: TicketboxPageAdapter,
    private readonly logger?: LoggerPort
  ) {}

  public async execute(request: PreWarmPlanRequest): Promise<PreWarmResult> {
    const result: PreWarmResult = {
      warmedShowings: [],
      warmedSeatmaps: [],
      warmedEvent: false,
      warmedQuestionForm: false,
    };

    const targetEventId = request.eventId || request.scopedPurchasePlan?.eventId;
    this.logger?.info('Starting pre-warm for upcoming ticket sale (read-only)', {
      eventId: targetEventId,
      hasScopedPlan: !!request.scopedPurchasePlan,
    });

    // 1. Pre-warm Event info if available
    if (targetEventId && this.adapter.fetchEventApi) {
      try {
        await this.adapter.fetchEventApi(targetEventId);
        result.warmedEvent = true;
      } catch (err) {
        this.logger?.debug('Pre-warm event API skipped/failed', { err: String(err) });
      }
    }

    // 2. Pre-warm question form schema if available
    if (targetEventId && this.adapter.fetchQuestionFormApi) {
      try {
        await this.adapter.fetchQuestionFormApi(targetEventId);
        result.warmedQuestionForm = true;
      } catch (err) {
        this.logger?.debug('Pre-warm question form API skipped/failed', { err: String(err) });
      }
    }

    // 3. Pre-warm showing and seatmaps strictly respecting Scope Guard whitelist
    const showingsToWarm = new Set<string>();
    if (request.scopedPurchasePlan?.targets) {
      for (const target of request.scopedPurchasePlan.targets) {
        if (target.showingId) {
          showingsToWarm.add(target.showingId);
        }
      }
    }

    for (const showingId of showingsToWarm) {
      if (this.adapter.fetchShowingApi) {
        try {
          await this.adapter.fetchShowingApi(showingId);
          result.warmedShowings.push(showingId);
        } catch (err) {
          this.logger?.debug('Pre-warm showing API failed', { showingId, err: String(err) });
        }
      }

      if (this.adapter.fetchSeatmapApi) {
        try {
          await this.adapter.fetchSeatmapApi(showingId);
          result.warmedSeatmaps.push(showingId);
        } catch (err) {
          this.logger?.debug('Pre-warm seatmap API failed', { showingId, err: String(err) });
        }
      }
    }

    this.logger?.info('Pre-warm completed', {
      warmedShowings: result.warmedShowings,
      warmedSeatmaps: result.warmedSeatmaps,
      warmedEvent: result.warmedEvent,
      warmedQuestionForm: result.warmedQuestionForm,
    });
    return result;
  }
}
