import { ChromeMessageBus } from '../../infrastructure/messaging/ChromeMessageBus';
import { ChromeStorageRepository } from '../../infrastructure/storage/ChromeStorageRepository';
import { PurchaseState } from '../../domain/states/PurchaseState';
import { ExtensionMessage } from '../shared/messages';
import {
  PurchasePlan,
  TicketRule,
  TicketOption,
  TicketCatalogSnapshot,
  FallbackPolicy,
  createDefaultPurchasePlan,
  createEmptyTicketCatalogSnapshot,
} from '../../domain/entities/PurchasePlan';
import { PurchasePlanValidator } from '../../domain/policies/PurchasePlanValidator';
import {
  ScopedPurchasePlan,
  createDefaultScopedPurchasePlan,
  extractEventIdFromUrl,
} from '../../domain/entities/ScopedPurchasePlan';
import { ScopedPurchasePlanValidator } from '../../domain/policies/ScopedPurchasePlanValidator';
import { PersistentExecutionState } from '../../application/ports/StorageRepository';
import { buildUserProfileFromInputs } from './profile-builder';
import { PopupMatrixRenderer } from './PopupMatrixRenderer';
import { PopupStateView } from './PopupStateView';
import { registerPopupEventListeners } from './PopupEventListeners';
import { PopupConfigView } from './PopupConfigView';

// ─── Infrastructure ──────────────────────────────────────────────────────────

const storage = new ChromeStorageRepository();
const messageBus = new ChromeMessageBus();

// ─── Runtime state ────────────────────────────────────────────────────────────

/** Current discovered catalog. Updated on every JOURNEY_UPDATE. */
let currentCatalog: TicketCatalogSnapshot = createEmptyTicketCatalogSnapshot();

/** Current purchase plan being edited. Persisted on every change. */
let currentPlan: PurchasePlan = createDefaultPurchasePlan();

/** Current scoped purchase plan being edited (showing x tier matrix). */
let currentScopedPlan: ScopedPurchasePlan = createDefaultScopedPurchasePlan();

// ─── DOM References ───────────────────────────────────────────────────────────

const stateBadge = document.getElementById('state-badge') as HTMLElement;
const currentStepDisplay = document.getElementById('current-step-display') as HTMLElement;
const blockingReasonContainer = document.getElementById('blocking-reason-container') as HTMLElement;
const blockingReasonText = document.getElementById('blocking-reason-text') as HTMLElement;

const eventUrlInput = document.getElementById('event-url') as HTMLInputElement;

const catalogStatusEl = document.getElementById('catalog-status') as HTMLElement;
const catalogStatusIcon = document.getElementById('catalog-status-icon') as HTMLElement;
const catalogStatusText = document.getElementById('catalog-status-text') as HTMLElement;
const btnRefreshCatalog = document.getElementById('btn-refresh-catalog') as HTMLButtonElement;

const eventInfoBar = document.getElementById('event-info-bar') as HTMLElement;
const eventInfoTitle = document.getElementById('event-info-title') as HTMLElement;

const showingGroup = document.getElementById('showing-group') as HTMLElement;
const showingSelect = document.getElementById('showing-select') as HTMLSelectElement;

const ticketRulesContainer = document.getElementById('ticket-rules-container') as HTMLElement;
const btnAddTicketRow = document.getElementById('btn-add-ticket-row') as HTMLButtonElement;

// Scoped Matrix DOM references
const matrixEmpty = document.getElementById('matrix-empty') as HTMLElement;
const matrixTableWrapper = document.getElementById('matrix-table-wrapper') as HTMLElement;
const scopedMatrixTbody = document.getElementById('scoped-matrix-tbody') as HTMLElement;
const scopedQuantityInput = document.getElementById('scoped-quantity') as HTMLInputElement;
const scopedStrategySelect = document.getElementById('scoped-strategy') as HTMLSelectElement;
const paramDurationInput = document.getElementById('param-duration') as HTMLInputElement;
const paramAttemptsInput = document.getElementById('param-attempts') as HTMLInputElement;
const paramPollIntervalInput = document.getElementById('param-poll-interval') as HTMLInputElement;
const paramJitterInput = document.getElementById('param-jitter') as HTMLInputElement;
const paramAllowPartialCheckbox = document.getElementById(
  'param-allow-partial'
) as HTMLInputElement;
const paramMaxPricePerTicketInput = document.getElementById(
  'param-max-price-per-ticket'
) as HTMLInputElement | null;
const paramMaxTotalInput = document.getElementById('param-max-total') as HTMLInputElement | null;
const persistentTargetDisplay = document.getElementById('persistent-target-display') as HTMLElement;
const persistentAttemptsDisplay = document.getElementById(
  'persistent-attempts-display'
) as HTMLElement;
const persistentElapsedDisplay = document.getElementById(
  'persistent-elapsed-display'
) as HTMLElement;
const persistentStopReasonRow = document.getElementById(
  'persistent-stop-reason-row'
) as HTMLElement;
const persistentStopReasonDisplay = document.getElementById(
  'persistent-stop-reason-display'
) as HTMLElement;
const tabHiddenBanner = document.getElementById('tab-hidden-banner') as HTMLElement;
const scopedSummaryBox = document.getElementById('scoped-summary-box') as HTMLElement;
const summaryAllowed = document.getElementById('summary-allowed') as HTMLElement;
const summaryDisallowed = document.getElementById('summary-disallowed') as HTMLElement;
const summaryConfirmCheckbox = document.getElementById(
  'summary-confirm-checkbox'
) as HTMLInputElement;
const scopedValidationError = document.getElementById('scoped-validation-error') as HTMLElement;

const allowFallbackCheckbox = document.getElementById('allow-fallback') as HTMLInputElement;
const fallbackPolicySelect = document.getElementById('fallback-policy-select') as HTMLSelectElement;
const fallbackPolicyGroup = document.getElementById('fallback-policy-group') as HTMLElement;

const profileNameInput = document.getElementById('profile-name') as HTMLInputElement;
const profilePhoneInput = document.getElementById('profile-phone') as HTMLInputElement;
const profileEmailInput = document.getElementById('profile-email') as HTMLInputElement;
const profileIdCardInput = document.getElementById('profile-id-card') as HTMLInputElement;
const profileBirthYearInput = document.getElementById('profile-birth-year') as HTMLInputElement;
const profileGenderSelect = document.getElementById('profile-gender') as HTMLSelectElement;
const profileAddressInput = document.getElementById('profile-address') as HTMLInputElement;
const profileAgreeTermsCheckbox = document.getElementById(
  'profile-agree-terms'
) as HTMLInputElement;
const profileAllowSensitive = document.getElementById(
  'profile-allow-sensitive'
) as HTMLInputElement | null;
const btnClearPii = document.getElementById('btn-clear-pii') as HTMLButtonElement | null;

const btnArm = document.getElementById('btn-arm') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
const btnResetConfig = document.getElementById('btn-reset-config') as HTMLButtonElement;

// Scheduled ARM DOM references
const scheduledArmTimeInput = document.getElementById('scheduled-arm-time') as HTMLInputElement;
const scheduledArmStatus = document.getElementById('scheduled-arm-status') as HTMLElement;
const scheduledArmTimeDisplay = document.getElementById(
  'scheduled-arm-time-display'
) as HTMLElement;
const scheduledArmCountdown = document.getElementById(
  'scheduled-arm-countdown'
) as HTMLElement | null;
const btnCancelScheduledArm = document.getElementById(
  'btn-cancel-scheduled-arm'
) as HTMLButtonElement;

// Mode Switcher DOM references
const tabModeBasic = document.getElementById('tab-mode-basic') as HTMLButtonElement | null;
const tabModeHardcore = document.getElementById('tab-mode-hardcore') as HTMLButtonElement | null;
const panelBasic = document.getElementById('panel-basic') as HTMLElement | null;
const panelHardcore = document.getElementById('panel-hardcore') as HTMLElement | null;

// Basic Mode DOM references
const basicShowingGroup = document.getElementById('basic-showing-group') as HTMLElement | null;
const basicShowingSelect = document.getElementById(
  'basic-showing-select'
) as HTMLSelectElement | null;
const basicTicketChecklist = document.getElementById(
  'basic-ticket-checklist'
) as HTMLElement | null;
const basicQuantityInput = document.getElementById('basic-quantity') as HTMLInputElement | null;
const basicScheduledArmTime = document.getElementById(
  'basic-scheduled-arm-time'
) as HTMLInputElement | null;
const basicScheduledStatus = document.getElementById(
  'basic-scheduled-status'
) as HTMLElement | null;
const basicScheduledTimeDisplay = document.getElementById(
  'basic-scheduled-time-display'
) as HTMLElement | null;
const basicScheduledCountdown = document.getElementById(
  'basic-scheduled-countdown'
) as HTMLElement | null;
const btnCancelBasicScheduled = document.getElementById(
  'btn-cancel-basic-scheduled'
) as HTMLButtonElement | null;
const basicProfileName = document.getElementById('basic-profile-name') as HTMLInputElement | null;
const basicProfilePhone = document.getElementById('basic-profile-phone') as HTMLInputElement | null;
const basicProfileEmail = document.getElementById('basic-profile-email') as HTMLInputElement | null;
const basicProfileIdCard = document.getElementById(
  'basic-profile-id-card'
) as HTMLInputElement | null;
const basicProfileAgreeTerms = document.getElementById(
  'basic-profile-agree-terms'
) as HTMLInputElement | null;
const basicProfileAllowSensitive = document.getElementById(
  'basic-profile-allow-sensitive'
) as HTMLInputElement | null;
const btnBasicClearPii = document.getElementById('btn-basic-clear-pii') as HTMLButtonElement | null;
const btnBasicArm = document.getElementById('btn-basic-arm') as HTMLButtonElement | null;
const btnBasicStop = document.getElementById('btn-basic-stop') as HTMLButtonElement | null;
const btnBasicReset = document.getElementById('btn-basic-reset') as HTMLButtonElement | null;
const btnBasicSelectAll = document.getElementById(
  'btn-basic-select-all'
) as HTMLButtonElement | null;
const btnBasicDeselectAll = document.getElementById(
  'btn-basic-deselect-all'
) as HTMLButtonElement | null;

const interventionBanner = document.getElementById('intervention-banner') as HTMLElement | null;
const btnInterventionResume = document.getElementById(
  'btn-intervention-resume'
) as HTMLButtonElement | null;

const ticketsTbody = document.getElementById('tickets-tbody') as HTMLElement;

const matrixRenderer = new PopupMatrixRenderer({
  ticketsBody: ticketsTbody,
  emptyState: matrixEmpty,
  tableWrapper: matrixTableWrapper,
  matrixBody: scopedMatrixTbody,
  getScopedPlan: () => currentScopedPlan,
  formatPrice,
  onMatrixChange: () => {
    rebuildScopedPlanFromMatrix();
    updateScopedSummaryAndValidation();
    savePlan();
  },
});

const renderCatalogTable = (tickets: TicketOption[]): void =>
  matrixRenderer.renderCatalogTable(tickets);
const renderScopedMatrix = (snapshot: TicketCatalogSnapshot): void =>
  matrixRenderer.renderScopedMatrix(snapshot);

const selTicket = document.getElementById('sel-ticket') as HTMLElement;
const selMode = document.getElementById('sel-mode') as HTMLElement;
const selArea = document.getElementById('sel-area') as HTMLElement;
const selSeats = document.getElementById('sel-seats') as HTMLElement;
const selQty = document.getElementById('sel-qty') as HTMLElement;

const sumSubtotal = document.getElementById('sum-subtotal') as HTMLElement;
const sumFees = document.getElementById('sum-fees') as HTMLElement;
const sumTotal = document.getElementById('sum-total') as HTMLElement;

const attemptIdDisplay = document.getElementById('attempt-id-display') as HTMLElement;
const logBox = document.getElementById('log-box') as HTMLElement;
const metricT1 = document.getElementById('metric-t1') as HTMLElement;
const metricT2 = document.getElementById('metric-t2') as HTMLElement;
const metricT3 = document.getElementById('metric-t3') as HTMLElement;
const metricT5 = document.getElementById('metric-t5') as HTMLElement;
const metricDelta = document.getElementById('metric-delta') as HTMLElement | null;
const metricOffset = document.getElementById('metric-offset') as HTMLElement | null;

