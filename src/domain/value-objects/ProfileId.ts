/**
 * Strongly typed ProfileId value object representing an isolated browser profile.
 */
export class ProfileId {
  private readonly _value: string;

  constructor(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error('ProfileId cannot be empty');
    }
    this._value = trimmed;
  }

  public get value(): string {
    return this._value;
  }

  public toString(): string {
    return this._value;
  }

  public equals(other: ProfileId): boolean {
    return this._value === other.value;
  }
}
