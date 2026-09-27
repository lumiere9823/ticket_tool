/**
 * Normalized Booking Journey Domain Entities and Models.
 * Models the complete Ticketbox purchase journey:
 * Event -> Showing -> Tickets -> Mode -> Standing/Seated -> Seats -> Summary -> Form -> Consent -> Payment.
 * Conforms to ADR-001, ADR-002, and AI Engineering Rules.
 */

export interface BookingEvent {
  id: string | null;
  url: string;
  title: string;
  venue?: string | undefined;
  status: 'ON_SALE' | 'SOLD_OUT' | 'NOT_STARTED' | 'CLOSED' | 'UNKNOWN';
}

export interface Showing {
  id: string | null;
  eventId: string | null;
  name?: string | null | undefined;
  date: string | null;
  startTime?: string | null | undefined;
  endTime?: string | null | undefined;
  venue?: string | null | undefined;
  status: 'ON_SALE' | 'SOLD_OUT' | 'NOT_STARTED' | 'CLOSED' | 'UNKNOWN';
}

export type JourneyTicketMode = 'STANDING' | 'SEATED' | 'AREA_BASED' | 'UNKNOWN';

export type JourneyAvailability =
  'AVAILABLE' | 'SOLD_OUT' | 'OFFLINE_SALE' | 'NOT_STARTED' | 'CLOSED' | 'UNKNOWN';

export interface JourneyTicketType {
  id: string | null;
  showingId: string | null;
  name: string;
  price: number;
  currency: 'VND' | string;
  mode: JourneyTicketMode;
  availability: JourneyAvailability;
  minQuantity: number | null;
  maxQuantity: number | null;
  selectable: boolean;
  metadata?: Record<string, unknown> | undefined;
  evidence: string[];
}

export type SeatStatus =
  'AVAILABLE' | 'SELECTED' | 'OCCUPIED' | 'BLOCKED' | 'UNAVAILABLE' | 'UNKNOWN';

export interface Seat {
  id: string;
  label: string;
  row: string;
  number: number;
  area: string;
  status: SeatStatus;
  selectable: boolean;
  price?: number | undefined;
  element?: unknown;
  x?: number | undefined;
  y?: number | undefined;
}

export interface SeatArea {
  id: string;
  name: string;
  price: number;
  currency?: string | undefined;
  mode: JourneyTicketMode;
  availability: JourneyAvailability;
  selectable: boolean;
  availableSeatCount?: number | undefined;
}

export interface SeatMapLegendItem {
  name: string;
  price: number;
  color?: string | undefined;
  available: boolean;
}

export interface SeatMap {
  areas: SeatArea[];
  seats: Seat[];
  legend: SeatMapLegendItem[];
}

export interface CurrentSelection {
  ticketId: string | null;
  name: string;
  price: number;
  currency: string;
  mode: JourneyTicketMode;
  quantity: number;
  areaId?: string | null | undefined;
  areaName?: string | null | undefined;
  seats: string[]; // List of seat labels e.g. ["A12", "A13"]
  selectedAt: string;
}

export interface SummaryItem {
  ticket: string;
  quantity: number;
  price: number;
  seats?: string[] | undefined;
}

export interface BookingSummary {
  items: SummaryItem[];
  subtotal: number;
  fees: number;
  total: number;
  currency: string;
}

export type FormFieldType =
  'TEXT' | 'EMAIL' | 'PHONE' | 'CHECKBOX' | 'SELECT' | 'RADIO' | 'UNKNOWN';

export interface FormField {
  id: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  value: string;
  selector: string;
  options?: string[] | undefined;
}

export interface FormSchema {
  fields: FormField[];
  hasConsentCheckbox: boolean;
  consentLabel?: string | undefined;
}

export interface UserProfileData {
  fullName: string;
  phone: string;
  email: string;
  agreeToTerms?: boolean | undefined;
  additionalFields?: Record<string, string> | undefined;
}

export interface BookingAttemptContext {
  attemptId: string;
  tabId?: number | string | undefined;
  frameId?: number | string | undefined;
  profileContext: {
    profileId: string;
    accountName?: string | undefined;
  };
}

export type ActionType =
  | 'SELECT_TICKET'
  | 'SET_QUANTITY'
  | 'SELECT_AREA'
  | 'SELECT_SEAT'
  | 'FILL_FIELD'
  | 'VALIDATE_FORM'
  | 'CONTINUE';

export interface ActionModel {
  actionId: string;
  type: ActionType;
  target: string;
  expectedBefore: unknown;
  expectedAfter: unknown;
  startedAt: string;
  completedAt?: string | undefined;
  result: 'SUCCESS' | 'FAILED' | 'RETRYING';
  error?: string | undefined;
}

export type SeatPreferencePolicy =
  'ANY_AVAILABLE' | 'SAME_ROW' | 'NEAREST_STAGE' | 'AREA_PRIORITY' | 'SPECIFIC_SEAT';

export type NonAdjacentFallbackPolicy = 'WAIT' | 'SELECT_NON_ADJACENT' | 'STOP';

export interface BookingPreferences {
  categoryPriority: string[];
  quantity: number;
  allowFallback: boolean;
  seatPreference?: SeatPreferencePolicy | undefined;
  nonAdjacentFallback?: NonAdjacentFallbackPolicy | undefined;
  userProfile?: UserProfileData | undefined;
}
