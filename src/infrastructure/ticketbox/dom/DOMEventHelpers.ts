/**
 * DOM Event Helpers
 *
 * Provides strongly-typed synthetic event dispatchers and input mutators
 * for simulated user interaction in Chrome Extension content scripts and tests.
 * Eliminates unsafe `as never` / `as unknown as` casts around dispatchEvent.
 */

import { DOMElementLike } from '../parsing/DOMElementLike';
import { MutableDOMElement } from '../types/TicketboxApiTypes';

interface ReactTracker {
  setValue?: (v: string) => void;
}

interface ElementWithTracker {
  _valueTracker?: ReactTracker;
}

/**
 * Dispatches a synthetic event on an element if possible.
 */
export function dispatchSyntheticEvent(
  target: EventTarget | DOMElementLike | null | undefined,
  type: string,
  eventInit: EventInit = { bubbles: true }
): boolean {
  if (!target) return false;

  const raw = 'rawElement' in target ? (target as DOMElementLike).rawElement : target;
  if (!raw || typeof (raw as EventTarget).dispatchEvent !== 'function') {
    return false;
  }

  const EventConstructor =
    typeof Event !== 'undefined'
      ? Event
      : typeof window !== 'undefined' && window.Event
        ? window.Event
        : null;

  if (!EventConstructor) {
    return false;
  }

  try {
    const event = new EventConstructor(type, eventInit);
    return (raw as EventTarget).dispatchEvent(event);
  } catch {
    return false;
  }
}

/**
 * Triggers a click on an element, either via el.click() or synthetic click event.
 */
export function dispatchSyntheticClick(
  target: HTMLElement | DOMElementLike | null | undefined
): void {
  if (!target) return;

  const raw = 'rawElement' in target ? (target as DOMElementLike).rawElement : target;
  if (!raw) {
    if ('click' in target && typeof (target as { click?: () => void }).click === 'function') {
      (target as { click: () => void }).click();
    }
    return;
  }

  if (typeof (raw as HTMLElement).click === 'function') {
    (raw as HTMLElement).click();
  } else {
    dispatchSyntheticEvent(raw as EventTarget, 'click', { bubbles: true, cancelable: true });
  }
}

/**
 * Sets input/textarea value through prototype descriptor (to bypass React controlled inputs),
 * resets React _valueTracker, and dispatches focus -> input -> change -> blur events.
 */
export function setNativeInputValueAndDispatch(
  inputEl: HTMLInputElement | HTMLTextAreaElement | DOMElementLike,
  value: string
): void {
  const raw =
    'rawElement' in inputEl ? (inputEl as DOMElementLike).rawElement : inputEl;
  if (!raw) return;

  const nativeEl = raw as HTMLElement;
  const isTextArea =
    (nativeEl.tagName && nativeEl.tagName.toLowerCase() === 'textarea') ||
    (typeof HTMLTextAreaElement !== 'undefined' && nativeEl instanceof HTMLTextAreaElement);

  const inputProto =
    typeof HTMLInputElement !== 'undefined'
      ? HTMLInputElement.prototype
      : typeof window !== 'undefined' && window.HTMLInputElement
        ? window.HTMLInputElement.prototype
        : null;

  const textAreaProto =
    typeof HTMLTextAreaElement !== 'undefined'
      ? HTMLTextAreaElement.prototype
      : typeof window !== 'undefined' && window.HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : null;

  const protoToUse = isTextArea ? textAreaProto : inputProto;
  const desc =
    (protoToUse ? Object.getOwnPropertyDescriptor(protoToUse, 'value') : undefined) ||
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(nativeEl) || nativeEl, 'value') ||
    Object.getOwnPropertyDescriptor(nativeEl, 'value');

  if (desc && desc.set) {
    desc.set.call(nativeEl, value);
  } else if ('value' in nativeEl) {
    (nativeEl as HTMLInputElement).value = value;
  }

  // Also update DOMElementLike wrapper value if present
  if ('value' in inputEl) {
    (inputEl as { value?: string }).value = value;
  }
  if ('attributes' in inputEl && (inputEl as unknown as MutableDOMElement).attributes) {
    (inputEl as unknown as MutableDOMElement).attributes['value'] = value;
  }

  // Reset React value tracker if present
  const tracker = (nativeEl as ElementWithTracker)._valueTracker;
  if (tracker && typeof tracker.setValue === 'function') {
    tracker.setValue('');
  }

  // Dispatch focus event
  dispatchSyntheticEvent(nativeEl, 'focus', { bubbles: true });

  // Dispatch input event (try InputEvent if available)
  let inputDispatched = false;
  if (typeof InputEvent !== 'undefined') {
    try {
      const inputEvt = new InputEvent('input', { bubbles: true, data: value });
      inputDispatched = nativeEl.dispatchEvent(inputEvt);
    } catch {
      inputDispatched = false;
    }
  }
  if (!inputDispatched) {
    dispatchSyntheticEvent(nativeEl, 'input', { bubbles: true });
  }

  // Dispatch change and blur events
  dispatchSyntheticEvent(nativeEl, 'change', { bubbles: true });
  dispatchSyntheticEvent(nativeEl, 'blur', { bubbles: true });
}

