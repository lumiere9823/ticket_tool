// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { TicketCatalogSnapshot, TicketOption } from '../../../src/domain/entities/PurchasePlan';
import { createDefaultScopedPurchasePlan } from '../../../src/domain/entities/ScopedPurchasePlan';
import { PurchaseState } from '../../../src/domain/states/PurchaseState';
import { BookingHandoffStep } from '../../../src/application/use-cases/BookingHandoffStep';
import { BookingPreferences } from '../../../src/domain/entities/BookingJourneyModels';
import { EventBus } from '../../../src/application/ports/EventBus';
import { LoggerPort } from '../../../src/application/ports/LoggerPort';
import { TicketboxPageAdapter } from '../../../src/application/ports/TicketboxPageAdapter';
import { PurchaseStateMachine } from '../../../src/domain/state-machine/PurchaseStateMachine';
import { PopupConfigView } from '../../../src/extension/popup/PopupConfigView';
import { PopupMatrixRenderer } from '../../../src/extension/popup/PopupMatrixRenderer';
import { PopupStateView } from '../../../src/extension/popup/PopupStateView';
import { registerPopupEventListeners } from '../../../src/extension/popup/PopupEventListeners';
import { createPopupViewFixture } from '../../fixtures/popup/popupViewFixture';

const ticket: TicketOption = {
  id: 'vip-1',
  name: '<img src=x onerror=alert(1)>',
  price: 1_500_000,
  currency: 'VND',
  mode: 'SEATED',
  availability: 'AVAILABLE',
  selectable: true,
  minQuantity: 1,
  maxQuantity: 4,
  source: 'EVENT_PAGE',
  evidence: ['fixture'],
};

const catalog: TicketCatalogSnapshot = {
  eventId: 'event-1',
  eventTitle: 'Fixture Event',
  showings: [{ id: 'show-1', name: 'Evening', date: null, tickets: [ticket] }],
  tickets: [ticket],
  loadState: 'LOADED',
  loadMessage: '1 ticket discovered',
  discoveredAt: '2026-10-02T00:00:00.000Z',
};

describe('Popup view contracts', () => {
  it('routes ARM, STOP, REFRESH, and optional SAVE through injected handlers', () => {
    const armButton = document.createElement('button');
    const stopButton = document.createElement('button');
    const refreshButton = document.createElement('button');
    const saveButton = document.createElement('button');
    const handlers = {
      onArm: vi.fn(),
      onStop: vi.fn(),
      onRefresh: vi.fn(),
      onSave: vi.fn(),
    };
    registerPopupEventListeners({
      armButton,
      stopButton,
      refreshButton,
      saveButton,
      ...handlers,
    });

    armButton.click();
    stopButton.click();
    refreshButton.click();
    saveButton.click();

    expect(handlers.onArm).toHaveBeenCalledOnce();
    expect(handlers.onStop).toHaveBeenCalledOnce();
    expect(handlers.onRefresh).toHaveBeenCalledOnce();
    expect(handlers.onSave).toHaveBeenCalledOnce();
  });

  it('renders catalog text safely and reports matrix edits through its callback', () => {
    const fixture = createPopupViewFixture();
    const onMatrixChange = vi.fn();
    const renderer = new PopupMatrixRenderer({
      ticketsBody: fixture.ticketsBody,
      emptyState: fixture.emptyState,
      tableWrapper: fixture.tableWrapper,
      matrixBody: fixture.matrixBody,
      getScopedPlan: () => createDefaultScopedPurchasePlan('event-1'),
      formatPrice: (price) => `${price} VND`,
      onMatrixChange,
    });

    renderer.renderCatalogTable(catalog.tickets);
    renderer.renderScopedMatrix(catalog);

    expect(fixture.ticketsBody.querySelector('img')).toBeNull();
    expect(fixture.ticketsBody.textContent).toContain(ticket.name);
    const checkbox = fixture.matrixBody.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox).not.toBeNull();
    checkbox!.checked = true;
    checkbox!.dispatchEvent(new Event('change'));
    expect(onMatrixChange).toHaveBeenCalledTimes(1);
  });

  it('maps matrix input to a scoped target and enforces the polling floor', () => {
    const fixture = createPopupViewFixture();
    const row = document.createElement('tr');
    row.dataset.showingId = 'show-1';
    const rank = document.createElement('input');
    rank.className = 'rank-input';
    rank.value = '3';
    const ticketCell = document.createElement('td');
    ticketCell.className = 'tier-checkboxes-cell';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = 'vip-1';
    checkbox.checked = true;
    ticketCell.appendChild(checkbox);
    row.append(rank, ticketCell);
    fixture.matrixBody.appendChild(row);

    const input = (): HTMLInputElement => document.createElement('input');
    const plan = createDefaultScopedPurchasePlan('event-1');
    const quantityInput = input();
    quantityInput.value = '2';
    const pollIntervalInput = input();
    pollIntervalInput.value = '250';
    const view = new PopupConfigView({
      ticketRulesContainer: document.createElement('div'),
      showingSelect: document.createElement('select'),
      allowFallbackCheckbox: input(),
      fallbackPolicySelect: document.createElement('select'),
      matrixBody: fixture.matrixBody,
      quantityInput,
      strategySelect: document.createElement('select'),
      durationInput: input(),
      attemptsInput: input(),
      pollIntervalInput,
      jitterInput: input(),
      allowPartialCheckbox: input(),
      maxPriceInput: null,
      maxTotalInput: null,
      summaryBox: document.createElement('div'),
      summaryAllowed: document.createElement('div'),
      summaryDisallowed: document.createElement('div'),
      validationError: document.createElement('div'),
      getCatalog: () => catalog,
      getPurchasePlan: () => ({
        showingId: null,
        ticketRules: [],
        fallbackPolicy: 'NEXT_PRIORITY',
        allowFallback: true,
      }),
      setPurchasePlan: vi.fn(),
      getPlan: () => plan,
      setPlan: vi.fn(),
      onPlanChange: vi.fn(),
    });

    const result = view.rebuildScopedPlanFromMatrix();
    expect(result.targets).toEqual([{ showingId: 'show-1', ticketTypeIds: ['vip-1'], rank: 3 }]);
    expect(result.quantity).toBe(2);
    expect(result.persistence.pollIntervalMs).toBe(1500);
  });

  it('renders authoritative state, blocking reason, and running button state', () => {
    const fixture = createPopupViewFixture();
    const view = new PopupStateView({
      stateBadge: fixture.stateBadge,
      currentStepDisplay: fixture.currentStepDisplay,
      blockingReasonContainer: fixture.blockingReasonContainer,
      blockingReasonText: fixture.blockingReasonText,
      interventionBanner: fixture.interventionBanner,
      armButtons: [fixture.armButton, fixture.basicArmButton],
    });

    view.update(PurchaseState.CAPTCHA_REQUIRED, 'Complete the challenge in Ticketbox');

    expect(fixture.stateBadge.textContent).toBe(PurchaseState.CAPTCHA_REQUIRED);
    expect(fixture.stateBadge.classList.contains('intervention')).toBe(true);
    expect(fixture.currentStepDisplay.textContent).toBe(PurchaseState.CAPTCHA_REQUIRED);
    expect(fixture.blockingReasonText.textContent).toBe('Complete the challenge in Ticketbox');
    expect(fixture.interventionBanner.style.display).toBe('flex');
    expect(fixture.armButton.classList.contains('running-active')).toBe(false);
  });
});

