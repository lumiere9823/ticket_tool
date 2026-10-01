import { describe, it, expect, beforeEach } from 'vitest';
import { SanitizedLogger } from '../../../src/infrastructure/logging/SanitizedLogger';
import { ChromeStorageRepository } from '../../../src/infrastructure/storage/ChromeStorageRepository';
import { StructuredLogEntry } from '../../../src/application/ports/LoggerPort';
import { PurchaseState } from '../../../src/domain/states/PurchaseState';

describe('P3-4: PII Data Sanitization & Retention Lifecycle', () => {
  describe('SanitizedLogger PII Redaction', () => {
    let capturedLogs: StructuredLogEntry[];
    let logger: SanitizedLogger;

    beforeEach(() => {
      capturedLogs = [];
      logger = new SanitizedLogger({}, (entry) => {
        capturedLogs.push(entry);
      });
    });

    it('redacts sensitive PII keys (phone, email, idCard, address, fullName, birthYear)', () => {
      logger.info('USER_PROFILE_SUBMITTED', {
        fullName: 'Nguyen Van A',
        phone: '0912345678',
        email: 'test.user@example.com',
        idCard: '012345678901',
        address: '123 Le Loi, Dist 1, HCMC',
        birthYear: '1990',
        gender: 'male',
      });

      expect(capturedLogs).toHaveLength(1);
      const meta = capturedLogs[0]!.metadata!;

      expect(meta.fullName).toBe('[REDACTED]');
      expect(meta.phone).toBe('[REDACTED]');
      expect(meta.email).toBe('[REDACTED]');
      expect(meta.idCard).toBe('[REDACTED]');
      expect(meta.address).toBe('[REDACTED]');
      expect(meta.birthYear).toBe('[REDACTED]');
      expect(meta.gender).toBe('[REDACTED]');
    });

    it('redacts PII values matching email, VN phone, and 9/12 digit IDs inside generic strings', () => {
      logger.info('RAW_FORM_SUBMISSION', {
        note1: 'Customer contact: buyer@company.com',
        note2: 'Contact number is 0987654321 please call',
        note3: 'Identity document number 079199001234',
        note4: 'Old CMND number 123456789',
      });

      expect(capturedLogs).toHaveLength(1);
      const meta = capturedLogs[0]!.metadata!;

      expect(meta.note1).toBe('[REDACTED]');
      expect(meta.note2).toBe('[REDACTED]');
      expect(meta.note3).toBe('[REDACTED]');
      expect(meta.note4).toBe('[REDACTED]');
    });
  });

  describe('ChromeStorageRepository PII Sanitization & Retention', () => {
    let storage: ChromeStorageRepository;

    beforeEach(() => {
      storage = new ChromeStorageRepository();
    });

    it('sanitizes state context so persistent/last state does not store plaintext PII', async () => {
      await storage.saveCurrentState({
        currentState: PurchaseState.PAYMENT_GATE,
        attemptId: 'att-1',
        updatedAt: new Date().toISOString(),
        evidence: {
          fullName: 'Nguyen Van B',
          email: 'secret@gmail.com',
          phone: '0901234567',
          idCard: '012345678901',
        },
      });

      const savedState = await storage.getLastState();
      const evidence = savedState?.evidence as Record<string, unknown>;

      expect(evidence.fullName).toBe('[REDACTED]');
      expect(evidence.email).toBe('[REDACTED]');
      expect(evidence.phone).toBe('[REDACTED]');
      expect(evidence.idCard).toBe('[REDACTED]');
    });

    it('omits idCard and address from userProfile unless allowSensitivePii is explicitly enabled', async () => {
      await storage.saveConfiguration({
        targetEventUrl: 'https://ticketbox.vn/event/1',
        discoveryMode: false,
        userProfile: {
          fullName: 'Tran Van C',
          email: 'c@gmail.com',
          phone: '0909090909',
          idCard: '079200001234', // sensitive
          address: '456 Nguyen Hue, HCMC', // sensitive
          allowSensitivePii: false,
        },
      });

      const config = await storage.getConfiguration();
      expect(config?.userProfile?.fullName).toBe('Tran Van C');
      expect(config?.userProfile?.idCard).toBeUndefined();
      expect(config?.userProfile?.address).toBeUndefined();
    });

    it('preserves idCard and address when allowSensitivePii is explicitly true', async () => {
      await storage.saveConfiguration({
        targetEventUrl: 'https://ticketbox.vn/event/1',
        discoveryMode: false,
        userProfile: {
          fullName: 'Tran Van C',
          email: 'c@gmail.com',
          phone: '0909090909',
          idCard: '079200001234',
          address: '456 Nguyen Hue, HCMC',
          allowSensitivePii: true,
        },
      });

      const config = await storage.getConfiguration();
      expect(config?.userProfile?.idCard).toBe('079200001234');
      expect(config?.userProfile?.address).toBe('456 Nguyen Hue, HCMC');
    });

    it('auto-purges expired userProfile older than 24 hours', async () => {
      const past25Hours = Date.now() - 25 * 3600 * 1000;

      await storage.saveConfiguration({
        targetEventUrl: 'https://ticketbox.vn/event/1',
        discoveryMode: false,
        userProfile: {
          fullName: 'Old Profile',
          email: 'old@example.com',
          phone: '0911111111',
          savedAt: past25Hours,
        },
      });

      const config = await storage.getConfiguration();
      // Should be expired and automatically cleared
      expect(config?.userProfile).toBeUndefined();
    });

    it('purges userProfile on demand via purgeUserProfile()', async () => {
      await storage.saveConfiguration({
        targetEventUrl: 'https://ticketbox.vn/event/1',
        discoveryMode: false,
        userProfile: {
          fullName: 'Active Profile',
          email: 'active@example.com',
          phone: '0922222222',
        },
      });

      await storage.purgeUserProfile();
      const config = await storage.getConfiguration();
      expect(config?.userProfile).toBeUndefined();
    });
  });
});
