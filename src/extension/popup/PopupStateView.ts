import { PurchaseState } from '../../domain/states/PurchaseState';

export interface PopupStateViewOptions {
  stateBadge: HTMLElement;
  currentStepDisplay: HTMLElement;
  blockingReasonContainer: HTMLElement;
  blockingReasonText: HTMLElement;
  interventionBanner: HTMLElement | null;
  armButtons: Array<HTMLButtonElement | null>;
}

const RUNNING_STATES = new Set<PurchaseState>([
  PurchaseState.ARMED,
  PurchaseState.MONITORING,
  PurchaseState.EVENT_DETECTED,
  PurchaseState.SHOWING_DETECTED,
  PurchaseState.TICKETS_DETECTED,
  PurchaseState.EVALUATING_TICKETS,
  PurchaseState.AVAILABLE_DETECTED,
  PurchaseState.SELECTING,
  PurchaseState.TICKET_SELECTED,
  PurchaseState.BOOKING_MODE_DETECTED,
  PurchaseState.SELECTING_QUANTITY,
  PurchaseState.AREA_SELECTION_REQUIRED,
  PurchaseState.SELECTING_AREA,
  PurchaseState.SEAT_MAP_DETECTED,
  PurchaseState.SELECTING_SEATS,
  PurchaseState.SEATS_SELECTED,
  PurchaseState.BOOKING_SUMMARY_DETECTED,
  PurchaseState.QUESTION_FORM_DETECTED,
  PurchaseState.FILLING_ATTENDEE_FORM,
  PurchaseState.FORM_VALIDATED,
  PurchaseState.RESERVING,
  PurchaseState.RETRYING_TARGET,
  PurchaseState.WAITING,
  PurchaseState.WAITING_FOR_STOCK,
]);

export class PopupStateView {
  constructor(private readonly options: PopupStateViewOptions) {}

  update(state: PurchaseState, blockingReason?: string): void {
    const {
      stateBadge,
      currentStepDisplay,
      blockingReasonContainer,
      blockingReasonText,
      interventionBanner,
    } = this.options;

    stateBadge.textContent = state;
    currentStepDisplay.textContent = state;
    stateBadge.className = 'badge';

    if (blockingReason) {
      blockingReasonContainer.style.display = 'block';
      blockingReasonText.textContent = blockingReason;
    } else if (state === PurchaseState.IN_QUEUE) {
      blockingReasonContainer.style.display = 'block';
      blockingReasonText.textContent =
        'Đang trong hàng chờ (Waiting Room). Vui lòng GIỮ NGUYÊN TRANG, tuyệt đối không tải lại.';
    } else if (state === PurchaseState.FAILED) {
      blockingReasonContainer.style.display = 'block';
      blockingReasonText.textContent =
        'Quy trình gặp sự cố DOM hoặc vé hết. Vui lòng thử lại hoặc tải lại trang.';
    } else {
      blockingReasonContainer.style.display = 'none';
    }

    switch (state) {
      case PurchaseState.READY:
      case PurchaseState.IDLE:
        stateBadge.classList.add('ready');
        break;
      case PurchaseState.ARMED:
      case PurchaseState.MONITORING:
      case PurchaseState.EVENT_DETECTED:
      case PurchaseState.SHOWING_DETECTED:
      case PurchaseState.TICKETS_DETECTED:
      case PurchaseState.EVALUATING_TICKETS:
      case PurchaseState.AVAILABLE_DETECTED:
      case PurchaseState.SELECTING:
      case PurchaseState.TICKET_SELECTED:
      case PurchaseState.BOOKING_MODE_DETECTED:
      case PurchaseState.SELECTING_QUANTITY:
      case PurchaseState.AREA_SELECTION_REQUIRED:
      case PurchaseState.SELECTING_AREA:
      case PurchaseState.SEAT_MAP_DETECTED:
      case PurchaseState.SELECTING_SEATS:
      case PurchaseState.SEATS_SELECTED:
      case PurchaseState.BOOKING_SUMMARY_DETECTED:
      case PurchaseState.QUESTION_FORM_DETECTED:
      case PurchaseState.FILLING_ATTENDEE_FORM:
      case PurchaseState.FORM_VALIDATED:
      case PurchaseState.RESERVING:
      case PurchaseState.RETRYING_TARGET:
        stateBadge.classList.add('armed');
        break;
      case PurchaseState.HELD:
      case PurchaseState.CONFIRMED:
        stateBadge.classList.add('held');
        break;
      case PurchaseState.STOPPED:
      case PurchaseState.STOPPED_LIMIT_REACHED:
      case PurchaseState.STOPPED_NO_TARGET:
      case PurchaseState.FAILED:
      case PurchaseState.RATE_LIMITED:
      case PurchaseState.SOLD_OUT:
      case PurchaseState.INVALID_SELECTION:
        stateBadge.classList.add('failed');
        break;
      case PurchaseState.WAITING:
      case PurchaseState.WAITING_FOR_STOCK:
        stateBadge.classList.add('monitoring');
        break;
      case PurchaseState.HUMAN_INTERVENTION_REQUIRED:
      case PurchaseState.CONSENT_REQUIRED:
      case PurchaseState.PAYMENT_GATE:
      case PurchaseState.CAPTCHA_REQUIRED:
      case PurchaseState.OTP_REQUIRED:
      case PurchaseState.PAYMENT_ACTION_REQUIRED:
      case PurchaseState.SESSION_REAUTH_REQUIRED:
      case PurchaseState.IN_QUEUE:
        stateBadge.classList.add('intervention');
        break;
      default:
        break;
    }

    const interventionStates = new Set<PurchaseState>([
      PurchaseState.HUMAN_INTERVENTION_REQUIRED,
      PurchaseState.CAPTCHA_REQUIRED,
      PurchaseState.OTP_REQUIRED,
      PurchaseState.SESSION_REAUTH_REQUIRED,
      PurchaseState.UNKNOWN_SECURITY_CHALLENGE,
      PurchaseState.IN_QUEUE,
    ]);
    if (interventionBanner) {
      interventionBanner.style.display = interventionStates.has(state) ? 'flex' : 'none';
    }

    const isRunning = RUNNING_STATES.has(state);
    for (const button of this.options.armButtons) {
      if (!button) continue;
      if (isRunning) {
        button.textContent = '🛑 DỪNG SĂN VÉ (ĐANG CHẠY...)';
        button.classList.add('running-active');
        button.style.background = '#dc2626';
        button.style.color = '#ffffff';
      } else {
        button.textContent = '🚀 BẮT ĐẦU SĂN VÉ (ARM)';
        button.classList.remove('running-active');
        button.style.background = '';
        button.style.color = '';
      }
    }
  }
}