describe('Booking handoff contracts', () => {
  it('stops at payment and publishes only a user-action notification', async () => {
    const publish = vi.fn();
    const transition = vi.fn();
    const step = new BookingHandoffStep({
      stateMachine: { transition } as unknown as PurchaseStateMachine,
      adapter: {} as TicketboxPageAdapter,
      eventBus: { publish } as unknown as EventBus,
      logger: { info: vi.fn(), warn: vi.fn() } as unknown as LoggerPort,
      getPageUrl: () => 'https://ticketbox.vn/payment/fixture',
      profileGate: vi.fn(),
      waitForQuestionFormToClose: vi.fn(),
      formNotAdvancedResult: vi.fn(),
      recordSeatCollision: vi.fn(),
    });

    const result = await step.handlePaymentGate();

    expect(result.finalState).toBe(PurchaseState.PAYMENT_GATE);
    expect(result.requiresUserAction).toBe(true);
    expect(transition).toHaveBeenCalledWith({ type: 'PAYMENT_GATE' });
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'NOTIFICATION_EVENT', category: 'PAYMENT_REQUIRED' })
    );
    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ARM_REQUESTED' }));
  });

  it('halts attendee form handling when the profile gate blocks and does not proceed', async () => {
    const proceedToNextStep = vi.fn();
    const result = {
      success: true,
      finalState: PurchaseState.FILLING_ATTENDEE_FORM,
      requiresUserAction: true,
      actionRequiredReason: 'Configure attendee profile',
    };
    const step = new BookingHandoffStep({
      stateMachine: {
        transition: vi.fn(),
        state: PurchaseState.QUESTION_FORM_DETECTED,
      } as unknown as PurchaseStateMachine,
      adapter: {
        getFormSchema: async () => ({
          fields: [
            {
              id: 'name',
              label: 'Name',
              type: 'TEXT',
              required: true,
              value: '',
              selector: '#name',
            },
          ],
          hasConsentCheckbox: false,
        }),
        proceedToNextStep,
      } as unknown as TicketboxPageAdapter,
      eventBus: { publish: vi.fn() } as unknown as EventBus,
      logger: { info: vi.fn(), warn: vi.fn() } as unknown as LoggerPort,
      getPageUrl: () => 'https://ticketbox.vn/question-form',
      profileGate: vi.fn(() => result),
      waitForQuestionFormToClose: vi.fn(),
      formNotAdvancedResult: vi.fn(),
      recordSeatCollision: vi.fn(),
    });
    const preferences: BookingPreferences = {
      categoryPriority: [],
      quantity: 1,
      allowFallback: false,
    };

    const actual = await step.handleQuestionForm(preferences);

    expect(actual).toBe(result);
    expect(proceedToNextStep).not.toHaveBeenCalled();
  });
});
