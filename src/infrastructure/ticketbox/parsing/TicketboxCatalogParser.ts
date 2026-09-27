import {
  EventCatalog,
  ShowingSnapshot,
  TicketType,
  TicketboxPageType,
  TicketMode,
} from '../../../domain/entities/EventCatalog';
import {
  AvailabilityEvaluator,
  RawAvailabilitySignals,
} from '../../../domain/policies/AvailabilityEvaluator';
import { DOMElementLike } from './DOMElementLike';

/**
 * Passive DOM parser extracting normalized EventCatalog from Ticketbox event/booking pages.
 * Operates purely on observable DOM metadata without mutating page state.
 * Enforces:
 * - Separation of Observation from Purchase Authorization
 * - Resilient to layout variations (does not depend on brittle CSS class names alone)
 * - Deterministic parsing
 */
export class TicketboxCatalogParser {
  /**
   * Detects the functional page type based on URL heuristics and authoritative DOM evidence.
   */
  public static detectPageType(url: string, root?: DOMElementLike | undefined): TicketboxPageType {
    const lowerUrl = url.toLowerCase();

    // 1. DOM evidence takes highest precedence if present
    if (root) {
      if (root.querySelector('.seat-map, #seat-map, svg.seatmap, [data-seatmap]') !== null) {
        return 'TICKET_SELECTION';
      }
      if (
        root.querySelector('form.questionnaire-form, #question-form, [data-question-form]') !== null
      ) {
        return 'QUESTION_FORM';
      }
      if (
        root.querySelector('.checkout-container, #payment-methods, [data-checkout-step]') !== null
      ) {
        return 'CHECKOUT';
      }
    }

    // 2. URL heuristics
    if (lowerUrl.includes('/checkout') || lowerUrl.includes('/payment')) {
      return 'CHECKOUT';
    }
    if (lowerUrl.includes('/question-form') || lowerUrl.includes('/attendee-info')) {
      return 'QUESTION_FORM';
    }
    if (lowerUrl.includes('/select-ticket') || lowerUrl.includes('/booking')) {
      return 'TICKET_SELECTION';
    }
    if (lowerUrl.includes('/select-showing') || lowerUrl.includes('/showing')) {
      return 'SHOWING_SELECTION';
    }

    // 3. Event page detection: URL pattern and DOM ticket-info section
    const isEventUrl =
      lowerUrl.includes('ticketbox.vn') &&
      (/\/[a-zA-Z0-9-]+-\d+/.test(lowerUrl) || lowerUrl.includes('/event/'));

    const hasEventDOM =
      root &&
      (root.querySelector('#ticket-info') !== null ||
        root.querySelector('h1') !== null ||
        root.querySelector('[data-event-id]') !== null);

    if (isEventUrl || hasEventDOM) {
      return 'EVENT';
    }

    return 'UNKNOWN';
  }

  /**
   * Parses an EventCatalog from a DOM tree.
   */
  public static parseCatalog(root: DOMElementLike, url = ''): EventCatalog {
    const eventId = this.extractEventId(url, root);
    const eventTitle = this.extractEventTitle(root);
    const pageType = this.detectPageType(url, root);

    const showings = this.extractShowings(root, pageType);

    return {
      eventId,
      eventTitle,
      eventUrl: url,
      showings,
    };
  }

