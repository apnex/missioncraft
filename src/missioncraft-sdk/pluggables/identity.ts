// IdentityProvider pluggable interface (Design v4.8 §2.1.1)
// Strict-1.0 commitment: every signature is committed contract; breaking changes post-v1 = major-bump.

export type SigningKey =
  | { type: 'gpg'; fingerprint: string }
  | { type: 'ssh'; publicKey: string }; // public-key path or base64-encoded handle

export interface AgentIdentity {
  readonly name: string;
  readonly email: string;
  readonly signingKey?: SigningKey; // discriminated union (v0.2 fold per §C.5); optional
}

export interface IdentityProvider {
  /**
   * Resolve the agent identity for commits + signed operations.
   *
   * Invocation-context (per Design v4.8 §2.6.6 + §2.6.6.v4 MEDIUM-R4.2 broadening):
   * - v3.6 baseline: invoked at each git-operation's commit-firing-time (NOT startMission-time)
   * - v4.0+ broadening: ALSO invoked at query-time for current-principal precedence chain (per §2.3.1 Step 3)
   *
   * Invariant: implementations MUST be idempotent + side-effect-free; safe to invoke at any time
   * (commit-firing-time, query-time, future-call-sites). 3rd-party implementers performing side-effects
   * (e.g., interactive credential prompt) violate this invariant.
   */
  resolve(): Promise<AgentIdentity>;
}
