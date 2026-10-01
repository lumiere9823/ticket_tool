/**
 * Page-World Bridge for Ticketbox Purchase Assistant.
 *
 * Runs strictly in the MAIN execution world (page context) with direct access to:
 * - window.Konva (Stage, Layer, Group, Circle, Text shapes)
 * - Canvas DOM element and native hit dispatching
 *
 * Communicates with the extension Content Script (isolated world) via
 * window.postMessage and window CustomEvents.
 */

interface KonvaNodeLike {
  attrs?: Record<string, unknown>;
  parent?: KonvaNodeLike;
  x?: () => number;
  y?: () => number;
  text?: () => string;
  id?: () => string;
  name?: () => string;
  fill?: (color?: string) => string | void;
  stroke?: (color?: string) => string | void;
  getAttr?: (name: string) => unknown;
  getChildren?: () => KonvaNodeLike[];
  getAbsolutePosition?: () => { x: number; y: number };
  getClientRect?: (config?: { relativeTo?: unknown }) => {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  fire: (eventType: string, evt?: Record<string, unknown>, bubble?: boolean) => void;
}

interface KonvaStageLike extends KonvaNodeLike {
  container: () => HTMLElement;
  content?: HTMLElement;
  getContent?: () => HTMLElement;
  width: () => number;
  height: () => number;
  scaleX: () => number;
  scaleY: () => number;
  find: (selector: string) => KonvaNodeLike[];
  findOne?: (selector: string) => KonvaNodeLike | null;
  getAbsoluteTransform?: () => {
    point: (pos: { x: number; y: number }) => { x: number; y: number };
    copy?: () => {
      invert: () => {
        point: (pos: { x: number; y: number }) => { x: number; y: number };
      };
    };
  };
  getIntersection?: (pos: { x: number; y: number }) => KonvaNodeLike | null;
}

interface KonvaGlobalLike {
  stages?: KonvaStageLike[];
}

interface BridgeSeatPayload {
  id: string;
  label?: string;
  x?: number;
  y?: number;
  row?: string;
  number?: number;
}

interface BridgeRequestPayload {
  areaId?: string;
  areaName?: string;
  ticketTypeId?: string;
  quantity?: number;
  ticketName?: string;
  selector?: string;
  text?: string;
  coords?: { x?: number; y?: number; width?: number; height?: number };
  seats?: BridgeSeatPayload[];
}

interface BridgeRequestMessage {
  source: 'TICKETBOX_ASSISTANT_CONTENT';
  type: string;
  requestId: string;
  payload?: BridgeRequestPayload;
}

interface BridgeResponseMessage {
  source: 'TICKETBOX_ASSISTANT_PAGE';
  type: string;
  requestId: string;
  success: boolean;
  data?: unknown | undefined;
  error?: string | undefined;
}

function getKonva(): KonvaGlobalLike | null {
  const g = window as unknown as Record<string, unknown>;
  if (g.Konva && typeof g.Konva === 'object') {
    return g.Konva as KonvaGlobalLike;
  }
  return null;
}

function getActiveStage(): KonvaStageLike | null {
  const konva = getKonva();
  if (!konva || !Array.isArray(konva.stages) || konva.stages.length === 0) {
    return null;
  }

  // After SPA navigations Konva.stages can keep destroyed stages whose container is detached.
  const attached = konva.stages.filter((stage) => {
    try {
      return stage.container().isConnected;
    } catch {
      return false;
    }
  });
  const pool = attached.length > 0 ? attached : konva.stages;

  // Pick the largest interactive stage (ignoring small minimaps < 200px)
  let best: KonvaStageLike | null = null;
  let bestArea = 0;
  for (const stage of pool) {
    if (typeof stage.width !== 'function' || typeof stage.height !== 'function') continue;
    const area = stage.width() * stage.height();
    if (stage.width() > 200 && area > bestArea) {
      best = stage;
      bestArea = area;
    }
  }

  return best ?? pool[0] ?? null;
}

/**
 * Konva binds its DOM listeners on the `.konvajs-content` element (a CHILD of stage.container()).
 * Events dispatched on the container bubble upwards and never reach Konva, so the target must be
 * the content element (or the canvas inside it).
 */
function getStageEventTarget(stage: KonvaStageLike): HTMLElement {
  const content = typeof stage.getContent === 'function' ? stage.getContent() : stage.content;
  return content ?? stage.container();
}

function dispatchPointerSequence(target: Element, clientX: number, clientY: number): void {
  if (typeof PointerEvent === 'undefined') return;
  const base: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX,
    clientY,
    button: 0,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  };
  const canvas = target.querySelector('canvas') || target;
  canvas.dispatchEvent(new PointerEvent('pointermove', { ...base, buttons: 0 }));
  canvas.dispatchEvent(new PointerEvent('pointerdown', { ...base, buttons: 1 }));
  canvas.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0 }));
}

function dispatchMouseSequence(target: Element, clientX: number, clientY: number): void {
  const base: MouseEventInit = { bubbles: true, cancelable: true, view: window, clientX, clientY };
  const canvas = target.querySelector('canvas') || target;
  canvas.dispatchEvent(new MouseEvent('mousemove', { ...base, buttons: 0 }));
  canvas.dispatchEvent(new MouseEvent('mousedown', { ...base, button: 0, buttons: 1 }));
  canvas.dispatchEvent(new MouseEvent('mouseup', { ...base, button: 0, buttons: 0 }));
  canvas.dispatchEvent(new MouseEvent('click', { ...base, button: 0, buttons: 0 }));
  if (target !== canvas) {
    target.dispatchEvent(new MouseEvent('click', { ...base, button: 0, buttons: 0 }));
  }
}

/**
 * Dispatches native events at a container-relative point. Konva derives `click` itself from a
 * matching down/up pair, so a synthetic `click` is deliberately NOT dispatched (it would be ignored
 * by Konva or, worse, double-trigger a toggle handler).
 */
function dispatchNativeEvents(stage: KonvaStageLike, clientX: number, clientY: number): void {
  const target = getStageEventTarget(stage);
  dispatchPointerSequence(target, clientX, clientY);
  dispatchMouseSequence(target, clientX, clientY);
}