const stateView = new PopupStateView({
  stateBadge,
  currentStepDisplay,
  blockingReasonContainer,
  blockingReasonText,
  interventionBanner,
  armButtons: [btnArm, btnBasicArm],
});

const configView = new PopupConfigView({
  ticketRulesContainer,
  showingSelect,
  allowFallbackCheckbox,
  fallbackPolicySelect,
  matrixBody: scopedMatrixTbody,
  quantityInput: scopedQuantityInput,
  strategySelect: scopedStrategySelect,
  durationInput: paramDurationInput,
  attemptsInput: paramAttemptsInput,
  pollIntervalInput: paramPollIntervalInput,
  jitterInput: paramJitterInput,
  allowPartialCheckbox: paramAllowPartialCheckbox,
  maxPriceInput: paramMaxPricePerTicketInput,
  maxTotalInput: paramMaxTotalInput,
  summaryBox: scopedSummaryBox,
  summaryAllowed,
  summaryDisallowed,
  validationError: scopedValidationError,
  getCatalog: () => currentCatalog,
  getPurchasePlan: () => currentPlan,
  setPurchasePlan: (plan) => {
    currentPlan = plan;
  },
  getPlan: () => currentScopedPlan,
  setPlan: (plan) => {
    currentScopedPlan = plan;
  },
  onPlanChange: () => savePlan(),
});

// ─── Utility ──────────────────────────────────────────────────────────────────

const MAX_LOG_LINES = 50;

function addLog(text: string, save = true): void {
  const line = document.createElement('div');
  const time = new Date().toLocaleTimeString();
  line.textContent = `[${time}] ${text}`;
  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;

  if (save && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get('ticketbox_recent_logs', (res) => {
      const logs: string[] = Array.isArray(res?.ticketbox_recent_logs)
        ? res.ticketbox_recent_logs
        : [];
      logs.push(`[${time}] ${text}`);
      if (logs.length > MAX_LOG_LINES) logs.splice(0, logs.length - MAX_LOG_LINES);
      chrome.storage.local.set({ ticketbox_recent_logs: logs });
    });
  }
}

function updateTelemetry(
  t1?: number,
  t2?: number,
  t3?: number,
  t5?: number,
  delta?: number,
  offset?: number
): void {
  if (t1 !== undefined && metricT1) metricT1.textContent = `${t1}ms`;
  if (t2 !== undefined && metricT2) metricT2.textContent = `${t2}ms`;
  if (t3 !== undefined && metricT3) metricT3.textContent = `${t3}ms`;
  if (t5 !== undefined && metricT5) metricT5.textContent = `${t5}ms`;
  if (delta !== undefined && metricDelta)
    metricDelta.textContent = `${delta > 0 ? '+' : ''}${delta}ms`;
  if (offset !== undefined && metricOffset)
    metricOffset.textContent = `${offset > 0 ? '+' : ''}${offset}ms`;
}

function formatPrice(price: number): string {
  return price > 0 ? `${price.toLocaleString('vi-VN')} đ` : 'Free';
}

// ─── Catalog Status UI ────────────────────────────────────────────────────────

function updateCatalogStatus(snapshot: TicketCatalogSnapshot): void {
  catalogStatusEl.className = 'catalog-status';

  switch (snapshot.loadState) {
    case 'IDLE':
      catalogStatusIcon.textContent = '⌛';
      catalogStatusText.textContent = snapshot.loadMessage;
      break;
    case 'LOADING':
      catalogStatusEl.classList.add('loading');
      catalogStatusIcon.textContent = '🔄';
      catalogStatusText.textContent = 'Discovering tickets...';
      break;
    case 'LOADED':
      catalogStatusEl.classList.add('loaded');
      catalogStatusIcon.textContent = '✓';
      catalogStatusText.textContent = snapshot.loadMessage;
      break;
    case 'EMPTY':
      catalogStatusEl.classList.add('empty');
      catalogStatusIcon.textContent = '○';
      catalogStatusText.textContent = snapshot.loadMessage || 'No ticket options detected.';
      break;
    case 'ERROR':
      catalogStatusEl.classList.add('error');
      catalogStatusIcon.textContent = '✗';
      catalogStatusText.textContent = snapshot.loadMessage || 'Unable to discover ticket options.';
      break;
    case 'INVALID_URL':
      catalogStatusEl.classList.add('error');
      catalogStatusIcon.textContent = '✗';
      catalogStatusText.textContent = 'Invalid Ticketbox event URL.';
      break;
  }

  // Event info bar
  if (snapshot.eventTitle) {
    eventInfoBar.style.display = 'block';
    eventInfoTitle.textContent = snapshot.eventTitle;
  } else {
    eventInfoBar.style.display = 'none';
  }
}

// ─── Showing Dropdown ─────────────────────────────────────────────────────────

function updateShowingDropdown(snapshot: TicketCatalogSnapshot): void {
  // Filter only genuine showings that have date, name, or valid ID
  const validShowings = (snapshot.showings || []).filter(
    (s) => (s.date && s.date.trim()) || (s.name && s.name.trim()) || (s.id && s.id.trim())
  );

  if (validShowings.length <= 1) {
    showingGroup.style.display = 'none';
    // Auto-select the single showing so ticket filtering still works
    if (validShowings.length === 1 && validShowings[0]?.id) {
      currentPlan.showingId = validShowings[0].id;
      const opt = document.createElement('option');
      opt.value = validShowings[0].id;
      opt.textContent = validShowings[0].name || validShowings[0].date || 'Suất diễn';
      showingSelect.replaceChildren(opt);
      showingSelect.value = validShowings[0].id;
    }
    return;
  }

  // If no showing selected yet, auto-select first showing with available tickets, or first showing
  if (!currentPlan.showingId && validShowings.length > 0) {
    const firstAvail =
      validShowings.find((s) => {
        const tickets =
          'tickets' in s && Array.isArray(s.tickets) ? (s.tickets as TicketOption[]) : [];
        return tickets.some((t) => t.availability === 'AVAILABLE');
      }) || validShowings[0];
    if (firstAvail?.id) {
      currentPlan.showingId = firstAvail.id;
    }
  }

  showingGroup.style.display = 'block';
  showingSelect.innerHTML = '';

  for (const s of validShowings) {
    const opt = document.createElement('option');
    opt.value = s.id ?? '';
    const showingTickets =
      'tickets' in s && Array.isArray(s.tickets) ? (s.tickets as TicketOption[]) : [];
    const availCount = showingTickets.filter((t) => t.availability === 'AVAILABLE').length;
    const availLabel =
      showingTickets.length > 0
        ? availCount > 0
          ? ` (${availCount} loại còn vé)`
          : ' (hết vé)'
        : '';
    const baseLabel = s.date || s.name || `Buổi diễn ${s.id ?? '?'}`;
    opt.textContent = baseLabel + availLabel;
    if (currentPlan.showingId === s.id) opt.selected = true;
    showingSelect.appendChild(opt);
  }
}

function onShowingChange(): void {
  currentPlan.showingId = showingSelect.value || null;
  const newTickets = getTicketsForCurrentShowing();
  // Preserve existing ticket rules by matching ticket name in the new showing
  for (const rule of currentPlan.ticketRules) {
    const match = newTickets.find((t) => t.name === rule.ticketName);
    if (match) {
      rule.ticketId = match.id ?? match.name;
    }
  }
  savePlan();
  refreshAllRuleCards();
}

// ─── Ticket Option Helpers ────────────────────────────────────────────────────

/**
 * Returns tickets relevant to the currently selected showing.
 * Falls back to all tickets when showingId is null.
 */
function getTicketsForCurrentShowing(): TicketOption[] {
  return configView.getTicketsForCurrentShowing();
}

/**
 * Generates quantity options array based on ticket constraints.
 * Defaults: min=1, max=8 when unknown.
 */
function buildQuantityOptions(ticket: TicketOption): number[] {
  return configView.buildQuantityOptions(ticket);
}

/**
 * Creates the availability suffix for an option label.
 */
function ticketOptionLabel(t: TicketOption): string {
  return configView.ticketOptionLabel(t);
}

// ─── Ticket Rule Card Builder ─────────────────────────────────────────────────

let ruleCardCounter = 0;

/**
 * Builds a ticket rule card DOM element backed by discovered catalog options.
 * All user input is select-based; no free-text ticket name entry.
 */
function buildTicketRuleCard(rule: TicketRule, ruleIndex: number): HTMLElement {
  const cardId = `rule-${ruleCardCounter++}`;
  const tickets = getTicketsForCurrentShowing();

  const card = document.createElement('div');
  card.className = 'ticket-rule-card';
  card.dataset.ruleId = cardId;

  // ── Header ──────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'ticket-rule-header';

  const ruleLabel = document.createElement('span');
  ruleLabel.className = 'ticket-rule-label';
  ruleLabel.textContent = `VÉ ${ruleIndex + 1}`;

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-remove-row';
  removeBtn.textContent = '×';
  removeBtn.title = 'Xóa loại vé này';
  removeBtn.addEventListener('click', () => {
    card.remove();
    rebuildPlanFromCards();
    savePlan();
    reindexRuleLabels();
  });

  header.appendChild(ruleLabel);
  header.appendChild(removeBtn);

  // ── Fields ───────────────────────────────────────────────────────────
  const fields = document.createElement('div');
  fields.className = 'ticket-rule-fields';

  // ── Ticket Select ───────────────────────────────────────────────────
  const ticketField = document.createElement('div');
  ticketField.className = 'field-group';

  const ticketLabel = document.createElement('div');
  ticketLabel.className = 'field-label';
  ticketLabel.textContent = 'Loại vé';

  const ticketSelect = document.createElement('select');
  ticketSelect.className = 'select-field rule-ticket-select';

  if (tickets.length === 0) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— Waiting for discovery... —';
    placeholder.disabled = true;
    placeholder.selected = true;
    ticketSelect.appendChild(placeholder);
  } else {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— Chọn loại vé —';
    placeholder.disabled = true;
    if (!rule.ticketId) placeholder.selected = true;
    ticketSelect.appendChild(placeholder);

    for (const t of tickets) {
      const opt = document.createElement('option');
      opt.value = t.id ?? t.name;
      opt.textContent = ticketOptionLabel(t);
      opt.className =
        t.availability === 'AVAILABLE'
          ? 'opt-available'
          : t.availability === 'SOLD_OUT'
            ? 'opt-soldout'
            : 'opt-unknown';
      if (!t.selectable) {
        opt.disabled = true;
      }
      if (rule.ticketId === (t.id ?? t.name) || rule.ticketName === t.name) {
        opt.selected = true;
      }
      ticketSelect.appendChild(opt);
    }
  }

  ticketField.appendChild(ticketLabel);
  ticketField.appendChild(ticketSelect);

  // ── Area Select (hidden by default, shown for AREA_BASED/SEATED) ─────
  const areaField = document.createElement('div');
  areaField.className = 'field-group rule-area-group';
  areaField.style.display = 'none';

  const areaLabel = document.createElement('div');
  areaLabel.className = 'field-label';
  areaLabel.textContent = 'Khu vực';

  const areaSelect = document.createElement('select');
  areaSelect.className = 'select-field rule-area-select';

  const areaPlaceholder = document.createElement('option');
  areaPlaceholder.value = '';
  areaPlaceholder.textContent = '— Phát hiện từ trang đặt vé —';
  areaSelect.appendChild(areaPlaceholder);

  areaField.appendChild(areaLabel);
  areaField.appendChild(areaSelect);

  // ── Quantity Select ──────────────────────────────────────────────────
  const qtyField = document.createElement('div');
  qtyField.className = 'field-group';

  const qtyLabel = document.createElement('div');
  qtyLabel.className = 'field-label';
  qtyLabel.textContent = 'Số lượng';

  const qtySelect = document.createElement('select');
  qtySelect.className = 'select-field rule-qty-select';

  // Build quantity options from selected ticket constraints
  const selectedTicket = tickets.find(
    (t) => (t.id ?? t.name) === rule.ticketId || t.name === rule.ticketName
  );
  const qtyOptions = selectedTicket ? buildQuantityOptions(selectedTicket) : [1, 2, 3, 4];
  for (const q of qtyOptions) {
    const opt = document.createElement('option');
    opt.value = String(q);
    opt.textContent = String(q);
    if (q === rule.quantity) opt.selected = true;
    qtySelect.appendChild(opt);
  }

  // Default to 1 if nothing selected
  if (!qtySelect.value || qtySelect.value === '0') {
    const firstOpt = qtySelect.querySelector('option');
    if (firstOpt) firstOpt.selected = true;
  }

  qtyField.appendChild(qtyLabel);
  qtyField.appendChild(qtySelect);

  // ── Row layout: ticket (full width) ─────────────────────────────────
  fields.appendChild(ticketField);
  fields.appendChild(areaField);
  fields.appendChild(qtyField);

  card.appendChild(header);
  card.appendChild(fields);

  // ── Status message area ──────────────────────────────────────────────
  const statusMsg = document.createElement('div');
  statusMsg.className = 'rule-status-msg';
  statusMsg.style.display = 'none';
  card.appendChild(statusMsg);

  // ── Update functions ─────────────────────────────────────────────────

  function updateAreaVisibility(): void {
    const selVal = ticketSelect.value;
    const ticket = tickets.find((t) => (t.id ?? t.name) === selVal);
    if (
      ticket &&
      (ticket.mode === 'AREA_BASED' || ticket.mode === 'SEATED') &&
      areaSelect.options.length > 1
    ) {
      areaField.style.display = 'flex';
    } else {
      areaField.style.display = 'none';
    }
  }

  function updateQtyOptions(): void {
    const selVal = ticketSelect.value;
    const ticket = tickets.find((t) => (t.id ?? t.name) === selVal);
    if (!ticket) return;

    const currentQty = parseInt(qtySelect.value, 10) || 1;
    const options = buildQuantityOptions(ticket);

    qtySelect.innerHTML = '';
    for (const q of options) {
      const opt = document.createElement('option');
      opt.value = String(q);
      opt.textContent = String(q);
      if (q === currentQty) opt.selected = true;
      qtySelect.appendChild(opt);
    }
    if (!qtySelect.value || qtySelect.value === '0') {
      const firstOpt = qtySelect.querySelector('option');
      if (firstOpt) firstOpt.selected = true;
    }
  }

  function validateCard(): void {
    const selVal = ticketSelect.value;
    if (!selVal) {
      card.classList.remove('invalid', 'unavailable');
      statusMsg.style.display = 'none';
      return;
    }
    const ticket = tickets.find((t) => (t.id ?? t.name) === selVal);
    if (!ticket) {
      card.classList.add('invalid');
      card.classList.remove('unavailable');
      statusMsg.className = 'ticket-invalid';
      statusMsg.textContent = 'Loại vé không còn trong catalog. Vui lòng chọn lại.';
      statusMsg.style.display = 'block';
      return;
    }
    card.classList.remove('invalid');
    if (ticket.availability !== 'AVAILABLE') {
      card.classList.add('unavailable');
      statusMsg.className = 'ticket-warning';
      statusMsg.textContent = `${ticket.name} hiện ${ticket.availability}. Sẽ sử dụng khi có.`;
      statusMsg.style.display = 'block';
    } else {
      card.classList.remove('unavailable');
      statusMsg.style.display = 'none';
    }
  }

  // ── Event listeners ──────────────────────────────────────────────────

  ticketSelect.addEventListener('change', () => {
    updateAreaVisibility();
    updateQtyOptions();
    validateCard();
    rebuildPlanFromCards();
    savePlan();
  });

  areaSelect.addEventListener('change', () => {
    rebuildPlanFromCards();
    savePlan();
  });

  qtySelect.addEventListener('change', () => {
    rebuildPlanFromCards();
    savePlan();
  });

  // Initialize
  updateAreaVisibility();
  validateCard();

  return card;
}

