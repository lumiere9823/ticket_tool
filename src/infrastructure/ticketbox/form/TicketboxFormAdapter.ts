/**
 * Ticketbox Form Adapter
 *
 * Handles parsing and filling attendee / question forms on Ticketbox:
 * - Reads form schemas via TicketboxFormParser and Question Form API
 * - Evaluates form fields against FormAutofillPolicy
 * - Safely dispatches inputs, selects, radios, and checkboxes using DOMEventHelpers
 */

import { LoggerPort } from '../../../application/ports/LoggerPort';
import {
  FormSchema,
  UserProfileData,
} from '../../../domain/entities/BookingJourneyModels';
import { FormAutofillPolicy } from '../../../domain/policies/FormAutofillPolicy';
import {
  setCheckboxOrRadioAndDispatch,
  setNativeInputValueAndDispatch,
  setSelectValueAndDispatch,
} from '../dom/DOMEventHelpers';
import { DOMElementLike } from '../parsing/DOMElementLike';
import { TicketboxFormParser } from '../parsing/TicketboxFormParser';
import { MutableDOMElement } from '../types/TicketboxApiTypes';

export interface FormAdapterContext {
  getRoot: () => DOMElementLike | null;
  getEventId: () => string | null;
  ensureQuestionFormCached?: (eventId: string) => Promise<unknown>;
  getFormSchema?: () => Promise<FormSchema | null>;
}

export class TicketboxFormAdapter {
  constructor(
    private readonly ctx: FormAdapterContext,
    private readonly logger?: LoggerPort
  ) {}

  public async getFormSchema(): Promise<FormSchema | null> {
    const root = this.ctx.getRoot();
    if (!root) return null;

    const eventId = this.ctx.getEventId();
    if (eventId && this.ctx.ensureQuestionFormCached) {
      await this.ctx.ensureQuestionFormCached(eventId);
    }

    return TicketboxFormParser.parseForm(root);
  }

  public async fillAttendeeForm(profile: UserProfileData): Promise<{
    allSatisfied: boolean;
    missingFields: string[];
    isConsentBlocked: boolean;
  }> {
    const schema = this.ctx.getFormSchema
      ? await this.ctx.getFormSchema()
      : await this.getFormSchema();
    if (!schema) {
      return { allSatisfied: true, missingFields: [], isConsentBlocked: false };
    }

    const evalResult = FormAutofillPolicy.evaluate(schema, profile);
    const root = this.ctx.getRoot();

    if (root) {
      for (const item of evalResult.plan) {
        if (item.targetValue) {
          const safeFieldId = item.field.id.replace(/"/g, '\\"');
          const el =
            root.querySelector(item.field.selector) ||
            root.querySelector(`[id="${safeFieldId}"]`) ||
            root.querySelector(`[name="${safeFieldId}"]`);

          if (el) {
            const raw = (el.rawElement || el) as HTMLElement;

            if (item.field.type === 'CHECKBOX' || item.field.type === 'RADIO') {
              if (item.targetValue === 'true') {
                if (typeof (el as MutableDOMElement).click === 'function') {
                  (el as MutableDOMElement).click!();
                }
                setCheckboxOrRadioAndDispatch(el as HTMLInputElement, true);
                this.logger?.info('Consent radio/checkbox selected', { label: item.field.label });
              }
            } else if (
              item.field.type === 'SELECT' ||
              (raw.tagName && raw.tagName.toLowerCase() === 'select')
            ) {
              setSelectValueAndDispatch(el as HTMLSelectElement, item.targetValue);
              this.logger?.info('Form select dropdown set', {
                label: item.field.label,
                source: item.source,
                value: item.targetValue,
              });
            } else {
              // TEXT, EMAIL, PHONE, ID_CARD, BIRTH_YEAR, ADDRESS
              setNativeInputValueAndDispatch(el as HTMLInputElement, item.targetValue);
              this.logger?.info('Form text input filled', {
                label: item.field.label,
                source: item.source,
              });
            }
          }
        }
      }
    }

    return {
      allSatisfied: evalResult.canProceed,
      missingFields: evalResult.missingFields,
      isConsentBlocked: evalResult.isConsentBlocked,
    };
  }
}
