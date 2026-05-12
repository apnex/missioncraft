// Error class hierarchy (Design v4.8 §2.3.1 + F18 ratified at v0.3 §BB)
//
// Flat hierarchy under MissioncraftError base; all 9 specialized classes extend the base directly.
// No multi-level inheritance per v0.3 §BB. Total = 10 classes.
//
// Consumer can `instanceof MissioncraftError` for catch-all; specialized class for typed handling.
//
// Explicit invocation sites for ConfigValidationError per Design v4.8 §2.5 + §2.3.1 + v1.3 fold MEDIUM-R2.3:
// - §2.5 unknown mission-config-schema-version reject
// - §2.5 atomic-write zod-validate-roundtrip failure
// - §2.3.1 SDK-side zod-validate-at-entry on startMission({config}) / applyMission({id, config})

/**
 * Base class for all missioncraft errors. Consumers can `try { ... } catch (e) { if (e instanceof MissioncraftError) ... }`
 * for catch-all handling; specialized subclass instanceof checks for typed error-flow.
 */
export class MissioncraftError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MissioncraftError';
    // Preserve prototype chain across transpilation per ES2022 + Strict-1.0 stability commitment.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Lock acquisition timed out (waitMs exceeded; per StorageProvider.acquireMissionLock + acquireRepoLock).
 */
export class LockTimeoutError extends MissioncraftError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LockTimeoutError';
    Object.setPrototypeOf(this, LockTimeoutError.prototype);
  }
}

/**
 * Workspace allocation failed (filesystem error, disk full, permission denied, etc.).
 * Also: id-generation collision cap-exceeded (v1.2 fold per MEDIUM-1).
 */
export class StorageAllocationError extends MissioncraftError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StorageAllocationError';
    Object.setPrototypeOf(this, StorageAllocationError.prototype);
  }
}

/**
 * Remote authentication failure (gh-cli auth expired, missing credential-helper, etc.).
 * Per §2.6.6 commit+push auth — push-403/401, PR-creation auth-rejection.
 */
export class RemoteAuthError extends MissioncraftError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RemoteAuthError';
    Object.setPrototypeOf(this, RemoteAuthError.prototype);
  }
}

/**
 * Operator-approval denied via ApprovalPolicy.decide() returning {approved: false}.
 */
export class ApprovalDeniedError extends MissioncraftError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ApprovalDeniedError';
    Object.setPrototypeOf(this, ApprovalDeniedError.prototype);
  }
}

/**
 * Mission lifecycle-state violation (e.g., update on terminal mission; mutation not allowed in current state per
 * §2.4.1 per-field state-restriction matrix; reader-side mutation rejection per HIGH-R2.3).
 * Also: mission-not-found errors; abandon-mid-flow concurrent-CLI race-rejection per v3.5+v3.6 folds.
 */
export class MissionStateError extends MissioncraftError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MissionStateError';
    Object.setPrototypeOf(this, MissionStateError.prototype);
  }
}

/**
 * Reader-mission auto-close signal — thrown by readerLoopBV5Tick when BRANCH-TRACKER detects
 * writer-terminal (writer mission-config gone OR writer lifecycle terminal). Distinct from
 * MissionStateError so watcher-entry can pattern-match → atomic lifecycle advance to
 * 'abandoned' + SIGTERM-self path (mission-78 W4-new slice (v.b) auto-close mechanics).
 */
export class ReaderAutoCloseError extends MissioncraftError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ReaderAutoCloseError';
    Object.setPrototypeOf(this, ReaderAutoCloseError.prototype);
  }
}

/**
 * Repo-lock conflict — repo already locked by a different mission (one-active-mission-per-repo invariant violation).
 * Per StorageProvider.acquireRepoLock contract.
 */
export class WorkspaceConflictError extends MissioncraftError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WorkspaceConflictError';
    Object.setPrototypeOf(this, WorkspaceConflictError.prototype);
  }
}

/**
 * Schema-validation failure at parse-site (zod parse-fail; unknown schema-version; name-format violation; etc.).
 *
 * Explicit invocation sites (v1.2 + v1.3 + v1.4 folds per MEDIUM-14 + MEDIUM-11 + MEDIUM-R2.3 + MEDIUM-R3.11):
 * - Unknown mission-config-schema-version reject (parser-side version-dispatch)
 * - Atomic-write zod-validate-roundtrip failure (CLI mid-mission config mutation)
 * - SDK-side zod-validate-at-entry on startMission/applyMission (defense-in-depth)
 * - YAML hydration parse-fail
 * - Adapter Hub-delivered payload parse-fail
 * - Name-format slug-validation violation
 * - Reserved-verb name-collision rejection
 */
export class ConfigValidationError extends MissioncraftError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConfigValidationError';
    Object.setPrototypeOf(this, ConfigValidationError.prototype);
  }
}

/**
 * Capability-gated method invocation against unsupported pluggable (per F13 capabilities-gated throws-on-unsupported).
 *
 * Examples:
 * - `RemoteProvider.openPullRequest()` against `pure-git` mode (capabilities.supportsPullRequests = false)
 * - `GitEngine.squashCommit?()` against engine that didn't implement (3rd-party variation)
 * - `Missioncraft` instantiation on Windows (v1.5 fold per MEDIUM-R4.1 — Linux+macOS only at v1)
 */
export class UnsupportedOperationError extends MissioncraftError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UnsupportedOperationError';
    Object.setPrototypeOf(this, UnsupportedOperationError.prototype);
  }
}

/**
 * Network operation exhausted retry budget (per state-durability.networkRetry config; default {maxAttempts: 5, backoffMs: 1000}).
 * Per §2.6.3 network-partition resilience fold (push retry-loop with exponential backoff).
 */
export class NetworkRetryExhaustedError extends MissioncraftError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NetworkRetryExhaustedError';
    Object.setPrototypeOf(this, NetworkRetryExhaustedError.prototype);
  }
}
