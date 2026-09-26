import { PurchaseStateMachine } from '../../domain/state-machine/PurchaseStateMachine';
import { SelectionStrategy, SelectionResult } from '../../domain/policies/SelectionStrategy';
import { TicketPreference } from '../../domain/entities/TicketPreference';
import { CandidateTicket } from '../../domain/entities/CandidateTicket';
import { EventBus } from '../ports/EventBus';
import { LoggerPort } from '../ports/LoggerPort';
import { LatencyTracker } from '../services/LatencyTracker';
import { PurchaseState } from '../../domain/states/PurchaseState';

export class EvaluateSelectionUseCase {
  constructor(
    private readonly stateMachine: PurchaseStateMachine,
    private readonly eventBus: EventBus,
    private readonly logger: LoggerPort
  ) {}

  public async execute(
    candidates: CandidateTicket[],
    preference: TicketPreference,
    latencyTracker?: LatencyTracker
  ): Promise<SelectionResult | null> {
    this.logger.debug('Evaluating candidate tickets against preferences', {
      candidateCount: candidates.length,
    });

    if (this.stateMachine.state === PurchaseState.MONITORING) {
      this.stateMachine.transition({ type: 'INVENTORY_AVAILABLE' });
    }

    latencyTracker?.recordT1();

    const result = SelectionStrategy.selectCandidate(candidates, preference);
    latencyTracker?.recordT2();

    if (result) {
      this.logger.info('Candidate selected successfully', {
        candidateId: result.candidate.id,
        category: result.candidate.categoryName,
        isFallback: result.isFallback,
      });

      const context = this.stateMachine.transition({ type: 'CANDIDATE_FOUND' });

      await this.eventBus.publish({
        type: 'SELECTION_STARTED',
        timestamp: new Date().toISOString(),
        attemptId: this.stateMachine.attemptId,
        state: context.currentState,
        candidate: result.candidate,
      });

      return result;
    } else {
      this.logger.warn('No matching candidate tickets found for preferences');
      this.stateMachine.transition({ type: 'NO_CANDIDATE_AVAILABLE' });
      return null;
    }
  }
}
