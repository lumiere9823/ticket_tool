import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TicketboxJourneyAdapter } from '../../../src/infrastructure/ticketbox/TicketboxJourneyAdapter';
import { SanitizedLogger } from '../../../src/infrastructure/logging/SanitizedLogger';
import { UserProfileData, SeatArea, Seat } from '../../../src/domain/entities/BookingJourneyModels';
import { createDefaultScopedPurchasePlan } from '../../../src/domain/entities/ScopedPurchasePlan';
import {
  wrapBrowserElement,
  parseHtmlToDOMElementLike,
} from '../../../src/infrastructure/ticketbox/parsing/DOMElementLike';
import { ExecuteBookingJourneyUseCase } from '../../../src/application/use-cases/ExecuteBookingJourneyUseCase';
import { PurchaseStateMachine } from '../../../src/domain/state-machine/PurchaseStateMachine';
import { PurchaseState } from '../../../src/domain/states/PurchaseState';
import { ChromeMessageBus } from '../../../src/infrastructure/messaging/ChromeMessageBus';
import { ActionGuard } from '../../../src/domain/policies/ActionGuard';
import { BookingError } from '../../../src/domain/errors/BookingErrors';

describe('FormAutofillJourney — Input Masking, React Synthetic Events & Collision Handling', () => {
  let logger: SanitizedLogger;

  beforeEach(() => {
    logger = new SanitizedLogger();
  });

  describe('P5-1: Attendee Form Autofill & Input Masking', () => {
    it('should invoke HTMLInputElement.prototype.value setter descriptor and dispatch focus/input/change/blur', async () => {
      // Mock DOM element simulating a browser HTMLInputElement with a React value tracker
      const dispatchedEvents: string[] = [];
      let trackerValue: string | null = null;
      let internalValue = '';

      const mockInput = {
        tagName: 'INPUT',
        id: 'attendee-phone',
        name: 'attendee-phone',
        type: 'tel',
        getAttribute(name: string) {
          if (name === 'id') return 'attendee-phone';
          if (name === 'name') return 'attendee-phone';
          if (name === 'type') return 'tel';
          if (name === 'required') return '';
          return null;
        },
        hasAttribute(name: string) {
          return ['id', 'name', 'type', 'required'].includes(name);
        },
        setAttribute() {},
        removeAttribute() {},
        style: {},
        closest() {
          return null;
        },
        dispatchEvent(evt: { type: string; bubbles?: boolean }) {
          dispatchedEvents.push(evt.type);
          return true;
        },
        _valueTracker: {
          setValue(val: string) {
            trackerValue = val;
          },
        },
      } as unknown as HTMLInputElement;

      // Define property setter descriptor on mockInput to simulate React's prototype interception
      let descriptorSetterCalled = false;
      Object.defineProperty(mockInput, 'value', {
        get() {
          return internalValue;
        },
        set(val: string) {
          descriptorSetterCalled = true;
          internalValue = val;
        },
        configurable: true,
      });

      const wrappedMock = wrapBrowserElement(mockInput as unknown as Element);
      // Create a root container wrapping our input
      const root = {
        tagName: 'div',
        textContent: '',
        parentElement: null,
        getAttribute: () => null,
        hasAttribute: () => false,
        querySelector: (sel: string) => (sel.includes('phone') ? wrappedMock : null),
        querySelectorAll: () => [wrappedMock],
      };

      const adapter = new TicketboxJourneyAdapter(logger, root);

      // Spy on getFormSchema to return a schema for this field
      vi.spyOn(adapter, 'getFormSchema').mockResolvedValue({
        fields: [
          {
            id: 'attendee-phone',
            label: 'Số điện thoại *',
            type: 'PHONE',
            required: true,
            value: '',
            selector: '#attendee-phone',
          },
        ],
        hasConsentCheckbox: false,
      });

      const profile: UserProfileData = {
        fullName: 'Nguyen Van A',
        email: 'test@example.com',
        phone: '0901234567',
        agreeToTerms: true,
      };

      const result = await adapter.fillAttendeeForm(profile);

      expect(result.allSatisfied).toBe(true);
      expect(result.missingFields).toHaveLength(0);
      expect(descriptorSetterCalled).toBe(true);
      expect(internalValue).toBe('0901234567');
      expect(trackerValue).toBe(''); // React _valueTracker reset
      expect(dispatchedEvents).toContain('focus');
      expect(dispatchedEvents).toContain('input');
      expect(dispatchedEvents).toContain('change');
      expect(dispatchedEvents).toContain('blur');
    });

    it('should invoke HTMLTextAreaElement.prototype.value setter for textarea inputs', async () => {
      const dispatchedEvents: string[] = [];
      let internalValue = '';
      let textareaSetterCalled = false;

      const mockTextarea = {
        tagName: 'TEXTAREA',
        id: 'attendee-address',
        name: 'attendee-address',
        getAttribute(name: string) {
          if (name === 'id') return 'attendee-address';
          if (name === 'name') return 'attendee-address';
          return null;
        },
        hasAttribute(name: string) {
          return ['id', 'name'].includes(name);
        },
        setAttribute() {},
        removeAttribute() {},
        style: {},
        closest() {
          return null;
        },
        dispatchEvent(evt: { type: string }) {
          dispatchedEvents.push(evt.type);
          return true;
        },
      } as unknown as HTMLTextAreaElement;

      Object.defineProperty(mockTextarea, 'value', {
        get() {
          return internalValue;
        },
        set(val: string) {
          textareaSetterCalled = true;
          internalValue = val;
        },
        configurable: true,
      });

      const wrappedTextarea = wrapBrowserElement(mockTextarea as unknown as Element);
      const root = {
        tagName: 'div',
        textContent: '',
        parentElement: null,
        getAttribute: () => null,
        hasAttribute: () => false,
        querySelector: () => wrappedTextarea,
        querySelectorAll: () => [wrappedTextarea],
      };

      const adapter = new TicketboxJourneyAdapter(logger, root);

      vi.spyOn(adapter, 'getFormSchema').mockResolvedValue({
        fields: [
          {
            id: 'attendee-address',
            label: 'Địa chỉ / Tỉnh thành',
            type: 'ADDRESS',
            required: false,
            value: '',
            selector: '#attendee-address',
          },
        ],
        hasConsentCheckbox: false,
      });

      const profile: UserProfileData = {
        fullName: 'Nguyen Van A',
        email: 'test@example.com',
        phone: '0901234567',
        address: '123 Nguyen Hue, Quan 1, TP.HCM',
        agreeToTerms: true,
      };

      const result = await adapter.fillAttendeeForm(profile);

      expect(result.allSatisfied).toBe(true);
      expect(textareaSetterCalled).toBe(true);
      expect(internalValue).toBe('123 Nguyen Hue, Quan 1, TP.HCM');
      expect(dispatchedEvents).toContain('input');
      expect(dispatchedEvents).toContain('change');
    });

    it('should set select dropdown and dispatch change and input events', async () => {
      const dispatchedEvents: string[] = [];
      let selectValue = '';

      const mockSelect = {
        tagName: 'SELECT',
        id: 'attendee-gender',
        options: [
          { value: 'male', text: 'Nam' },
          { value: 'female', text: 'Nữ' },
        ],
        getAttribute(name: string) {
          if (name === 'id') return 'attendee-gender';
          return null;
        },
        hasAttribute(name: string) {
          return name === 'id';
        },
        setAttribute() {},
        removeAttribute() {},
        style: {},
        closest() {
          return null;
        },
        dispatchEvent(evt: { type: string }) {
          dispatchedEvents.push(evt.type);
          return true;
        },
      } as unknown as HTMLSelectElement;

      Object.defineProperty(mockSelect, 'value', {
        get() {
          return selectValue;
        },
        set(val: string) {
          selectValue = val;
        },
        configurable: true,
      });

      const wrappedSelect = wrapBrowserElement(mockSelect as unknown as Element);
      const root = {
        tagName: 'div',
        textContent: '',
        parentElement: null,
        getAttribute: () => null,
        hasAttribute: () => false,
        querySelector: () => wrappedSelect,
        querySelectorAll: () => [wrappedSelect],
      };

      const adapter = new TicketboxJourneyAdapter(logger, root);

      vi.spyOn(adapter, 'getFormSchema').mockResolvedValue({
        fields: [
          {
            id: 'attendee-gender',
            label: 'Giới tính',
            type: 'SELECT',
            required: false,
            value: '',
            selector: '#attendee-gender',
          },
        ],
        hasConsentCheckbox: false,
      });

      const profile: UserProfileData = {
        fullName: 'Nguyen Van A',
        email: 'test@example.com',
        phone: '0901234567',
        gender: 'Nam',
        agreeToTerms: true,
      };

      const result = await adapter.fillAttendeeForm(profile);

      expect(result.allSatisfied).toBe(true);
      expect(selectValue).toBe('male');
      expect(dispatchedEvents).toContain('change');
      expect(dispatchedEvents).toContain('input');
    });

    it('should set checkbox checked property and click wrapper container when available', async () => {
      let checkboxChecked = false;
      let wrapperClicked = false;
      const dispatchedEvents: string[] = [];

      const mockWrapper = {
        click() {
          wrapperClicked = true;
        },
      };

      const mockCheckbox = {
        tagName: 'INPUT',
        type: 'checkbox',
        id: 'consent-box',
        getAttribute(name: string) {
          if (name === 'type') return 'checkbox';
          if (name === 'id') return 'consent-box';
          return null;
        },
        hasAttribute(name: string) {
          return ['type', 'id'].includes(name);
        },
        setAttribute() {},
        removeAttribute() {},
        style: {},
        click() {},
        closest(sel: string) {
          if (sel.includes('ant-checkbox-wrapper') || sel.includes('checkbox')) {
            return mockWrapper;
          }
          return null;
        },
        dispatchEvent(evt: { type: string }) {
          dispatchedEvents.push(evt.type);
          return true;
        },
      } as unknown as HTMLInputElement;

      Object.defineProperty(mockCheckbox, 'checked', {
        get() {
          return checkboxChecked;
        },
        set(val: boolean) {
          checkboxChecked = val;
        },
        configurable: true,
      });

      const wrappedCheckbox = wrapBrowserElement(mockCheckbox as unknown as Element);
      const root = {
        tagName: 'div',
        textContent: '',
        parentElement: null,
        getAttribute: () => null,
        hasAttribute: () => false,
        querySelector: () => wrappedCheckbox,
        querySelectorAll: () => [wrappedCheckbox],
      };

      const adapter = new TicketboxJourneyAdapter(logger, root);

      vi.spyOn(adapter, 'getFormSchema').mockResolvedValue({
        fields: [
          {
            id: 'consent-box',
            label: 'Tôi đồng ý với điều khoản sử dụng',
            type: 'CHECKBOX',
            required: true,
            value: '',
            selector: '#consent-box',
          },
        ],
        hasConsentCheckbox: true,
        consentLabel: 'Tôi đồng ý với điều khoản sử dụng',
      });

      const profile: UserProfileData = {
        fullName: 'Nguyen Van A',
        email: 'test@example.com',
        phone: '0901234567',
        agreeToTerms: true,
      };

      const result = await adapter.fillAttendeeForm(profile);

      expect(result.allSatisfied).toBe(true);
      expect(result.isConsentBlocked).toBe(false);
      expect(checkboxChecked).toBe(true);
      expect(wrapperClicked).toBe(true);
      expect(dispatchedEvents).toContain('change');
      expect(dispatchedEvents).toContain('input');
    });
  });

  describe('P5-2: Consent Gate & Payment Gate Boundary Verification', () => {
    it('should halt at CONSENT_REQUIRED when user profile has agreeToTerms=false', async () => {
      const stateMachine = new PurchaseStateMachine(PurchaseState.READY);
      const eventBus = new ChromeMessageBus();
      const publishSpy = vi.spyOn(eventBus, 'publish');

      const html = `
        <div id="booking-page">
          <div class="ticket-item" data-ticket-id="ticket-1">
            <h3 class="ticket-name">General Admission</h3>
            <span class="price">500.000 đ</span>
            <button type="button">Mua ngay</button>
          </div>
          <form class="attendee-form" id="attendee-form">
            <div class="form-group">
              <label for="f-name">Họ và tên *</label>
              <input type="text" id="f-name" name="name" required />
            </div>
            <div class="form-group">
              <label for="f-phone">Số điện thoại *</label>
              <input type="tel" id="f-phone" name="phone" required />
            </div>
            <div class="form-group">
              <label for="f-email">Email *</label>
              <input type="email" id="f-email" name="email" required />
            </div>
            <div class="form-group">
              <label class="checkbox">
                <input type="checkbox" id="terms-consent" name="agreeTerms" required />
                Tôi đồng ý với điều khoản sử dụng của Ticketbox
              </label>
            </div>
          </form>
        </div>
      `;

      const root = parseHtmlToDOMElementLike(html);
      const adapter = new TicketboxJourneyAdapter(logger, root);
      const useCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, eventBus, logger);

      const result = await useCase.execute({
        categoryPriority: ['General Admission'],
        quantity: 1,
        allowFallback: false,
        userProfile: {
          fullName: 'Nguyen Van A',
          email: 'a@example.com',
          phone: '0901234567',
          agreeToTerms: false, // Refused consent
        },
      });

      expect(result.success).toBe(true);
      expect(result.finalState).toBe(PurchaseState.CONSENT_REQUIRED);
      expect(result.requiresUserAction).toBe(true);
      expect(result.actionRequiredReason).toBe('User consent required');
      expect(stateMachine.state).toBe(PurchaseState.CONSENT_REQUIRED);

      // Verify ActionGuard forbids automated booking actions in CONSENT_REQUIRED
      expect(
        ActionGuard.canExecuteAction({ currentState: stateMachine.state, action: 'PROCEED' })
          .allowed
      ).toBe(false);
      expect(
        ActionGuard.canExecuteAction({ currentState: stateMachine.state, action: 'SELECT_TICKET' })
          .allowed
      ).toBe(false);
      expect(
        ActionGuard.canExecuteAction({ currentState: stateMachine.state, action: 'RESERVE' })
          .allowed
      ).toBe(false);
      expect(
        ActionGuard.canExecuteAction({ currentState: stateMachine.state, action: 'FILL_FORM' })
          .allowed
      ).toBe(false);

      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'NOTIFICATION_EVENT',
          category: 'CONSENT_REQUIRED',
        })
      );
    });

    it('should halt at PAYMENT_GATE and forbid automated submission or reservation', async () => {
      const stateMachine = new PurchaseStateMachine(PurchaseState.READY);
      const eventBus = new ChromeMessageBus();
      const publishSpy = vi.spyOn(eventBus, 'publish');

      const html = `
        <div id="booking-page">
          <div class="ticket-item" data-ticket-id="ticket-1">
            <h3 class="ticket-name">Standard Ticket</h3>
            <span class="price">500.000 đ</span>
            <button type="button">Mua ngay</button>
          </div>
        </div>
      `;

      const root = parseHtmlToDOMElementLike(html);
      const adapter = new TicketboxJourneyAdapter(logger, root);
      // Simulate that the page is in checkout/payment URL
      adapter.setCustomUrl('https://ticketbox.vn/payment/12345');

      const useCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, eventBus, logger);

      const result = await useCase.execute({
        categoryPriority: ['Standard Ticket'],
        quantity: 1,
        allowFallback: false,
        userProfile: {
          fullName: 'Nguyen Van A',
          email: 'a@example.com',
          phone: '0901234567',
          agreeToTerms: true,
        },
      });

      expect(result.success).toBe(true);
      expect(result.finalState).toBe(PurchaseState.PAYMENT_GATE);
      expect(result.requiresUserAction).toBe(true);
      expect(stateMachine.state).toBe(PurchaseState.PAYMENT_GATE);

      // Verify ActionGuard allows USER_ACTION for user manual payment handoff but strictly forbids automated reservation / actions
      expect(
        ActionGuard.canExecuteAction({ currentState: stateMachine.state, action: 'USER_ACTION' })
          .allowed
      ).toBe(true);
      expect(
        ActionGuard.canExecuteAction({ currentState: stateMachine.state, action: 'PAYMENT' })
          .allowed
      ).toBe(false);
      expect(
        ActionGuard.canExecuteAction({ currentState: stateMachine.state, action: 'SELECT_TICKET' })
          .allowed
      ).toBe(false);
      expect(
        ActionGuard.canExecuteAction({ currentState: stateMachine.state, action: 'SELECT_SEATS' })
          .allowed
      ).toBe(false);
      expect(
        ActionGuard.canExecuteAction({ currentState: stateMachine.state, action: 'RESERVE' })
          .allowed
      ).toBe(false);

      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'NOTIFICATION_EVENT',
          category: 'PAYMENT_REQUIRED',
        })
      );
    });
  });

  describe('P5-3: Journey Execution Retry Bounds & Collision Recovery', () => {
    it('should switch to alternative area when current area reaches collision threshold (MAX_AREA_COLLISIONS=2)', async () => {
      const stateMachine = new PurchaseStateMachine(PurchaseState.READY);
      const eventBus = new ChromeMessageBus();

      // HTML with 2 areas for the same ticket tier: Area 1 and Area 2
      const html = `
        <div id="booking-page">
          <div class="ticket-item" data-ticket-id="ticket-seated">
            <h3 class="ticket-name">VIP Zone</h3>
            <span class="price">1.000.000 đ</span>
            <button type="button">Chọn ghế</button>
          </div>
          <div class="seat-map" id="seat-map"></div>
        </div>
      `;

      const root = parseHtmlToDOMElementLike(html);
      const adapter = new TicketboxJourneyAdapter(logger, root);
      adapter.setCustomUrl('https://ticketbox.vn/booking/select-ticket');

      const areas: SeatArea[] = [
        {
          id: 'area-1',
          name: 'VIP Zone - Khối A',
          price: 1000000,
          mode: 'SEATED',
          ticketTypeId: 'ticket-seated',
          ticketTypeName: 'VIP Zone',
          selectable: true,
          availability: 'AVAILABLE',
        },
        {
          id: 'area-2',
          name: 'VIP Zone - Khối B',
          price: 1000000,
          mode: 'SEATED',
          ticketTypeId: 'ticket-seated',
          ticketTypeName: 'VIP Zone',
          selectable: true,
          availability: 'AVAILABLE',
        },
      ];

      vi.spyOn(adapter, 'discoverAreas').mockResolvedValue(areas);

      let areaSelectedCount = 0;
      const selectedAreaIds: string[] = [];

      vi.spyOn(adapter, 'selectArea').mockImplementation(async (id: string) => {
        areaSelectedCount++;
        selectedAreaIds.push(id);
        return true;
      });

      // Mock discoverSeats to return no available seats in Area 1 (triggering area exhaustion)
      // and available seats in Area 2
      vi.spyOn(adapter, 'discoverSeats').mockImplementation(async (areaOrName?: string) => {
        if (!areaOrName || areaOrName.includes('area-1') || areaOrName.includes('Khối A')) {
          // No seats in area 1
          return [];
        }
        return [
          {
            id: 'b-01',
            label: 'B01',
            row: 'B',
            number: 1,
            area: 'VIP Zone - Khối B',
            areaId: 'area-2',
            status: 'AVAILABLE',
            price: 1000000,
            x: 0,
            y: 0,
            selectable: true,
          },
        ];
      });

      vi.spyOn(adapter, 'selectSpecificSeats').mockResolvedValue(true);
      vi.spyOn(adapter, 'proceedToNextStep').mockImplementation(async () => {
        adapter.setCustomUrl('https://ticketbox.vn/payment/123');
        return true;
      });

      const useCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, eventBus, logger, {
        maxRetries: 4,
        maxAreaCollisions: 2,
      });

      const result = await useCase.execute({
        categoryPriority: ['VIP Zone'],
        quantity: 1,
        allowFallback: false,
        userProfile: {
          fullName: 'Nguyen Van A',
          email: 'a@example.com',
          phone: '0901234567',
          agreeToTerms: true,
        },
      });

      expect(result.success).toBe(true);
      expect(areaSelectedCount).toBeGreaterThanOrEqual(2);
      expect(selectedAreaIds).toContain('area-1');
      expect(selectedAreaIds).toContain('area-2');
      expect(result.selection?.areaId).toBe('area-2');
      expect(result.selection?.seats).toEqual(['B01']);
    });

    it('should blacklist unavailable seat and reselect alternative on -1242 seat collision error modal', async () => {
      const stateMachine = new PurchaseStateMachine(PurchaseState.READY);
      const eventBus = new ChromeMessageBus();

      const html = `
        <div id="booking-page">
          <div class="ticket-item" data-ticket-id="ticket-seated">
            <h3 class="ticket-name">VIP Zone</h3>
            <span class="price">1.000.000 đ</span>
            <button type="button">Chọn ghế</button>
          </div>
          <div class="seat-map" id="seat-map"></div>
        </div>
      `;

      const root = parseHtmlToDOMElementLike(html);
      const adapter = new TicketboxJourneyAdapter(logger, root);
      adapter.setCustomUrl('https://ticketbox.vn/booking/select-ticket');

      const availableSeats: Seat[] = [
        {
          id: 'a-01',
          label: 'A01',
          row: 'A',
          number: 1,
          area: 'VIP Zone',
          status: 'AVAILABLE',
          price: 1000000,
          x: 0,
          y: 0,
          selectable: true,
        },
        {
          id: 'a-02',
          label: 'A02',
          row: 'A',
          number: 2,
          area: 'VIP Zone',
          status: 'AVAILABLE',
          price: 1000000,
          x: 10,
          y: 0,
          selectable: true,
        },
      ];

      vi.spyOn(adapter, 'discoverSeats').mockResolvedValue(availableSeats);

      let attempt = 0;
      const selectedSeatsHistory: string[][] = [];

      vi.spyOn(adapter, 'selectSpecificSeats').mockImplementation(async (seatIds: string[]) => {
        attempt++;
        selectedSeatsHistory.push(seatIds);
        return true;
      });

      // On attempt 1, detectAndHandleErrorModal finds -1242 seat collision on A01 once (modal dismissed after discovery)
      let modalDismissed = false;
      vi.spyOn(adapter, 'detectAndHandleErrorModal').mockImplementation(async () => {
        if (attempt === 1 && !modalDismissed) {
          modalDismissed = true;
          return {
            hasError: true,
            isSeatUnavailable: true,
            seatLabel: 'A01',
            message: 'Ghế A01 đã được đặt bởi người khác (-1242)',
          };
        }
        return { hasError: false, isSeatUnavailable: false };
      });

      vi.spyOn(adapter, 'proceedToNextStep').mockImplementation(async () => {
        if (attempt >= 2) {
          adapter.setCustomUrl('https://ticketbox.vn/payment/123');
        }
        return true;
      });

      const useCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, eventBus, logger, {
        maxRetries: 3,
      });

      const result = await useCase.execute({
        categoryPriority: ['VIP Zone'],
        quantity: 1,
        allowFallback: false,
        userProfile: {
          fullName: 'Nguyen Van A',
          email: 'a@example.com',
          phone: '0901234567',
          agreeToTerms: true,
        },
      });

      expect(result.success).toBe(true);
      // Attempt 1 picked A01, collided (-1242), blacklisted A01, and attempt 2 picked A02!
      expect(selectedSeatsHistory[0]).toEqual(['a-01']);
      expect(selectedSeatsHistory[1]).toEqual(['a-02']);
      expect(adapter.isSeatBlacklisted('A01')).toBe(true);
      expect(result.selection?.seats).toEqual(['A02']);
    });

    it('should transition to WAITING_FOR_STOCK when retries exceed MAX_RETRIES under a scoped purchase plan', async () => {
      const stateMachine = new PurchaseStateMachine(PurchaseState.READY);
      const eventBus = new ChromeMessageBus();

      const html = `
        <div id="booking-page">
          <div class="ticket-item" data-ticket-id="ticket-seated">
            <h3 class="ticket-name">VIP Zone</h3>
            <span class="price">1.000.000 đ</span>
            <button type="button">Chọn ghế</button>
          </div>
        </div>
      `;

      const root = parseHtmlToDOMElementLike(html);
      const adapter = new TicketboxJourneyAdapter(logger, root);

      // discoverSeats always throws recoverable BookingError
      vi.spyOn(adapter, 'discoverSeats').mockRejectedValue(
        new BookingError({
          code: 'SEAT_UNAVAILABLE',
          message: 'Seat network glitch',
          state: PurchaseState.SELECTING_SEATS,
          recoverable: true,
        })
      );

      const useCase = new ExecuteBookingJourneyUseCase(stateMachine, adapter, eventBus, logger, {
        maxRetries: 2,
      });

      const result = await useCase.execute({
        categoryPriority: ['VIP Zone'],
        quantity: 1,
        allowFallback: false,
        scopedPurchasePlan: {
          ...createDefaultScopedPurchasePlan('event-1'),
          targets: [
            {
              showingId: 'default',
              ticketTypeIds: ['ticket-seated'],
              rank: 1,
            },
          ],
          quantity: 1,
        },
        userProfile: {
          fullName: 'Nguyen Van A',
          email: 'a@example.com',
          phone: '0901234567',
          agreeToTerms: true,
        },
      });

      expect(result.success).toBe(false);
      expect(result.finalState).toBe(PurchaseState.WAITING_FOR_STOCK);
      expect(stateMachine.state).toBe(PurchaseState.WAITING_FOR_STOCK);
    });
  });
});
