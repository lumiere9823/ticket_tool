import {
  PurchasePlan,
  TicketOption,
  TicketRule,
  TicketCatalogSnapshot,
} from '../../domain/entities/PurchasePlan';
import {
  DEFAULT_PERSISTENCE_POLICY,
  PriorityStrategy,
  ScopedPurchasePlan,
} from '../../domain/entities/ScopedPurchasePlan';
import { ScopedPurchasePlanValidator } from '../../domain/policies/ScopedPurchasePlanValidator';

export interface PopupConfigViewOptions {
  ticketRulesContainer: HTMLElement;
  showingSelect: HTMLSelectElement;
  allowFallbackCheckbox: HTMLInputElement;
  fallbackPolicySelect: HTMLSelectElement;
  matrixBody: HTMLElement;
  quantityInput: HTMLInputElement;
  strategySelect: HTMLSelectElement;
  durationInput: HTMLInputElement;
  attemptsInput: HTMLInputElement;
  pollIntervalInput: HTMLInputElement;
  jitterInput: HTMLInputElement;
  allowPartialCheckbox: HTMLInputElement;
  maxPriceInput: HTMLInputElement | null;
  maxTotalInput: HTMLInputElement | null;
  summaryBox: HTMLElement;
  summaryAllowed: HTMLElement;
  summaryDisallowed: HTMLElement;
  validationError: HTMLElement;
  getCatalog: () => TicketCatalogSnapshot;
  getPurchasePlan: () => PurchasePlan;
  setPurchasePlan: (plan: PurchasePlan) => void;
  getPlan: () => ScopedPurchasePlan;
  setPlan: (plan: ScopedPurchasePlan) => void;
  onPlanChange: () => void;
}

export class PopupConfigView {
  private ruleCardCounter = 0;

  constructor(private readonly options: PopupConfigViewOptions) {}

  getTicketsForCurrentShowing(): TicketOption[] {
    const plan = this.options.getPurchasePlan();
    if (plan.showingId) {
      const showing = this.options.getCatalog().showings.find((item) => item.id === plan.showingId);
      if (
        showing &&
        'tickets' in showing &&
        Array.isArray(showing.tickets) &&
        showing.tickets.length > 0
      ) {
        return showing.tickets as TicketOption[];
      }
    }
    return this.options.getCatalog().tickets;
  }

  buildQuantityOptions(ticket: TicketOption): number[] {
    const min = ticket.minQuantity ?? 1;
    const max = ticket.maxQuantity ?? 8;
    const options: number[] = [];
    for (let quantity = min; quantity <= Math.min(max, 20); quantity++) options.push(quantity);
    return options.length > 0 ? options : [1];
  }

  buildTicketRuleCard(rule: TicketRule, ruleIndex: number): HTMLElement {
    const cardId = `rule-${this.ruleCardCounter++}`;
    const tickets = this.getTicketsForCurrentShowing();
    const card = document.createElement('div');
    card.className = 'ticket-rule-card';
    card.dataset.ruleId = cardId;

    const header = document.createElement('div');
    header.className = 'ticket-rule-header';
    const ruleLabel = document.createElement('span');
    ruleLabel.className = 'ticket-rule-label';
    ruleLabel.textContent = `VÉ ${ruleIndex + 1}`;

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'btn-remove-row';
    removeButton.textContent = '×';
    removeButton.title = 'Xóa loại vé này';
    removeButton.addEventListener('click', () => {
      card.remove();
      this.rebuildPlanFromCards();
      this.options.onPlanChange();
      this.reindexRuleLabels();
    });
    header.append(ruleLabel, removeButton);

    const fields = document.createElement('div');
    fields.className = 'ticket-rule-fields';
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

      for (const ticket of tickets) {
        const option = document.createElement('option');
        option.value = ticket.id ?? ticket.name;
        option.textContent = this.ticketOptionLabel(ticket);
        option.className =
          ticket.availability === 'AVAILABLE'
            ? 'opt-available'
            : ticket.availability === 'SOLD_OUT'
              ? 'opt-soldout'
              : 'opt-unknown';
        if (!ticket.selectable) option.disabled = true;
        if (rule.ticketId === (ticket.id ?? ticket.name) || rule.ticketName === ticket.name) {
          option.selected = true;
        }
        ticketSelect.appendChild(option);
      }
    }
    ticketField.append(ticketLabel, ticketSelect);

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
    areaField.append(areaLabel, areaSelect);

