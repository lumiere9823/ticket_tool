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
    let formContainer = root.querySelector(
      'form.questionnaire-form, #question-form, [data-question-form], form.attendee-form, .attendee-container, #attendee-form, .questionnaire-container, [class*="attendee"], [class*="questionnaire"], [class*="question-form"], form, main, [role="main"]'
    );

    if (!formContainer) {
      formContainer = root;
    }

    const rawInputs = formContainer.querySelectorAll('input, select, textarea');
    const inputElements = rawInputs.filter((el) => {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'hidden' || type === 'submit' || type === 'button') return false;

      const name = (el.getAttribute('name') || '').toLowerCase();
      const id = (el.getAttribute('id') || '').toLowerCase();
      const className = (el.className || '').toLowerCase();

      // Filter out reCAPTCHA elements
      if (
        name.includes('recaptcha') ||
        id.includes('recaptcha') ||
        className.includes('recaptcha')
      ) {
        return false;
      }

      // Filter out navigation/search inputs
      if (type === 'search' || name.includes('search') || id.includes('search')) {
        return false;
      }

      // Filter out hidden elements by CSS / attributes
      if (el.rawElement && typeof window !== 'undefined') {
        const native = el.rawElement as HTMLElement;
        if (
          native.style?.display === 'none' ||
          native.style?.visibility === 'hidden' ||
          native.getAttribute('aria-hidden') === 'true' ||
          native.closest?.('[style*="display: none"], [style*="display:none"], [aria-hidden="true"], header, nav')
        ) {
          return false;
        }
      }

      return true;
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

      // Ensure stable selector attribute is present
      const stableFieldKey = `tb_field_${i}`;
      if (el.setAttribute) {
        el.setAttribute('data-tb-field', stableFieldKey);
      }
      if (el.rawElement && typeof (el.rawElement as HTMLElement).setAttribute === 'function') {
        (el.rawElement as HTMLElement).setAttribute('data-tb-field', stableFieldKey);
      }

      const id = el.getAttribute('id') || el.getAttribute('name') || stableFieldKey;

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

      // Check for consent checkbox or radio
      const cleanLabel = label.toLowerCase();
      if (
        (fieldType === 'CHECKBOX' || fieldType === 'RADIO') &&
        (cleanLabel.includes('agree') ||
          cleanLabel.includes('đồng ý') ||
          cleanLabel.includes('terms') ||
          cleanLabel.includes('điều khoản') ||
          cleanLabel.includes('chính sách') ||
          cleanLabel.includes('vận hành') ||
          cleanLabel.includes('btc') ||
          cleanLabel.includes('sử dụng thông tin'))
      ) {
        hasConsentCheckbox = true;
        consentLabel = label;
      }

      const selector = el.id
        ? `[id="${el.id}"]`
        : el.getAttribute('name')
          ? `[name="${el.getAttribute('name')}"]`
          : `[data-tb-field="${stableFieldKey}"]`;

      fields.push({
        id,
        label: label.replace(/\*/g, '').trim(),
        type: fieldType,
        required: isRequired,
        value: el.getAttribute('value') || '',
        selector,
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

    if (
      cleanLabel.includes('cccd') ||
      cleanLabel.includes('cmnd') ||
      cleanLabel.includes('căn cước') ||
      cleanLabel.includes('hộ chiếu') ||
      cleanLabel.includes('passport') ||
      cleanLabel.includes('citizen id') ||
      cleanLabel.includes('id number') ||
      cleanLabel.includes('giấy tờ')
    ) {
      return 'ID_CARD';
    }

    if (
      cleanLabel.includes('năm sinh') ||
      cleanLabel.includes('ngày sinh') ||
      cleanLabel.includes('ngày tháng năm sinh') ||
      cleanLabel.includes('birth year') ||
      cleanLabel.includes('date of birth') ||
      cleanLabel.includes('dob') ||
      cleanLabel.includes('sinh năm')
    ) {
      return 'BIRTH_YEAR';
    }

    if (
      cleanLabel.includes('giới tính') ||
      cleanLabel.includes('gender') ||
      cleanLabel.includes('sex')
    ) {
      return 'GENDER';
    }

    if (
      cleanLabel.includes('địa chỉ') ||
      cleanLabel.includes('address') ||
      cleanLabel.includes('tỉnh thành') ||
      cleanLabel.includes('tỉnh / thành phố') ||
      cleanLabel.includes('tỉnh/thành') ||
      cleanLabel.includes('city') ||
      cleanLabel.includes('thành phố')
    ) {
      return 'ADDRESS';
    }

    if (
      cleanLabel.includes('họ & tên') ||
      cleanLabel.includes('họ và tên') ||
      cleanLabel.includes('họ tên') ||
      cleanLabel.includes('full name') ||
      cleanLabel.includes('your name') ||
      cleanLabel.includes('tên người') ||
      cleanLabel.includes('người nhận')
    ) {
      return 'TEXT';
    }

    if (tag === 'textarea' || rawType === 'text') {
      return 'TEXT';
    }

    return 'UNKNOWN';
  }

  private static extractFieldLabel(el: DOMElementLike, root: DOMElementLike, id: string): string {
    const name = el.getAttribute('name');
    const rawType = (el.getAttribute('type') || '').toLowerCase();
    const isChoiceInput = rawType === 'radio' || rawType === 'checkbox';

    // 0. Discover parent question container title (e.g. Ant Design or Ticketbox question item)
    let questionTitle = '';
    if (el.rawElement && typeof (el.rawElement as HTMLElement).closest === 'function') {
      const native = el.rawElement as HTMLElement;
      const questionContainer = native.closest(
        '.question-item, .question-container, [class*="question-item"], [class*="questionCollection"], .ant-form-item, [class*="form-item"], [class*="question"], .field-container, .form-group'
      );
      if (questionContainer) {
        const titleEl = questionContainer.querySelector(
          '.ant-form-item-label label, .question-title, [class*="question-title"], [class*="title"], h3, h4, h5'
        );
        if (titleEl && titleEl.textContent?.trim()) {
          const t = titleEl.textContent.trim();
          if (!t.toLowerCase().includes('điền câu trả lời')) {
            questionTitle = t;
          }
        }
      }
    }

    // 1. Associated <label for="id">
    if (id) {
      const labelEl = root.querySelector(`label[for="${id}"]`);
      if (labelEl && labelEl.textContent.trim()) {
        const text = labelEl.textContent.trim();
        if (!text.toLowerCase().includes('điền câu trả lời')) {
          return questionTitle && isChoiceInput ? `${questionTitle} [${text}]` : text;
        }
      }
    }

    // 1b. Enclosing <label> containing this input
    const allLabels = root.querySelectorAll('label');
    for (const lbl of allLabels) {
      if (
        (id && lbl.querySelector(`[id="${id}"]`)) ||
        (name && lbl.querySelector(`[name="${name}"]`))
      ) {
        if (lbl.textContent.trim()) {
          const text = lbl.textContent.trim();
          if (!text.toLowerCase().includes('điền câu trả lời')) {
            return questionTitle && isChoiceInput ? `${questionTitle} [${text}]` : text;
          }
        }
      }
    }

    // If choice input has a questionTitle, return it even if enclosing label was not found
    if (questionTitle) {
      return questionTitle;
    }

    // 1c. Real browser DOM traversal via closest container or previous sibling
    if (el.rawElement && typeof (el.rawElement as HTMLElement).closest === 'function') {
      const native = el.rawElement as HTMLElement;

      // Check previous siblings
      let prev = native.previousElementSibling;
      while (prev) {
        const text = prev.textContent?.trim();
        if (text && text.length > 1 && !text.toLowerCase().includes('điền câu trả lời')) {
          return text;
        }
        prev = prev.previousElementSibling;
      }

      // Check parent's previous sibling
      if (native.parentElement) {
        let parentPrev = native.parentElement.previousElementSibling;
        while (parentPrev) {
          const text = parentPrev.textContent?.trim();
          if (text && text.length > 1 && !text.toLowerCase().includes('điền câu trả lời')) {
            return text;
          }
          parentPrev = parentPrev.previousElementSibling;
        }
      }

      // Check enclosing question/form container
      const container = native.closest(
        '.ant-form-item, [class*="form-item"], [class*="question"], [class*="field"], .form-group'
      );
      if (container) {
        const heading = container.querySelector(
          '.ant-form-item-label, label, [class*="label"], [class*="title"], h3, h4, h5, p, span'
        );
        if (heading && heading.textContent?.trim()) {
          const text = heading.textContent.trim();
          if (!text.toLowerCase().includes('điền câu trả lời')) return text;
        }
      }
    }

    // 2. Sibling text or child in parent if available in DOMElementLike
    if (el.parentElement) {
      if (typeof el.parentElement.querySelector === 'function') {
        const heading = el.parentElement.querySelector(
          '.title, .label, [class*="title"], [class*="label"], h2, h3, h4, h5, p, span, div'
        );
        if (heading && heading !== el) {
          const text = heading.textContent.trim();
          if (text && text.length > 1 && !text.toLowerCase().includes('điền câu trả lời')) {
            return text;
          }
        }
      }
      const parentText = el.parentElement.textContent.trim();
      if (
        parentText &&
        parentText.length < 200 &&
        !parentText.toLowerCase().includes('điền câu trả lời')
      ) {
        return parentText;
      }
    }

    // 3. aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    // 4. placeholder only if it's descriptive
    const placeholder = el.getAttribute('placeholder');
    if (
      placeholder &&
      placeholder.trim() &&
      !placeholder.toLowerCase().includes('điền câu trả lời')
    ) {
      return placeholder.trim();
    }

    // 5. Name attribute
    if (name && name.trim()) return name.trim();

    return id;
  }
}