/**
 * Sets select element value and dispatches change + input events.
 */
export function setSelectValueAndDispatch(
  selectEl: HTMLSelectElement | DOMElementLike,
  value: string
): void {
  const raw =
    'rawElement' in selectEl ? (selectEl as DOMElementLike).rawElement : selectEl;
  if (!raw) return;

  const nativeEl = raw as HTMLSelectElement;
  let appliedValue = value;
  if ('options' in nativeEl && nativeEl.options) {
    const options = Array.from(nativeEl.options);
    const targetVal = value.toLowerCase();
    const matchedOpt = options.find(
      (opt) =>
        opt.value.toLowerCase() === targetVal ||
        opt.text.toLowerCase().includes(targetVal) ||
        targetVal.includes(opt.text.toLowerCase())
    );
    if (matchedOpt) {
      appliedValue = matchedOpt.value;
    }
    const selectProto =
      typeof HTMLSelectElement !== 'undefined'
        ? HTMLSelectElement.prototype
        : typeof window !== 'undefined' && window.HTMLSelectElement
          ? window.HTMLSelectElement.prototype
          : null;
    const desc =
      (selectProto ? Object.getOwnPropertyDescriptor(selectProto, 'value') : undefined) ||
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(nativeEl) || nativeEl, 'value') ||
      Object.getOwnPropertyDescriptor(nativeEl, 'value');
    if (desc && desc.set) {
      desc.set.call(nativeEl, appliedValue);
    } else {
      nativeEl.value = appliedValue;
    }
  } else if ('value' in nativeEl) {
    const desc =
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(nativeEl) || nativeEl, 'value') ||
      Object.getOwnPropertyDescriptor(nativeEl, 'value');
    if (desc && desc.set) {
      desc.set.call(nativeEl, value);
    } else {
      nativeEl.value = value;
    }
  }

  if ('value' in selectEl && selectEl !== nativeEl) {
    (selectEl as { value?: string }).value = appliedValue;
  }

  dispatchSyntheticEvent(nativeEl, 'change', { bubbles: true });
  dispatchSyntheticEvent(nativeEl, 'input', { bubbles: true });
}

/**
 * Sets radio or checkbox checked state, updates attributes, dispatches change + input,
 * and clicks wrapper element if present.
 */
export function setCheckboxOrRadioAndDispatch(
  element: HTMLInputElement | DOMElementLike,
  checked: boolean = true
): void {
  const raw =
    'rawElement' in element ? (element as DOMElementLike).rawElement : element;
  if (!raw) return;

  const nativeEl = raw as HTMLInputElement;
  if (typeof window !== 'undefined' && window.HTMLInputElement) {
    const desc = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'checked'
    );
    if (desc && desc.set) {
      desc.set.call(nativeEl, checked);
    } else {
      nativeEl.checked = checked;
    }
  } else {
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(nativeEl) || nativeEl, 'checked') ||
      Object.getOwnPropertyDescriptor(nativeEl, 'checked');
    if (desc && desc.set) {
      desc.set.call(nativeEl, checked);
    } else if ('checked' in nativeEl) {
      nativeEl.checked = checked;
    }
  }

  // Reset React value tracker if present
  const tracker = (nativeEl as ElementWithTracker)._valueTracker;
  if (tracker && typeof tracker.setValue === 'function') {
    tracker.setValue('false');
  }

  dispatchSyntheticEvent(nativeEl, 'change', { bubbles: true });
  dispatchSyntheticEvent(nativeEl, 'input', { bubbles: true });

  if (typeof nativeEl.closest === 'function') {
    const parentWrapper = nativeEl.closest(
      'label, .ant-radio-wrapper, .ant-checkbox-wrapper, [class*="radio"], [class*="checkbox"]'
    ) as HTMLElement | null;
    if (parentWrapper && typeof parentWrapper.click === 'function') {
      parentWrapper.click();
    }
  }

  if ('setAttribute' in element) {
    const likeEl = element as DOMElementLike;
    if (typeof likeEl.setAttribute === 'function') {
      likeEl.setAttribute('checked', String(checked));
      likeEl.setAttribute('aria-checked', String(checked));
    }
  }
  if ('attributes' in element) {
    const elLike = element as unknown as MutableDOMElement;
    elLike.attributes = elLike.attributes || {};
    elLike.attributes['checked'] = String(checked);
    elLike.attributes['aria-checked'] = String(checked);
  }
}
