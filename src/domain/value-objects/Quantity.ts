/**
 * Strongly typed Quantity value object.
 * Enforces positive integer constraints and maximum limits.
 */
export class Quantity {
  private readonly _value: number;

  constructor(value: number, maxLimit = 10) {
    if (!Number.isInteger(value)) {
      throw new Error(`Quantity must be an integer, received: ${value}`);
    }
    if (value <= 0) {
      throw new Error(`Quantity must be strictly positive, received: ${value}`);
    }
    if (value > maxLimit) {
      throw new Error(
        `Quantity cannot exceed maximum allowable limit of ${maxLimit}, received: ${value}`
      );
    }
    this._value = value;
  }

  public get value(): number {
    return this._value;
  }

  public toJSON(): number {
    return this._value;
  }
}
