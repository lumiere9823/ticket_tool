/**
 * popup/state-display.ts
 *
 * Manages the state badge, current step display, button arm/stop states,
 * and blocking reason UI in the popup.
 *
 * Extracted from popup.ts to isolate state-visualization concerns.
 */

import { PurchaseState } from '../../domain/states/PurchaseState';

export interface StateBadgeRefs {
  stateBadge: HTMLElement;
  currentStepDisplay: HTMLElement;
  blockingReasonContainer: HTMLElement;
  blockingReasonText: HTMLElement;
  btnArm: HTMLButtonElement | null;
  btnStop: HTMLButtonElement | null;
  btnBasicArm: HTMLButtonElement | null;
  btnBasicStop: HTMLButtonElement | null;
}

/** States where monitoring is actively running (ARM button shows as STOP). */
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

/**
 * Returns a human-readable label for a given PurchaseState.
 */
export function getStateLabel(state: PurchaseState): string {
  const labels: Partial<Record<PurchaseState, string>> = {
    [PurchaseState.IDLE]: 'Chờ',
    [PurchaseState.READY]: 'Sẵn sàng',
    [PurchaseState.ARMED]: 'Đã ARM',
    [PurchaseState.MONITORING]: 'Đang theo dõi',
    [PurchaseState.WAITING_FOR_STOCK]: 'Chờ vé',
    [PurchaseState.SELECTING]: 'Đang chọn vé',
    [PurchaseState.RESERVING]: 'Đang giữ chỗ',
    [PurchaseState.HELD]: 'Đã giữ chỗ',
    [PurchaseState.CONFIRMED]: 'Thành công',
    [PurchaseState.STOPPED]: 'Đã dừng',
    [PurchaseState.STOPPED_LIMIT_REACHED]: 'Dừng (hết giới hạn)',
    [PurchaseState.FAILED]: 'Thất bại',
    [PurchaseState.HUMAN_INTERVENTION_REQUIRED]: 'Cần can thiệp',
    [PurchaseState.PAYMENT_GATE]: 'Đến trang thanh toán',
  };
  return labels[state] ?? state;
}

/**
 * Returns true if the given state is an actively-running monitoring state.
 */
export function isRunningState(state: PurchaseState): boolean {
  return RUNNING_STATES.has(state);
}

/**
 * StateBadgeController — updates all state-related UI elements in one place.
 */
export class StateBadgeController {
  constructor(private readonly refs: StateBadgeRefs) {}

  update(state: PurchaseState, blockingReason?: string | null): void {
    const { stateBadge, currentStepDisplay, blockingReasonContainer, blockingReasonText } =
      this.refs;

    // Clear all state classes
    stateBadge.className = 'state-badge';
    stateBadge.textContent = getStateLabel(state);

    // Apply current step display
    if (currentStepDisplay) {
      currentStepDisplay.textContent = getStateLabel(state);
    }

    // Blocking reason banner
    if (state === PurchaseState.HUMAN_INTERVENTION_REQUIRED && blockingReason) {
      blockingReasonContainer.style.display = 'block';
      blockingReasonText.textContent = blockingReason;
    } else if (state === PurchaseState.FAILED) {
      blockingReasonContainer.style.display = 'block';
      blockingReasonText.textContent =
        'Quy trình gặp sự cố DOM hoặc vé hết. Vui lòng thử lại hoặc tải lại trang.';
    } else {
      blockingReasonContainer.style.display = 'none';
    }

    // Apply badge color class
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
        stateBadge.classList.add('intervention');
        break;
      default:
        break;
    }

    // ARM button label sync
    this.updateArmButtons(state);
  }

  private updateArmButtons(state: PurchaseState): void {
    const running = isRunningState(state);

    const setRunning = (btn: HTMLButtonElement | null) => {
      if (!btn) return;
      btn.textContent = '🛑 DỪNG SĂN VÉ (ĐANG CHẠY...)';
      btn.classList.add('running-active');
      btn.style.background = '#dc2626';
      btn.style.color = '#ffffff';
    };
    const setIdle = (btn: HTMLButtonElement | null) => {
      if (!btn) return;
      btn.textContent = '🚀 BẮT ĐẦU SĂN VÉ (ARM)';
      btn.classList.remove('running-active');
      btn.style.background = '';
      btn.style.color = '';
    };

    if (running) {
      setRunning(this.refs.btnArm);
      setRunning(this.refs.btnBasicArm);
    } else {
      setIdle(this.refs.btnArm);
      setIdle(this.refs.btnBasicArm);
    }
  }
}
