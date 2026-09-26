import {
  StorageRepository,
  AssistantConfiguration,
} from '../../application/ports/StorageRepository';
import { StateContext } from '../../domain/states/PurchaseState';
import { AccountProfile } from '../../domain/entities/AccountProfile';
import { ProfileId } from '../../domain/value-objects/ProfileId';

const STORAGE_KEYS = {
  CONFIG: 'ticketbox_assistant_config',
  STATE: 'ticketbox_assistant_last_state',
  PROFILES: 'ticketbox_assistant_profiles',
};

export class ChromeStorageRepository implements StorageRepository {
  private inMemoryMap: Map<string, unknown> = new Map();

  private isChromeStorageAvailable(): boolean {
    return (
      typeof chrome !== 'undefined' &&
      typeof chrome.storage !== 'undefined' &&
      typeof chrome.storage.local !== 'undefined'
    );
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
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.CONFIG]: config }, () => {
          resolve();
        });
      });
    }
    this.inMemoryMap.set(STORAGE_KEYS.CONFIG, config);
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
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.STATE]: state }, () => {
          resolve();
        });
      });
    }
    this.inMemoryMap.set(STORAGE_KEYS.STATE, state);
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

    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.PROFILES]: serialized }, () => {
          resolve();
        });
      });
    }
    this.inMemoryMap.set(STORAGE_KEYS.PROFILES, serialized);
  }

  public async clearSession(): Promise<void> {
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.remove([STORAGE_KEYS.STATE, STORAGE_KEYS.CONFIG], () => {
          resolve();
        });
      });
    }
    this.inMemoryMap.delete(STORAGE_KEYS.STATE);
    this.inMemoryMap.delete(STORAGE_KEYS.CONFIG);
  }
}
