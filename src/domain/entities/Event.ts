/**
 * Represents target event metadata.
 */
export interface EventProps {
  id: string;
  name: string;
  url: string;
  showingId?: string | undefined;
  saleStartTime?: string | undefined;
  status: 'NOT_OPEN' | 'ON_SALE' | 'SOLD_OUT' | 'ENDED' | 'UNKNOWN';
}

export class Event {
  public readonly id: string;
  public readonly name: string;
  public readonly url: string;
  public readonly showingId?: string | undefined;
  public readonly saleStartTime?: string | undefined;
  public readonly status: 'NOT_OPEN' | 'ON_SALE' | 'SOLD_OUT' | 'ENDED' | 'UNKNOWN';

  constructor(props: EventProps) {
    if (!props.id.trim()) {
      throw new Error('Event ID cannot be empty');
    }
    if (!props.name.trim()) {
      throw new Error('Event name cannot be empty');
    }
    if (!props.url.trim()) {
      throw new Error('Event URL cannot be empty');
    }

    this.id = props.id;
    this.name = props.name;
    this.url = props.url;
    this.showingId = props.showingId;
    this.saleStartTime = props.saleStartTime;
    this.status = props.status;
  }

  public isOnSale(): boolean {
    return this.status === 'ON_SALE';
  }
}