// ─── Rule Card Indexing ────────────────────────────────────────────────────────

function reindexRuleLabels(): void {
  const cards = ticketRulesContainer.querySelectorAll('.ticket-rule-card');
  cards.forEach((card, i) => {
    const label = card.querySelector('.ticket-rule-label');
    if (label) label.textContent = `VÉ ${i + 1}`;
  });
}

// ─── Plan Sync ────────────────────────────────────────────────────────────────

/**
 * Reads all rule cards and rebuilds currentPlan.ticketRules from DOM state.
 */
function rebuildPlanFromCards(): void {
  const cards = ticketRulesContainer.querySelectorAll('.ticket-rule-card');
  const tickets = getTicketsForCurrentShowing();

  const rules: TicketRule[] = [];
  for (const card of Array.from(cards)) {
    const ticketSelect = card.querySelector('.rule-ticket-select') as HTMLSelectElement;
    const areaSelect = card.querySelector('.rule-area-select') as HTMLSelectElement;
    const qtySelect = card.querySelector('.rule-qty-select') as HTMLSelectElement;

    const ticketValue = ticketSelect?.value ?? '';
    if (!ticketValue) continue;

    const ticket = tickets.find((t) => (t.id ?? t.name) === ticketValue);
    const areaValue = areaSelect?.value ?? '';
    const qtyValue = parseInt(qtySelect?.value ?? '1', 10) || 1;

    rules.push({
      ticketId: ticket?.id ?? ticketValue,
      ticketName: ticket?.name ?? ticketValue,
      quantity: qtyValue,
      areaId: areaValue || null,
      areaName: areaValue || null,
      seatPolicy: 'ANY_AVAILABLE',
    });
  }

  currentPlan.ticketRules = rules;
  currentPlan.showingId = showingSelect.value || null;
  currentPlan.allowFallback = allowFallbackCheckbox.checked;
  currentPlan.fallbackPolicy = (fallbackPolicySelect.value as FallbackPolicy) || 'NEXT_PRIORITY';
}

/**
 * Re-renders all existing rule cards when catalog updates.
 * Preserves user selections where possible (match by ticketId or name).
 */
function refreshAllRuleCards(): void {
  const existingRules = [...currentPlan.ticketRules];
  ticketRulesContainer.innerHTML = '';

  if (existingRules.length === 0) {
    // Add a blank rule ready to fill
    addTicketRuleRow({ ticketId: '', ticketName: '', quantity: 1 });
    return;
  }

  existingRules.forEach((rule, idx) => {
    const card = buildTicketRuleCard(rule, idx);
    ticketRulesContainer.appendChild(card);
  });

  reindexRuleLabels();
}

/**
 * Adds a new empty ticket rule row to the purchase plan.
 */
function addTicketRuleRow(rule?: Partial<TicketRule>): void {
  const newRule: TicketRule = {
    ticketId: rule?.ticketId ?? '',
    ticketName: rule?.ticketName ?? '',
    quantity: rule?.quantity ?? 1,
    areaId: rule?.areaId ?? null,
    seatPolicy: 'ANY_AVAILABLE',
  };

  const ruleIndex = ticketRulesContainer.querySelectorAll('.ticket-rule-card').length;
  const card = buildTicketRuleCard(newRule, ruleIndex);
  ticketRulesContainer.appendChild(card);
  reindexRuleLabels();
}

// ─── Catalog Table Rendering ──────────────────────────────────────────────────

// ─── Scoped Matrix UI Functions ───────────────────────────────────────────────

function rebuildScopedPlanFromMatrix(): ScopedPurchasePlan {
  return configView.rebuildScopedPlanFromMatrix();
}

function updateScopedSummaryAndValidation(): void {
  configView.updateScopedSummaryAndValidation();
}

// ─── Mode Switcher & Basic Panel Logic ───────────────────────────────────────

function switchUiMode(mode: 'basic' | 'hardcore'): void {
  if (tabModeBasic && tabModeHardcore && panelBasic && panelHardcore) {
    if (mode === 'basic') {
      tabModeBasic.classList.add('active');
      tabModeHardcore.classList.remove('active');
      panelBasic.style.display = 'flex';
      panelHardcore.style.display = 'none';
      syncProfileFields('basic');
    } else {
      tabModeHardcore.classList.add('active');
      tabModeBasic.classList.remove('active');
      panelHardcore.style.display = 'block';
      panelBasic.style.display = 'none';
      syncProfileFields('hardcore');
    }
  }
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ ui_mode: mode });
  }
}

function syncProfileFields(toMode: 'basic' | 'hardcore'): void {
  if (toMode === 'basic') {
    if (basicProfileName && profileNameInput && profileNameInput.value) {
      basicProfileName.value = profileNameInput.value;
    }
    if (basicProfilePhone && profilePhoneInput && profilePhoneInput.value) {
      basicProfilePhone.value = profilePhoneInput.value;
    }
    if (basicProfileEmail && profileEmailInput && profileEmailInput.value) {
      basicProfileEmail.value = profileEmailInput.value;
    }
    if (basicProfileIdCard && profileIdCardInput && profileIdCardInput.value) {
      basicProfileIdCard.value = profileIdCardInput.value;
    }
    if (basicProfileAgreeTerms && profileAgreeTermsCheckbox) {
      basicProfileAgreeTerms.checked = profileAgreeTermsCheckbox.checked;
    }
    if (basicProfileAllowSensitive && profileAllowSensitive) {
      basicProfileAllowSensitive.checked = profileAllowSensitive.checked;
    }
  } else {
    if (basicProfileName && profileNameInput && basicProfileName.value) {
      profileNameInput.value = basicProfileName.value;
    }
    if (basicProfilePhone && profilePhoneInput && basicProfilePhone.value) {
      profilePhoneInput.value = basicProfilePhone.value;
    }
    if (basicProfileEmail && profileEmailInput && basicProfileEmail.value) {
      profileEmailInput.value = basicProfileEmail.value;
    }
    if (basicProfileIdCard && profileIdCardInput && basicProfileIdCard.value) {
      profileIdCardInput.value = basicProfileIdCard.value;
    }
    if (basicProfileAgreeTerms && profileAgreeTermsCheckbox) {
      profileAgreeTermsCheckbox.checked = basicProfileAgreeTerms.checked;
    }
    if (basicProfileAllowSensitive && profileAllowSensitive) {
      profileAllowSensitive.checked = basicProfileAllowSensitive.checked;
    }
  }
}

function renderBasicTicketChecklist(snapshot?: TicketCatalogSnapshot): void {
  if (!basicTicketChecklist) return;
  const current = snapshot || currentCatalog;
  const tickets = current.tickets;

  if (!tickets || tickets.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'empty-cell';
    emptyDiv.style.cssText = 'padding: 12px; text-align: center; color: var(--text-muted);';
    emptyDiv.textContent =
      'Chưa phát hiện vé. Vui lòng mở trang sự kiện trên trình duyệt rồi bấm nút ↺ ở trên.';
    basicTicketChecklist.replaceChildren(emptyDiv);
    return;
  }

  // Update showings in basic mode
  if (current.showings && current.showings.length > 0 && basicShowingSelect) {
    basicShowingSelect.replaceChildren(
      ...current.showings.map((s) => {
        const opt = document.createElement('option');
        opt.value = s.id || '';
        opt.textContent = s.name || s.id || '';
        return opt;
      })
    );
    if (showingSelect.value) {
      basicShowingSelect.value = showingSelect.value;
    } else if (current.showings[0]?.id) {
      basicShowingSelect.value = current.showings[0].id;
    }

    if (current.showings.length > 1) {
      if (basicShowingGroup) basicShowingGroup.style.display = 'block';
    } else if (basicShowingGroup) {
      basicShowingGroup.style.display = 'none';
    }
  } else if (basicShowingGroup) {
    basicShowingGroup.style.display = 'none';
  }

  basicTicketChecklist.replaceChildren();

  // Check if user previously had saved selections
  const savedTicketIds = new Set<string>();
  if (currentScopedPlan?.targets) {
    for (const target of currentScopedPlan.targets) {
      for (const id of target.ticketTypeIds) {
        savedTicketIds.add(id);
      }
    }
  }
  const hasSavedSelection = savedTicketIds.size > 0;

  tickets.forEach((ticket, idx) => {
    const item = document.createElement('div');
    const ticketId = ticket.id ?? ticket.name;
    const isAvail = ticket.availability !== 'SOLD_OUT';

    // Default: If user already saved a plan, respect it. Otherwise, only select the FIRST available ticket!
    const isChecked = hasSavedSelection
      ? (savedTicketIds.has(ticketId) || savedTicketIds.has(ticket.name)) && isAvail
      : idx === 0 && isAvail;

    item.className = `basic-ticket-item ${isChecked ? 'selected' : ''}`;
    item.dataset.ticketId = ticketId;
    item.dataset.ticketName = ticket.name;

    let badgeClass = 'badge-avail';
    let badgeText = 'Còn vé';
    if (ticket.availability === 'SOLD_OUT') {
      badgeClass = 'badge-sold';
      badgeText = 'Hết vé';
    } else if (ticket.availability === 'NOT_STARTED') {
      badgeClass = 'badge-pending';
      badgeText = 'Sắp mở';
    }

    const priceFormatted = ticket.price ? `${formatPrice(ticket.price)}` : 'Chưa có giá';

    const leftDiv = document.createElement('div');
    leftDiv.className = 'basic-ticket-left';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'basic-ticket-cb';
    cb.checked = isChecked;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'basic-ticket-name';
    nameSpan.title = ticket.name;
    nameSpan.textContent = ticket.name;

    leftDiv.append(cb, nameSpan);

    const rightDiv = document.createElement('div');
    rightDiv.className = 'basic-ticket-right';

    const priceSpan = document.createElement('span');
    priceSpan.className = 'basic-ticket-price';
    priceSpan.textContent = priceFormatted;

    const badgeSpan = document.createElement('span');
    badgeSpan.className = `basic-ticket-badge ${badgeClass}`;
    badgeSpan.textContent = badgeText;

    rightDiv.append(priceSpan, badgeSpan);

    item.replaceChildren(leftDiv, rightDiv);

    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      if (cb.checked) {
        item.classList.add('selected');
      } else {
        item.classList.remove('selected');
      }
      syncBasicChecklistToScopedPlan();
      savePlan();
    });

    item.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).tagName !== 'INPUT') {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      }
    });

    basicTicketChecklist.appendChild(item);
  });
}