    const quantityField = document.createElement('div');
    quantityField.className = 'field-group';
    const quantityLabel = document.createElement('div');
    quantityLabel.className = 'field-label';
    quantityLabel.textContent = 'Số lượng';
    const quantitySelect = document.createElement('select');
    quantitySelect.className = 'select-field rule-qty-select';
    const selectedTicket = tickets.find(
      (ticket) => (ticket.id ?? ticket.name) === rule.ticketId || ticket.name === rule.ticketName
    );
    for (const quantity of selectedTicket
      ? this.buildQuantityOptions(selectedTicket)
      : [1, 2, 3, 4]) {
      const option = document.createElement('option');
      option.value = String(quantity);
      option.textContent = String(quantity);
      if (quantity === rule.quantity) option.selected = true;
      quantitySelect.appendChild(option);
    }
    if (!quantitySelect.value || quantitySelect.value === '0') {
      const firstOption = quantitySelect.querySelector('option');
      if (firstOption) firstOption.selected = true;
    }
    quantityField.append(quantityLabel, quantitySelect);
    fields.append(ticketField, areaField, quantityField);
    card.append(header, fields);

    const statusMessage = document.createElement('div');
    statusMessage.className = 'rule-status-msg';
    statusMessage.style.display = 'none';
    card.appendChild(statusMessage);

    const updateAreaVisibility = (): void => {
      const ticket = tickets.find((item) => (item.id ?? item.name) === ticketSelect.value);
      areaField.style.display =
        ticket &&
        (ticket.mode === 'AREA_BASED' || ticket.mode === 'SEATED') &&
        areaSelect.options.length > 1
          ? 'flex'
          : 'none';
    };

    const updateQuantityOptions = (): void => {
      const ticket = tickets.find((item) => (item.id ?? item.name) === ticketSelect.value);
      if (!ticket) return;
      const currentQuantity = parseInt(quantitySelect.value, 10) || 1;
      quantitySelect.replaceChildren();
      for (const quantity of this.buildQuantityOptions(ticket)) {
        const option = document.createElement('option');
        option.value = String(quantity);
        option.textContent = String(quantity);
        if (quantity === currentQuantity) option.selected = true;
        quantitySelect.appendChild(option);
      }
      if (!quantitySelect.value || quantitySelect.value === '0') {
        const firstOption = quantitySelect.querySelector('option');
        if (firstOption) firstOption.selected = true;
      }
    };

    const validateCard = (): void => {
      if (!ticketSelect.value) {
        card.classList.remove('invalid', 'unavailable');
        statusMessage.style.display = 'none';
        return;
      }
      const ticket = tickets.find((item) => (item.id ?? item.name) === ticketSelect.value);
      if (!ticket) {
        card.classList.add('invalid');
        card.classList.remove('unavailable');
        statusMessage.className = 'ticket-invalid';
        statusMessage.textContent = 'Loại vé không còn trong catalog. Vui lòng chọn lại.';
        statusMessage.style.display = 'block';
        return;
      }
      card.classList.remove('invalid');
      if (ticket.availability !== 'AVAILABLE') {
        card.classList.add('unavailable');
        statusMessage.className = 'ticket-warning';
        statusMessage.textContent = `${ticket.name} hiện ${ticket.availability}. Sẽ sử dụng khi có.`;
        statusMessage.style.display = 'block';
      } else {
        card.classList.remove('unavailable');
        statusMessage.style.display = 'none';
      }
    };

