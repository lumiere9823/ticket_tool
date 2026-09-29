import { PurchaseStateMachine } from '../../domain/state-machine/PurchaseStateMachine';
import { StorageRepository, AssistantConfiguration } from '../ports/StorageRepository';
import { EventBus } from '../ports/EventBus';
import { LoggerPort } from '../ports/LoggerPort';
import { StateContext } from '../../domain/states/PurchaseState';

export interface ArmAssistantRequest {
  eventUrl: string;
  categoryPriority: string[];
  quantity: number;
  allowFallback?: boolean | undefined;
  userProfile?:
    | {
        fullName: string;
        phone: string;
        email: string;
        agreeToTerms?: boolean | undefined;
      }
    | undefined;
}

export class ArmAssistantUseCase {
  constructor(
    private readonly stateMachine: PurchaseStateMachine,
    private readonly storage: StorageRepository,
    private readonly eventBus: EventBus,
    private readonly logger: LoggerPort
  ) {}

  public async execute(request: ArmAssistantRequest): Promise<StateContext> {
    this.logger.info('ArmAssistantUseCase requested', { eventUrl: request.eventUrl });

    // 1. Save configured preferences while preserving existing userProfile and purchasePlan
    const existing = await this.storage.getConfiguration();
    const profile = request.userProfile ?? existing?.userProfile;
    const config: AssistantConfiguration = {
      ...existing,
      targetEventUrl: request.eventUrl,
      preferences: {
        categoryPriority: request.categoryPriority,
        quantity: request.quantity,
        allowFallback: request.allowFallback ?? true,
      },
      discoveryMode: false,
      ...(profile ? { userProfile: profile } : {}),
    };
    await this.storage.saveConfiguration(config);

    // 2. Transition state machine: READY -> ARMED
    const context = this.stateMachine.transition({ type: 'ARM' });
    await this.storage.saveCurrentState(context);

    // 3. Publish state update
    await this.eventBus.publish({
      type: 'STATE_CHANGED',
      timestamp: new Date().toISOString(),
      attemptId: context.attemptId,
      state: context.currentState,
      context,
    });

    return context;
  }
}