function syncBasicChecklistToScopedPlan(): void {
  const checkedItems = basicTicketChecklist?.querySelectorAll('.basic-ticket-item') ?? [];
  const selectedTicketIds: string[] = [];
  checkedItems.forEach((item) => {
    const cb = item.querySelector('.basic-ticket-cb') as HTMLInputElement | null;
    if (cb && cb.checked) {
      const name = (item as HTMLElement).dataset.ticketName;
      const id = (item as HTMLElement).dataset.ticketId;
      if (id && !selectedTicketIds.includes(id)) selectedTicketIds.push(id);
      if (name && !selectedTicketIds.includes(name)) selectedTicketIds.push(name);
    }
  });

  const quantity = Math.max(1, parseInt(basicQuantityInput?.value || '1', 10) || 1);
  const showingId =
    basicShowingSelect?.value ||
    showingSelect?.value ||
    currentPlan.showingId ||
    currentCatalog.showings?.[0]?.id ||
    'default';

  const scheduledVal = basicScheduledArmTime?.value;
  let startAt: string | undefined = undefined;
  if (scheduledVal) {
    const startMs = new Date(scheduledVal).getTime();
    if (startMs > Date.now()) {
      startAt = new Date(startMs).toISOString();
    }
  }

  currentScopedPlan = {
    ...currentScopedPlan,
    eventId: currentCatalog.eventId || currentScopedPlan?.eventId || 'event',
    targets: [
      {
        showingId,
        ticketTypeIds: selectedTicketIds,
        rank: 1,
      },
    ],
    quantity,
    strategy: 'BY_TARGET_ORDER',
    allowPartialQuantity: false,
    persistence: {
      ...currentScopedPlan?.persistence,
      maxDurationMinutes: currentScopedPlan?.persistence?.maxDurationMinutes ?? 120,
      maxAttempts: currentScopedPlan?.persistence?.maxAttempts ?? 1000,
      pollIntervalMs: currentScopedPlan?.persistence?.pollIntervalMs ?? 1800,
      jitterRatio: 0.2,
      startAt,
    },
  };
}

let isArmingInProgress = false;

async function handleBasicArm(): Promise<void> {
  if (isArmingInProgress) return;
  isArmingInProgress = true;
  try {
    if (btnBasicArm?.classList.contains('running-active')) {
      btnStop.click();
      return;
    }
    const url = eventUrlInput.value.trim();
    if (!url) {
      alert('Vui lòng nhập hoặc mở URL sự kiện Ticketbox!');
      return;
    }

    // Get checked tickets from basicTicketChecklist
    const checkedItems = basicTicketChecklist?.querySelectorAll('.basic-ticket-item') ?? [];
    const selectedTicketIds: string[] = [];
    checkedItems.forEach((item) => {
      const cb = item.querySelector('.basic-ticket-cb') as HTMLInputElement | null;
      if (cb && cb.checked) {
        const name = (item as HTMLElement).dataset.ticketName;
        const id = (item as HTMLElement).dataset.ticketId;
        if (id && !selectedTicketIds.includes(id)) selectedTicketIds.push(id);
        if (name && !selectedTicketIds.includes(name)) selectedTicketIds.push(name);
      }
    });

    if (selectedTicketIds.length === 0) {
      alert(
        'ARM bị chặn: Bạn chưa tick chọn hạng vé nào!\n\nVui lòng tick chọn ít nhất một hạng vé muốn mua trong danh sách.'
      );
      return;
    }

    const quantity = Math.max(1, parseInt(basicQuantityInput?.value || '1', 10) || 1);
    const showingId =
      basicShowingSelect?.value ||
      showingSelect?.value ||
      currentPlan.showingId ||
      currentCatalog.showings?.[0]?.id ||
      'default';

    // Construct standard ScopedPurchasePlan
    const plan: ScopedPurchasePlan = {
      eventId: currentCatalog.eventId || 'event',
      targets: [
        {
          showingId,
          ticketTypeIds: selectedTicketIds,
          rank: 1,
        },
      ],
      quantity,
      strategy: 'BY_TARGET_ORDER',
      allowPartialQuantity: false,
      persistence: {
        maxDurationMinutes: 120,
        maxAttempts: 1000,
        pollIntervalMs: 1800,
        jitterRatio: 0.2,
      },
    };

    // Check scheduled time
    const scheduledVal = basicScheduledArmTime?.value;
    let isScheduled = false;
    if (scheduledVal) {
      const startMs = new Date(scheduledVal).getTime();
      if (startMs > Date.now()) {
        isScheduled = true;
        activeScheduledTargetMs = startMs;
        const startAtIso = new Date(startMs).toISOString();
        plan.persistence.startAt = startAtIso;
        if (basicScheduledStatus && basicScheduledTimeDisplay) {
          basicScheduledStatus.style.display = 'flex';
          basicScheduledTimeDisplay.textContent = new Date(startMs).toLocaleString('vi-VN');
          if (basicScheduledCountdown) {
            const remainingMs = Math.max(0, startMs - Date.now());
            basicScheduledCountdown.textContent = `(Còn lại ${formatCountdown(remainingMs)})`;
            basicScheduledCountdown.style.display = 'inline-flex';
          }
        }
      } else {
        alert('Thời gian hẹn giờ mở bán phải ở thời điểm tương lai!');
        return;
      }
    }

    currentScopedPlan = plan;
    // Sync profile
    syncProfileFields('hardcore');
    await savePlan();

    const userProfile = buildUserProfileFromInputs(
      {
        nameInput: basicProfileName,
        phoneInput: basicProfilePhone,
        emailInput: basicProfileEmail,
        idCardInput: basicProfileIdCard,
        agreeTermsCheckbox: basicProfileAgreeTerms,
        allowSensitiveCheckbox: basicProfileAllowSensitive,
      },
      {
        nameInput: profileNameInput,
        phoneInput: profilePhoneInput,
        emailInput: profileEmailInput,
        idCardInput: profileIdCardInput,
        agreeTermsCheckbox: profileAgreeTermsCheckbox,
        allowSensitiveCheckbox: profileAllowSensitive,
      }
    );

    if (isScheduled) {
      addLog(
        `⏰ [CƠ BẢN] Đã hẹn giờ ARM vào: ${new Date(plan.persistence.startAt!).toLocaleString('vi-VN')}. Đến giờ sẽ tự động mở tab săn vé!`
      );
      alert(
        `Đã đặt lịch hẹn ARM thành công!\n\n• Thời gian: ${new Date(plan.persistence.startAt!).toLocaleString('vi-VN')}\n• Hạng vé: ${selectedTicketIds.join(', ')}\n• Số lượng: ${quantity} vé.\n\nĐến giờ mở bán, trợ lý sẽ tự động đưa tab Ticketbox lên và săn vé!`
      );
    } else {
      updateStateBadge(PurchaseState.ARMED);
      addLog(`🚀 [CƠ BẢN] Đã ARM săn vé: ${selectedTicketIds.join(', ')} (${quantity} vé)...`);
    }

    const targetTab = await findTicketboxTab();
    const targetTabId = targetTab?.id;
    const eventId = plan.eventId || extractEventIdFromUrl(url) || undefined;

    await messageBus.publish({
      type: 'ARM_REQUESTED',
      timestamp: new Date().toISOString(),
      eventUrl: url,
      categoryPriority: selectedTicketIds,
      quantity,
      allowFallback: false,
      scopedPurchasePlan: plan,
      userProfile,
      targetTabId,
      eventId,
      targetEventId: eventId,
    });
  } finally {
    isArmingInProgress = false;
  }
}

// ─── Catalog Update Handler ───────────────────────────────────────────────────

let lastLoggedCatalogSignature = '';
let lastLoggedDiscoveryKey = '';

function applyNewCatalog(snapshot: TicketCatalogSnapshot): void {
  const prevTicketCount = currentCatalog.tickets.length;
  currentCatalog = snapshot;

  updateCatalogStatus(snapshot);
  updateShowingDropdown(snapshot);
  renderCatalogTable(snapshot.tickets);

  // Render Basic Checklist
  renderBasicTicketChecklist(snapshot);

  // Render Scoped Matrix
  renderScopedMatrix(snapshot);
  updateScopedSummaryAndValidation();

  // Only refresh rule cards if tickets actually changed to avoid losing focus
  const newCount = snapshot.tickets.length;
  if (newCount !== prevTicketCount || prevTicketCount === 0) {
    refreshAllRuleCards();
  } else {
    validateAllRuleCards();
  }

  const signature = `${newCount}_${snapshot.tickets.map((t) => `${t.name}_${t.price}_${t.availability}`).join('|')}_${snapshot.loadMessage}`;
  if (signature !== lastLoggedCatalogSignature) {
    lastLoggedCatalogSignature = signature;
    addLog(
      `Catalog updated: ${newCount} ticket${newCount !== 1 ? 's' : ''} — ${snapshot.loadMessage}`
    );
  }
}

/**
 * Validates all rule cards against the current catalog without rebuilding them.
 * Marks invalid/unavailable cards visually.
 */
function validateAllRuleCards(): void {
  const validation = PurchasePlanValidator.validate(currentPlan, currentCatalog.tickets);

  const cards = Array.from(ticketRulesContainer.querySelectorAll('.ticket-rule-card'));
  cards.forEach((card, i) => {
    card.classList.remove('invalid', 'unavailable');
    const statusMsg = card.querySelector('.rule-status-msg') as HTMLElement | null;
    if (!statusMsg) return;

    if (validation.invalidRuleIndices.includes(i)) {
      card.classList.add('invalid');
      statusMsg.className = 'ticket-invalid';
      statusMsg.textContent = 'Vé đã chọn không còn trong catalog. Vui lòng chọn lại.';
      statusMsg.style.display = 'block';
    } else if (validation.unavailableRuleIndices.includes(i)) {
      card.classList.add('unavailable');
      statusMsg.className = 'ticket-warning';
      const rule = currentPlan.ticketRules[i];
      statusMsg.textContent = rule
        ? `${rule.ticketName} hiện không khả dụng. Sẽ thử theo fallback policy.`
        : 'Vé không khả dụng.';
      statusMsg.style.display = 'block';
    } else {
      statusMsg.style.display = 'none';
    }
  });
}

// ─── State Badge ───────────────────────────────────────────────────────────────

function updateStateBadge(state: PurchaseState, blockingReason?: string): void {
  stateView.update(state, blockingReason);
}

