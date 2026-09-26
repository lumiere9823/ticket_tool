/**
 * Strategy defining whether a single successful reservation stops all other coordinated profiles,
 * or allows multiple profiles to secure reservations independently.
 * Implements docs/ticketbox/06-multi-account-orchestration.md Section 6.
 */
export enum ExecutionPolicyType {
  ONE_SUCCESS = 'ONE_SUCCESS',
  MULTIPLE_SUCCESS = 'MULTIPLE_SUCCESS',
}

export class ExecutionPolicy {
  constructor(public readonly type: ExecutionPolicyType = ExecutionPolicyType.ONE_SUCCESS) {}

  public shouldStopOthersOnSuccess(): boolean {
    return this.type === ExecutionPolicyType.ONE_SUCCESS;
  }
}
