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
  fill?: (color?: string) => string | void;
  stroke?: (color?: string) => string | void;
  getAttr?: (name: string) => unknown;
  getChildren?: () => KonvaNodeLike[];
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

  // Find the primary interactive stage (ignoring small minimaps < 200px)
  for (const stage of konva.stages) {
    if (typeof stage.width === 'function' && stage.width() > 200) {
      return stage;
    }
  }

  return konva.stages[0] ?? null;
}

/**
 * Dispatches simulated native pointer and mouse events directly to the canvas/container.
 */
function dispatchNativeEvents(target: Element, clientX: number, clientY: number): void {
  const pointerOpts: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX,
    clientY,
    buttons: 1,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  };

  const releaseOpts: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX,
    clientY,
    buttons: 0,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  };

  target.dispatchEvent(new PointerEvent('pointerover', pointerOpts));
  target.dispatchEvent(new PointerEvent('pointerenter', pointerOpts));
  target.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
  target.dispatchEvent(new MouseEvent('mouseover', pointerOpts));
  target.dispatchEvent(new MouseEvent('mousedown', pointerOpts));

  target.dispatchEvent(new PointerEvent('pointerup', releaseOpts));
  target.dispatchEvent(new MouseEvent('mouseup', releaseOpts));
  target.dispatchEvent(new MouseEvent('click', releaseOpts));
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

  if (!areaId && !areaName) {
    return { success: false, transitioned: false, message: 'Missing areaId or areaName' };
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

  // 1. Match by data-section-id attribute
  if (areaId) {
    const safeId = String(areaId).trim();
    for (const g of groups) {
      const gSectionId = g.attrs ? g.attrs['data-section-id'] : undefined;
      const directAttr = typeof g.getAttr === 'function' ? g.getAttr('data-section-id') : undefined;
      const matched = String(gSectionId ?? directAttr ?? '').trim();
      if (matched && (matched === safeId || matched.includes(safeId) || safeId.includes(matched))) {
        targetGroup = g;
        break;
      }
    }
  }

  // 2. Match by id or name
  if (!targetGroup && areaId) {
    const safeId = String(areaId).toLowerCase();
    for (const g of groups) {
      const gId = String(g.attrs?.id ?? '').toLowerCase();
      const gName = String(g.attrs?.name ?? '').toLowerCase();
      if (gId === safeId || gName === safeId) {
        targetGroup = g;
        break;
      }
    }
  }

  // 3. Match by areaName
  if (!targetGroup && areaName) {
    const safeName = areaName.toLowerCase().trim();
    for (const g of groups) {
      const gName = String(g.attrs?.name ?? '').toLowerCase();
      if (gName && (gName.includes(safeName) || safeName.includes(gName))) {
        targetGroup = g;
        break;
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
        dispatchNativeEvents(container, clientX, clientY);
      }
    } catch {
      // ignore rect calculation error
    }
  }

  // Poll for view transition (up to 2500ms)
  const maxWait = 25;
  for (let i = 0; i < maxWait; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (isSectionViewActive()) {
      return { success: true, transitioned: true };
    }
  }

  return { success: true, transitioned: isSectionViewActive() };
}

/**
 * Handles SELECT_SEATS in Konva.
 */
