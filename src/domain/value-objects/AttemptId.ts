/**
 * Strongly typed AttemptId value object.
 * Format: attempt_<timestamp>_<random>
 */
export class AttemptId {
  private readonly _value: string;

  constructor(value?: string) {
    if (value) {
      if (!value.trim()) {
        throw new Error('AttemptId cannot be empty');
      }
      this._value = value;
    } else {
      const timestamp = Date.now().toString(36);
      const random = Math.random().toString(36).substring(2, 8);
      this._value = `attempt_${timestamp}_${random}`;
    }
  }

  public get value(): string {
    return this._value;
  }

  public toString(): string {
    return this._value;
  }

  public equals(other: AttemptId): boolean {
    return this._value === other.value;
  }
}
