/**
 * Strongly typed Money value object.
 */
export class Money {
  constructor(
    public readonly amount: number,
    public readonly currency: string = 'VND'
  ) {
    if (amount < 0) {
      throw new Error(`Money amount cannot be negative, received: ${amount}`);
    }
    if (!currency.trim()) {
      throw new Error('Currency code cannot be empty');
    }
  }

  public formatted(): string {
    return `${this.amount.toLocaleString('vi-VN')} ${this.currency}`;
  }
}
