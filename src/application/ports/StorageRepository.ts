import { StateContext } from '../../domain/states/PurchaseState';
import { AccountProfile } from '../../domain/entities/AccountProfile';
import { PurchasePlan, TicketCatalogSnapshot } from '../../domain/entities/PurchasePlan';

export interface AssistantConfiguration {
  targetEventUrl: string;
  /** Legacy preferences kept for backward-compatibility with ARM_REQUESTED message. */
  preferences?: {
    categoryPriority: string[];
    quantity: number;
    allowFallback: boolean;
  };
  /** New structured purchase plan (replaces preferences.categoryPriority free-text). */
  purchasePlan?: PurchasePlan;
  discoveryMode: boolean;
  activeProfileId?: string;
  /** Cached ticket catalog snapshot for instant popup rendering on re-open. */
  ticketCatalogSnapshot?: TicketCatalogSnapshot;
  userProfile?:
    | {
        fullName: string;
        phone: string;
        email: string;
        agreeToTerms?: boolean | undefined;
      }
    | undefined;
}

export interface StorageRepository {
  getConfiguration(): Promise<AssistantConfiguration | null>;
  saveConfiguration(config: AssistantConfiguration): Promise<void>;

  getLastState(): Promise<StateContext | null>;
  saveCurrentState(state: StateContext): Promise<void>;

  getProfiles(): Promise<AccountProfile[]>;
  saveProfile(profile: AccountProfile): Promise<void>;

  getHumanInterventionRecord(id: string): Promise<Record<string, unknown> | null>;
  saveHumanInterventionRecord(record: Record<string, unknown>): Promise<void>;

  clearSession(): Promise<void>;
}