  private static extractEventId(url: string, root: DOMElementLike): string | null {
    // 1. From DOM data attribute
    const dataEl = root.querySelector('[data-event-id]');
    if (dataEl) {
      const id = dataEl.getAttribute('data-event-id');
      if (id && id.trim()) return id.trim();
    }

    // 2. From URL slug pattern e.g. -26416? or /event/1234
    const slugMatch = url.match(/-(\d+)(?:[/?#]|$)/);
    if (slugMatch && slugMatch[1]) {
      return slugMatch[1];
    }

    const eventMatch = url.match(/\/event\/([a-zA-Z0-9_-]+)/);
    if (eventMatch && eventMatch[1]) {
      return eventMatch[1];
    }

    return null;
  }

  private static extractEventTitle(root: DOMElementLike): string | null {
    // Check h1
    const h1 = root.querySelector('h1');
    if (h1 && h1.textContent.trim()) {
      return h1.textContent.trim();
    }

    // Check meta og:title or twitter:title if available in DOM
    const metaTitle = root.querySelector('meta[property="og:title"], meta[name="twitter:title"]');
    if (metaTitle) {
      const content = metaTitle.getAttribute('content');
      if (content && content.trim() && !content.includes('Ticketbox - Nền tảng')) {
        return content.trim().replace(/\s*\|\s*Ticketbox.*$/i, '');
      }
    }

    // Check title element
    const titleEl = root.querySelector('title');
    if (titleEl && titleEl.textContent.trim()) {
      const cleaned = titleEl.textContent.trim().replace(/\s*\|\s*Ticketbox.*$/i, '');
      if (cleaned && !cleaned.toLowerCase().includes('ticketbox')) {
        return cleaned;
      }
    }

    // Check event title class or attribute
    const titleClassEl = root.querySelector(
      '.event-title, [data-event-title], [class*="event-title"], .banner-title, #banner h2, h2'
    );
    if (titleClassEl && titleClassEl.textContent.trim()) {
      return titleClassEl.textContent.trim();
    }

    // Check banner image alt
    const bannerImg = root.querySelector('#banner img[alt], .banner img[alt], img[alt]');
    if (bannerImg) {
      const alt = bannerImg.getAttribute('alt');
      if (
        alt &&
        alt.trim() &&
        !alt.toLowerCase().includes('logo') &&
        !alt.toLowerCase().includes('ticketbox')
      ) {
        return alt.trim();
      }
    }

    return null;
  }

  private static extractShowings(
    root: DOMElementLike,
    pageType: TicketboxPageType
  ): ShowingSnapshot[] {
    const showingContainers = root.querySelectorAll(
      '#ticket-info .ant-collapse-item, .ant-collapse-item, .showing-item, [data-showing-id], .session-tab, .date-tab'
    );

    if (showingContainers.length > 0) {
      const snapshots: ShowingSnapshot[] = [];
      for (const showingEl of showingContainers) {
        const id =
          showingEl.getAttribute('data-showing-id') || showingEl.getAttribute('id') || null;
        const nameEl = showingEl.querySelector('.showing-name, .tab-title, .second-row, h3, h4');
        const name = nameEl ? nameEl.textContent.trim() : null;
        const dateEl = showingEl.querySelector('.showing-date, .tab-date, .first-row, time');
        const date = dateEl ? dateEl.textContent.trim() : null;

        const showingBtn = showingEl.querySelector(
          '#select-showing-btn, [id*="select-showing"], button'
        );
        const isShowingBtnEnabled =
          showingBtn !== null
            ? !showingBtn.hasAttribute('disabled') &&
              showingBtn.getAttribute('aria-disabled') !== 'true'
            : false;

        const ticketTypes = this.extractTicketTypesFromContainer(
          showingEl,
          pageType,
          isShowingBtnEnabled
        );
        snapshots.push({
          id,
          name,
          date,
          ticketTypes,
        });
      }
      return snapshots;
    }

    // Single unified showing
    const ticketTypes = this.extractTicketTypesFromRoot(root, pageType);
    return [
      {
        id: null,
        name: null,
        date: null,
        ticketTypes,
      },
    ];
  }

  private static extractTicketTypesFromRoot(
    root: DOMElementLike,
    pageType: TicketboxPageType
  ): TicketType[] {
    // Prefer searching within #ticket-info or ticket containers
    const ticketInfoContainer =
      root.querySelector('#ticket-info') ||
      root.querySelector('.ticket-info, section.tickets, [data-section="tickets"]') ||
      root;

    const showingBtn = ticketInfoContainer.querySelector(
      '#select-showing-btn, [id*="select-showing"], button'
    );
    const isShowingBtnEnabled =
      showingBtn !== null
        ? !showingBtn.hasAttribute('disabled') &&
          showingBtn.getAttribute('aria-disabled') !== 'true'
        : false;

    return this.extractTicketTypesFromContainer(ticketInfoContainer, pageType, isShowingBtnEnabled);
  }

  private static extractTicketTypesFromContainer(
    container: DOMElementLike,
    pageType: TicketboxPageType,
    parentControlEnabled = false
  ): TicketType[] {
    const itemElements = container.querySelectorAll(
      '.content-row, [class*="content-row"], .ticket-item, .ticket-row, [data-ticket-id], [data-ticket], [role="listitem"], .ticket-card'
    );

    const ticketTypes: TicketType[] = [];

    if (itemElements.length > 0) {
      for (const itemEl of itemElements) {
        const ticket = this.parseSingleTicket(itemEl, pageType, parentControlEnabled);
        if (ticket) {
          ticketTypes.push(ticket);
        }
      }
      return ticketTypes;
    }

    // Fallback: If no dedicated ticket-item wrappers exist, look for table rows or candidate sections
    const rows = container.querySelectorAll('tr, .row');
    for (const row of rows) {
      const ticket = this.parseSingleTicket(row, pageType, parentControlEnabled);
      if (ticket) {
        ticketTypes.push(ticket);
      }
    }

    return ticketTypes;
  }

  private static parseSingleTicket(
    itemEl: DOMElementLike,
    pageType: TicketboxPageType,
    parentControlEnabled = false
  ): TicketType | null {
    const rawText = itemEl.textContent.trim();
    if (!rawText) return null;

    const evidence: string[] = [];

    // 1. Name Extraction
    const nameEl = itemEl.querySelector(
      '.title-tickettype, [class*="title-tickettype"], .ticket-name, .name, [data-ticket-name], h3, h4, h5, strong, .title'
    );
    let name = '';
    if (nameEl && nameEl.textContent.trim()) {
      name = nameEl.textContent.trim();
      evidence.push('NAME_FROM_HEADING_ELEMENT');
    } else {
      // Split rawText lines and take first meaningful line
      const lines = rawText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      name = lines[0] || 'Unknown Ticket';
      evidence.push('NAME_FROM_FIRST_TEXT_LINE');
    }

    // 2. ID Extraction
    const id =
      itemEl.getAttribute('data-ticket-id') ||
      itemEl.getAttribute('data-id') ||
      itemEl.getAttribute('id') ||
      null;
    if (id) evidence.push(`ID_OBSERVED_${id}`);

    // 3. Price Extraction (VND)
    const price = this.extractVNDPrice(itemEl, rawText, evidence);

    // 4. Ticket Mode Classification
    const mode = this.classifyMode(name, rawText, evidence);

    // 5. Quantity Constraints
    const quantityInfo = this.extractQuantityConstraints(itemEl, evidence);

    // 6. Availability & Selectability
    const statusBadgeEl = itemEl.querySelector(
      '#status-badge, [id*="status-badge"], .status-badge, [class*="status-badge"], .badge, .status'
    );
    const statusBadgeText = statusBadgeEl ? statusBadgeEl.textContent.trim() : '';
    const isStatusBadgeDisabled = statusBadgeEl
      ? statusBadgeEl.getAttribute('class')?.includes('disabled') || false
      : false;

    const buttonEl = itemEl.querySelector('button, [role="button"], input[type="submit"]');
    const inputEl = itemEl.querySelector('input[type="number"], select');

    const isRowDisabled =
      itemEl.hasAttribute('disabled') ||
      itemEl.getAttribute('aria-disabled') === 'true' ||
      itemEl.getAttribute('class')?.includes('disabled') ||
      (statusBadgeEl !== null &&
        isStatusBadgeDisabled &&
        statusBadgeText.toLowerCase().includes('hết'));

    const isExplicitSoldOut =
      statusBadgeText.toLowerCase().includes('hết') ||
      rawText.toLowerCase().includes('hết vé') ||
      rawText.toLowerCase().includes('sold out');

    const isExplicitAvailable =
      statusBadgeText.toLowerCase().includes('còn vé') ||
      statusBadgeText.toLowerCase().includes('đang mở bán') ||
      rawText.toLowerCase().includes('còn vé') ||
      rawText.toLowerCase().includes('đang mở bán');

    const isControlEnabled =
      !isExplicitSoldOut &&
      !isRowDisabled &&
      (buttonEl !== null
        ? !buttonEl.hasAttribute('disabled') && buttonEl.getAttribute('aria-disabled') !== 'true'
        : inputEl !== null
          ? !inputEl.hasAttribute('disabled')
          : parentControlEnabled || isExplicitAvailable);

    const signals: RawAvailabilitySignals = {
      visibleText: rawText,
      buttonLabel: buttonEl ? buttonEl.textContent.trim() : statusBadgeText || undefined,
      isDisabled: isRowDisabled || isExplicitSoldOut,
      isAriaDisabled: itemEl.getAttribute('aria-disabled') === 'true',
      dataAvailability:
        itemEl.getAttribute('data-availability') ||
        (isExplicitSoldOut ? 'sold_out' : isExplicitAvailable ? 'available' : undefined),
      isControlEnabled,
      mode,
    };

    const evalResult = AvailabilityEvaluator.evaluateAvailability(signals);
    evidence.push(...evalResult.evidence);

    return {
      id,
      name,
      price,
      mode,
      availability: evalResult.availability,
      minQuantity: quantityInfo.minQuantity,
      maxQuantity: quantityInfo.maxQuantity,
      selectedQuantity: quantityInfo.selectedQuantity,
      selectable: evalResult.selectable,
      source: {
        page: pageType === 'TICKET_SELECTION' ? 'BOOKING' : 'EVENT',
        evidence,
      },
      rawLabel: rawText,
    };
  }

  private static extractVNDPrice(
    itemEl: DOMElementLike,
    rawText: string,
    evidence: string[]
  ): { amount: number; currency: 'VND' } {
    // Check dedicated price element first
    const priceEl = itemEl.querySelector(
      '.price-value, .tkt-price, .price, .ticket-price, [data-price]'
    );
    const searchTarget = (priceEl ? priceEl.textContent : rawText).replace(/\u00a0/g, ' ');

    // Matches e.g.: "3.000.000 đ", "3,500,000 VND", "3.000.000đ", "100.000 VNĐ", "900000 VNĐ", "3000000"
    const priceMatch =
      searchTarget.match(/(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(?:đ|vnd|vnđ|d)/iu) ||
      searchTarget.match(/\b(\d{1,3}(?:[.,]\d{3})+)\b/);

    if (priceMatch && priceMatch[1]) {
      const sanitizedNumber = priceMatch[1].replace(/[.,]/g, '');
      const amount = parseInt(sanitizedNumber, 10);
      if (!isNaN(amount) && amount >= 0) {
        evidence.push(`PRICE_PARSED_VND_${amount}`);
        return { amount, currency: 'VND' };
      }
    }

    evidence.push('PRICE_NOT_OBSERVABLE');
    return { amount: 0, currency: 'VND' };
  }

  private static classifyMode(name: string, rawText: string, evidence: string[]): TicketMode {
    const combined = (name + ' ' + rawText).toLowerCase();

    if (combined.includes('standing') || combined.includes('đứng')) {
      evidence.push('MODE_STANDING_DETECTED');
      return 'STANDING';
    }

    if (
      combined.includes('seated') ||
      combined.includes('ngồi') ||
      combined.includes('ghế') ||
      combined.includes('seat')
    ) {
      evidence.push('MODE_SEATED_DETECTED');
      return 'SEATED';
    }

    if (combined.includes('zone') || combined.includes('khu')) {
      evidence.push('MODE_ZONE_DETECTED');
      return 'ZONE';
    }

    evidence.push('MODE_DEFAULT_STANDING');
    return 'STANDING';
  }

  private static extractQuantityConstraints(
    itemEl: DOMElementLike,
    evidence: string[]
  ): {
    minQuantity: number | null;
    maxQuantity: number | null;
    selectedQuantity: number;
  } {
    const input = itemEl.querySelector(
      'input[type="number"], input.qty-input, [data-quantity-input]'
    );

    if (input) {
      const minAttr = input.getAttribute('min');
      const maxAttr = input.getAttribute('max');
      const valAttr = input.getAttribute('value');

      const minQuantity = minAttr !== null ? parseInt(minAttr, 10) : null;
      const maxQuantity = maxAttr !== null ? parseInt(maxAttr, 10) : null;
      const selectedQuantity = valAttr !== null ? parseInt(valAttr, 10) || 0 : 0;

      if (maxQuantity !== null && !isNaN(maxQuantity)) {
        evidence.push(`OBSERVABLE_MAX_QUANTITY_${maxQuantity}`);
      }
      if (minQuantity !== null && !isNaN(minQuantity)) {
        evidence.push(`OBSERVABLE_MIN_QUANTITY_${minQuantity}`);
      }

      return {
        minQuantity: minQuantity !== null && !isNaN(minQuantity) ? minQuantity : null,
        maxQuantity: maxQuantity !== null && !isNaN(maxQuantity) ? maxQuantity : null,
        selectedQuantity,
      };
    }

    // Check select dropdown
    const select = itemEl.querySelector('select');
    if (select) {
      const options = select.querySelectorAll('option');
      if (options.length > 0) {
        const values = options
          .map((o) => parseInt(o.getAttribute('value') || o.textContent, 10))
          .filter((v) => !isNaN(v));

        if (values.length > 0) {
          const min = Math.min(...values);
          const max = Math.max(...values);
          evidence.push(`SELECT_OPTIONS_RANGE_${min}_${max}`);
          return {
            minQuantity: min,
            maxQuantity: max,
            selectedQuantity: 0,
          };
        }
      }
    }

    // No observable quantity controls
    evidence.push('QUANTITY_CONSTRAINTS_NOT_OBSERVABLE');
    return {
      minQuantity: null,
      maxQuantity: null,
      selectedQuantity: 0,
    };
  }
}
