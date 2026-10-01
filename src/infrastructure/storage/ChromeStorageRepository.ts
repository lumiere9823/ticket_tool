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

const PII_STORAGE_KEYS = new Set([
  'phone',
  'phonenumber',
  'telephone',
  'mobile',
  'tel',
  'email',
  'emailaddress',
  'idcard',
  'cccd',
  'cmnd',
  'nationalid',
  'passport',
  'address',
  'fulladdress',
  'street',
  'fullname',
  'firstname',
  'lastname',
  'customername',
  'birthyear',
  'birthday',
  'dob',
  'dateofbirth',
  'gender',
]);

const PII_MAX_RETENTION_MS = 24 * 3600 * 1000; // 24 hours

export class ChromeStorageRepository implements StorageRepository {
  private inMemoryMap: Map<string, unknown> = new Map();
  private cachedConfig: AssistantConfiguration | null = null;
  private cachedPersistentState: PersistentExecutionState | null = null;
  private cachedJourneyState: StateContext | null = null;
  private isStorageListenerAttached = false;

  constructor() {
    this.attachStorageChangeListener();
  }

  private attachStorageChangeListener(): void {
    if (
      typeof chrome !== 'undefined' &&
      chrome.storage?.onChanged &&
      !this.isStorageListenerAttached
    ) {
      this.isStorageListenerAttached = true;
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local') {
          const configChange = changes[STORAGE_KEYS.CONFIG];
          if (configChange) {
            this.cachedConfig = (configChange.newValue as AssistantConfiguration) ?? null;
          }
          const persistChange = changes[STORAGE_KEYS.PERSISTENT_STATE];
          if (persistChange) {
            this.cachedPersistentState =
              (persistChange.newValue as PersistentExecutionState) ?? null;
          }
          const journeyChange = changes[STORAGE_KEYS.JOURNEY_STATE];
          if (journeyChange) {
            this.cachedJourneyState = (journeyChange.newValue as StateContext) ?? null;
          }
        }
      });
    }
  }

  private isChromeStorageAvailable(): boolean {
    return (
      typeof chrome !== 'undefined' &&
      typeof chrome.runtime !== 'undefined' &&
      Boolean(chrome.runtime.id) &&
      typeof chrome.storage !== 'undefined' &&
      typeof chrome.storage.local !== 'undefined'
    );
  }

  private isPiiString(val: string): boolean {
    if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(val)) return true;
    if (/(?:\+84|0)(?:3[2-9]|5[689]|7[06-9]|8[1-9]|9[0-9])[0-9]{7}\b/.test(val)) return true;
    if (/\b\d{9}\b|\b\d{12}\b/.test(val)) return true;
    return false;
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

  /**
   * Sanitizes state machine contexts and execution states so that both credentials
   * AND sensitive PII (names, emails, phones, IDs) are redacted from logs and persisted state.
   */
  private sanitizeStateData<T>(data: T): T {
    if (!data || typeof data !== 'object') {
      if (typeof data === 'string' && this.isPiiString(data)) {
        return '[REDACTED]' as unknown as T;
      }
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitizeStateData(item)) as unknown as T;
    }

    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (FORBIDDEN_STORAGE_KEYS.has(lower)) {
        continue;
      }
      if (PII_STORAGE_KEYS.has(lower)) {
        cleaned[key] = '[REDACTED]';
        continue;
      }
      if (typeof value === 'object' && value !== null) {
        cleaned[key] = this.sanitizeStateData(value);
      } else if (typeof value === 'string' && this.isPiiString(value)) {
        cleaned[key] = '[REDACTED]';
      } else {
        cleaned[key] = value;
      }
    }

    return cleaned as T;
  }

  public async getConfiguration(forceRefresh = false): Promise<AssistantConfiguration | null> {
    let config: AssistantConfiguration | null = null;
    if (!forceRefresh && this.cachedConfig !== null) {
      config = this.cachedConfig;
    } else if (this.isChromeStorageAvailable()) {
      config = await new Promise<AssistantConfiguration | null>((resolve) => {
        chrome.storage.local.get(STORAGE_KEYS.CONFIG, (res) => {
          resolve((res[STORAGE_KEYS.CONFIG] as AssistantConfiguration) ?? null);
        });
      });
    } else {
      config = (this.inMemoryMap.get(STORAGE_KEYS.CONFIG) as AssistantConfiguration) ?? null;
    }

    // Auto-purge userProfile if older than 24 hours
    if (config?.userProfile) {
      const savedAt = config.userProfile.savedAt;
      if (savedAt && Date.now() - savedAt > PII_MAX_RETENTION_MS) {
        delete config.userProfile;
        await this.saveConfiguration(config);
      }
    }

    this.cachedConfig = config;
    return config;
  }

  public async saveConfiguration(config: AssistantConfiguration): Promise<void> {
    const safeConfig = this.sanitizeData(config);

    // Enforce PII policy: idCard and address only saved if allowSensitivePii is explicitly true
    if (safeConfig.userProfile) {
      if (safeConfig.userProfile.savedAt === undefined) {
        safeConfig.userProfile.savedAt = Date.now();
      }
      if (safeConfig.userProfile.allowSensitivePii !== true) {
        delete safeConfig.userProfile.idCard;
        delete safeConfig.userProfile.address;
      }
    }

    this.cachedConfig = safeConfig;
    this.inMemoryMap.set(STORAGE_KEYS.CONFIG, safeConfig);

    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.CONFIG]: safeConfig }, () => {
          resolve();
        });
      });
    }
  }

  public async purgeUserProfile(): Promise<void> {
    const config = await this.getConfiguration();
    if (config?.userProfile) {
      delete config.userProfile;
      await this.saveConfiguration(config);
    }
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
    const safeState = this.sanitizeStateData(state);
    this.inMemoryMap.set(STORAGE_KEYS.STATE, safeState);
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.STATE]: safeState }, () => {
          resolve();
        });
      });
    }
  }

  public async getJourneyState(forceRefresh = false): Promise<StateContext | null> {
    if (!forceRefresh && this.cachedJourneyState !== null) {
      return this.cachedJourneyState;
    }
    if (this.isChromeStorageAvailable()) {
      const state = await new Promise<StateContext | null>((resolve) => {
        chrome.storage.local.get(STORAGE_KEYS.JOURNEY_STATE, (res) => {
          resolve((res[STORAGE_KEYS.JOURNEY_STATE] as StateContext) ?? null);
        });
      });
      this.cachedJourneyState = state;
      return state;
    }
    const state = (this.inMemoryMap.get(STORAGE_KEYS.JOURNEY_STATE) as StateContext) ?? null;
    this.cachedJourneyState = state;
    return state;
  }

  public async saveJourneyState(state: StateContext): Promise<void> {
    const safeState = this.sanitizeStateData(state);
    this.cachedJourneyState = safeState;
    this.inMemoryMap.set(STORAGE_KEYS.JOURNEY_STATE, safeState);
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.JOURNEY_STATE]: safeState }, () => {
          resolve();
        });
      });
    }
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
    const safeState = this.sanitizeStateData(state);
    this.inMemoryMap.set(STORAGE_KEYS.LIFECYCLE_STATE, safeState);
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.LIFECYCLE_STATE]: safeState }, () => {
          resolve();
        });
      });
    }
  }

  public async getPersistentState(forceRefresh = false): Promise<PersistentExecutionState | null> {
    if (!forceRefresh && this.cachedPersistentState !== null) {
      return this.cachedPersistentState;
    }
    if (this.isChromeStorageAvailable()) {
      const state = await new Promise<PersistentExecutionState | null>((resolve) => {
        chrome.storage.local.get(STORAGE_KEYS.PERSISTENT_STATE, (res) => {
          resolve((res[STORAGE_KEYS.PERSISTENT_STATE] as PersistentExecutionState) ?? null);
        });
      });
      this.cachedPersistentState = state;
      return state;
    }
    const state =
      (this.inMemoryMap.get(STORAGE_KEYS.PERSISTENT_STATE) as PersistentExecutionState) ?? null;
    this.cachedPersistentState = state;
    return state;
  }

  public async savePersistentState(state: Partial<PersistentExecutionState>): Promise<void> {
    const current = this.cachedPersistentState ?? (await this.getPersistentState());
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
    const safeState = this.sanitizeStateData(merged);
    this.cachedPersistentState = safeState;
    this.inMemoryMap.set(STORAGE_KEYS.PERSISTENT_STATE, safeState);
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.PERSISTENT_STATE]: safeState }, () => {
          resolve();
        });
      });
    }
  }

  public async clearPersistentState(): Promise<void> {
    this.cachedPersistentState = null;
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
    this.cachedConfig = null;
    this.cachedPersistentState = null;
    this.cachedJourneyState = null;
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
    this.cachedConfig = null;
    this.cachedPersistentState = null;
    this.cachedJourneyState = null;
    const keysToRemove = [
      STORAGE_KEYS.STATE,
      STORAGE_KEYS.CONFIG,
      STORAGE_KEYS.JOURNEY_STATE,
      STORAGE_KEYS.LIFECYCLE_STATE,
    ];
    keysToRemove.forEach((k) => this.inMemoryMap.delete(k));
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.remove(keysToRemove, () => {
          resolve();
        });
      });
    }
  }
}
