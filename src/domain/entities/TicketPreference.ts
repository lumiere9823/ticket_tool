import { Quantity } from '../value-objects/Quantity';
import { Money } from '../value-objects/Money';

/**
 * User-configured ticket purchase preferences.
 */
export interface TicketPreferenceProps {
  categoryPriority: string[];
  quantity: Quantity;
  allowFallback?: boolean | undefined;
  sectionPriority?: string[] | undefined;
  maxPricePerTicket?: Money | undefined;
}

export class TicketPreference {
  public readonly categoryPriority: readonly string[];
  public readonly quantity: Quantity;
  public readonly allowFallback: boolean;
  public readonly sectionPriority: readonly string[];
  public readonly maxPricePerTicket?: Money | undefined;

  constructor(props: TicketPreferenceProps) {
    if (!props.categoryPriority || props.categoryPriority.length === 0) {
      throw new Error('TicketPreference must contain at least one category priority');
    }
    this.categoryPriority = Object.freeze([...props.categoryPriority]);
    this.quantity = props.quantity;
    this.allowFallback = props.allowFallback ?? true;
    this.sectionPriority = Object.freeze([...(props.sectionPriority ?? [])]);
    this.maxPricePerTicket = props.maxPricePerTicket;
  }

  public matchesCategory(categoryName: string): boolean {
    const normalized = categoryName.trim().toLowerCase();
    return this.categoryPriority.some((p) => {
      const target = p.trim().toLowerCase();
      return target === 'any' || target === normalized || normalized.includes(target);
    });
  }
}