    const syncAndSave = (): void => {
      this.rebuildPlanFromCards();
      this.options.onPlanChange();
    };
    ticketSelect.addEventListener('change', () => {
      updateAreaVisibility();
      updateQuantityOptions();
      validateCard();
      syncAndSave();
    });
    areaSelect.addEventListener('change', syncAndSave);
    quantitySelect.addEventListener('change', syncAndSave);
    updateAreaVisibility();
    validateCard();
    return card;
  }

  reindexRuleLabels(): void {
    this.options.ticketRulesContainer
      .querySelectorAll('.ticket-rule-card')
      .forEach((card, index) => {
        const label = card.querySelector('.ticket-rule-label');
        if (label) label.textContent = `VÉ ${index + 1}`;
      });
  }

  rebuildPlanFromCards(): void {
    const plan = this.options.getPurchasePlan();
    const tickets = this.getTicketsForCurrentShowing();
    const rules: TicketRule[] = [];
    for (const card of Array.from(
      this.options.ticketRulesContainer.querySelectorAll('.ticket-rule-card')
    )) {
      const ticketSelect = card.querySelector('.rule-ticket-select') as HTMLSelectElement;
      const areaSelect = card.querySelector('.rule-area-select') as HTMLSelectElement;
      const quantitySelect = card.querySelector('.rule-qty-select') as HTMLSelectElement;
      const ticketValue = ticketSelect?.value ?? '';
      if (!ticketValue) continue;
      const ticket = tickets.find((item) => (item.id ?? item.name) === ticketValue);
      const areaValue = areaSelect?.value ?? '';
      rules.push({
        ticketId: ticket?.id ?? ticketValue,
        ticketName: ticket?.name ?? ticketValue,
        quantity: parseInt(quantitySelect?.value ?? '1', 10) || 1,
        areaId: areaValue || null,
        areaName: areaValue || null,
        seatPolicy: 'ANY_AVAILABLE',
      });
    }
    plan.ticketRules = rules;
    plan.showingId = this.options.showingSelect.value || null;
    plan.allowFallback = this.options.allowFallbackCheckbox.checked;
    plan.fallbackPolicy = this.options.fallbackPolicySelect.value as PurchasePlan['fallbackPolicy'];
    this.options.setPurchasePlan(plan);
  }

  refreshAllRuleCards(): void {
    const rules = [...this.options.getPurchasePlan().ticketRules];
    this.options.ticketRulesContainer.replaceChildren();
    if (rules.length === 0) {
      this.addTicketRuleRow({ ticketId: '', ticketName: '', quantity: 1 });
      return;
    }
    rules.forEach((rule, index) => {
      this.options.ticketRulesContainer.appendChild(this.buildTicketRuleCard(rule, index));
    });
    this.reindexRuleLabels();
  }

  addTicketRuleRow(rule?: Partial<TicketRule>): void {
    const newRule: TicketRule = {
      ticketId: rule?.ticketId ?? '',
      ticketName: rule?.ticketName ?? '',
      quantity: rule?.quantity ?? 1,
      areaId: rule?.areaId ?? null,
      seatPolicy: 'ANY_AVAILABLE',
    };
    const ruleIndex =
      this.options.ticketRulesContainer.querySelectorAll('.ticket-rule-card').length;
    this.options.ticketRulesContainer.appendChild(this.buildTicketRuleCard(newRule, ruleIndex));
    this.reindexRuleLabels();
  }

  ticketOptionLabel(ticket: TicketOption): string {
    const price = ticket.price > 0 ? `${ticket.price.toLocaleString('vi-VN')} đ` : 'Free';
    const availability =
      ticket.availability === 'AVAILABLE'
        ? ''
        : ticket.availability === 'SOLD_OUT'
          ? ' — HẾT VÉ'
          : ` — ${ticket.availability}`;
    return `${ticket.name} — ${price}${availability}`;
  }

  rebuildScopedPlanFromMatrix(): ScopedPurchasePlan {
    const rows = this.options.matrixBody.querySelectorAll('tr');
    const targets: ScopedPurchasePlan['targets'] = [];

    rows.forEach((row) => {
      const showingId = row.dataset.showingId;
      if (!showingId) return;

      const rankInput = row.querySelector('.rank-input') as HTMLInputElement | null;
      const rank = rankInput ? parseInt(rankInput.value, 10) || 1 : 1;
      const checkedBoxes = Array.from(
        row.querySelectorAll<HTMLInputElement>(
          '.tier-checkboxes-cell input[type="checkbox"]:checked'
        )
      );
      const ticketTypeIds = checkedBoxes.map((checkbox) => checkbox.value);

      if (ticketTypeIds.length > 0) targets.push({ showingId, ticketTypeIds, rank });
    });

    const quantity = parseInt(this.options.quantityInput.value, 10) || 1;
    const strategy = (this.options.strategySelect.value as PriorityStrategy) || 'BY_TARGET_ORDER';
    const persistence = {
      maxDurationMinutes:
        this.parseOptionalInteger(this.options.durationInput) ??
        DEFAULT_PERSISTENCE_POLICY.maxDurationMinutes,
      maxAttempts:
        this.parseOptionalInteger(this.options.attemptsInput) ??
        DEFAULT_PERSISTENCE_POLICY.maxAttempts,
      pollIntervalMs: Math.max(
        1500,
        parseInt(this.options.pollIntervalInput.value, 10) ||
          DEFAULT_PERSISTENCE_POLICY.pollIntervalMs
      ),
      jitterRatio:
        parseFloat(this.options.jitterInput.value) || DEFAULT_PERSISTENCE_POLICY.jitterRatio,
      maxPricePerTicket: this.parseOptionalInteger(this.options.maxPriceInput),
      maxTotal: this.parseOptionalInteger(this.options.maxTotalInput),
    };

    const plan: ScopedPurchasePlan = {
      eventId: this.options.getCatalog().eventId ?? '',
      targets,
      quantity,
      strategy,
      persistence,
      allowPartialQuantity: this.options.allowPartialCheckbox.checked,
    };
    this.options.setPlan(plan);
    return plan;
  }

  updateScopedSummaryAndValidation(): void {
    const plan = this.options.getPlan();
    const totalTickets = plan.targets.reduce(
      (count, target) => count + target.ticketTypeIds.length,
      0
    );

    if (totalTickets === 0) {
      this.options.summaryBox.style.display = 'none';
      this.options.validationError.style.display = 'block';
      this.options.validationError.textContent =
        '⚠️ Danh sách mục tiêu (whitelist) đang rỗng. Bạn phải tick chọn ít nhất một hạng vé trong ma trận.';
      return;
    }

    const fragment = document.createDocumentFragment();
    const allowedHeading = document.createElement('strong');
    allowedHeading.textContent = `Sẽ chỉ mua (Số lượng: ${plan.quantity} vé):`;
    fragment.appendChild(allowedHeading);
    for (const target of plan.targets) {
      fragment.appendChild(document.createElement('br'));
      fragment.appendChild(
        document.createTextNode(
          `• Suất [${target.showingId}] (Ưu tiên Rank ${target.rank}): ${target.ticketTypeIds.join(', ')}`
        )
      );
    }
    this.options.summaryAllowed.replaceChildren(fragment);

    const disallowedHeading = document.createElement('strong');
    disallowedHeading.textContent = 'Sẽ KHÔNG mua:';
    this.options.summaryDisallowed.replaceChildren(
      disallowedHeading,
      document.createTextNode(' Bất kỳ suất diễn hay hạng vé nào khác ngoài danh sách trên.')
    );
    this.options.summaryBox.style.display = 'flex';

    const validation = ScopedPurchasePlanValidator.validate(plan, this.options.getCatalog());
    if (validation.valid) {
      this.options.validationError.style.display = 'none';
    } else {
      this.options.validationError.style.display = 'block';
      this.options.validationError.textContent = `❌ Lỗi cấu hình:\n• ${validation.errors.join('\n• ')}`;
    }
  }

  private parseOptionalInteger(
    input: HTMLInputElement | null,
    fallback?: number
  ): number | undefined {
    if (!input || input.value.trim() === '') return fallback;
    return Math.max(0, parseInt(input.value, 10));
  }
}
