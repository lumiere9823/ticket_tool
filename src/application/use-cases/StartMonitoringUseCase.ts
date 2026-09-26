import { PurchaseStateMachine } from '../../domain/state-machine/PurchaseStateMachine';
import { EventBus } from '../ports/EventBus';
import { StorageRepository } from '../ports/StorageRepository';
import { LoggerPort } from '../ports/LoggerPort';
import { StateContext } from '../../domain/states/PurchaseState';
import { AttemptId } from '../../domain/value-objects/AttemptId';

export class StartMonitoringUseCase {
  constructor(
    private readonly stateMachine: PurchaseStateMachine,
    private readonly storage: StorageRepository,
    private readonly eventBus: EventBus,
    private readonly logger: LoggerPort
  ) {}

  public async execute(eventUrl: string): Promise<StateContext> {
    const attemptId = new AttemptId().value;
    this.stateMachine.setAttemptId(attemptId);

    this.logger.info('StartMonitoringUseCase starting monitoring', {
      attemptId,
      eventUrl,
    });

    const context = this.stateMachine.transition({ type: 'MONITORING_STARTED' });
    await this.storage.saveCurrentState(context);

    await this.eventBus.publish({
      type: 'START_MONITORING',
      timestamp: new Date().toISOString(),
      attemptId,
      state: context.currentState,
      eventUrl,
    });

    await this.eventBus.publish({
      type: 'STATE_CHANGED',
      timestamp: new Date().toISOString(),
      attemptId,
      state: context.currentState,
      context,
    });

    return context;
  }
}