/**
 * Checks if the page is currently in SECTION seat view.
 */
function isSectionViewActive(): boolean {
  // Ticketbox renders .seat_status in SECTION view
  if (document.querySelector('.seat_status, [class*="seat_status"]')) {
    return true;
  }

  // Back to zone map button rendered in section view
  const backButtons = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
  for (const btn of backButtons) {
    const text = (btn.textContent || '').toLowerCase();
    if (
      text.includes('quay lại bản đồ') ||
      text.includes('back to zone') ||
      text.includes('đổi khu vực')
    ) {
      return true;
    }
  }

  // Check if circles exist on stage
  const stage = getActiveStage();
  if (stage && typeof stage.find === 'function') {
    const circles = stage.find('Circle');
    if (circles.length > 5) {
      return true;
    }
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Triggers a click on a DOM element in the MAIN execution world.
 * Directly invokes React synthetic event handlers (__reactProps$* / __reactEventHandlers$*)
 * if present to ensure React component state updates immediately, followed by native
 * MouseEvents and el.click().
 */
function triggerClick(el: HTMLElement): void {
  // 1. React Fiber props invocation (Main World direct access)
  try {
    const reactKey = Object.keys(el).find(
      (k) => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$')
    );
    if (reactKey) {
      const props = (el as unknown as Record<string, unknown>)[reactKey] as
        Record<string, unknown> | undefined;
      if (typeof props?.onClick === 'function') {
        props.onClick({
          type: 'click',
          target: el,
          currentTarget: el,
          preventDefault: () => {},
          stopPropagation: () => {},
          persist: () => {},
          bubbles: true,
        });
      }
    }
  } catch {
    // ignore
  }

  // 2. Full native mouse/pointer sequence
  try {
    const opts: MouseEventInit = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  } catch {
    // ignore
  }

  // 3. Fallback standard .click()
  try {
    el.click();
  } catch {
    // ignore
  }
}

/**
 * Finds the currently visible area modal element on page.
 */
function findAreaModal(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const modals = document.querySelectorAll('.ant-modal, [role="dialog"], [class*="modal"]');
  for (const m of Array.from(modals)) {
    const el = m as HTMLElement;
    if (el.offsetParent !== null || window.getComputedStyle(el).display !== 'none') {
      const text = el.innerText || el.textContent || '';
      if (
        text.includes('Khu') ||
        text.includes('Số lượng') ||
        text.includes('Tiếp tục') ||
        text.includes('Chọn vé') ||
        text.includes('Tối đa')
      ) {
        return el;
      }
    }
  }
  return null;
}

/**
 * Checks whether an Area Selection Modal is visible on screen.
 */
function hasAreaModal(): boolean {
  return findAreaModal() !== null;
}

/**
 * Reads the current quantity shown inside a modal.
 */
function readModalCurrentQuantity(modal: HTMLElement): number {
  const input = modal.querySelector('input') as HTMLInputElement | null;
  if (input) {
    if (input.value && input.value.trim() !== '') {
      const p = parseInt(input.value, 10);
      if (!isNaN(p)) return p;
    }
    const ariaVal = input.getAttribute('aria-valuenow');
    if (ariaVal) {
      const p = parseInt(ariaVal, 10);
      if (!isNaN(p)) return p;
    }
  }
  const numbers = Array.from(modal.querySelectorAll('span, div, p, strong'))
    .map((el) => ({ el, text: (el.textContent || '').trim() }))
    .filter((item) => /^\d+$/.test(item.text) && item.el.children.length === 0);
  if (numbers.length > 0) {
    const p = parseInt(numbers[0]!.text, 10);
    if (!isNaN(p)) return p;
  }
  return 0;
}

/**
 * Finds stepper button (plus or minus) inside a modal.
 */
function findModalStepperButton(modal: HTMLElement, type: 'plus' | 'minus'): HTMLElement | null {
  const buttons = Array.from(modal.querySelectorAll('button, [role="button"], span, div'));
  for (const btn of buttons) {
    const text = (btn.textContent || '').trim();
    const aria = btn.getAttribute('aria-label') || '';
    const cls =
      btn.className && typeof btn.className === 'string' ? btn.className.toLowerCase() : '';
    if (type === 'plus') {
      if (
        text === '+' ||
        aria.toLowerCase().includes('plus') ||
        aria.toLowerCase().includes('increase') ||
        cls.includes('plus') ||
        cls.includes('increase') ||
        cls.includes('up')
      ) {
        return btn as HTMLElement;
      }
    } else {
      if (
        text === '-' ||
        text === '–' ||
        aria.toLowerCase().includes('minus') ||
        aria.toLowerCase().includes('decrease') ||
        cls.includes('minus') ||
        cls.includes('decrease') ||
        cls.includes('down')
      ) {
        return btn as HTMLElement;
      }
    }
  }
  return null;
}

/**
 * Finds continue button inside a modal.
 */
function findModalContinueButton(modal: HTMLElement): HTMLElement | null {
  const candidates = Array.from(modal.querySelectorAll('button, [role="button"], a.ant-btn'));
  for (const c of candidates) {
    const text = (c.textContent || '').toLowerCase().trim();
    if (
      (text.includes('tiếp tục') ||
        text.includes('xác nhận') ||
        text.includes('continue') ||
        text.includes('đồng ý')) &&
      !c.hasAttribute('disabled') &&
      !c.classList.contains('ant-btn-disabled') &&
      !c.classList.contains('disabled')
    ) {
      return c as HTMLElement;
    }
  }
  return null;
}

/**
 * Handles CONFIRM_AREA_MODAL from content script in MAIN world.
 * Adjusts quantity stepper and clicks the modal's continue button synchronously.
 */
async function handleConfirmAreaModal(
  payload?: BridgeRequestPayload
): Promise<{ success: boolean; message?: string }> {
  const targetQty = payload?.quantity ?? 1;
  const modal = findAreaModal();
  if (!modal) {
    return { success: false, message: 'Area modal not found in DOM' };
  }

  const plusBtn = findModalStepperButton(modal, 'plus');
  const minusBtn = findModalStepperButton(modal, 'minus');
  let currentQty = readModalCurrentQuantity(modal);

  const maxSteps = Math.min(10, Math.abs(targetQty - currentQty) || 1);
  for (let i = 0; i < maxSteps && currentQty !== targetQty; i++) {
    if (currentQty < targetQty && plusBtn) {
      triggerClick(plusBtn);
      await sleep(50);
    } else if (currentQty > targetQty && minusBtn) {
      triggerClick(minusBtn);
      await sleep(50);
    }
    currentQty = readModalCurrentQuantity(modal);
  }

  // Also update input value if present
  const input = modal.querySelector('input') as HTMLInputElement | null;
  if (input) {
    try {
      const proto = window.HTMLInputElement?.prototype;
      const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
      if (descriptor && descriptor.set) {
        descriptor.set.call(input, String(targetQty));
      } else {
        input.value = String(targetQty);
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch {
      // ignore
    }
  }

  // Allow React state setter to complete and enable the continue button
  await sleep(80);

  // Find and click the continue button in modal
  const continueBtn = findModalContinueButton(modal);
  if (continueBtn) {
    triggerClick(continueBtn);
    return { success: true, message: 'Modal stepper adjusted and continue clicked' };
  }

  return { success: true, message: `Modal quantity set to ${currentQty}` };
}

/**
 * Handles CLICK_ELEMENT from content script in MAIN world.
 */
function handleClickElement(payload?: BridgeRequestPayload): {
  success: boolean;
  message?: string;
} {
  if (typeof document === 'undefined') return { success: false, message: 'No document' };
  let el: HTMLElement | null = null;
  if (payload?.selector) {
    el = document.querySelector(payload.selector) as HTMLElement | null;
  }
  if (!el && payload?.text) {
    const search = payload.text.toLowerCase().trim();
    const all = Array.from(document.querySelectorAll('button, [role="button"], a, div, span'));
    for (const item of all) {
      const t = (item.textContent || '').toLowerCase().trim();
      if (t === search || t.includes(search)) {
        el = item as HTMLElement;
        break;
      }
    }
  }
  if (el) {
    triggerClick(el);
    return { success: true };
  }
  return { success: false, message: 'Element not found' };
}

/**
 * Handles SELECT_AREA in Konva.
 */
async function handleSelectArea(
  payload?: BridgeRequestPayload
): Promise<{ success: boolean; transitioned: boolean; message?: string }> {
  const areaId = payload?.areaId;
  const areaName = payload?.areaName;
  const ticketTypeId = payload?.ticketTypeId;
  const coords = payload?.coords;

  if (!areaId && !areaName && !ticketTypeId) {
    return {
      success: false,
      transitioned: false,
      message: 'Missing areaId, areaName, or ticketTypeId',
    };
  }

  // If already in section view or area modal is already open, view transition is already fulfilled
  if (isSectionViewActive() || hasAreaModal()) {
    return { success: true, transitioned: true, message: 'Already in section view or modal open' };
  }

  const safeName = areaName ? areaName.toLowerCase().trim() : '';
  const safeNameClean = safeName.replace(/[\s-]+/g, '_');
  const safeNameSpaced = safeName.replace(/[\s_-]+/g, ' ');
  const safeNameCompact = safeName.replace(/[\s_-]+/g, '');

  // Check if an area card can be clicked directly in DOM (e.g. right sidebar or ticket legend)
  if (typeof document !== 'undefined' && safeName) {
    const tierCandidates = Array.from(
      document.querySelectorAll(
        '.legend-item, [class*="legend-item"], [class*="tier-item"], [class*="ticket-item"], [class*="section-item"], .ticket-legend > div, aside div[role="button"], .sidebar div[role="button"]'
      )
    );
    for (const tc of tierCandidates) {
      const txt = (tc.textContent || '').toLowerCase();
      const cleanTxt = txt.replace(/[\s_-]+/g, ' ');
      const compactTxt = txt.replace(/[\s_-]+/g, '');
      const matchesName =
        txt.includes(safeName) ||
        cleanTxt.includes(safeNameSpaced) ||
        compactTxt.includes(safeNameCompact);
      if (matchesName) {
        triggerClick(tc as HTMLElement);
        await sleep(60);
        if (isSectionViewActive() || hasAreaModal()) {
          return { success: true, transitioned: true, message: 'Clicked DOM area item directly' };
        }
      }
    }
  }

  const stage = getActiveStage();
  if (!stage) {
    return { success: false, transitioned: false, message: 'No Konva stage found' };
  }

  const groups = typeof stage.find === 'function' ? stage.find('Group') : [];
  let targetGroup: KonvaNodeLike | null = null;

  // 1. Match by ticketTypeId
  if (ticketTypeId) {
    const safeTtId = String(ticketTypeId).trim();
    for (const g of groups) {
      const gTtId = g.attrs
        ? (g.attrs['ticketTypeId'] ?? g.attrs['data-ticket-type-id'] ?? g.attrs['data-ticket-id'])
        : undefined;
      const matched = String(gTtId ?? '').trim();
      if (matched && matched === safeTtId) {
        targetGroup = g;
        break;
      }
    }
  }

  // 2. Match by data-section-id attribute or areaId
  if (!targetGroup && areaId) {
    const safeId = String(areaId).trim();
    for (const g of groups) {
      const gSectionId = g.attrs
        ? (g.attrs['data-section-id'] ?? g.attrs['sectionId'] ?? g.attrs['id'])
        : undefined;
      const directAttr = typeof g.getAttr === 'function' ? g.getAttr('data-section-id') : undefined;
      const matched = String(gSectionId ?? directAttr ?? '').trim();
      if (matched && (matched === safeId || matched.includes(safeId) || safeId.includes(matched))) {
        targetGroup = g;
        break;
      }
    }
  }

  // 3. Match by areaName (normalized with underscores and spaces)
  if (!targetGroup && safeName) {
    for (const g of groups) {
      const gName = String(g.attrs?.name ?? '').toLowerCase();
      const gId = String(g.attrs?.id ?? '').toLowerCase();
      if (
        gName === safeName ||
        gName === safeNameClean ||
        gName === safeNameSpaced ||
        gName === safeNameCompact ||
        gId === safeName ||
        gId === safeNameClean ||
        gId === safeNameSpaced ||
        gId === safeNameCompact ||
        (safeName.length > 3 && (gName.includes(safeName) || safeName.includes(gName))) ||
        (safeNameClean.length > 3 &&
          (gName.includes(safeNameClean) || safeNameClean.includes(gName))) ||
        (safeNameSpaced.length > 3 &&
          (gName.includes(safeNameSpaced) || safeNameSpaced.includes(gName)))
      ) {
        targetGroup = g;
        break;
      }
      // Check child text shapes inside the group
      if (typeof g.getChildren === 'function') {
        const children = g.getChildren();
        const hasMatchingText = children.some((c) => {
          const txt =
            typeof c.text === 'function'
              ? c.text().toLowerCase()
              : String(c.attrs?.text ?? '').toLowerCase();
          const cleanTxt = txt.replace(/[\s_-]+/g, ' ');
          const compactTxt = txt.replace(/[\s_-]+/g, '');
          return (
            txt &&
            (txt === safeName ||
              txt === safeNameClean ||
              txt === safeNameSpaced ||
              cleanTxt === safeNameSpaced ||
              compactTxt === safeNameCompact ||
              safeName.includes(txt) ||
              txt.includes(safeName) ||
              cleanTxt.includes(safeNameSpaced) ||
              safeNameSpaced.includes(cleanTxt))
          );
        });
        if (hasMatchingText) {
          targetGroup = g;
          break;
        }
      }
    }
  }

  if (!targetGroup) {
    // If no group matched specifically, check if only one interactive group exists
    const interactiveGroups = groups.filter((g) => {
      const secId = g.attrs ? g.attrs['data-section-id'] : undefined;
      return secId !== undefined;
    });
    if (interactiveGroups.length === 1) {
      targetGroup = interactiveGroups[0] ?? null;
    }
  }

  if (!targetGroup && coords && coords.x !== undefined && coords.y !== undefined) {
    // Coordinate fallback on canvas container
    const container = stage.container();
    if (container) {
      const cRect = container.getBoundingClientRect();
      const cx = coords.width ? coords.x + coords.width / 2 : coords.x;
      const cy = coords.height ? coords.y + coords.height / 2 : coords.y;
      const scaleX = typeof stage.scaleX === 'function' ? stage.scaleX() : 1;
      const scaleY = typeof stage.scaleY === 'function' ? stage.scaleY() : 1;
      const clientX = cRect.left + cx * scaleX;
      const clientY = cRect.top + cy * scaleY;
      dispatchNativeEvents(stage, clientX, clientY);
      return {
        success: true,
        transitioned: false,
        message: 'Dispatched simulated coordinate click to canvas',
      };
    }
  }

  if (!targetGroup) {
    return {
      success: false,
      transitioned: false,
      message: `Section group for area '${areaId ?? areaName}' not found in Konva stage`,
    };
  }

  // Fire Konva click and tap events
  targetGroup.fire(
    'click',
    { evt: { type: 'click' }, target: targetGroup, currentTarget: targetGroup },
    true
  );
  targetGroup.fire(
    'tap',
    { evt: { type: 'tap' }, target: targetGroup, currentTarget: targetGroup },
    true
  );

  // Fire on children shapes
  if (typeof targetGroup.getChildren === 'function') {
    const children = targetGroup.getChildren();
    for (const child of children) {
      child.fire('click', { evt: { type: 'click' }, target: child, currentTarget: child }, true);
      child.fire('tap', { evt: { type: 'tap' }, target: child, currentTarget: child }, true);
    }
  }

  // Also calculate screen coordinates and dispatch native events to the canvas
  const container = stage.container();
  if (container && typeof targetGroup.getClientRect === 'function') {
    try {
      const rect = targetGroup.getClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        const cRect = container.getBoundingClientRect();
        const clientX = cRect.left + rect.x + rect.width / 2;
        const clientY = cRect.top + rect.y + rect.height / 2;
        dispatchNativeEvents(stage, clientX, clientY);
      }
    } catch {
      // ignore rect calculation error
    }
  }

  // Check view transition immediately or poll (up to 300ms)
  if (isSectionViewActive() || hasAreaModal()) {
    return { success: true, transitioned: true };
  }
  const maxWait = 6;
  for (let i = 0; i < maxWait; i++) {
    await sleep(50);
    if (isSectionViewActive() || hasAreaModal()) {
      return { success: true, transitioned: true };
    }
  }

  return { success: true, transitioned: isSectionViewActive() || hasAreaModal() };
}

const SIGNATURE_POLL_MS = 50;
const SIGNATURE_POLL_MAX = 10;

interface SeatAttemptReport {
  id: string;
  label?: string | undefined;
  found: boolean;
  candidates: number;
  changed: boolean;
  method?: string | undefined;
  before?: string | undefined;
  after?: string | undefined;
  note?: string | undefined;
}

/** Visual signature of a seat node: legend colours (white / green / red) live in fill + stroke. */
function nodeSignature(node: KonvaNodeLike): string {
  const fill = typeof node.fill === 'function' ? String(node.fill() ?? '') : '';
  const stroke = typeof node.stroke === 'function' ? String(node.stroke() ?? '') : '';
  return `${fill}|${stroke}`;
}

/** Waits until the node's visual state differs from `before` (React/Redux re-render is async) or DOM confirms selection. */
async function waitForSignatureOrDomChange(
  node: KonvaNodeLike,
  before: string,
  seatLabel?: string
): Promise<boolean> {
  for (let i = 0; i < SIGNATURE_POLL_MAX; i++) {
    await sleep(SIGNATURE_POLL_MS);
    if (nodeSignature(node) !== before) return true;
    if (hasDomSelectionIndicator(seatLabel)) return true;
  }
  return false;
}

/** Checks if the DOM footer, checkout bar, or summary reflects seat selection. */
function hasDomSelectionIndicator(label?: string): boolean {
  if (typeof document === 'undefined') return false;
  const bar = document.querySelector(
    '[class*="bottom"], [class*="footer"], .checkout-bar, .booking-bar, [class*="seat-info"], [class*="action-bar"], [class*="summary"]'
  );
  if (!bar) return false;
  const text = (bar.textContent || '').toUpperCase();

  // If label is specified, it must explicitly appear in the DOM selection container
  if (label) {
    const cleanLabel = label.toUpperCase().trim();
    if (text.includes(cleanLabel)) return true;
    const tags = Array.from(
      document.querySelectorAll(
        '[class*="seat-tag"], [class*="seat-item"], [class*="selected-seat"], [class*="seatTag"], [class*="badge"]'
      )
    );
    for (const tag of tags) {
      if ((tag.textContent || '').toUpperCase().includes(cleanLabel)) return true;
    }
    return false;
  }

  // If no specific label, check for positive count / seat tag indicating at least 1 selected seat
  if (text.includes('VUI LÒNG') || text.includes('0 VÉ') || text.includes('0 GHẾ')) {
    return false;
  }

  const hasPositiveCount = /[1-9]\d*\s*(?:VÉ|GHẾ|SEATS?|TICKETS?)/i.test(text);
  const hasPrice = /[1-9]\d{2,}(?:[.,]\d{3})*\s*(?:Đ|VND)/i.test(text);
  const hasSeatTag =
    document.querySelector(
      '[class*="seat-tag"], [class*="selected-seat"], [class*="seat-item"]'
    ) !== null;

  return hasPositiveCount || (hasPrice && !text.includes('CHỌN VÉ')) || hasSeatTag;
}

/**
 * Finds Circle/Shape nodes matching seat attributes (id, label) or coordinates (local or absolute).
 * Returns candidates sorted by distance (exact attribute matches have distance 0).
 */
function findSeatCandidates(
  stage: KonvaStageLike,
  seat: BridgeSeatPayload
): { node: KonvaNodeLike; distance: number }[] {
  const circles = typeof stage.find === 'function' ? stage.find('Circle') : [];
  const out: { node: KonvaNodeLike; distance: number }[] = [];

  const norm = (val: unknown): string =>
    String(val ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');

  const targetIdNorm = norm(seat.id);
  const targetLabelNorm = norm(seat.label);
  const targetRowNorm = norm(seat.row);
  const targetNum =
    typeof seat.number === 'number'
      ? seat.number
      : parseInt(String(seat.label || '').replace(/^\D+/g, ''), 10) || 0;

  // 1. Direct and normalized attribute matching across all circles
  for (const circle of circles) {
    const attrs = circle.attrs || {};
    const cId = norm(attrs.id ?? (typeof circle.id === 'function' ? circle.id() : ''));
    const cSeatId = norm(
      attrs.seatId ?? attrs['data-seat-id'] ?? attrs['data-id'] ?? attrs.seat_id
    );
    const cName = norm(attrs.name ?? (typeof circle.name === 'function' ? circle.name() : ''));
    const cLabel = norm(
      attrs.label ??
        attrs.seatLabel ??
        attrs.seat_label ??
        attrs.seatCode ??
        attrs.seat_code ??
        attrs.code
    );
    const cRow = norm(attrs.row ?? attrs.rowName ?? attrs.row_name);
    const cNum =
      parseInt(
        String(attrs.number ?? attrs.seatNumber ?? attrs.seat_number ?? attrs.num ?? ''),
        10
      ) || 0;

    // Check data sub-object if present
    const dataObj = (attrs.data && typeof attrs.data === 'object' ? attrs.data : null) as Record<
      string,
      unknown
    > | null;
    const dId = dataObj ? norm(dataObj.id ?? dataObj.seatId ?? dataObj.seat_id) : '';
    const dLabel = dataObj
      ? norm(dataObj.label ?? dataObj.name ?? dataObj.seatCode ?? dataObj.code)
      : '';
    const dRow = dataObj ? norm(dataObj.row ?? dataObj.rowName) : '';
    const dNum = dataObj
      ? parseInt(String(dataObj.number ?? dataObj.seatNumber ?? ''), 10) || 0
      : 0;

    // Check parent group attributes (e.g. Group for row 'A2' containing Circle '12')
    const parent = circle.parent;
    const pAttrs = parent?.attrs || {};
    const pName = norm(pAttrs.name ?? (typeof parent?.name === 'function' ? parent.name() : ''));
    const pRow = norm(pAttrs.row ?? pAttrs.rowName);

    // Exact matches
    const isIdMatch =
      targetIdNorm.length > 0 &&
      (cId === targetIdNorm || cSeatId === targetIdNorm || dId === targetIdNorm);

    const isLabelMatch =
      targetLabelNorm.length > 0 &&
      (cLabel === targetLabelNorm ||
        cName === targetLabelNorm ||
        dLabel === targetLabelNorm ||
        (cRow && cNum && `${cRow}${cNum}` === targetLabelNorm) ||
        (dRow && dNum && `${dRow}${dNum}` === targetLabelNorm) ||
        (pRow && cNum && `${pRow}${cNum}` === targetLabelNorm) ||
        (pName && cNum && `${pName}${cNum}` === targetLabelNorm) ||
        (pName && cName && `${pName}${cName}` === targetLabelNorm));

    const isRowColMatch =
      targetRowNorm.length > 0 &&
      targetNum > 0 &&
      ((cRow === targetRowNorm && cNum === targetNum) ||
        (dRow === targetRowNorm && dNum === targetNum) ||
        (pRow === targetRowNorm && cNum === targetNum) ||
        (pName === targetRowNorm && cNum === targetNum));

    if (isIdMatch || isLabelMatch || isRowColMatch) {
      out.push({ node: circle, distance: 0 });
      continue;
    }
  }

  if (out.length > 0) {
    return out;
  }

  // 2. Coordinate-based matching with Scale-Invariance
  if (typeof seat.x === 'number' && typeof seat.y === 'number') {
    const stageTransform =
      typeof stage.getAbsoluteTransform === 'function' ? stage.getAbsoluteTransform() : null;
    const stageScaleX =
      typeof stage.scaleX === 'function' && stage.scaleX() !== 0 ? Math.abs(stage.scaleX()) : 1;
    const stageScaleY =
      typeof stage.scaleY === 'function' && stage.scaleY() !== 0 ? Math.abs(stage.scaleY()) : 1;

    // Calculate dynamic tolerance adjusted for stage scaling (large vs small screens)
    const baseTolerance = 30.0;
    const dynamicTolerance = Math.max(25.0, baseTolerance * Math.max(stageScaleX, stageScaleY));

    // Calculate stage transformed expected coordinates
    const expectedAbs = stageTransform ? stageTransform.point({ x: seat.x, y: seat.y }) : null;

    for (const circle of circles) {
      const lx = typeof circle.x === 'function' ? circle.x() : 0;
      const ly = typeof circle.y === 'function' ? circle.y() : 0;
      let ax = lx;
      let ay = ly;
      if (typeof circle.getAbsolutePosition === 'function') {
        try {
          const abs = circle.getAbsolutePosition();
          if (abs && typeof abs.x === 'number' && typeof abs.y === 'number') {
            ax = abs.x;
            ay = abs.y;
          }
        } catch {
          // ignore
        }
      }

      let minD = Infinity;

      // Check distance in unscaled local coords
      const localD = Math.hypot(lx - seat.x, ly - seat.y);
      if (localD < minD) minD = localD;

      // Check distance in stage absolute coords
      if (expectedAbs) {
        const stageD = Math.hypot(ax - expectedAbs.x, ay - expectedAbs.y);
        if (stageD < minD) minD = stageD;
      }

      // Check direct absolute distance
      const directAbsD = Math.hypot(ax - seat.x, ay - seat.y);
      if (directAbsD < minD) minD = directAbsD;

      // Check inverted stage coords
      if (stageTransform && typeof stageTransform.copy === 'function') {
        try {
          const unscaled = stageTransform.copy().invert().point({ x: ax, y: ay });
          const unscaledD = Math.hypot(unscaled.x - seat.x, unscaled.y - seat.y);
          if (unscaledD < minD) minD = unscaledD;
        } catch {
          // ignore
        }
      }

      if (minD <= dynamicTolerance) {
        out.push({ node: circle, distance: minD });
      }
    }
  }

  // 3. Fallback: check other shapes (Shape, Rect, Path) if circles didn't match
  if (out.length === 0 && typeof stage.find === 'function') {
    const allShapes = stage.find('Shape');
    for (const shape of allShapes) {
      const attrs = shape.attrs || {};
      const sId = norm(attrs.id ?? (typeof shape.id === 'function' ? shape.id() : ''));
      const sSeatId = norm(attrs.seatId ?? attrs['data-seat-id'] ?? attrs['data-id'] ?? '');
      const sName = norm(attrs.name ?? (typeof shape.name === 'function' ? shape.name() : ''));
      const sLabel = norm(attrs.label ?? '');

      if (targetIdNorm && (sId === targetIdNorm || sSeatId === targetIdNorm)) {
        out.push({ node: shape, distance: 0 });
        continue;
      }
      if (targetLabelNorm && (sName === targetLabelNorm || sLabel === targetLabelNorm)) {
        out.push({ node: shape, distance: 0 });
        continue;
      }

      if (typeof seat.x === 'number' && typeof seat.y === 'number') {
        let minD = Infinity;
        if (typeof shape.x === 'function' && typeof shape.y === 'function') {
          const localD = Math.hypot(shape.x() - seat.x, shape.y() - seat.y);
          if (localD < minD) minD = localD;
        }
        if (typeof shape.getAbsolutePosition === 'function') {
          try {
            const abs = shape.getAbsolutePosition();
            if (abs && typeof abs.x === 'number' && typeof abs.y === 'number') {
              const absD = Math.hypot(abs.x - seat.x, abs.y - seat.y);
              if (absD < minD) minD = absD;
            }
          } catch {
            // ignore
          }
        }
        if (minD <= 35.0) {
          out.push({ node: shape, distance: minD });
        }
      }
    }
  }

  return out.sort((a, b) => a.distance - b.distance);
}

/**
 * Clicks one seat node and VERIFIES the state change.
 * Computes CSS client coordinates with stage-to-canvas ratio scaling
 * to guarantee accurate clicking on any monitor resolution, DPI, or zoom level.
 */
async function clickSeatNode(
  stage: KonvaStageLike,
  node: KonvaNodeLike,
  seatLabel?: string
): Promise<{ changed: boolean; method: string; before: string; after: string }> {
  const before = nodeSignature(node);
  const target = getStageEventTarget(stage);
  const rect = target.getBoundingClientRect();
  const abs = typeof node.getAbsolutePosition === 'function' ? node.getAbsolutePosition() : null;

  // Scale stage coordinates to actual CSS client pixels on screen
  const stageW =
    typeof stage.width === 'function' && stage.width() > 0 ? stage.width() : rect.width;
  const stageH =
    typeof stage.height === 'function' && stage.height() > 0 ? stage.height() : rect.height;
  const ratioX = stageW > 0 ? rect.width / stageW : 1;
  const ratioY = stageH > 0 ? rect.height / stageH : 1;

  const nodeAbsX =
    abs && typeof abs.x === 'number' ? abs.x : typeof node.x === 'function' ? node.x() : 0;
  const nodeAbsY =
    abs && typeof abs.y === 'number' ? abs.y : typeof node.y === 'function' ? node.y() : 0;

  const clientX = rect.left + nodeAbsX * ratioX;
  const clientY = rect.top + nodeAbsY * ratioY;

  const attempts: { method: string; run: () => void }[] = [];

  // 1. Native pointer sequence at calculated screen coordinates
  attempts.push({
    method: 'native-pointer',
    run: () => dispatchPointerSequence(target, clientX, clientY),
  });

  // 2. Native mouse sequence at calculated screen coordinates
  attempts.push({
    method: 'native-mouse',
    run: () => dispatchMouseSequence(target, clientX, clientY),
  });

  // 3. Konva node & stage fire
  attempts.push({
    method: 'konva-fire',
    run: () => {
      const mouseEvt = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
        button: 0,
      });
      if (typeof PointerEvent !== 'undefined') {
        const ptrEvt = new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX,
          clientY,
          button: 0,
        });
        node.fire('pointerdown', { evt: ptrEvt as never, target: node }, true);
        node.fire('pointerup', { evt: ptrEvt as never, target: node }, true);
      }
      node.fire('mousedown', { evt: mouseEvt, target: node }, true);
      node.fire('mouseup', { evt: mouseEvt, target: node }, true);
      node.fire('click', { evt: mouseEvt, target: node }, true);
      node.fire('pointerclick', { evt: mouseEvt, target: node }, true);
      node.fire('tap', { evt: { type: 'tap', clientX, clientY }, target: node }, true);

      // Also fire on parent group if present
      if (node.parent && typeof node.parent.fire === 'function') {
        node.parent.fire('click', { evt: mouseEvt, target: node }, true);
      }

      // Also fire on stage if stage listener is used by Ticketbox
      if (typeof stage.fire === 'function') {
        stage.fire('click', { evt: mouseEvt, target: node }, true);
      }
    },
  });

  for (const attempt of attempts) {
    try {
      attempt.run();
    } catch {
      continue;
    }
    if (await waitForSignatureOrDomChange(node, before, seatLabel)) {
      return { changed: true, method: attempt.method, before, after: nodeSignature(node) };
    }
  }

  // Check if DOM selection indicator changed with seatLabel verification
  if (hasDomSelectionIndicator(seatLabel)) {
    return {
      changed: true,
      method: attempts[0]?.method || 'native',
      before,
      after: nodeSignature(node),
    };
  }

  return {
    changed: false,
    method: attempts[0]?.method || 'none',
    before,
    after: nodeSignature(node),
  };
}

