import { PurchaseStateMachine } from '../../domain/state-machine/PurchaseStateMachine';
import { StorageRepository } from '../ports/StorageRepository';
import { EventBus } from '../ports/EventBus';
import { LoggerPort } from '../ports/LoggerPort';
import { StateContext, PurchaseState } from '../../domain/states/PurchaseState';

export class StopAssistantUseCase {
  constructor(
    private readonly stateMachine: PurchaseStateMachine,
    private readonly storage: StorageRepository,
    private readonly eventBus: EventBus,
    private readonly logger: LoggerPort
  ) {}

  public async execute(reason = 'User requested stop'): Promise<StateContext> {
    this.logger.info('StopAssistantUseCase requested', { reason });

    const context = this.stateMachine.transition({
      type: 'STOP_REQUESTED',
      reason,
    });

    await this.storage.saveCurrentState(context);

    await this.eventBus.publish({
      type: 'STOP_REQUESTED',
      timestamp: new Date().toISOString(),
      attemptId: this.stateMachine.attemptId,
      state: PurchaseState.STOPPED,
      reason,
    });

    await this.eventBus.publish({
      type: 'STATE_CHANGED',
      timestamp: new Date().toISOString(),
      attemptId: this.stateMachine.attemptId,
      state: PurchaseState.STOPPED,
      context,
    });

    return context;
  }
}
