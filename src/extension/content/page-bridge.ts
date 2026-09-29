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
  target.dispatchEvent(new PointerEvent('pointermove', { ...base, buttons: 0 }));
  target.dispatchEvent(new PointerEvent('pointerdown', { ...base, buttons: 1 }));
  target.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0 }));
}

function dispatchMouseSequence(target: Element, clientX: number, clientY: number): void {
  const base: MouseEventInit = { bubbles: true, cancelable: true, view: window, clientX, clientY };
  target.dispatchEvent(new MouseEvent('mousemove', { ...base, buttons: 0 }));
  target.dispatchEvent(new MouseEvent('mousedown', { ...base, button: 0, buttons: 1 }));
  target.dispatchEvent(new MouseEvent('mouseup', { ...base, button: 0, buttons: 0 }));
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
    return { success: false, transitioned: false, message: 'Missing areaId, areaName, or ticketTypeId' };
  }

  // If already in section view, view transition is already fulfilled
  if (isSectionViewActive()) {
    return { success: true, transitioned: true, message: 'Already in section view' };
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
      const gTtId = g.attrs ? g.attrs['ticketTypeId'] ?? g.attrs['data-ticket-type-id'] ?? g.attrs['data-ticket-id'] : undefined;
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
      const gSectionId = g.attrs ? g.attrs['data-section-id'] ?? g.attrs['sectionId'] ?? g.attrs['id'] : undefined;
      const directAttr = typeof g.getAttr === 'function' ? g.getAttr('data-section-id') : undefined;
      const matched = String(gSectionId ?? directAttr ?? '').trim();
      if (matched && (matched === safeId || matched.includes(safeId) || safeId.includes(matched))) {
        targetGroup = g;
        break;
      }
    }
  }

  // 3. Match by areaName (normalized with underscores and spaces)
  if (!targetGroup && areaName) {
    const safeName = areaName.toLowerCase().trim();
    const safeNameClean = safeName.replace(/[\s-]+/g, '_');
    for (const g of groups) {
      const gName = String(g.attrs?.name ?? '').toLowerCase();
      const gId = String(g.attrs?.id ?? '').toLowerCase();
      if (
        gName === safeName ||
        gName === safeNameClean ||
        gId === safeName ||
        gId === safeNameClean ||
        (safeName.length > 3 && (gName.includes(safeName) || safeName.includes(gName))) ||
        (safeNameClean.length > 3 && (gName.includes(safeNameClean) || safeNameClean.includes(gName)))
      ) {
        targetGroup = g;
        break;
      }
      // Check child text shapes inside the group
      if (typeof g.getChildren === 'function') {
        const children = g.getChildren();
        const hasMatchingText = children.some((c) => {
          const txt = typeof c.text === 'function' ? c.text().toLowerCase() : String(c.attrs?.text ?? '').toLowerCase();
          return txt && (txt === safeName || safeName.includes(txt) || txt.includes(safeName));
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
      return { success: true, transitioned: false, message: 'Dispatched simulated coordinate click to canvas' };
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

  // Poll for view transition (up to 800ms)
  const maxWait = 8;
  for (let i = 0; i < maxWait; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (isSectionViewActive()) {
      return { success: true, transitioned: true };
    }
  }

  return { success: true, transitioned: isSectionViewActive() };
}

const SEAT_MATCH_TOLERANCE = 15.0;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Visual signature of a seat node: legend colours (white / green / red) live in fill + stroke. */
function nodeSignature(node: KonvaNodeLike): string {
  const fill = typeof node.fill === 'function' ? String(node.fill() ?? '') : '';
  const stroke = typeof node.stroke === 'function' ? String(node.stroke() ?? '') : '';
  return `${fill}|${stroke}`;
}

/** Waits until the node's visual state differs from `before` (React/Redux re-render is async). */
async function waitForSignatureChange(node: KonvaNodeLike, before: string): Promise<boolean> {
  for (let i = 0; i < SIGNATURE_POLL_MAX; i++) {
    await sleep(SIGNATURE_POLL_MS);
    if (nodeSignature(node) !== before) return true;
  }
  return false;
}

/** Checks if the DOM footer, checkout bar, or summary reflects seat selection. */
function hasDomSelectionIndicator(label?: string): boolean {
  if (typeof document === 'undefined') return false;
  const bar = document.querySelector(
    '[class*="bottom"], [class*="footer"], .checkout-bar, .booking-bar, [class*="seat-info"], [class*="action-bar"]'
  );
  if (!bar) return false;
  const text = (bar.textContent || '').toUpperCase();
  if (label && text.includes(label.toUpperCase())) return true;
  if (
    text.includes('VÉ') ||
    text.includes('GHẾ') ||
    text.includes('TIẾP TỤC') ||
    text.includes('ĐẶT VÉ')
  ) {
    return true;
  }
  return false;
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

  const safeId = seat.id ? String(seat.id).trim() : '';
  const safeLabel = seat.label ? String(seat.label).trim().toLowerCase() : '';

  for (const circle of circles) {
    // 1. Direct attribute match (id, seatId, label, name)
    const attrs = circle.attrs || {};
    const cId = String(attrs.id ?? (typeof circle.id === 'function' ? circle.id() : '')).trim();
    const cSeatId = String(attrs.seatId ?? attrs['data-seat-id'] ?? attrs['data-id'] ?? '').trim();
    const cName = String(attrs.name ?? (typeof circle.name === 'function' ? circle.name() : ''))
      .trim()
      .toLowerCase();
    const cLabel = String(attrs.label ?? '')
      .trim()
      .toLowerCase();

    if (safeId && (cId === safeId || cSeatId === safeId)) {
      out.push({ node: circle, distance: 0 });
      continue;
    }
    if (safeLabel && (cName === safeLabel || cLabel === safeLabel)) {
      out.push({ node: circle, distance: 0 });
      continue;
    }

    // 2. Coordinate match (local and absolute position)
    if (typeof seat.x === 'number' && typeof seat.y === 'number') {
      let minD = Infinity;

      // Local coordinates
      if (typeof circle.x === 'function' && typeof circle.y === 'function') {
        const localD = Math.hypot(circle.x() - seat.x, circle.y() - seat.y);
        if (localD < minD) minD = localD;
      }

      // Absolute coordinates (Stage-relative)
      if (typeof circle.getAbsolutePosition === 'function') {
        try {
          const abs = circle.getAbsolutePosition();
          if (abs && typeof abs.x === 'number' && typeof abs.y === 'number') {
            const absD = Math.hypot(abs.x - seat.x, abs.y - seat.y);
            if (absD < minD) minD = absD;
          }
        } catch {
          // ignore
        }
      }

      if (minD <= SEAT_MATCH_TOLERANCE) {
        out.push({ node: circle, distance: minD });
      }
    }
  }

  // Fallback: check other shapes (Shape, Rect, Path) if circles didn't match and ID exists
  if (out.length === 0 && safeId && typeof stage.find === 'function') {
    const allShapes = stage.find('Shape');
    for (const shape of allShapes) {
      const attrs = shape.attrs || {};
      const sId = String(attrs.id ?? (typeof shape.id === 'function' ? shape.id() : '')).trim();
      const sSeatId = String(attrs.seatId ?? attrs['data-seat-id'] ?? '').trim();
      if (sId === safeId || sSeatId === safeId) {
        out.push({ node: shape, distance: 0 });
      }
    }
  }

  return out.sort((a, b) => a.distance - b.distance);
}

/**
 * Clicks one seat node and VERIFIES the state change.
 */
async function clickSeatNode(
  stage: KonvaStageLike,
  node: KonvaNodeLike
): Promise<{ changed: boolean; method: string; before: string; after: string }> {
  const before = nodeSignature(node);
  const target = getStageEventTarget(stage);
  const rect = target.getBoundingClientRect();
  const abs = typeof node.getAbsolutePosition === 'function' ? node.getAbsolutePosition() : null;

  const attempts: { method: string; run: () => void }[] = [];
  if (abs && typeof abs.x === 'number' && typeof abs.y === 'number') {
    const clientX = rect.left + abs.x;
    const clientY = rect.top + abs.y;
    attempts.push({
      method: 'native-pointer',
      run: () => dispatchPointerSequence(target, clientX, clientY),
    });
    attempts.push({
      method: 'native-mouse',
      run: () => dispatchMouseSequence(target, clientX, clientY),
    });
  } else {
    const lx = typeof node.x === 'function' ? node.x() : 0;
    const ly = typeof node.y === 'function' ? node.y() : 0;
    const clientX = rect.left + lx;
    const clientY = rect.top + ly;
    attempts.push({
      method: 'native-pointer',
      run: () => dispatchPointerSequence(target, clientX, clientY),
    });
    attempts.push({
      method: 'native-mouse',
      run: () => dispatchMouseSequence(target, clientX, clientY),
    });
  }

  attempts.push({
    method: 'konva-fire',
    run: () => {
      node.fire(
        'click',
        { evt: new MouseEvent('click', { bubbles: true, button: 0 }), target: node },
        true
      );
      node.fire('tap', { evt: { type: 'tap' }, target: node }, true);
    },
  });

  for (const attempt of attempts) {
    try {
      attempt.run();
    } catch {
      continue;
    }
    if (await waitForSignatureChange(node, before)) {
      return { changed: true, method: attempt.method, before, after: nodeSignature(node) };
    }
  }

  // Check if DOM selection indicator changed even if node signature didn't
  if (hasDomSelectionIndicator()) {
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

    const result = await clickSeatNode(stage, best.node);
    report.changed = result.changed;
    report.method = result.method;
    report.before = result.before;
    report.after = result.after;

    const domIndicated = hasDomSelectionIndicator(seat.label);
    if (result.changed || domIndicated || result.method !== 'none') {
      selectedCount++;
      await sleep(150);
    } else {
      report.note = 'Clicked but seat visual state did not change';
    }
  }

  return { success: selectedCount > 0, selectedCount, reports };
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
}

initializePageBridge();