async function handleSelectSeats(
  payload?: BridgeRequestPayload
): Promise<{ success: boolean; selectedCount: number; message?: string }> {
  const seats = payload?.seats;
  if (!seats || !Array.isArray(seats) || seats.length === 0) {
    return { success: false, selectedCount: 0, message: 'No seats provided' };
  }

  const stage = getActiveStage();
  if (!stage) {
    return { success: false, selectedCount: 0, message: 'No Konva stage found' };
  }

  let selectedCount = 0;

  for (const seat of seats) {
    let matchedTarget: KonvaNodeLike | null = null;
    let matchedGroup: KonvaNodeLike | null = null;

    // Strategy 1: Coordinates matching against Circle shapes
    if (typeof seat.x === 'number' && typeof seat.y === 'number') {
      const circles = typeof stage.find === 'function' ? stage.find('Circle') : [];
      let minDistance = 4.0;

      for (const circle of circles) {
        if (typeof circle.x === 'function' && typeof circle.y === 'function') {
          const dist = Math.hypot(circle.x() - seat.x, circle.y() - seat.y);
          if (dist < minDistance) {
            minDistance = dist;
            matchedTarget = circle;
            matchedGroup = circle.parent ?? null;
            if (dist < 0.5) break;
          }
        }
      }
    }

    // Strategy 2: Text matching by seat number
    if (!matchedTarget && seat.number) {
      const numStr = String(seat.number);
      const texts = typeof stage.find === 'function' ? stage.find('Text') : [];
      for (const text of texts) {
        if (typeof text.text === 'function' && text.text() === numStr) {
          if (typeof seat.y === 'number' && typeof text.y === 'function') {
            if (Math.abs(text.y() - seat.y) > 30) continue;
          }
          matchedTarget = text;
          matchedGroup = text.parent ?? null;
          break;
        }
      }
    }

    // Strategy 3: Konva absolute transform point hit testing
    if (
      !matchedTarget &&
      typeof seat.x === 'number' &&
      typeof seat.y === 'number' &&
      typeof stage.getAbsoluteTransform === 'function' &&
      typeof stage.getIntersection === 'function'
    ) {
      try {
        const tf = stage.getAbsoluteTransform();
        const stagePos = tf.point({ x: seat.x, y: seat.y });
        const hit = stage.getIntersection(stagePos);
        if (hit) {
          matchedTarget = hit;
          matchedGroup = hit.parent ?? null;
        }
      } catch {
        // ignore transform error
      }
    }

    const interactiveNode = matchedGroup ?? matchedTarget;

    if (interactiveNode) {
      // Fire Konva click and tap
      interactiveNode.fire(
        'click',
        { evt: { type: 'click' }, target: interactiveNode, currentTarget: interactiveNode },
        true
      );
      interactiveNode.fire(
        'tap',
        { evt: { type: 'tap' }, target: interactiveNode, currentTarget: interactiveNode },
        true
      );

      // If matchedTarget is different from group, also fire on it
      if (matchedTarget && matchedTarget !== interactiveNode) {
        matchedTarget.fire(
          'click',
          { evt: { type: 'click' }, target: matchedTarget, currentTarget: matchedTarget },
          true
        );
      }

      // Also calculate screen coordinates and dispatch native events to the canvas
      const container = stage.container();
      if (container) {
        try {
          const cRect = container.getBoundingClientRect();
          let clientX = 0;
          let clientY = 0;

          if (typeof interactiveNode.getClientRect === 'function') {
            const rect = interactiveNode.getClientRect();
            if (rect && rect.width > 0) {
              clientX = cRect.left + rect.x + rect.width / 2;
              clientY = cRect.top + rect.y + rect.height / 2;
            }
          }

          if (
            (clientX === 0 || clientY === 0) &&
            typeof seat.x === 'number' &&
            typeof seat.y === 'number'
          ) {
            const scaleX = typeof stage.scaleX === 'function' ? stage.scaleX() : 1;
            const scaleY = typeof stage.scaleY === 'function' ? stage.scaleY() : 1;
            const sx = typeof stage.x === 'function' ? stage.x() : 0;
            const sy = typeof stage.y === 'function' ? stage.y() : 0;
            clientX = cRect.left + sx + seat.x * scaleX;
            clientY = cRect.top + sy + seat.y * scaleY;
          }

          if (clientX > 0 && clientY > 0) {
            dispatchNativeEvents(container, clientX, clientY);
          }
        } catch {
          // ignore native dispatch error
        }
      }

      selectedCount++;
      // Small pause between seats to allow React/Redux updates
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  return { success: selectedCount > 0, selectedCount };
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
