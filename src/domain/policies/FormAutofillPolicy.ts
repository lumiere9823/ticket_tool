import { FormField, FormSchema, UserProfileData } from '../entities/BookingJourneyModels';

export interface AutofillPlanItem {
  field: FormField;
  targetValue: string;
  source:
    | 'FULL_NAME'
    | 'PHONE'
    | 'EMAIL'
    | 'ID_CARD'
    | 'BIRTH_YEAR'
    | 'GENDER'
    | 'ADDRESS'
    | 'CONSENT'
    | 'ADDITIONAL'
    | 'MANUAL';
  satisfied: boolean;
  requiresUserAction: boolean;
  reason?: string | undefined;
}

export interface AutofillEvaluationResult {
  canProceed: boolean;
  isConsentBlocked: boolean;
  hasUnsatisfiedRequiredFields: boolean;
  plan: AutofillPlanItem[];
  missingFields: string[];
  consentField?: FormField | undefined;
}

export class FormAutofillPolicy {
  /**
   * Evaluates a FormSchema against UserProfileData.
   * Strictly enforces:
   * - No guessing or auto-filling of arbitrary/unknown questions.
   * - Safe mapping of configured profile attributes (name, phone, email, idCard, birthYear, gender, address).
   * - Consent checkbox gate: stops with isConsentBlocked if user has not explicitly consented.
   */
  public static evaluate(
    schema: FormSchema,
    profile?: UserProfileData | undefined
  ): AutofillEvaluationResult {
    const plan: AutofillPlanItem[] = [];
    let isConsentBlocked = false;
    let consentField: FormField | undefined;
    const missingFields: string[] = [];

    for (const field of schema.fields) {
      const normalizedLabel = (field.label || '').toLowerCase();

      // 1. Consent checkbox / radio detection
      const isConsent =
        (field.type === 'CHECKBOX' || field.type === 'RADIO') &&
        (normalizedLabel.includes('agree') ||
          normalizedLabel.includes('đồng ý') ||
          normalizedLabel.includes('terms') ||
          normalizedLabel.includes('điều khoản') ||
          normalizedLabel.includes('chính sách') ||
          normalizedLabel.includes('policy') ||
          normalizedLabel.includes('vận hành') ||
          normalizedLabel.includes('btc') ||
          normalizedLabel.includes('sử dụng thông tin') ||
          normalizedLabel.includes('quy định'));

      if (isConsent) {
        consentField = field;
        const userAgreed = profile?.agreeToTerms === true;

        // If this is explicitly a negative option like "Không/No", do not select it
        const isNegativeOption =
          normalizedLabel.includes('[không') ||
          normalizedLabel.endsWith('không/no]') ||
          normalizedLabel.includes('không đồng ý') ||
          normalizedLabel.includes('disagree') ||
          normalizedLabel.includes('refuse');

        if (isNegativeOption) {
          plan.push({
            field,
            targetValue: 'false',
            source: 'CONSENT',
            satisfied: true,
            requiresUserAction: false,
          });
          continue;
        }

        if (userAgreed) {
          plan.push({
            field,
            targetValue: 'true',
            source: 'CONSENT',
            satisfied: true,
            requiresUserAction: false,
          });
        } else {
          isConsentBlocked = true;
          plan.push({
            field,
            targetValue: '',
            source: 'CONSENT',
            satisfied: false,
            requiresUserAction: true,
            reason: 'User consent required for terms and conditions',
          });
          if (field.required) {
            missingFields.push(field.label || field.id);
          }
        }
        continue;
      }

      // 2. Email field
      if (
        field.type === 'EMAIL' ||
        normalizedLabel.includes('email') ||
        normalizedLabel.includes('thư điện tử')
      ) {
        const email = profile?.email?.trim();
        if (email) {
          plan.push({
            field,
            targetValue: email,
            source: 'EMAIL',
            satisfied: true,
            requiresUserAction: false,
          });
        } else {
          if (field.required) missingFields.push(field.label || 'Email');
          plan.push({
            field,
            targetValue: '',
            source: 'EMAIL',
            satisfied: false,
            requiresUserAction: field.required,
            reason: 'User email not configured in profile',
          });
        }
        continue;
      }

      // 3. Phone field
      if (
        field.type === 'PHONE' ||
        normalizedLabel.includes('phone') ||
        normalizedLabel.includes('điện thoại') ||
        normalizedLabel.includes('sđt') ||
        normalizedLabel.includes('so dien thoai')
      ) {
        const phone = profile?.phone?.trim();
        if (phone) {
          plan.push({
            field,
            targetValue: phone,
            source: 'PHONE',
            satisfied: true,
            requiresUserAction: false,
          });
        } else {
          if (field.required) missingFields.push(field.label || 'Phone');
          plan.push({
            field,
            targetValue: '',
            source: 'PHONE',
            satisfied: false,
            requiresUserAction: field.required,
            reason: 'User phone number not configured in profile',
          });
        }
        continue;
      }

      // 4. Full Name field
      if (
        field.type === 'TEXT' &&
        (normalizedLabel.includes('name') ||
          normalizedLabel.includes('họ tên') ||
          normalizedLabel.includes('họ và tên') ||
          normalizedLabel.includes('họ & tên') ||
          normalizedLabel.includes('full name') ||
          normalizedLabel.includes('your name') ||
          normalizedLabel.includes('tên của bạn') ||
          normalizedLabel.includes('tên người') ||
          normalizedLabel.includes('attendee') ||
          normalizedLabel.includes('người nhận'))
      ) {
        const name = profile?.fullName?.trim();
        if (name) {
          plan.push({
            field,
            targetValue: name,
            source: 'FULL_NAME',
            satisfied: true,
            requiresUserAction: false,
          });
        } else {
          if (field.required) missingFields.push(field.label || 'Full Name');
          plan.push({
            field,
            targetValue: '',
            source: 'FULL_NAME',
            satisfied: false,
            requiresUserAction: field.required,
            reason: 'User full name not configured in profile',
          });
        }
        continue;
      }

      // 5. Check additional configured fields first (explicit user mapping)
      if (profile?.additionalFields) {
        const matchedKey = Object.keys(profile.additionalFields).find((k) =>
          normalizedLabel.includes(k.toLowerCase())
        );
        if (matchedKey) {
          const val = profile.additionalFields[matchedKey]!;
          plan.push({
            field,
            targetValue: val,
            source: 'ADDITIONAL',
            satisfied: true,
            requiresUserAction: false,
          });
          continue;
        }
      }

      // 6. CCCD / CMND / Passport field
      if (
        field.type === 'ID_CARD' ||
        normalizedLabel.includes('cccd') ||
        normalizedLabel.includes('cmnd') ||
        normalizedLabel.includes('căn cước') ||
        normalizedLabel.includes('hộ chiếu') ||
        normalizedLabel.includes('passport') ||
        normalizedLabel.includes('citizen id') ||
        normalizedLabel.includes('id number') ||
        normalizedLabel.includes('giấy tờ')
      ) {
        const idCard = profile?.idCard?.trim();
        if (idCard) {
          plan.push({
            field,
            targetValue: idCard,
            source: 'ID_CARD',
            satisfied: true,
            requiresUserAction: false,
          });
        } else {
          if (field.required) missingFields.push(field.label || 'CCCD/CMND/Passport');
          plan.push({
            field,
            targetValue: '',
            source: 'ID_CARD',
            satisfied: false,
            requiresUserAction: field.required,
            reason: 'User ID card / CCCD not configured in profile',
          });
        }
        continue;
      }

      // 6. Birth Year / DOB field
      if (
        field.type === 'BIRTH_YEAR' ||
        normalizedLabel.includes('năm sinh') ||
        normalizedLabel.includes('ngày sinh') ||
        normalizedLabel.includes('ngày tháng năm sinh') ||
        normalizedLabel.includes('birth year') ||
        normalizedLabel.includes('date of birth') ||
        normalizedLabel.includes('dob') ||
        normalizedLabel.includes('sinh năm')
      ) {
        const birthYear = profile?.birthYear?.trim();
        if (birthYear) {
          plan.push({
            field,
            targetValue: birthYear,
            source: 'BIRTH_YEAR',
            satisfied: true,
            requiresUserAction: false,
          });
        } else {
          if (field.required) missingFields.push(field.label || 'Birth Year');
          plan.push({
            field,
            targetValue: '',
            source: 'BIRTH_YEAR',
            satisfied: false,
            requiresUserAction: field.required,
            reason: 'User birth year not configured in profile',
          });
        }
        continue;
      }

      // 7. Gender field
      if (
        field.type === 'GENDER' ||
        normalizedLabel.includes('giới tính') ||
        normalizedLabel.includes('gender') ||
        normalizedLabel.includes('sex')
      ) {
        const gender = profile?.gender?.trim();
        if (gender) {
          const normGender = gender.toLowerCase();
          if (field.type === 'RADIO' || field.type === 'CHECKBOX') {
            const matchesOption =
              (normGender.includes('nam') || normGender === 'male')
                ? (normalizedLabel.includes('nam') || normalizedLabel.includes('male')) && !normalizedLabel.includes('nữ') && !normalizedLabel.includes('female')
                : (normGender.includes('nữ') || normGender === 'female')
                  ? normalizedLabel.includes('nữ') || normalizedLabel.includes('female')
                  : normalizedLabel.includes(normGender);

            plan.push({
              field,
              targetValue: matchesOption ? 'true' : 'false',
              source: 'GENDER',
              satisfied: true,
              requiresUserAction: false,
            });
          } else {
            plan.push({
              field,
              targetValue: gender,
              source: 'GENDER',
              satisfied: true,
              requiresUserAction: false,
            });
          }
        } else {
          if (field.required) missingFields.push(field.label || 'Gender');
          plan.push({
            field,
            targetValue: '',
            source: 'GENDER',
            satisfied: false,
            requiresUserAction: field.required,
            reason: 'User gender not configured in profile',
          });
        }
        continue;
      }

      // 8. Address field
      if (
        field.type === 'ADDRESS' ||
        normalizedLabel.includes('địa chỉ') ||
        normalizedLabel.includes('address') ||
        normalizedLabel.includes('tỉnh thành') ||
        normalizedLabel.includes('tỉnh/thành') ||
        normalizedLabel.includes('city') ||
        normalizedLabel.includes('thành phố')
      ) {
        const address = profile?.address?.trim();
        if (address) {
          plan.push({
            field,
            targetValue: address,
            source: 'ADDRESS',
            satisfied: true,
            requiresUserAction: false,
          });
        } else {
          if (field.required) missingFields.push(field.label || 'Address');
          plan.push({
            field,
            targetValue: '',
            source: 'ADDRESS',
            satisfied: false,
            requiresUserAction: field.required,
            reason: 'User address not configured in profile',
          });
        }
        continue;
      }

      // 10. Unknown / Event-specific question
      plan.push({
        field,
        targetValue: '',
        source: 'MANUAL',
        satisfied: !field.required,
        requiresUserAction: field.required,
        reason: 'Event-specific custom field requires manual user input',
      });
      if (field.required) {
        missingFields.push(field.label || field.id);
      }
    }

    const hasUnsatisfiedRequiredFields = missingFields.length > 0;
    const canProceed = !isConsentBlocked && !hasUnsatisfiedRequiredFields;

    return {
      canProceed,
      isConsentBlocked,
      hasUnsatisfiedRequiredFields,
      plan,
      missingFields,
      consentField,
    };
  }
}
