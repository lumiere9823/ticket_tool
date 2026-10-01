import { StateContext } from '../../domain/states/PurchaseState';
import { AccountProfile } from '../../domain/entities/AccountProfile';
import { PurchasePlan, TicketCatalogSnapshot } from '../../domain/entities/PurchasePlan';
import { ScopedPurchasePlan } from '../../domain/entities/ScopedPurchasePlan';
import { UserProfileData } from '../../domain/entities/BookingJourneyModels';

export interface AssistantConfiguration {
  targetEventUrl: string;
  /** Legacy preferences kept for backward-compatibility with ARM_REQUESTED message. */
  preferences?: {
    categoryPriority: string[];
    quantity: number;
    allowFallback: boolean;
  };
  /** Structured purchase plan. */
  purchasePlan?: PurchasePlan;
  /** Scoped persistent purchase plan (whitelist of showingId x ticketTypeId with persistence policy). */
  scopedPurchasePlan?: ScopedPurchasePlan;
  discoveryMode: boolean;
  activeProfileId?: string;
  /** Cached ticket catalog snapshot for instant popup rendering on re-open. */
  ticketCatalogSnapshot?: TicketCatalogSnapshot;
  userProfile?: UserProfileData | undefined;
  /** ISO timestamp mirror of scopedPurchasePlan.persistence.startAt — for fast alarm handler lookup. */
  scheduledArmAt?: string | undefined;
}

export interface PersistentExecutionState {
  startedAt: string | number;
  attemptsCount: number;
  lastTarget?:
    string | { showingId: string; ticketTypeId: string; ticketName?: string } | undefined;
  currentPhase: string;
  stopReason?: string | undefined;
  tabHiddenWarning?: boolean | undefined;
}

export interface StorageRepository {
  getConfiguration(): Promise<AssistantConfiguration | null>;
  saveConfiguration(config: AssistantConfiguration): Promise<void>;
  /** Clears config + last state + persistent state. Profiles are NOT cleared. */
  clearConfiguration(): Promise<void>;

  getLastState(): Promise<StateContext | null>;
  saveCurrentState(state: StateContext): Promise<void>;

  /** Journey execution state — owned exclusively by the content script */
  getJourneyState(): Promise<StateContext | null>;
  saveJourneyState(state: StateContext): Promise<void>;

  /** Lifecycle execution state — owned exclusively by the background service worker */
  getLifecycleState(): Promise<StateContext | null>;
  saveLifecycleState(state: StateContext): Promise<void>;

  getPersistentState(): Promise<PersistentExecutionState | null>;
  savePersistentState(state: Partial<PersistentExecutionState>): Promise<void>;
  clearPersistentState(): Promise<void>;

  getProfiles(): Promise<AccountProfile[]>;
  saveProfile(profile: AccountProfile): Promise<void>;

  getHumanInterventionRecord(id: string): Promise<Record<string, unknown> | null>;
  saveHumanInterventionRecord(record: Record<string, unknown>): Promise<void>;

  clearSession(): Promise<void>;
}
