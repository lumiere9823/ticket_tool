import { FormField, FormSchema, UserProfileData } from '../entities/BookingJourneyModels';

export interface AutofillPlanItem {
  field: FormField;
  targetValue: string;
  source: 'FULL_NAME' | 'PHONE' | 'EMAIL' | 'CONSENT' | 'ADDITIONAL' | 'MANUAL';
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
   * - Safe mapping of configured fullName, phone, email only.
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
          normalizedLabel.includes('sử dụng thông tin'));

      if (isConsent) {
        consentField = field;
        const userAgreed = profile?.agreeToTerms === true;

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

      // 3. Phone / ID field
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
        normalizedLabel.includes('name') ||
        normalizedLabel.includes('họ tên') ||
        normalizedLabel.includes('họ và tên') ||
        normalizedLabel.includes('họ & tên') ||
        normalizedLabel.includes('full name') ||
        normalizedLabel.includes('attendee') ||
        normalizedLabel.includes('người nhận')
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

      // 5. Check additional configured fields
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

      // 6. Unknown / Event-specific question
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
