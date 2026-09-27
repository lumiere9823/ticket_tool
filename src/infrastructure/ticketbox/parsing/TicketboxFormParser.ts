import {
  FormField,
  FormFieldType,
  FormSchema,
} from '../../../domain/entities/BookingJourneyModels';
import { DOMElementLike } from './DOMElementLike';

export class TicketboxFormParser {
  /**
   * Dynamically parses question and attendee form schemas from the page DOM.
   * Conforms strictly to Sections 17 and 20.
   */
  public static parseForm(root: DOMElementLike): FormSchema | null {
    const formContainer =
      root.querySelector(
        'form.questionnaire-form, #question-form, [data-question-form], form.attendee-form, .attendee-container, #attendee-form'
      ) ||
      root.querySelector('form') ||
      root;

    const rawInputs = formContainer.querySelectorAll('input, select, textarea');
    const inputElements = rawInputs.filter((el) => {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      return type !== 'hidden' && type !== 'submit' && type !== 'button';
    });

    if (inputElements.length === 0) {
      return null;
    }

    const fields: FormField[] = [];
    let hasConsentCheckbox = false;
    let consentLabel: string | undefined;

    for (let i = 0; i < inputElements.length; i++) {
      const el = inputElements[i]!;
      const tag = el.tagName.toLowerCase();
      const rawType = (el.getAttribute('type') || 'text').toLowerCase();
      const id = el.getAttribute('id') || el.getAttribute('name') || `field_${i}`;

      // Extract label
      const label = this.extractFieldLabel(el, root, id);

      // Determine form field type
      const fieldType = this.classifyFieldType(tag, rawType, label);

      // Determine required flag
      const isRequired =
        el.hasAttribute('required') ||
        el.getAttribute('aria-required') === 'true' ||
        label.includes('*') ||
        label.toLowerCase().includes('bắt buộc');

      // Check for consent checkbox
      const cleanLabel = label.toLowerCase();
      if (
        fieldType === 'CHECKBOX' &&
        (cleanLabel.includes('agree') ||
          cleanLabel.includes('đồng ý') ||
          cleanLabel.includes('terms') ||
          cleanLabel.includes('điều khoản') ||
          cleanLabel.includes('chính sách'))
      ) {
        hasConsentCheckbox = true;
        consentLabel = label;
      }

      fields.push({
        id,
        label: label.replace(/\*/g, '').trim(),
        type: fieldType,
        required: isRequired,
        value: el.getAttribute('value') || '',
        selector: el.id ? `#${el.id}` : `[name="${el.getAttribute('name')}"]`,
      });
    }

    return {
      fields,
      hasConsentCheckbox,
      consentLabel,
    };
  }

  private static classifyFieldType(tag: string, rawType: string, label: string): FormFieldType {
    const cleanLabel = label.toLowerCase();

    if (tag === 'select') return 'SELECT';
    if (rawType === 'checkbox') return 'CHECKBOX';
    if (rawType === 'radio') return 'RADIO';

    if (rawType === 'email' || cleanLabel.includes('email') || cleanLabel.includes('thư điện tử')) {
      return 'EMAIL';
    }

    if (
      rawType === 'tel' ||
      cleanLabel.includes('phone') ||
      cleanLabel.includes('điện thoại') ||
      cleanLabel.includes('sđt') ||
      cleanLabel.includes('so dien thoai')
    ) {
      return 'PHONE';
    }

    if (tag === 'textarea' || rawType === 'text') {
      return 'TEXT';
    }

    return 'UNKNOWN';
  }

  private static extractFieldLabel(el: DOMElementLike, root: DOMElementLike, id: string): string {
    const name = el.getAttribute('name');

    // 1. Associated <label for="id">
    if (id) {
      const labelEl = root.querySelector(`label[for="${id}"]`);
      if (labelEl && labelEl.textContent.trim()) {
        return labelEl.textContent.trim();
      }
    }

    // 1b. Enclosing <label> containing this input
    const allLabels = root.querySelectorAll('label');
    for (const lbl of allLabels) {
      if ((id && lbl.querySelector(`#${id}`)) || (name && lbl.querySelector(`[name="${name}"]`))) {
        if (lbl.textContent.trim()) {
          return lbl.textContent.trim();
        }
      }
    }

    // 2. aria-label or placeholder
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return placeholder.trim();

    // 3. Name attribute
    if (name && name.trim()) return name.trim();

    return id;
  }
}
