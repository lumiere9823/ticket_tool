import {
  StorageRepository,
  AssistantConfiguration,
  PersistentExecutionState,
} from '../../application/ports/StorageRepository';

import { StateContext } from '../../domain/states/PurchaseState';
import { AccountProfile } from '../../domain/entities/AccountProfile';
import { ProfileId } from '../../domain/value-objects/ProfileId';

const STORAGE_KEYS = {
  CONFIG: 'ticketbox_assistant_config',
  STATE: 'ticketbox_assistant_last_state',
  JOURNEY_STATE: 'ticketbox_assistant_journey_state',
  LIFECYCLE_STATE: 'ticketbox_assistant_lifecycle_state',
  PERSISTENT_STATE: 'ticketbox_assistant_persistent_state',
  PROFILES: 'ticketbox_assistant_profiles',
  INTERVENTIONS: 'ticketbox_assistant_interventions',
};

const FORBIDDEN_STORAGE_KEYS = new Set([
  'password',
  'pass',
  'otp',
  'cvv',
  'cvc',
  'card',
  'cardnumber',
  'cookie',
  'rawcookie',
  'sessiontoken',
  'rawtoken',
  'accesstoken',
  'refreshtoken',
  'secret',
]);

export class ChromeStorageRepository implements StorageRepository {
  private inMemoryMap: Map<string, unknown> = new Map();

  private isChromeStorageAvailable(): boolean {
    return (
      typeof chrome !== 'undefined' &&
      typeof chrome.runtime !== 'undefined' &&
      Boolean(chrome.runtime.id) &&
      typeof chrome.storage !== 'undefined' &&
      typeof chrome.storage.local !== 'undefined'
    );
  }