async function updatePersistentMonitoringDisplay(
  pStateParam?: PersistentExecutionState | null
): Promise<void> {
  let pState = pStateParam;
  if (pState === undefined) {
    pState = await storage.getPersistentState();
  }

  const maxAttempts = currentScopedPlan.persistence?.maxAttempts ?? 200;
  const maxDuration = currentScopedPlan.persistence?.maxDurationMinutes ?? 30;

  if (persistentTargetDisplay) {
    if (typeof pState?.lastTarget === 'object' && pState.lastTarget) {
      persistentTargetDisplay.textContent = `[${pState.lastTarget.showingId}] ${pState.lastTarget.ticketName ?? pState.lastTarget.ticketTypeId}`;
    } else if (typeof pState?.lastTarget === 'string') {
      persistentTargetDisplay.textContent = pState.lastTarget;
    } else {
      persistentTargetDisplay.textContent = '-';
    }
  }

  const attemptsCapStr = maxAttempts > 0 ? `${maxAttempts}` : '∞';
  if (persistentAttemptsDisplay) {
    persistentAttemptsDisplay.textContent = `${pState?.attemptsCount ?? 0} / ${attemptsCapStr}`;
  }

  const durationCapStr = maxDuration > 0 ? `${maxDuration}m` : '∞';

  // Clear the live timer when monitoring is stopped/completed — even if startedAt still exists in storage.
  const stoppedPhases = new Set(['STOPPED', 'STOPPED_LIMIT_REACHED', 'CONFIRMED', 'FAILED']);
  if (pState?.startedAt && !stoppedPhases.has(pState?.currentPhase ?? '')) {
    activeStartedAtMs =
      typeof pState.startedAt === 'number'
        ? pState.startedAt
        : new Date(pState.startedAt).getTime();
  } else {
    activeStartedAtMs = null;
  }

  if (persistentElapsedDisplay) {
    if (activeStartedAtMs) {
      const elapsedMs = Math.max(0, Date.now() - activeStartedAtMs);
      persistentElapsedDisplay.textContent = `${formatElapsed(elapsedMs)} / ${durationCapStr}`;
    } else {
      persistentElapsedDisplay.textContent = `00:00 / ${durationCapStr}`;
    }
  }

  if (persistentStopReasonRow && persistentStopReasonDisplay) {
    if (pState?.stopReason) {
      persistentStopReasonRow.style.display = 'flex';
      persistentStopReasonDisplay.textContent = pState.stopReason;
    } else {
      persistentStopReasonRow.style.display = 'none';
    }
  }

  if (tabHiddenBanner) {
    tabHiddenBanner.style.display = pState?.tabHiddenWarning ? 'block' : 'none';
  }
}

// ─── Persistence ───────────────────────────────────────────────────────────────

async function savePlan(): Promise<void> {
  rebuildPlanFromCards();
  const config = await storage.getConfiguration();
  const targetUrl = eventUrlInput.value.trim() || config?.targetEventUrl || '';
  const scheduledArmAt = currentScopedPlan?.persistence?.startAt || config?.scheduledArmAt;
  const ticketCatalogSnapshot =
    currentCatalog.tickets.length > 0 ? currentCatalog : config?.ticketCatalogSnapshot;

  await storage.saveConfiguration({
    targetEventUrl: targetUrl,
    discoveryMode: false,
    purchasePlan: currentPlan,
    scopedPurchasePlan: currentScopedPlan,
    ...(scheduledArmAt ? { scheduledArmAt } : {}),
    ...(ticketCatalogSnapshot ? { ticketCatalogSnapshot } : {}),
    userProfile: buildUserProfileFromInputs(
      {
        nameInput: profileNameInput,
        phoneInput: profilePhoneInput,
        emailInput: profileEmailInput,
        idCardInput: profileIdCardInput,
        agreeTermsCheckbox: profileAgreeTermsCheckbox,
        allowSensitiveCheckbox: profileAllowSensitive,
        birthYearInput: profileBirthYearInput,
        genderSelect: profileGenderSelect,
        addressInput: profileAddressInput,
      },
      {
        nameInput: basicProfileName,
        phoneInput: basicProfilePhone,
        emailInput: basicProfileEmail,
        idCardInput: basicProfileIdCard,
        agreeTermsCheckbox: basicProfileAgreeTerms,
        allowSensitiveCheckbox: basicProfileAllowSensitive,
      }
    ),
    // Keep legacy preferences for backward compat with ARM_REQUESTED
    preferences: {
      categoryPriority: currentPlan.ticketRules.map((r) => r.ticketName).filter(Boolean),
      quantity: currentPlan.ticketRules[0]?.quantity ?? 1,
      allowFallback: currentPlan.allowFallback,
    },
  });
}

// ─── Tab Discovery & Connection ──────────────────────────────────────────────

/**
 * Finds the most relevant Ticketbox tab:
 * 1. Current active tab if it's on ticketbox.vn
 * 2. Any open tab whose URL matches eventUrlInput
 * 3. Any open tab on ticketbox.vn
 */
async function findTicketboxTab(): Promise<chrome.tabs.Tab | null> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) {
      resolve(null);
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
      const active = activeTabs[0];
      if (active?.url && active.url.includes('ticketbox.vn')) {
        resolve(active);
        return;
      }

      // If active tab is not ticketbox, search all tabs
      chrome.tabs.query({ url: '*://*.ticketbox.vn/*' }, (tbTabs) => {
        if (!tbTabs || tbTabs.length === 0) {
          resolve(null);
          return;
        }

        const inputUrl = eventUrlInput.value.trim().toLowerCase();
        if (inputUrl) {
          const cleanInput = inputUrl.split('?')[0]!;
          const exactMatch = tbTabs.find((t) => t.url && t.url.toLowerCase().includes(cleanInput));
          if (exactMatch) {
            resolve(exactMatch);
            return;
          }
        }

        resolve(tbTabs[0] || null);
      });
    });
  });
}

/**
 * Triggers a discovery scan on the target Ticketbox tab.
 * If the content script is detached or not yet loaded, dynamically injects content.js!
 */
async function requestDiscoveryFromTab(manual = false): Promise<void> {
  const tab = await findTicketboxTab();

  if (!tab || !tab.id) {
    if (manual) {
      const url = eventUrlInput.value.trim();
      if (url && url.startsWith('http')) {
        addLog(`Đang mở tab Ticketbox mới: ${url}`);
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
          chrome.tabs.create({ url });
        }
      } else {
        updateCatalogStatus({
          ...currentCatalog,
          loadState: 'ERROR',
          loadMessage: 'Chưa mở trang Ticketbox. Vui lòng mở trang sự kiện trên trình duyệt.',
        });
        addLog('Không tìm thấy tab Ticketbox nào đang mở.');
      }
    }
    return;
  }

  const tabId = tab.id;

  // Auto-populate URL if input is empty
  if (tab.url && !eventUrlInput.value) {
    eventUrlInput.value = tab.url;
  }

  updateCatalogStatus({
    ...currentCatalog,
    loadState: 'LOADING',
    loadMessage: 'Đang kết nối và quét thông tin vé...',
  });

  chrome.tabs.sendMessage(
    tabId,
    { type: 'REQUEST_DISCOVERY_SCAN', timestamp: new Date().toISOString() },
    async () => {
      if (chrome.runtime.lastError) {
        addLog('Content script chưa sẵn sàng. Đang tự động nạp content.js vào tab...');

        // Try injecting content.js dynamically
        if (typeof chrome !== 'undefined' && chrome.scripting && chrome.scripting.executeScript) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId },
              files: ['content.js'],
            });
            addLog('Đã nạp content.js vào tab thành công. Đang quét lại...');
            setTimeout(() => {
              chrome.tabs.sendMessage(
                tabId,
                { type: 'REQUEST_DISCOVERY_SCAN', timestamp: new Date().toISOString() },
                () => {
                  if (chrome.runtime.lastError) {
                    updateCatalogStatus({
                      ...currentCatalog,
                      loadState: 'ERROR',
                      loadMessage: 'Vui lòng nhấn F5 tại tab Ticketbox để kích hoạt.',
                    });
                  }
                }
              );
            }, 400);
            return;
          } catch (injectErr) {
            addLog(`Không thể tự động nạp content script: ${injectErr}`);
          }
        }

        updateCatalogStatus({
          ...currentCatalog,
          loadState: 'ERROR',
          loadMessage: 'Vui lòng nhấn F5 (Tải lại) tab Ticketbox để kích hoạt.',
        });
      } else {
        addLog('Đã gửi yêu cầu quét vé tới tab Ticketbox.');
      }
    }
  );
}

// ─── Scheduled ARM Helpers ────────────────────────────────────────────────────

