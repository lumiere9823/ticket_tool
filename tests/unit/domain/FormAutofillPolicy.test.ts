import { describe, it, expect } from 'vitest';
import { FormAutofillPolicy } from '../../../src/domain/policies/FormAutofillPolicy';
import { FormSchema, UserProfileData } from '../../../src/domain/entities/BookingJourneyModels';

describe('FormAutofillPolicy', () => {
  const completeProfile: UserProfileData = {
    fullName: 'Nguyen Van A',
    email: 'nguyenvana@example.com',
    phone: '0901234567',
    agreeToTerms: true,
  };

  it('should successfully satisfy all standard fields when profile is complete and terms agreed', () => {
    const schema: FormSchema = {
      fields: [
        {
          id: 'f-name',
          label: 'Full Name',
          type: 'TEXT',
          required: true,
          value: '',
          selector: '#f-name',
        },
        {
          id: 'f-email',
          label: 'Email Address',
          type: 'EMAIL',
          required: true,
          value: '',
          selector: '#f-email',
        },
        {
          id: 'f-phone',
          label: 'Phone Number',
          type: 'PHONE',
          required: true,
          value: '',
          selector: '#f-phone',
        },
        {
          id: 'f-terms',
          label: 'I agree to the terms and conditions',
          type: 'CHECKBOX',
          required: true,
          value: '',
          selector: '#f-terms',
        },
      ],
      hasConsentCheckbox: true,
      consentLabel: 'I agree to the terms and conditions',
    };

    const result = FormAutofillPolicy.evaluate(schema, completeProfile);

    expect(result.canProceed).toBe(true);
    expect(result.isConsentBlocked).toBe(false);
    expect(result.hasUnsatisfiedRequiredFields).toBe(false);
    expect(result.missingFields).toHaveLength(0);
    expect(result.plan).toHaveLength(4);
    expect(result.plan[0]?.targetValue).toBe('Nguyen Van A');
    expect(result.plan[1]?.targetValue).toBe('nguyenvana@example.com');
    expect(result.plan[2]?.targetValue).toBe('0901234567');
    expect(result.plan[3]?.targetValue).toBe('true');
  });

  it('should block with isConsentBlocked=true when agreeToTerms is false', () => {
    const schema: FormSchema = {
      fields: [
        {
          id: 'f-terms',
          label: 'Tôi đồng ý với điều khoản sử dụng',
          type: 'CHECKBOX',
          required: true,
          value: '',
          selector: '#f-terms',
        },
      ],
      hasConsentCheckbox: true,
      consentLabel: 'Tôi đồng ý với điều khoản sử dụng',
    };

    const profileWithoutConsent: UserProfileData = {
      ...completeProfile,
      agreeToTerms: false,
    };

    const result = FormAutofillPolicy.evaluate(schema, profileWithoutConsent);

    expect(result.canProceed).toBe(false);
    expect(result.isConsentBlocked).toBe(true);
    expect(result.consentField?.id).toBe('f-terms');
    expect(result.missingFields).toContain('Tôi đồng ý với điều khoản sử dụng');
  });

  it('should report missing required fields when profile lacks required phone or email', () => {
    const schema: FormSchema = {
      fields: [
        {
          id: 'f-email',
          label: 'Email',
          type: 'EMAIL',
          required: true,
          value: '',
          selector: '#f-email',
        },
        {
          id: 'f-phone',
          label: 'Số điện thoại',
          type: 'PHONE',
          required: true,
          value: '',
          selector: '#f-phone',
        },
      ],
      hasConsentCheckbox: false,
    };

    const sparseProfile: UserProfileData = {
      fullName: 'Nguyen Van A',
      email: '',
      phone: '',
      agreeToTerms: true,
    };

    const result = FormAutofillPolicy.evaluate(schema, sparseProfile);

    expect(result.canProceed).toBe(false);
    expect(result.hasUnsatisfiedRequiredFields).toBe(true);
    expect(result.missingFields).toContain('Email');
    expect(result.missingFields).toContain('Số điện thoại');
  });

  it('should recognize Vietnamese label variations for all fields', () => {
    const vnSchema: FormSchema = {
      fields: [
        {
          id: 'f-1',
          label: 'Họ và tên người nhận',
          type: 'TEXT',
          required: true,
          value: '',
          selector: '#f-1',
        },
        {
          id: 'f-2',
          label: 'Thư điện tử',
          type: 'TEXT',
          required: true,
          value: '',
          selector: '#f-2',
        },
        {
          id: 'f-3',
          label: 'SĐT liên lạc',
          type: 'TEXT',
          required: true,
          value: '',
          selector: '#f-3',
        },
        {
          id: 'f-4',
          label: 'Chính sách bảo mật',
          type: 'CHECKBOX',
          required: true,
          value: '',
          selector: '#f-4',
        },
      ],
      hasConsentCheckbox: true,
      consentLabel: 'Chính sách bảo mật',
    };

    const result = FormAutofillPolicy.evaluate(vnSchema, completeProfile);

    expect(result.canProceed).toBe(true);
    expect(result.plan[0]?.source).toBe('FULL_NAME');
    expect(result.plan[1]?.source).toBe('EMAIL');
    expect(result.plan[2]?.source).toBe('PHONE');
    expect(result.plan[3]?.source).toBe('CONSENT');
  });

  it('should map configured additionalFields when available', () => {
    const schema: FormSchema = {
      fields: [
        {
          id: 'f-idcard',
          label: 'CMND / CCCD',
          type: 'TEXT',
          required: true,
          value: '',
          selector: '#f-idcard',
        },
      ],
      hasConsentCheckbox: false,
    };

    const profileWithAdd: UserProfileData = {
      ...completeProfile,
      additionalFields: {
        CCCD: '012345678901',
      },
    };

    const result = FormAutofillPolicy.evaluate(schema, profileWithAdd);

    expect(result.canProceed).toBe(true);
    expect(result.plan[0]?.targetValue).toBe('012345678901');
    expect(result.plan[0]?.source).toBe('ADDITIONAL');
  });

  it('should never guess unknown required event-specific questions', () => {
    const schema: FormSchema = {
      fields: [
        {
          id: 'f-diet',
          label: 'Dietary Preference / Meal Type',
          type: 'TEXT',
          required: true,
          value: '',
          selector: '#f-diet',
        },
      ],
      hasConsentCheckbox: false,
    };

    const result = FormAutofillPolicy.evaluate(schema, completeProfile);

    expect(result.canProceed).toBe(false);
    expect(result.hasUnsatisfiedRequiredFields).toBe(true);
    expect(result.plan[0]?.source).toBe('MANUAL');
    expect(result.plan[0]?.requiresUserAction).toBe(true);
    expect(result.missingFields).toContain('Dietary Preference / Meal Type');
  });

  it('should allow optional unknown questions without blocking proceed', () => {
    const schema: FormSchema = {
      fields: [
        {
          id: 'f-diet',
          label: 'Optional Dietary Preference',
          type: 'TEXT',
          required: false,
          value: '',
          selector: '#f-diet',
        },
      ],
      hasConsentCheckbox: false,
    };

    const result = FormAutofillPolicy.evaluate(schema, completeProfile);

    expect(result.canProceed).toBe(true);
    expect(result.hasUnsatisfiedRequiredFields).toBe(false);
    expect(result.plan[0]?.satisfied).toBe(true);
    expect(result.plan[0]?.requiresUserAction).toBe(false);
  });
});