  /**
   * Sanitizes objects before writing to storage to guarantee no credentials can be leaked.
   */
  private sanitizeData<T>(data: T): T {
    if (!data || typeof data !== 'object') {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitizeData(item)) as unknown as T;
    }

    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (FORBIDDEN_STORAGE_KEYS.has(lower)) {
        // Drop forbidden credential keys completely from storage
        continue;
      }
      cleaned[key] = typeof value === 'object' && value !== null ? this.sanitizeData(value) : value;
    }

    return cleaned as T;
  }

  public async getConfiguration(): Promise<AssistantConfiguration | null> {
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.get(STORAGE_KEYS.CONFIG, (res) => {
          resolve((res[STORAGE_KEYS.CONFIG] as AssistantConfiguration) ?? null);
        });
      });
    }
    return (this.inMemoryMap.get(STORAGE_KEYS.CONFIG) as AssistantConfiguration) ?? null;
  }

  public async saveConfiguration(config: AssistantConfiguration): Promise<void> {
    const safeConfig = this.sanitizeData(config);
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.CONFIG]: safeConfig }, () => {
          resolve();
        });
      });
    }
    this.inMemoryMap.set(STORAGE_KEYS.CONFIG, safeConfig);
  }

  public async getLastState(): Promise<StateContext | null> {
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.get(STORAGE_KEYS.STATE, (res) => {
          resolve((res[STORAGE_KEYS.STATE] as StateContext) ?? null);
        });
      });
    }
    return (this.inMemoryMap.get(STORAGE_KEYS.STATE) as StateContext) ?? null;
  }

  public async saveCurrentState(state: StateContext): Promise<void> {
    const safeState = this.sanitizeData(state);
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.STATE]: safeState }, () => {
          resolve();
        });
      });
    }
    this.inMemoryMap.set(STORAGE_KEYS.STATE, safeState);
  }

  public async getJourneyState(): Promise<StateContext | null> {
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.get(STORAGE_KEYS.JOURNEY_STATE, (res) => {
          resolve((res[STORAGE_KEYS.JOURNEY_STATE] as StateContext) ?? null);
        });
      });
    }
    return (this.inMemoryMap.get(STORAGE_KEYS.JOURNEY_STATE) as StateContext) ?? null;
  }

  public async saveJourneyState(state: StateContext): Promise<void> {
    const safeState = this.sanitizeData(state);
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.JOURNEY_STATE]: safeState }, () => {
          resolve();
        });
      });
    }
    this.inMemoryMap.set(STORAGE_KEYS.JOURNEY_STATE, safeState);
  }

  public async getLifecycleState(): Promise<StateContext | null> {
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.get(STORAGE_KEYS.LIFECYCLE_STATE, (res) => {
          resolve((res[STORAGE_KEYS.LIFECYCLE_STATE] as StateContext) ?? null);
        });
      });
    }
    return (this.inMemoryMap.get(STORAGE_KEYS.LIFECYCLE_STATE) as StateContext) ?? null;
  }

  public async saveLifecycleState(state: StateContext): Promise<void> {
    const safeState = this.sanitizeData(state);
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.LIFECYCLE_STATE]: safeState }, () => {
          resolve();
        });
      });
    }
    this.inMemoryMap.set(STORAGE_KEYS.LIFECYCLE_STATE, safeState);
  }

  public async getPersistentState(): Promise<PersistentExecutionState | null> {
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.get(STORAGE_KEYS.PERSISTENT_STATE, (res) => {
          resolve((res[STORAGE_KEYS.PERSISTENT_STATE] as PersistentExecutionState) ?? null);
        });
      });
    }
    return (
      (this.inMemoryMap.get(STORAGE_KEYS.PERSISTENT_STATE) as PersistentExecutionState) ?? null
    );
  }

  public async savePersistentState(state: Partial<PersistentExecutionState>): Promise<void> {
    const current = await this.getPersistentState();
    const merged: PersistentExecutionState = {
      startedAt:
        state.startedAt !== undefined ? state.startedAt : (current?.startedAt ?? Date.now()),
      attemptsCount:
        state.attemptsCount !== undefined ? state.attemptsCount : (current?.attemptsCount ?? 0),
      lastTarget: 'lastTarget' in state ? state.lastTarget : current?.lastTarget,
      currentPhase:
        state.currentPhase !== undefined ? state.currentPhase : (current?.currentPhase ?? 'INIT'),
      stopReason: 'stopReason' in state ? state.stopReason : current?.stopReason,
      tabHiddenWarning:
        state.tabHiddenWarning !== undefined
          ? state.tabHiddenWarning
          : (current?.tabHiddenWarning ?? false),
      armedTabId: state.armedTabId !== undefined ? state.armedTabId : current?.armedTabId,
      armedEventId: state.armedEventId !== undefined ? state.armedEventId : current?.armedEventId,
    };
    const safeState = this.sanitizeData(merged);
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.PERSISTENT_STATE]: safeState }, () => {
          resolve();
        });
      });
    }
    this.inMemoryMap.set(STORAGE_KEYS.PERSISTENT_STATE, safeState);
  }

  public async clearPersistentState(): Promise<void> {
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.remove(STORAGE_KEYS.PERSISTENT_STATE, () => {
          resolve();
        });
      });
    }
    this.inMemoryMap.delete(STORAGE_KEYS.PERSISTENT_STATE);
  }

  /**
   * Clears all session config (event URL, purchase plan, execution state).
   * Profiles are intentionally preserved.
   */
  public async clearConfiguration(): Promise<void> {
    const keysToRemove = [
      STORAGE_KEYS.CONFIG,
      STORAGE_KEYS.STATE,
      STORAGE_KEYS.JOURNEY_STATE,
      STORAGE_KEYS.LIFECYCLE_STATE,
      STORAGE_KEYS.PERSISTENT_STATE,
    ];
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.remove(keysToRemove, () => resolve());
      });
    }
    keysToRemove.forEach((k) => this.inMemoryMap.delete(k));
  }

  public async getProfiles(): Promise<AccountProfile[]> {
    let raw: Array<{
      profileId: string;
      accountId: string;
      displayName: string;
    }> = [];

    if (this.isChromeStorageAvailable()) {
      raw = await new Promise((resolve) => {
        chrome.storage.local.get(STORAGE_KEYS.PROFILES, (res) => {
          resolve(res[STORAGE_KEYS.PROFILES] ?? []);
        });
      });
    } else {
      raw = (this.inMemoryMap.get(STORAGE_KEYS.PROFILES) as typeof raw) ?? [];
    }

    return raw.map(
      (r) => new AccountProfile(new ProfileId(r.profileId), r.accountId, r.displayName)
    );
  }

  public async saveProfile(profile: AccountProfile): Promise<void> {
    const existing = await this.getProfiles();
    const updated = existing.filter((p) => !p.profileId.equals(profile.profileId));
    updated.push(profile);

    const serialized = updated.map((p) => ({
      profileId: p.profileId.value,
      accountId: p.accountId,
      displayName: p.displayName,
    }));

    const safeSerialized = this.sanitizeData(serialized);

    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.PROFILES]: safeSerialized }, () => {
          resolve();
        });
      });
    }
    this.inMemoryMap.set(STORAGE_KEYS.PROFILES, safeSerialized);
  }

  public async getHumanInterventionRecord(id: string): Promise<Record<string, unknown> | null> {
    const key = `${STORAGE_KEYS.INTERVENTIONS}_${id}`;
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.get(key, (res) => {
          resolve((res[key] as Record<string, unknown>) ?? null);
        });
      });
    }
    return (this.inMemoryMap.get(key) as Record<string, unknown>) ?? null;
  }

  public async saveHumanInterventionRecord(record: Record<string, unknown>): Promise<void> {
    const id = record['id'] as string;
    const key = `${STORAGE_KEYS.INTERVENTIONS}_${id}`;
    const safeRecord = this.sanitizeData(record);

    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: safeRecord }, () => {
          resolve();
        });
      });
    }
    this.inMemoryMap.set(key, safeRecord);
  }

  public async clearSession(): Promise<void> {
    const keysToRemove = [
      STORAGE_KEYS.STATE,
      STORAGE_KEYS.CONFIG,
      STORAGE_KEYS.JOURNEY_STATE,
      STORAGE_KEYS.LIFECYCLE_STATE,
    ];
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.remove(keysToRemove, () => {
          resolve();
        });
      });
    }
    keysToRemove.forEach((k) => this.inMemoryMap.delete(k));
  }
}