/**
 * Handles SELECT_SEATS in Konva.
 */
async function handleSelectSeats(payload?: BridgeRequestPayload): Promise<{
  success: boolean;
  selectedCount: number;
  message?: string;
  reports?: SeatAttemptReport[];
}> {
  const seats = payload?.seats;
  if (!seats || !Array.isArray(seats) || seats.length === 0) {
    return { success: false, selectedCount: 0, message: 'No seats provided' };
  }

  const stage = getActiveStage();
  if (!stage) {
    return { success: false, selectedCount: 0, message: 'No Konva stage found' };
  }

  let selectedCount = 0;
  const reports: SeatAttemptReport[] = [];

  for (const seat of seats) {
    const candidates = findSeatCandidates(stage, seat);
    const report: SeatAttemptReport = {
      id: seat.id,
      label: seat.label,
      found: candidates.length > 0,
      candidates: candidates.length,
      changed: false,
    };
    reports.push(report);

    const best = candidates[0];
    if (!best) {
      report.note = 'No Circle within tolerance of API coordinates or matching attributes';
      continue;
    }

    // Only refuse if distance is non-zero (ambiguous coordinates without exact attribute match)
    const second = candidates[1];
    if (best.distance > 0 && second && second.distance - best.distance < 0.05) {
      report.note = 'Ambiguous: multiple Circles share the same coordinates';
      continue;
    }

    const result = await clickSeatNode(stage, best.node, seat.label);
    report.changed = result.changed;
    report.method = result.method;
    report.before = result.before;
    report.after = result.after;

    const domIndicated = hasDomSelectionIndicator(seat.label);
    if (result.changed || domIndicated) {
      selectedCount++;
      await sleep(150);
    } else {
      report.note = 'Clicked but seat visual state and DOM indicator did not change';
    }
  }

  return { success: selectedCount > 0, selectedCount, reports };
}

