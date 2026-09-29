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

  it('should successfully autofill Event 26215 question form with consent radio, email, and phone', () => {
    const event26215Schema: FormSchema = {
      fields: [
        {
          id: 'q-consent-yes',
          label:
            'Tôi đồng ý Ticketbox & BTC sử dụng thông tin đặt vé nhằm mục đích vận hành sự kiện [Có/Yes]',
          type: 'RADIO',
          required: true,
          value: 'Có/Yes',
          selector: '#q-consent-yes',
        },
        {
          id: 'q-email',
          label: 'Email của bạn để nhận vé/Your Email address for receiving tickets',
          type: 'EMAIL',
          required: true,
          value: '',
          selector: '#q-email',
        },
        {
          id: 'q-phone',
          label: 'Số điện thoại của bạn/ Your Phone Number',
          type: 'PHONE',
          required: true,
          value: '',
          selector: '#q-phone',
        },
      ],
      hasConsentCheckbox: true,
      consentLabel:
        'Tôi đồng ý Ticketbox & BTC sử dụng thông tin đặt vé nhằm mục đích vận hành sự kiện [Có/Yes]',
    };

    const userProfile: UserProfileData = {
      fullName: 'Boris Eifman Fan',
      email: 'eifman.fan@ticketbox.vn',
      phone: '0987654321',
      agreeToTerms: true,
    };

    const result = FormAutofillPolicy.evaluate(event26215Schema, userProfile);

    expect(result.canProceed).toBe(true);
    expect(result.isConsentBlocked).toBe(false);
    expect(result.hasUnsatisfiedRequiredFields).toBe(false);
    expect(result.missingFields).toHaveLength(0);
    expect(result.plan).toHaveLength(3);

    // Consent radio should be satisfied and targeted with 'true'
    expect(result.plan[0]?.source).toBe('CONSENT');
    expect(result.plan[0]?.targetValue).toBe('true');
    expect(result.plan[0]?.satisfied).toBe(true);

    // Email
    expect(result.plan[1]?.source).toBe('EMAIL');
    expect(result.plan[1]?.targetValue).toBe('eifman.fan@ticketbox.vn');
    expect(result.plan[1]?.satisfied).toBe(true);

    // Phone
    expect(result.plan[2]?.source).toBe('PHONE');
    expect(result.plan[2]?.targetValue).toBe('0987654321');
    expect(result.plan[2]?.satisfied).toBe(true);
  });

  it('should autofill extended profile fields (idCard, birthYear, gender, address)', () => {
    const extendedSchema: FormSchema = {
      fields: [
        {
          id: 'f-cccd',
          label: 'Số CCCD / Hộ chiếu',
          type: 'ID_CARD',
          required: true,
          value: '',
          selector: '#f-cccd',
        },
        {
          id: 'f-dob',
          label: 'Năm sinh / Date of Birth',
          type: 'BIRTH_YEAR',
          required: true,
          value: '',
          selector: '#f-dob',
        },
        {
          id: 'f-gender',
          label: 'Giới tính [Nam/Male]',
          type: 'RADIO',
          required: true,
          value: 'Nam',
          selector: '#f-gender-male',
        },
        {
          id: 'f-address',
          label: 'Địa chỉ / Tỉnh thành',
          type: 'ADDRESS',
          required: true,
          value: '',
          selector: '#f-address',
        },
      ],
      hasConsentCheckbox: false,
    };

    const extendedProfile: UserProfileData = {
      fullName: 'Tran Van B',
      email: 'tranb@example.com',
      phone: '0912345678',
      idCard: '079123456789',
      birthYear: '1992',
      gender: 'Nam',
      address: 'TP. Hồ Chí Minh',
      agreeToTerms: true,
    };

    const result = FormAutofillPolicy.evaluate(extendedSchema, extendedProfile);

    expect(result.canProceed).toBe(true);
    expect(result.hasUnsatisfiedRequiredFields).toBe(false);
    expect(result.missingFields).toHaveLength(0);

    expect(result.plan[0]?.source).toBe('ID_CARD');
    expect(result.plan[0]?.targetValue).toBe('079123456789');

    expect(result.plan[1]?.source).toBe('BIRTH_YEAR');
    expect(result.plan[1]?.targetValue).toBe('1992');

    expect(result.plan[2]?.source).toBe('GENDER');
    expect(result.plan[2]?.targetValue).toBe('true');

    expect(result.plan[3]?.source).toBe('ADDRESS');
    expect(result.plan[3]?.targetValue).toBe('TP. Hồ Chí Minh');
  });
});
