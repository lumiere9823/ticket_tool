import { UserProfileData } from '../../domain/entities/BookingJourneyModels';

export interface ProfileInputElements {
  nameInput?: { value: string } | null;
  phoneInput?: { value: string } | null;
  emailInput?: { value: string } | null;
  idCardInput?: { value: string } | null;
  agreeTermsCheckbox?: { checked: boolean } | null;
  allowSensitiveCheckbox?: { checked: boolean } | null;
  birthYearInput?: { value: string } | null;
  genderSelect?: { value: string } | null;
  addressInput?: { value: string } | null;
}

/**
 * Builds UserProfileData from UI input elements with strict consent enforcement.
 * If agreeTermsCheckbox is unselected or missing, agreeToTerms defaults to false (fail-closed).
 * idCard and address are strictly omitted unless allowSensitiveCheckbox is explicitly checked.
 */
export function buildUserProfileFromInputs(
  inputs: ProfileInputElements,
  fallbackInputs?: ProfileInputElements
): UserProfileData {
  const name = inputs.nameInput?.value.trim() || fallbackInputs?.nameInput?.value.trim() || '';
  const phone = inputs.phoneInput?.value.trim() || fallbackInputs?.phoneInput?.value.trim() || '';
  const email = inputs.emailInput?.value.trim() || fallbackInputs?.emailInput?.value.trim() || '';
  const idCard =
    inputs.idCardInput?.value.trim() || fallbackInputs?.idCardInput?.value.trim() || undefined;

  // Never default to true: only true if checkbox explicitly checked
  const agreeToTerms =
    inputs.agreeTermsCheckbox !== undefined && inputs.agreeTermsCheckbox !== null
      ? inputs.agreeTermsCheckbox.checked
      : fallbackInputs?.agreeTermsCheckbox !== undefined &&
          fallbackInputs?.agreeTermsCheckbox !== null
        ? fallbackInputs.agreeTermsCheckbox.checked
        : false;

  const allowSensitivePii = Boolean(
    inputs.allowSensitiveCheckbox?.checked || fallbackInputs?.allowSensitiveCheckbox?.checked
  );

  const birthYear =
    inputs.birthYearInput?.value.trim() ||
    fallbackInputs?.birthYearInput?.value.trim() ||
    undefined;
  const gender =
    inputs.genderSelect?.value.trim() || fallbackInputs?.genderSelect?.value.trim() || undefined;
  const address =
    inputs.addressInput?.value.trim() || fallbackInputs?.addressInput?.value.trim() || undefined;

  return {
    fullName: name,
    phone,
    email,
    idCard: allowSensitivePii ? idCard : undefined,
    agreeToTerms: Boolean(agreeToTerms),
    birthYear,
    gender,
    address: allowSensitivePii ? address : undefined,
    allowSensitivePii,
    savedAt: Date.now(),
  };
}