/**
 * Handles DESELECT_SEATS:
 * 1. Closes tags in DOM (bottom bar / sidebar tags matching labels, or all tags if none specified).
 * 2. Clicks matching candidate Circle/Shape nodes in Konva stage to toggle selection off.
 */
async function handleDeselectSeats(payload?: BridgeRequestPayload): Promise<{
  success: boolean;
  deselectedCount: number;
  message?: string;
}> {
  let deselectedCount = 0;
  const seats = payload?.seats || [];
  const targetLabels = seats
    .map((s) => (s.label || s.id || '').toUpperCase().trim())
    .filter(Boolean);

  // 1. Close DOM tags in main world (Ant Design tag close buttons or custom pills)
  if (typeof document !== 'undefined') {
    const tags = Array.from(
      document.querySelectorAll(
        '.ant-tag, [class*="seat-tag"], [class*="seat-item"], [class*="selected-seat"], [class*="seatTag"], [class*="badge"], [class*="seat-pill"], [class*="ticket-item"], [class*="cart-item"], [class*="seatItem"]'
      )
    );

    for (const tag of tags) {
      const text = (tag.textContent || '').toUpperCase().trim();
      const isMatch = targetLabels.length === 0 || targetLabels.some((l) => text.includes(l));
      if (isMatch) {
        const closeIcon = tag.querySelector(
          '.ant-tag-close-icon, [aria-label="close"], [class*="close"], [class*="remove"], [class*="delete"], svg'
        ) as HTMLElement | null;
        if (closeIcon && typeof closeIcon.click === 'function') {
          closeIcon.click();
          deselectedCount++;
        } else if (typeof (tag as HTMLElement).click === 'function') {
          (tag as HTMLElement).click();
          deselectedCount++;
        }
      }
    }
  }

  // 2. Deselect via Konva stage nodes
  const stage = getActiveStage();
  if (stage && seats.length > 0) {
    for (const seat of seats) {
      const candidates = findSeatCandidates(stage, seat);
      const best = candidates[0];
      if (best) {
        await clickSeatNode(stage, best.node, seat.label);
        deselectedCount++;
        await sleep(100);
      }
    }
  }

  return { success: true, deselectedCount };
}

