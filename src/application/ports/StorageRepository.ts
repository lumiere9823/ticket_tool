import { StateContext } from '../../domain/states/PurchaseState';
import { AccountProfile } from '../../domain/entities/AccountProfile';

export interface AssistantConfiguration {
  targetEventUrl: string;
  preferences?: {
    categoryPriority: string[];
    quantity: number;
    allowFallback: boolean;
  };
  discoveryMode: boolean;
  activeProfileId?: string;
}

export interface StorageRepository {
  getConfiguration(): Promise<AssistantConfiguration | null>;
  saveConfiguration(config: AssistantConfiguration): Promise<void>;

  getLastState(): Promise<StateContext | null>;
  saveCurrentState(state: StateContext): Promise<void>;

  getProfiles(): Promise<AccountProfile[]>;
  saveProfile(profile: AccountProfile): Promise<void>;

  clearSession(): Promise<void>;
}