function formatElapsed(elapsedMs: number): string {
  const totalSec = Math.max(0, Math.floor(elapsedMs / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (min >= 60) {
    const hr = Math.floor(min / 60);
    const remMin = min % 60;
    return `${pad(hr)}:${pad(remMin)}:${pad(sec)}`;
  }
  return `${pad(min)}:${pad(sec)}`;
}

function formatCountdown(remainingMs: number): string {
  if (remainingMs <= 0) return '00:00:00';
  const totalSec = Math.floor(remainingMs / 1000);
  const hr = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hr)}:${pad(min)}:${pad(sec)}`;
}

let activeStartedAtMs: number | null = null;
let activeScheduledTargetMs: number | null = null;
let liveTimerInterval: number | null = null;

function updateLiveTimes(): void {
  const maxDuration = currentScopedPlan?.persistence?.maxDurationMinutes ?? 30;
  const durationCapStr = maxDuration > 0 ? `${maxDuration}m` : '∞';

  // 1. Live elapsed time ticker
  if (persistentElapsedDisplay && activeStartedAtMs) {
    const elapsedMs = Math.max(0, Date.now() - activeStartedAtMs);
    persistentElapsedDisplay.textContent = `${formatElapsed(elapsedMs)} / ${durationCapStr}`;
  }

  // 2. Live scheduled countdown ticker
  if (activeScheduledTargetMs) {
    const remainingMs = activeScheduledTargetMs - Date.now();
    if (remainingMs > 0) {
      const cdStr = `(Còn lại ${formatCountdown(remainingMs)})`;
      if (scheduledArmCountdown) {
        scheduledArmCountdown.textContent = cdStr;
        scheduledArmCountdown.style.display = 'inline-flex';
      }
      if (basicScheduledCountdown) {
        basicScheduledCountdown.textContent = cdStr;
        basicScheduledCountdown.style.display = 'inline-flex';
      }
    } else {
      const activatingStr = '(Đang kích hoạt...)';
      if (scheduledArmCountdown) {
        scheduledArmCountdown.textContent = activatingStr;
        scheduledArmCountdown.style.display = 'inline-flex';
      }
      if (basicScheduledCountdown) {
        basicScheduledCountdown.textContent = activatingStr;
        basicScheduledCountdown.style.display = 'inline-flex';
      }
      activeScheduledTargetMs = null;
      messageBus
        .publish({
          type: 'SYNC_STATE_REQUEST',
          timestamp: new Date().toISOString(),
        })
        .catch(() => {});
    }
  } else {
    if (scheduledArmCountdown) scheduledArmCountdown.style.display = 'none';
    if (basicScheduledCountdown) basicScheduledCountdown.style.display = 'none';
  }
}

/**
 * Converts an ISO timestamp string into a datetime-local input value (local time).
 */
function toDatetimeLocalValue(isoString: string): string {
  const d = new Date(isoString);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function showScheduledArmStatus(isoString: string): void {
  const targetMs = new Date(isoString).getTime();
  activeScheduledTargetMs = targetMs > Date.now() ? targetMs : null;

  if (scheduledArmStatus) scheduledArmStatus.style.display = 'flex';
  if (scheduledArmTimeDisplay) {
    scheduledArmTimeDisplay.textContent = new Date(isoString).toLocaleString('vi-VN');
  }
  if (activeScheduledTargetMs && scheduledArmCountdown) {
    const remainingMs = Math.max(0, activeScheduledTargetMs - Date.now());
    scheduledArmCountdown.textContent = `(Còn lại ${formatCountdown(remainingMs)})`;
    scheduledArmCountdown.style.display = 'inline-flex';
  }
  // Open the details panel so user sees the status
  const details = document.getElementById('scheduled-arm-details') as HTMLDetailsElement | null;
  if (details) details.open = true;
}

function hideScheduledArmStatus(): void {
  activeScheduledTargetMs = null;
  if (scheduledArmStatus) scheduledArmStatus.style.display = 'none';
  if (scheduledArmTimeInput) scheduledArmTimeInput.value = '';
  if (scheduledArmCountdown) scheduledArmCountdown.style.display = 'none';
  if (basicScheduledStatus) basicScheduledStatus.style.display = 'none';
  if (basicScheduledArmTime) basicScheduledArmTime.value = '';
  if (basicScheduledCountdown) basicScheduledCountdown.style.display = 'none';
}

// ─── Reset Popup to Blank ─────────────────────────────────────────────────────

/**
 * Resets all popup inputs to blank after a config reset.
 * State badge and log are left untouched (log retains history).
 */
function resetPopupToBlank(): void {
  // URL
  if (eventUrlInput) eventUrlInput.value = '';

  // Profile fields (Hardcore & Basic)
  if (profileNameInput) profileNameInput.value = '';
  if (profilePhoneInput) profilePhoneInput.value = '';
  if (profileEmailInput) profileEmailInput.value = '';
  if (profileIdCardInput) profileIdCardInput.value = '';
  if (profileBirthYearInput) profileBirthYearInput.value = '';
  if (profileGenderSelect) profileGenderSelect.value = '';
  if (profileAddressInput) profileAddressInput.value = '';
  if (profileAgreeTermsCheckbox) profileAgreeTermsCheckbox.checked = false;
  if (profileAllowSensitive) profileAllowSensitive.checked = false;

  if (basicProfileName) basicProfileName.value = '';
  if (basicProfilePhone) basicProfilePhone.value = '';
  if (basicProfileEmail) basicProfileEmail.value = '';
  if (basicProfileIdCard) basicProfileIdCard.value = '';
  if (basicProfileAgreeTerms) basicProfileAgreeTerms.checked = false;
  if (basicProfileAllowSensitive) basicProfileAllowSensitive.checked = false;

  // Scoped plan & Basic quantity
  if (scopedQuantityInput) scopedQuantityInput.value = '1';
  if (basicQuantityInput) basicQuantityInput.value = '1';
  if (scopedStrategySelect) scopedStrategySelect.value = 'BY_TARGET_ORDER';
  if (paramDurationInput) paramDurationInput.value = '120';
  if (paramAttemptsInput) paramAttemptsInput.value = '1000';
  if (paramPollIntervalInput) paramPollIntervalInput.value = '2000';
  if (paramJitterInput) paramJitterInput.value = '0.2';
  if (paramMaxPricePerTicketInput) paramMaxPricePerTicketInput.value = '0';
  if (paramMaxTotalInput) paramMaxTotalInput.value = '0';
  if (paramAllowPartialCheckbox) paramAllowPartialCheckbox.checked = false;
  if (summaryConfirmCheckbox) summaryConfirmCheckbox.checked = false;

  // Scheduled ARM (both modes)
  hideScheduledArmStatus();
  if (basicScheduledStatus) basicScheduledStatus.style.display = 'none';
  if (basicScheduledArmTime) basicScheduledArmTime.value = '';

  // Clear log storage
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.remove('ticketbox_recent_logs');
  }
  if (logBox) logBox.innerHTML = '';

  // Catalog, basic checklist & matrix
  currentCatalog = {
    eventId: null,
    eventTitle: null,
    showings: [],
    tickets: [],
    loadState: 'IDLE',
    loadMessage: 'Config đã được xóa. Vui lòng mở tab Ticketbox và quét lại.',
    discoveredAt: null,
  };
  renderCatalogTable([]);
  renderBasicTicketChecklist();
  if (matrixEmpty) matrixEmpty.style.display = 'block';
  if (matrixTableWrapper) matrixTableWrapper.style.display = 'none';
  if (scopedMatrixTbody) scopedMatrixTbody.innerHTML = '';
  if (scopedSummaryBox) scopedSummaryBox.style.display = 'none';
  if (scopedValidationError) scopedValidationError.style.display = 'none';
  if (eventInfoBar) eventInfoBar.style.display = 'none';

  // State badge reset
  updateStateBadge(PurchaseState.IDLE);
}

// ─── Initial Data Load ────────────────────────────────────────────────────────

async function loadInitialData(): Promise<void> {
  // Load saved UI mode
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get('ui_mode', (res) => {
      const mode = (res?.ui_mode as 'basic' | 'hardcore') || 'basic';
      switchUiMode(mode);
    });
  }

  const config = await storage.getConfiguration();

  if (config) {
    if (config.targetEventUrl) eventUrlInput.value = config.targetEventUrl;

    // Restore user profile
    if (config.userProfile) {
      profileNameInput.value = config.userProfile.fullName ?? '';
      profilePhoneInput.value = config.userProfile.phone ?? '';
      profileEmailInput.value = config.userProfile.email ?? '';
      if (profileIdCardInput) profileIdCardInput.value = config.userProfile.idCard ?? '';
      if (profileBirthYearInput) profileBirthYearInput.value = config.userProfile.birthYear ?? '';
      if (profileGenderSelect) profileGenderSelect.value = config.userProfile.gender ?? '';
      if (profileAddressInput) profileAddressInput.value = config.userProfile.address ?? '';
      profileAgreeTermsCheckbox.checked = config.userProfile.agreeToTerms ?? false;
      if (profileAllowSensitive) {
        profileAllowSensitive.checked = config.userProfile.allowSensitivePii ?? false;
      }

      // Sync to basic profile
      if (basicProfileName) basicProfileName.value = config.userProfile.fullName ?? '';
      if (basicProfilePhone) basicProfilePhone.value = config.userProfile.phone ?? '';
      if (basicProfileEmail) basicProfileEmail.value = config.userProfile.email ?? '';
      if (basicProfileIdCard) basicProfileIdCard.value = config.userProfile.idCard ?? '';
      if (basicProfileAgreeTerms) {
        basicProfileAgreeTerms.checked = config.userProfile.agreeToTerms ?? false;
      }
      if (basicProfileAllowSensitive) {
        basicProfileAllowSensitive.checked = config.userProfile.allowSensitivePii ?? false;
      }
    }

    // Restore purchase plan
    if (config.purchasePlan) {
      currentPlan = config.purchasePlan;
      allowFallbackCheckbox.checked = currentPlan.allowFallback;
      fallbackPolicySelect.value = currentPlan.fallbackPolicy;
    } else if (config.preferences) {
      // Migrate from legacy preferences
      currentPlan = {
        showingId: null,
        ticketRules: config.preferences.categoryPriority.map((name, i) => ({
          ticketId: name,
          ticketName: name,
          quantity: i === 0 ? config.preferences!.quantity : 1,
          seatPolicy: 'ANY_AVAILABLE' as const,
        })),
        fallbackPolicy: 'NEXT_PRIORITY',
        allowFallback: config.preferences.allowFallback,
      };
      allowFallbackCheckbox.checked = currentPlan.allowFallback;
    }

    // Restore scoped purchase plan
    if (config.scopedPurchasePlan) {
      currentScopedPlan = config.scopedPurchasePlan;
      const qtyStr = String(currentScopedPlan.quantity || 1);
      if (scopedQuantityInput) scopedQuantityInput.value = qtyStr;
      if (basicQuantityInput) basicQuantityInput.value = qtyStr;
      if (scopedStrategySelect)
        scopedStrategySelect.value = currentScopedPlan.strategy || 'BY_TARGET_ORDER';
      if (paramAllowPartialCheckbox && currentScopedPlan.allowPartialQuantity !== undefined) {
        paramAllowPartialCheckbox.checked = currentScopedPlan.allowPartialQuantity;
      }
      if (currentScopedPlan.persistence) {
        if (paramDurationInput)
          paramDurationInput.value = String(
            currentScopedPlan.persistence.maxDurationMinutes !== undefined
              ? currentScopedPlan.persistence.maxDurationMinutes
              : 120
          );
        if (paramAttemptsInput)
          paramAttemptsInput.value = String(
            currentScopedPlan.persistence.maxAttempts !== undefined
              ? currentScopedPlan.persistence.maxAttempts
              : 1000
          );
        if (paramPollIntervalInput)
          paramPollIntervalInput.value = String(
            currentScopedPlan.persistence.pollIntervalMs || 2000
          );

        if (paramJitterInput)
          paramJitterInput.value = String(currentScopedPlan.persistence.jitterRatio ?? 0.2);

        if (paramMaxPricePerTicketInput)
          paramMaxPricePerTicketInput.value = String(
            currentScopedPlan.persistence.maxPricePerTicket ?? 0
          );
        if (paramMaxTotalInput)
          paramMaxTotalInput.value = String(currentScopedPlan.persistence.maxTotal ?? 0);

        // Restore scheduled ARM input and status if a future startAt is saved
        const startAt = currentScopedPlan.persistence.startAt || config.scheduledArmAt;
        if (startAt) {
          const startAtMs = new Date(startAt).getTime();
          if (startAtMs > Date.now()) {
            const formattedVal = toDatetimeLocalValue(startAt);
            if (scheduledArmTimeInput) scheduledArmTimeInput.value = formattedVal;
            if (basicScheduledArmTime) basicScheduledArmTime.value = formattedVal;
            showScheduledArmStatus(startAt);
            if (basicScheduledStatus && basicScheduledTimeDisplay) {
              basicScheduledStatus.style.display = 'flex';
              basicScheduledTimeDisplay.textContent = new Date(startAt).toLocaleString('vi-VN');
            }
          }
        }
      }
    }

    // Restore cached catalog snapshot for instant display
    if (config.ticketCatalogSnapshot) {
      applyNewCatalog(config.ticketCatalogSnapshot);
    }
  }

  // Render rule cards (if no catalog yet, renders with empty dropdowns)
  refreshAllRuleCards();

  // Restore recent logs from storage
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get('ticketbox_recent_logs', (res) => {
      if (Array.isArray(res?.ticketbox_recent_logs) && res.ticketbox_recent_logs.length > 0) {
        logBox.innerHTML = '';
        for (const logLine of res.ticketbox_recent_logs) {
          const div = document.createElement('div');
          div.textContent = logLine;
          logBox.appendChild(div);
        }
        logBox.scrollTop = logBox.scrollHeight;
      }
    });
  }

  // Load last state and persistent phase
  const lastState = await storage.getLastState();
  const persistentState = await storage.getPersistentState();

  if (lastState?.currentState) {
    updateStateBadge(lastState.currentState, lastState.failureMessage);
    if (lastState.attemptId) {
      attemptIdDisplay.textContent = lastState.attemptId;
    }
  }

  if (persistentState?.currentPhase === 'SCHEDULED' && config?.scheduledArmAt) {
    showScheduledArmStatus(config.scheduledArmAt);
    if (basicScheduledStatus && basicScheduledTimeDisplay) {
      basicScheduledStatus.style.display = 'flex';
      basicScheduledTimeDisplay.textContent = new Date(config.scheduledArmAt).toLocaleString(
        'vi-VN'
      );
      const startAtMs = new Date(config.scheduledArmAt).getTime();
      if (startAtMs > Date.now() && basicScheduledCountdown) {
        const rem = Math.max(0, startAtMs - Date.now());
        basicScheduledCountdown.textContent = `(Còn lại ${formatCountdown(rem)})`;
        basicScheduledCountdown.style.display = 'inline-flex';
      }
    }
  } else if (
    (persistentState?.currentPhase === 'ARMED' || persistentState?.currentPhase === 'MONITORING') &&
    (!lastState?.currentState ||
      lastState.currentState === PurchaseState.IDLE ||
      lastState.currentState === PurchaseState.READY)
  ) {
    updateStateBadge(PurchaseState.ARMED);
  }

  await updatePersistentMonitoringDisplay(persistentState);

  // Read cached latest journey scan for immediate catalog display
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get('latestJourneyUpdate', (res) => {
      const cached = res?.latestJourneyUpdate;
      if (cached?.catalogSnapshot) {
        applyNewCatalog(cached.catalogSnapshot);
      } else if (cached?.tickets) {
        // Legacy fallback: build minimal snapshot from simple tickets array
        const legacySnapshot: TicketCatalogSnapshot = {
          eventId: null,
          eventTitle: cached.eventTitle ?? null,
          showings: [],
          tickets: (
            cached.tickets as Array<{
              name: string;
              price: number;
              mode: string;
              availability: string;
            }>
          ).map((t) => ({
            id: null,
            name: t.name,
            price: t.price,
            currency: 'VND' as const,
            mode: (t.mode === 'ZONE' ? 'AREA_BASED' : t.mode) as
              'STANDING' | 'SEATED' | 'AREA_BASED' | 'UNKNOWN',
            availability: t.availability as
              'AVAILABLE' | 'SOLD_OUT' | 'OFFLINE_SALE' | 'NOT_STARTED' | 'CLOSED' | 'UNKNOWN',
            selectable: t.availability === 'AVAILABLE',
            minQuantity: null,
            maxQuantity: null,
            source: 'EVENT_PAGE' as const,
            evidence: [],
          })),
          loadState: 'LOADED',
          loadMessage: `${cached.tickets.length} ticket options discovered (cached).`,
          discoveredAt: null,
        };
        applyNewCatalog(legacySnapshot);
      }
      if (cached?.summary) {
        sumSubtotal.textContent = formatPrice(cached.summary.subtotal);
        sumFees.textContent = formatPrice(cached.summary.fees);
        sumTotal.textContent = formatPrice(cached.summary.total);
      }
    });
  }

  // Discover from Ticketbox tab
  await requestDiscoveryFromTab(false);

  // Request latest state synchronization from service worker
  await messageBus.publish({
    type: 'SYNC_STATE_REQUEST',
    timestamp: new Date().toISOString(),
  });

  // Start 1-second live ticker for elapsed time and scheduled countdown
  updateLiveTimes();
  if (typeof window !== 'undefined' && !liveTimerInterval) {
    liveTimerInterval = window.setInterval(updateLiveTimes, 1000);
    // Cleanup on popup unload to prevent memory leaks across popup re-opens
    window.addEventListener(
      'unload',
      () => {
        if (liveTimerInterval !== null) {
          window.clearInterval(liveTimerInterval);
          liveTimerInterval = null;
        }
      },
      { once: true }
    );
  }
}

// ─── Message Handler ──────────────────────────────────────────────────────────

messageBus.subscribe((message: ExtensionMessage) => {
  switch (message.type) {
    case 'STATE_CHANGED': {
      updateStateBadge(message.context.currentState, message.context.failureMessage);
      if (message.context.attemptId) {
        attemptIdDisplay.textContent = message.context.attemptId;
      }
      updatePersistentMonitoringDisplay().catch(() => {});
      addLog(`State → ${message.context.currentState}`);
      break;
    }

    case 'SYNC_STATE_RESPONSE': {
      updateStateBadge(message.context.currentState, message.context.failureMessage);
      if (message.context.attemptId) {
        attemptIdDisplay.textContent = message.context.attemptId;
      }
      updateTelemetry();
      updatePersistentMonitoringDisplay().catch(() => {});

      // Apply full catalog snapshot if available
      if (message.catalogSnapshot) {
        applyNewCatalog(message.catalogSnapshot);
      } else if (message.journeyDetails) {
        if (message.journeyDetails.eventTitle) {
          eventInfoTitle.textContent = message.journeyDetails.eventTitle;
          eventInfoBar.style.display = 'block';
        }
        if (message.journeyDetails.tickets) {
          renderCatalogTable(
            message.journeyDetails.tickets.map((t) => ({
              id: null,
              name: t.name,
              price: t.price,
              currency: 'VND',
              mode: (t.mode === 'ZONE' ? 'AREA_BASED' : t.mode) as
                'STANDING' | 'SEATED' | 'AREA_BASED' | 'UNKNOWN',
              availability: t.availability as
                'AVAILABLE' | 'SOLD_OUT' | 'OFFLINE_SALE' | 'NOT_STARTED' | 'CLOSED' | 'UNKNOWN',
              selectable: t.availability === 'AVAILABLE',
              minQuantity: null,
              maxQuantity: null,
              source: 'EVENT_PAGE',
              evidence: [],
            }))
          );
        }
      }
      break;
    }

    case 'JOURNEY_UPDATE': {
      // Apply full catalog snapshot (preferred)
      if (message.catalogSnapshot) {
        applyNewCatalog(message.catalogSnapshot);
      } else if (message.eventTitle) {
        eventInfoTitle.textContent = message.eventTitle;
        eventInfoBar.style.display = 'block';
      }

      // Update runtime selection display
      if (message.selection) {
        selTicket.textContent = message.selection.ticket || '-';
        selMode.textContent = message.selection.mode || '-';
        selArea.textContent = message.selection.area || '-';
        selSeats.textContent = message.selection.seats?.join(', ') || '-';
        selQty.textContent = String(message.selection.quantity || '-');
      }

      if (message.summary) {
        sumSubtotal.textContent = formatPrice(message.summary.subtotal);
        sumFees.textContent = formatPrice(message.summary.fees);
        sumTotal.textContent = formatPrice(message.summary.total);
      }

      if (message.blockingReason) {
        blockingReasonContainer.style.display = 'block';
        blockingReasonText.textContent = message.blockingReason;
      }
      break;
    }

    case 'PAGE_DISCOVERY_SNAPSHOT': {
      const ticketCount = message.domSummary?.ticketElementsCount ?? 0;
      const title = message.domSummary?.title || message.pageTitle || 'Ticketbox';
      if (title && title !== 'Ticketbox') {
        eventInfoTitle.textContent = title;
        eventInfoBar.style.display = 'block';
      }
      const discKey = `${ticketCount}_${title}`;
      if (discKey !== lastLoggedDiscoveryKey) {
        lastLoggedDiscoveryKey = discKey;
        addLog(
          `Discovered ${ticketCount} ticket tier${ticketCount !== 1 ? 's' : ''} on "${title}"`
        );
      }
      break;
    }

    case 'NOTIFICATION_EVENT': {
      addLog(`[${message.category}] ${message.body}`);
      if (message.category === 'CONSENT_REQUIRED') {
        updateStateBadge(PurchaseState.CONSENT_REQUIRED, 'User consent required');
      } else if (message.category === 'PAYMENT_REQUIRED') {
        updateStateBadge(
          PurchaseState.PAYMENT_GATE,
          'Payment step reached — user action required.'
        );
      }
      break;
    }

    case 'RESERVATION_CONFIRMED': {
      addLog(`Reservation Confirmed! ID: ${message.reservationId}`);
      updateStateBadge(PurchaseState.HELD);
      break;
    }

    case 'RESERVATION_FAILED': {
      addLog(`Reservation Failed: ${message.reason} - ${message.errorMessage ?? ''}`);
      break;
    }

    case 'RESET_CONFIG_DONE': {
      resetPopupToBlank();
      addLog('✅ Config đã được xóa. Cấu hình lại từ đầu.');
      break;
    }

    case 'SCHEDULED_ARM_CONFIRMED': {
      showScheduledArmStatus(message.scheduledAt);
      addLog(`⏰ Hẹn ARM vào: ${new Date(message.scheduledAt).toLocaleString('vi-VN')}`);
      break;
    }

    default:
      break;
  }
});

// ─── Button Handlers ──────────────────────────────────────────────────────────

const handleArmClick = async (): Promise<void> => {
  if (isArmingInProgress) return;
  isArmingInProgress = true;
  try {
    if (btnArm?.classList.contains('running-active')) {
      btnStop.click();
      return;
    }
    const url = eventUrlInput.value.trim();
    if (!url) {
      alert('Please enter a target Ticketbox event URL');
      return;
    }

    // 1. Rebuild plans
    rebuildPlanFromCards();
    let scopedPlan = rebuildScopedPlanFromMatrix();

    // 2. Validate Scoped Purchase Plan (BR-S01, BR-S02, BR-S03, BR-S07, AC-09, AC-11)
    const validation = ScopedPurchasePlanValidator.validate(
      scopedPlan,
      currentCatalog,
      profileNameInput.value.trim() ? 1 : undefined
    );

    // BR-S02 & AC-09: Whitelist rỗng thì chặn ARM kèm thông báo
    if (
      !scopedPlan.targets ||
      scopedPlan.targets.length === 0 ||
      scopedPlan.targets.every((t) => t.ticketTypeIds.length === 0)
    ) {
      const isScheduled = Boolean(scheduledArmTimeInput?.value);
      const hasCatalog =
        currentCatalog.tickets.length > 0 ||
        (currentCatalog.showings ?? []).some(
          (s) =>
            'tickets' in s &&
            Array.isArray((s as { tickets?: unknown[] }).tickets) &&
            ((s as { tickets?: unknown[] }).tickets?.length ?? 0) > 0
        );

      let errorMsg: string;
      if (!hasCatalog) {
        // Matrix trống vì chưa quét trang
        errorMsg = isScheduled
          ? 'ARM bị chặn: Chưa quét được danh mục vé!\n\n' +
            'Để hẹn giờ ARM, bạn cần làm trước:\n' +
            '1. Mở tab Ticketbox event trên trình duyệt\n' +
            '2. Nhấn nút ↺ (Refresh catalog) trong popup\n' +
            '3. Tick ✅ hạng vé muốn mua trong ma trận\n' +
            '4. Chọn giờ hẹn → nhấn ARM'
          : 'ARM bị chặn: Chưa quét được danh mục vé!\n\n' +
            '1. Mở tab Ticketbox event trên trình duyệt\n' +
            '2. Nhấn nút ↺ (Refresh catalog) trong popup\n' +
            '3. Tick ✅ hạng vé muốn mua → ARM';
      } else {
        // Catalog có nhưng chưa tick
        errorMsg =
          'ARM bị chặn: Whitelist rỗng!\n\nDanh mục vé đã được quét nhưng bạn chưa tick ✅ hạng vé nào trong bảng "SĂN VÉ CÓ PHẠM VI (SCOPED MATRIX)".\n\nVui lòng tick ít nhất một hạng vé trước khi ARM.';
      }

      if (scopedValidationError) {
        scopedValidationError.style.display = 'block';
        scopedValidationError.textContent = errorMsg.replace(/\n/g, '\n');
      }
      alert(errorMsg);
      return;
    }

    if (!validation.valid) {
      if (scopedValidationError) {
        scopedValidationError.style.display = 'block';
        scopedValidationError.textContent = `❌ Không thể ARM do vi phạm quy tắc:\n• ${validation.errors.join('\n• ')}`;
      }
      alert(`ARM bị chặn do lỗi cấu hình:\n• ${validation.errors.join('\n• ')}`);
      return;
    }

    // 3. Summary confirmation check
    if (!summaryConfirmCheckbox.checked) {
      if (scopedSummaryBox) {
        scopedSummaryBox.style.display = 'flex';
        scopedSummaryBox.scrollIntoView({ behavior: 'smooth' });
      }
      alert(
        'Vui lòng đọc bản tóm tắt "Sẽ chỉ mua / Sẽ KHÔNG mua" và tick chọn xác nhận trước khi ARM.'
      );
      return;
    }

    // Inject startAt from the datetime picker into scopedPlan persistence if set in the future
    const scheduledArmValue = scheduledArmTimeInput?.value;
    let isScheduled = false;
    if (scheduledArmValue) {
      const startAtIso = new Date(scheduledArmValue).toISOString();
      const startAtMs = new Date(startAtIso).getTime();
      if (startAtMs > Date.now()) {
        isScheduled = true;
        scopedPlan = {
          ...scopedPlan,
          persistence: {
            ...scopedPlan.persistence,
            startAt: startAtIso,
          },
        };
        showScheduledArmStatus(startAtIso);
      }
    }

    await savePlan();

    if (isScheduled) {
      addLog(
        `⏰ Đã hẹn giờ ARM vào: ${new Date(scopedPlan.persistence.startAt!).toLocaleString('vi-VN')}. Trợ lý sẽ tự động chạy khi đến giờ!`
      );
    } else {
      updateStateBadge(PurchaseState.ARMED);
      addLog(
        'Đã kích hoạt trợ lý với Scope Guard cứng (ARMED)... Đang chuẩn bị săn vé theo phạm vi.'
      );
    }

    const userProfile = buildUserProfileFromInputs(
      {
        nameInput: profileNameInput,
        phoneInput: profilePhoneInput,
        emailInput: profileEmailInput,
        idCardInput: profileIdCardInput,
        agreeTermsCheckbox: profileAgreeTermsCheckbox,
        allowSensitiveCheckbox: profileAllowSensitive,
        birthYearInput: profileBirthYearInput,
        genderSelect: profileGenderSelect,
        addressInput: profileAddressInput,
      },
      {
        nameInput: basicProfileName,
        phoneInput: basicProfilePhone,
        emailInput: basicProfileEmail,
        idCardInput: basicProfileIdCard,
        agreeTermsCheckbox: basicProfileAgreeTerms,
        allowSensitiveCheckbox: basicProfileAllowSensitive,
      }
    );

    if (!userProfile.fullName || !userProfile.phone) {
      addLog(
        'Lưu ý: Chưa điền Họ tên hoặc SĐT trong "User Profile". Nếu sự kiện có bảng câu hỏi, hệ thống sẽ dừng chờ bạn điền.'
      );
    }

    // Priority categories from scoped targets
    const categoryPriority = scopedPlan.targets.flatMap((t) => t.ticketTypeIds);

    const targetTab = await findTicketboxTab();
    const targetTabId = targetTab?.id;
    const eventId = scopedPlan.eventId || extractEventIdFromUrl(url) || undefined;

    await messageBus.publish({
      type: 'ARM_REQUESTED',
      timestamp: new Date().toISOString(),
      eventUrl: url,
      categoryPriority,
      quantity: scopedPlan.quantity,
      allowFallback: false, // In scoped persistent mode, fallback outside scope is forbidden
      scopedPurchasePlan: scopedPlan,
      userProfile,
      targetTabId,
      eventId,
      targetEventId: eventId,
    });
  } finally {
    isArmingInProgress = false;
  }
};

const handleStopClick = async (): Promise<void> => {
  addLog('Đã dừng trợ lý theo yêu cầu.');
  updateStateBadge(PurchaseState.STOPPED, 'Đã dừng theo yêu cầu của bạn');
  // Immediately halt the live elapsed timer — don't wait for async storage update.
  activeStartedAtMs = null;
  if (persistentElapsedDisplay) {
    const maxDuration = currentScopedPlan?.persistence?.maxDurationMinutes ?? 30;
    const durationCapStr = maxDuration > 0 ? `${maxDuration}m` : '∞';
    persistentElapsedDisplay.textContent = `00:00 / ${durationCapStr}`;
  }
  await messageBus.publish({
    type: 'STOP_REQUESTED',
    timestamp: new Date().toISOString(),
    reason: 'Manual user stop via Popup UI',
  });
};

if (btnResetConfig) {
  btnResetConfig.addEventListener('click', async () => {
    const confirmed = confirm(
      'Xóa toàn bộ cấu hình đã lưu?\n\n• URL sự kiện\n• Preference vé, scoped matrix\n• User profile\n• Execution state\n\nProfiles tài khoản sẽ được GIỮ LẠI.'
    );
    if (!confirmed) return;
    addLog('🗑 Đang xóa config...');
    await messageBus.publish({
      type: 'RESET_CONFIG_REQUESTED',
      timestamp: new Date().toISOString(),
    });
  });
}

if (btnCancelScheduledArm) {
  btnCancelScheduledArm.addEventListener('click', async () => {
    addLog('Đang hủy lịch ARM...');
    await messageBus.publish({
      type: 'CANCEL_SCHEDULED_ARM',
      timestamp: new Date().toISOString(),
    });
    hideScheduledArmStatus();
    addLog('✅ Đã hủy hẹn giờ ARM.');
  });
}

btnAddTicketRow.addEventListener('click', () => {
  addTicketRuleRow();
  rebuildPlanFromCards();
  savePlan();
});

const handleRefreshCatalogClick = (): void => {
  addLog('Làm mới danh mục vé theo yêu cầu...');
  requestDiscoveryFromTab(true);
};

registerPopupEventListeners({
  armButton: btnArm,
  stopButton: btnStop,
  refreshButton: btnRefreshCatalog,
  saveButton: document.getElementById('btn-save') as HTMLButtonElement | null,
  onArm: handleArmClick,
  onStop: handleStopClick,
  onRefresh: handleRefreshCatalogClick,
  onSave: savePlan,
});

showingSelect.addEventListener('change', onShowingChange);

[
  scopedQuantityInput,
  scopedStrategySelect,
  paramDurationInput,
  paramAttemptsInput,
  paramPollIntervalInput,
  paramJitterInput,
  paramMaxPricePerTicketInput,
  paramMaxTotalInput,
  paramAllowPartialCheckbox,
].forEach((el) => {
  if (el) {
    el.addEventListener('change', () => {
      rebuildScopedPlanFromMatrix();
      updateScopedSummaryAndValidation();
      savePlan();
    });
  }
});

if (summaryConfirmCheckbox) {
  summaryConfirmCheckbox.addEventListener('change', () => {
    rebuildScopedPlanFromMatrix();
    updateScopedSummaryAndValidation();
  });
}

allowFallbackCheckbox.addEventListener('change', () => {
  fallbackPolicyGroup.style.display = allowFallbackCheckbox.checked ? 'flex' : 'none';
  rebuildPlanFromCards();
  savePlan();
});

fallbackPolicySelect.addEventListener('change', () => {
  rebuildPlanFromCards();
  savePlan();
});

// Reactively update popup when new discovery scan or persistent state is saved to storage
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      if (changes['latestJourneyUpdate']?.newValue) {
        const update = changes['latestJourneyUpdate'].newValue;
        if (update?.catalogSnapshot) {
          applyNewCatalog(update.catalogSnapshot);
        }
      }
      if (changes['persistentExecutionState']) {
        updatePersistentMonitoringDisplay(changes['persistentExecutionState'].newValue);
      }
    }
  });
}

// Save and scan on URL input change
eventUrlInput.addEventListener('change', () => {
  savePlan();
  requestDiscoveryFromTab(false);
});

eventUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    savePlan();
    requestDiscoveryFromTab(true);
  }
});

// Auto-save when user edits profile fields
[
  profileNameInput,
  profilePhoneInput,
  profileEmailInput,
  profileIdCardInput,
  profileBirthYearInput,
  profileGenderSelect,
  profileAddressInput,
  profileAgreeTermsCheckbox,
  profileAllowSensitive,
].forEach((el) => {
  if (el) {
    el.addEventListener('change', () => savePlan());
  }
});

// Mode switcher listeners
tabModeBasic?.addEventListener('click', () => switchUiMode('basic'));
tabModeHardcore?.addEventListener('click', () => switchUiMode('hardcore'));

// Basic Panel action buttons
btnBasicArm?.addEventListener('click', handleBasicArm);
btnBasicStop?.addEventListener('click', () => btnStop.click());
btnBasicReset?.addEventListener('click', () => btnResetConfig?.click());
btnCancelBasicScheduled?.addEventListener('click', () => btnCancelScheduledArm?.click());
btnInterventionResume?.addEventListener('click', async () => {
  addLog('Đang xác thực và tiếp tục sau giải CAPTCHA...');
  try {
    await messageBus.publish({
      type: 'USER_COMPLETED_INTERVENTION',
      interventionId: 'captcha_resolved',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Error sending USER_COMPLETED_INTERVENTION from popup', err);
  }
});

btnBasicSelectAll?.addEventListener('click', () => {
  basicTicketChecklist?.querySelectorAll('.basic-ticket-item').forEach((item) => {
    const cb = item.querySelector('.basic-ticket-cb') as HTMLInputElement | null;
    if (cb) {
      cb.checked = true;
      item.classList.add('selected');
    }
  });
  syncBasicChecklistToScopedPlan();
  savePlan();
});

btnBasicDeselectAll?.addEventListener('click', () => {
  basicTicketChecklist?.querySelectorAll('.basic-ticket-item').forEach((item) => {
    const cb = item.querySelector('.basic-ticket-cb') as HTMLInputElement | null;
    if (cb) {
      cb.checked = false;
      item.classList.remove('selected');
    }
  });
  syncBasicChecklistToScopedPlan();
  savePlan();
});

if (basicQuantityInput) {
  basicQuantityInput.addEventListener('change', () => {
    syncBasicChecklistToScopedPlan();
    savePlan();
  });
}

if (basicScheduledArmTime) {
  basicScheduledArmTime.addEventListener('change', () => {
    const val = basicScheduledArmTime.value;
    if (val) {
      const ms = new Date(val).getTime();
      if (ms > Date.now()) {
        activeScheduledTargetMs = ms;
        if (basicScheduledStatus && basicScheduledTimeDisplay) {
          basicScheduledStatus.style.display = 'flex';
          basicScheduledTimeDisplay.textContent = new Date(ms).toLocaleString('vi-VN');
          if (basicScheduledCountdown) {
            const rem = Math.max(0, ms - Date.now());
            basicScheduledCountdown.textContent = `(Còn lại ${formatCountdown(rem)})`;
            basicScheduledCountdown.style.display = 'inline-flex';
          }
        }
      } else {
        activeScheduledTargetMs = null;
        if (basicScheduledStatus) basicScheduledStatus.style.display = 'none';
        if (basicScheduledCountdown) basicScheduledCountdown.style.display = 'none';
      }
    } else {
      activeScheduledTargetMs = null;
      if (basicScheduledStatus) basicScheduledStatus.style.display = 'none';
      if (basicScheduledCountdown) basicScheduledCountdown.style.display = 'none';
    }
    syncBasicChecklistToScopedPlan();
    savePlan();
  });
}

if (scheduledArmTimeInput) {
  scheduledArmTimeInput.addEventListener('change', () => {
    const val = scheduledArmTimeInput.value;
    if (val) {
      const ms = new Date(val).getTime();
      if (ms > Date.now()) {
        showScheduledArmStatus(new Date(ms).toISOString());
      }
    }
    savePlan();
  });
}

if (basicShowingSelect) {
  basicShowingSelect.addEventListener('change', () => {
    showingSelect.value = basicShowingSelect.value;
    onShowingChange();
    renderBasicTicketChecklist();
    syncBasicChecklistToScopedPlan();
    savePlan();
  });
}

// Auto-save basic profile fields
[
  basicProfileName,
  basicProfilePhone,
  basicProfileEmail,
  basicProfileIdCard,
  basicProfileAgreeTerms,
  basicProfileAllowSensitive,
].forEach((el) => {
  if (el) {
    el.addEventListener('change', () => {
      syncProfileFields('hardcore');
      savePlan();
    });
  }
});

// Clear PII Handler
async function handleClearPii(): Promise<void> {
  const confirmed = confirm(
    'Bạn có chắc chắn muốn xóa toàn bộ thông tin cá nhân (Họ tên, SĐT, Email, CCCD, Địa chỉ) khỏi bộ nhớ thiết bị?'
  );
  if (!confirmed) return;

  await storage.purgeUserProfile();

  // Clear inputs in both forms
  if (profileNameInput) profileNameInput.value = '';
  if (profilePhoneInput) profilePhoneInput.value = '';
  if (profileEmailInput) profileEmailInput.value = '';
  if (profileIdCardInput) profileIdCardInput.value = '';
  if (profileBirthYearInput) profileBirthYearInput.value = '';
  if (profileGenderSelect) profileGenderSelect.value = '';
  if (profileAddressInput) profileAddressInput.value = '';
  if (profileAgreeTermsCheckbox) profileAgreeTermsCheckbox.checked = false;
  if (profileAllowSensitive) profileAllowSensitive.checked = false;

  if (basicProfileName) basicProfileName.value = '';
  if (basicProfilePhone) basicProfilePhone.value = '';
  if (basicProfileEmail) basicProfileEmail.value = '';
  if (basicProfileIdCard) basicProfileIdCard.value = '';
  if (basicProfileAgreeTerms) basicProfileAgreeTerms.checked = false;
  if (basicProfileAllowSensitive) basicProfileAllowSensitive.checked = false;

  addLog('🔒 Đã xoá toàn bộ dữ liệu cá nhân khỏi bộ nhớ cục bộ.');
}

btnClearPii?.addEventListener('click', handleClearPii);
btnBasicClearPii?.addEventListener('click', handleClearPii);

// ─── Bootstrap ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', loadInitialData);