/**
 * Inspects overall Konva seatmap state.
 */
function handleGetSeatmapState(): {
  hasKonva: boolean;
  stagesCount: number;
  isSectionView: boolean;
} {
  const konva = getKonva();
  const stagesCount = konva && Array.isArray(konva.stages) ? konva.stages.length : 0;
  return {
    hasKonva: konva !== null,
    stagesCount,
    isSectionView: isSectionViewActive(),
  };
}

/**
 * Message dispatcher for requests from Content Script.
 */
async function processBridgeRequest(
  type: string,
  payload?: BridgeRequestPayload
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  try {
    return await dispatchBridgeRequest(type, payload);
  } catch (err) {
    // Without this an exception inside a Konva handler would leave the content script waiting
    // for a response until it times out, hiding the real error.
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const handledRequestIds = new Set<string>();

/** The content script sends every request over BOTH channels; only handle each requestId once. */
function claimRequest(requestId: string): boolean {
  if (handledRequestIds.has(requestId)) return false;
  handledRequestIds.add(requestId);
  if (handledRequestIds.size > 200) {
    const oldest = handledRequestIds.values().next().value;
    if (oldest !== undefined) handledRequestIds.delete(oldest);
  }
  return true;
}

async function dispatchBridgeRequest(
  type: string,
  payload?: BridgeRequestPayload
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  switch (type) {
    case 'CHECK_READY':
    case 'GET_SEATMAP_STATE': {
      const state = handleGetSeatmapState();
      return { success: true, data: state };
    }

    case 'SELECT_AREA': {
      const result = await handleSelectArea(payload);
      return { success: result.success, data: result };
    }

    case 'SELECT_SEATS': {
      const result = await handleSelectSeats(payload);
      return { success: result.success, data: result };
    }

    case 'DESELECT_SEATS': {
      const result = await handleDeselectSeats(payload);
      return { success: result.success, data: result };
    }

    case 'CONFIRM_AREA_MODAL': {
      const result = await handleConfirmAreaModal(payload);
      return { success: result.success, data: result };
    }

    case 'CLICK_ELEMENT': {
      const result = handleClickElement(payload);
      return { success: result.success, data: result };
    }

    default:
      return { success: false, error: `Unknown bridge action: ${type}` };
  }
}

/**
 * Setup listeners on window.
 */
function initializePageBridge(): void {
  // Flag page bridge as loaded
  (window as unknown as Record<string, unknown>).__TICKETBOX_PAGE_BRIDGE_LOADED__ = true;

  // 1. window.postMessage listener
  window.addEventListener('message', async (event: MessageEvent) => {
    if (event.source !== window || !event.data) return;
    const msg = event.data as BridgeRequestMessage;
    if (msg.source !== 'TICKETBOX_ASSISTANT_CONTENT' || !msg.type || !msg.requestId) return;
    if (!claimRequest(msg.requestId)) return;

    const result = await processBridgeRequest(msg.type, msg.payload);
    const response: BridgeResponseMessage = {
      source: 'TICKETBOX_ASSISTANT_PAGE',
      type: `${msg.type}_RESPONSE`,
      requestId: msg.requestId,
      success: result.success,
      data: result.data,
      error: result.error,
    };

    window.postMessage(response, '*');
  });

  // 2. CustomEvent listener
  window.addEventListener('TICKETBOX_ASSISTANT_REQUEST', async (event: Event) => {
    const detail = (event as CustomEvent<BridgeRequestMessage>).detail;
    if (!detail || !detail.type || !detail.requestId) return;
    if (!claimRequest(detail.requestId)) return;

    const result = await processBridgeRequest(detail.type, detail.payload);
    const response: BridgeResponseMessage = {
      source: 'TICKETBOX_ASSISTANT_PAGE',
      type: `${detail.type}_RESPONSE`,
      requestId: detail.requestId,
      success: result.success,
      data: result.data,
      error: result.error,
    };

    window.dispatchEvent(
      new CustomEvent('TICKETBOX_ASSISTANT_RESPONSE', {
        detail: response,
      })
    );
  });

  // 3. Monitor Konva stage scale for anti-bot zoom thrash detection
  startStageScaleMonitor();

  // 4. Intercept history pushState/replaceState for instantaneous SPA route detection
  installRouteInterceptors();
}

/**
 * Monitors active Konva Stage scale changes and broadcasts ZOOM_SAMPLE messages
 * to the content script for anti-bot zoom thrash detection.
 */
function startStageScaleMonitor(): void {
  if (typeof window === 'undefined') return;
  let lastScale = 1;
  setInterval(() => {
    try {
      const stage = getActiveStage();
      if (stage) {
        const sx = typeof stage.scaleX === 'function' ? stage.scaleX() : 1;
        const sy = typeof stage.scaleY === 'function' ? stage.scaleY() : 1;
        const s = (sx + sy) / 2;
        if (Math.abs(s - lastScale) > 0.02) {
          lastScale = s;
          window.postMessage(
            {
              source: 'TICKETBOX_ASSISTANT_PAGE',
              type: 'ZOOM_SAMPLE',
              scale: s,
            },
            '*'
          );
        }
      }
    } catch {
      // ignore
    }
  }, 100);
}

/**
 * Intercepts history.pushState and history.replaceState to immediately notify the content
 * script of SPA route transitions (e.g. Next.js router transitions from /select-ticket to /question-form).
 */
function installRouteInterceptors(): void {
  if (typeof window === 'undefined' || !window.history) return;
  try {
    const notifyRouteChange = () => {
      window.postMessage(
        {
          source: 'TICKETBOX_ASSISTANT_PAGE',
          type: 'ROUTE_CHANGE',
          url: window.location.href,
        },
        '*'
      );
    };

    const origPushState = window.history.pushState;
    if (typeof origPushState === 'function') {
      window.history.pushState = function (...args) {
        const ret = origPushState.apply(this, args);
        notifyRouteChange();
        return ret;
      };
    }

    const origReplaceState = window.history.replaceState;
    if (typeof origReplaceState === 'function') {
      window.history.replaceState = function (...args) {
        const ret = origReplaceState.apply(this, args);
        notifyRouteChange();
        return ret;
      };
    }
  } catch {
    // ignore
  }
}

initializePageBridge();
