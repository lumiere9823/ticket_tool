import { describe, it, expect, beforeEach } from 'vitest';
import { buildUserProfileFromInputs } from '../../../src/extension/popup/profile-builder';
import { PurchaseStateMachine } from '../../../src/domain/state-machine/PurchaseStateMachine';
import { PurchaseState } from '../../../src/domain/states/PurchaseState';
import { ExecuteBookingJourneyUseCase } from '../../../src/application/use-cases/ExecuteBookingJourneyUseCase';
import { TicketboxJourneyAdapter } from '../../../src/infrastructure/ticketbox/TicketboxJourneyAdapter';
import { parseHtmlToDOMElementLike } from '../../../src/infrastructure/ticketbox/parsing/DOMElementLike';
import { ChromeMessageBus } from '../../../src/infrastructure/messaging/ChromeMessageBus';
import { SanitizedLogger } from '../../../src/infrastructure/logging/SanitizedLogger';
import { BOOKING_JOURNEY_FIXTURES } from '../../fixtures/booking/bookingFixtures';
import { BookingPreferences } from '../../../src/domain/entities/BookingJourneyModels';

describe('P2-4: Profile Consent Guard and popup agreeToTerms integrity', () => {
  let stateMachine: PurchaseStateMachine;
  let eventBus: ChromeMessageBus;
  let logger: SanitizedLogger;

  beforeEach(() => {
    stateMachine = new PurchaseStateMachine(PurchaseState.READY);
    eventBus = new ChromeMessageBus();
    logger = new SanitizedLogger();
  });

  describe('Basic mode profile building', () => {
    it('should set agreeToTerms = false when basic mode checkbox is unchecked', () => {
      const basicInputs = {
        nameInput: { value: 'Nguyen Van A' },
        phoneInput: { value: '0901234567' },
        emailInput: { value: 'a@example.com' },
        idCardInput: { value: '079123456789' },
        agreeTermsCheckbox: { checked: false },
      };

      const profile = buildUserProfileFromInputs(basicInputs);

      expect(profile.fullName).toBe('Nguyen Van A');
      expect(profile.phone).toBe('0901234567');
      expect(profile.email).toBe('a@example.com');
      expect(profile.agreeToTerms).toBe(false);
    });

    it('should set agreeToTerms = false when basic mode checkbox element is absent/missing', () => {
      const basicInputs = {
        nameInput: { value: 'Nguyen Van A' },
        phoneInput: { value: '0901234567' },
        emailInput: { value: 'a@example.com' },
      };

      const profile = buildUserProfileFromInputs(basicInputs);

      expect(profile.agreeToTerms).toBe(false);
    });

    it('should set agreeToTerms = true only when basic mode checkbox is explicitly checked', () => {
      const basicInputs = {
        nameInput: { value: 'Nguyen Van A' },
        phoneInput: { value: '0901234567' },
        emailInput: { value: 'a@example.com' },
        agreeTermsCheckbox: { checked: true },
      };

      const profile = buildUserProfileFromInputs(basicInputs);

      expect(profile.agreeToTerms).toBe(true);
    });
  });

  describe('Advanced mode profile building', () => {
    it('should set agreeToTerms = false when advanced mode checkbox is unchecked', () => {
      const advancedInputs = {
        nameInput: { value: 'Tran Van B' },
        phoneInput: { value: '0912345678' },
        emailInput: { value: 'b@example.com' },
        idCardInput: { value: '079987654321' },
        agreeTermsCheckbox: { checked: false },
        birthYearInput: { value: '1990' },
        genderSelect: { value: 'Nam' },
        addressInput: { value: 'Hà Nội' },
      };

      const profile = buildUserProfileFromInputs(advancedInputs);

      expect(profile.fullName).toBe('Tran Van B');
      expect(profile.agreeToTerms).toBe(false);
    });

    it('should set agreeToTerms = true when advanced mode checkbox is explicitly checked', () => {
      const advancedInputs = {
        nameInput: { value: 'Tran Van B' },
        phoneInput: { value: '0912345678' },
        emailInput: { value: 'b@example.com' },
        agreeTermsCheckbox: { checked: true },
      };

      const profile = buildUserProfileFromInputs(advancedInputs);

      expect(profile.agreeToTerms).toBe(true);
    });
  });

  describe('End-to-end Consent Guard halting behavior', () => {
    it('should stop at CONSENT_REQUIRED for Basic mode when checkbox was unchecked', async () => {
      const combinedHtml = `
        ${BOOKING_JOURNEY_FIXTURES.CASE_A_STANDING}
        ${BOOKING_JOURNEY_FIXTURES.CASE_J_CONSENT_FORM}
      `;
      const root = parseHtmlToDOMElementLike(combinedHtml);
      const adapter = new TicketboxJourneyAdapter(logger, root);
      const useCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, eventBus, logger);

      // Profile derived from unchecked Basic mode
      const basicProfile = buildUserProfileFromInputs({
        nameInput: { value: 'Basic User' },
        phoneInput: { value: '0901112233' },
        emailInput: { value: 'basic@example.com' },
        agreeTermsCheckbox: { checked: false },
      });

      const preferences: BookingPreferences = {
        categoryPriority: ['Hoả Tâm 2'],
        quantity: 2,
        allowFallback: false,
        userProfile: basicProfile,
      };

      const result = await useCase.execute(preferences);

      expect(result.success).toBe(true);
      expect(result.finalState).toBe(PurchaseState.CONSENT_REQUIRED);
      expect(result.requiresUserAction).toBe(true);
      expect(result.actionRequiredReason).toBe('User consent required');
      expect(stateMachine.state).toBe(PurchaseState.CONSENT_REQUIRED);
    });

    it('should stop at CONSENT_REQUIRED for Advanced mode when checkbox was unchecked', async () => {
      const combinedHtml = `
        ${BOOKING_JOURNEY_FIXTURES.CASE_A_STANDING}
        ${BOOKING_JOURNEY_FIXTURES.CASE_J_CONSENT_FORM}
      `;
      const root = parseHtmlToDOMElementLike(combinedHtml);
      const adapter = new TicketboxJourneyAdapter(logger, root);
      const useCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, eventBus, logger);

      // Profile derived from unchecked Advanced mode
      const advancedProfile = buildUserProfileFromInputs({
        nameInput: { value: 'Advanced User' },
        phoneInput: { value: '0903334455' },
        emailInput: { value: 'advanced@example.com' },
        agreeTermsCheckbox: { checked: false },
      });

      const preferences: BookingPreferences = {
        categoryPriority: ['Hoả Tâm 2'],
        quantity: 2,
        allowFallback: false,
        userProfile: advancedProfile,
      };

      const result = await useCase.execute(preferences);

      expect(result.success).toBe(true);
      expect(result.finalState).toBe(PurchaseState.CONSENT_REQUIRED);
      expect(result.requiresUserAction).toBe(true);
      expect(result.actionRequiredReason).toBe('User consent required');
      expect(stateMachine.state).toBe(PurchaseState.CONSENT_REQUIRED);
    });

    it('should proceed past CONSENT_REQUIRED when agreeToTerms = true', async () => {
      const combinedHtml = `
        ${BOOKING_JOURNEY_FIXTURES.CASE_A_STANDING}
        ${BOOKING_JOURNEY_FIXTURES.CASE_J_CONSENT_FORM}
      `;
      const root = parseHtmlToDOMElementLike(combinedHtml);
      const adapter = new TicketboxJourneyAdapter(logger, root);
      const useCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, eventBus, logger);

      const consentingProfile = buildUserProfileFromInputs({
        nameInput: { value: 'Consenting User' },
        phoneInput: { value: '0909998877' },
        emailInput: { value: 'consent@example.com' },
        agreeTermsCheckbox: { checked: true },
      });

      const preferences: BookingPreferences = {
        categoryPriority: ['Hoả Tâm 2'],
        quantity: 2,
        allowFallback: false,
        userProfile: consentingProfile,
      };

      const result = await useCase.execute(preferences);

      expect(result.success).toBe(true);
      // It does NOT stop at CONSENT_REQUIRED; it continues past form validation
      expect(result.finalState).not.toBe(PurchaseState.CONSENT_REQUIRED);
    });
  });
});
