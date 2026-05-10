// @apnex/missioncraft SDK — top-level exports per Design v4.8 §2.3.1
// PRIMARY contract surface: 5 pluggable interfaces + Mission/Scope resource-types + Mutation discriminated-unions + zod schemas.
// Strict-1.0 commitment per Q2=a — every export is committed contract; breaking changes post-v1 require major-bump.

export const VERSION = '1.0.0';

// ─── Pluggable interfaces (§2.1) ───
export type {
  // §2.1.1 IdentityProvider
  SigningKey,
  AgentIdentity,
  IdentityProvider,
  // §2.1.2 ApprovalPolicy
  ApprovalAction,
  ApprovalContext,
  ApprovalDecision,
  ApprovalPolicy,
  // §2.1.3 StorageProvider
  WorkspaceHandle,
  LockHandle,
  StorageProvider,
  // §2.1.4 GitEngine
  GitOptions,
  CommitOptions,
  MergeStrategy,
  PushOptions,
  LogEntry,
  GitStatus,
  GitEngine,
  // §2.1.5 RemoteProvider
  RemoteProviderCapabilities,
  PullRequestSpec,
  PullRequestSummary,
  PullRequestFilter,
  RepoMetadata,
  RemoteUser,
  RemoteProvider,
} from './pluggables/index.js';

// ─── SDK-INTERNAL constructor types (§2.3.1) ───
export type { MissioncraftConfig, StateDurabilityConfig } from './core/types.js';

// ─── Mission resource (k8s-shape primary resource) ───
export type {
  MissionStatePhase,
  MissionHandle,
  MissionParticipant,        // v4.0 NEW per idea-265
  RepoSpec,
  MissionRepoState,          // v4.0 NEW per MINOR-R1.2
  MissionState,
  MissionFilter,
  MissionConfig,
  MissionMutation,
} from './core/mission-types.js';

// ─── Scope resource (v2.0 NEW per Refinement C) ───
export type {
  ScopeStatePhase,
  ScopeHandle,
  ScopeState,
  ScopeFilter,
  ScopeConfig,
  ScopeMutation,
} from './core/scope-types.js';

// ─── Runtime zod schemas (v1.3 fold per MEDIUM-R3.1; adapter + 3rd-party consumers need .parse() at integration boundary) ───
export {
  RepoSpecSchema,
  MissionParticipantSchema,
  MissionStatePhaseSchema,
  MissionConfigSchema,           // default writer-role; v3.6-baseline-compatible
  makeMissionConfigSchema,       // v4.5 factory per MEDIUM-R6.4 — role-based state-validation
} from './core/mission-config-schema.js';
export { ScopeConfigSchema } from './core/scope-config-schema.js';
export { OperatorConfigSchema } from './core/operator-config-schema.js';

// ─── Engine-side helpers ───
export { deriveOwningPrincipalRole } from './core/role-derivation.js';

// ─── Error class hierarchy (10 classes; flat under MissioncraftError base per F18 v0.3 §BB) ───
export {
  MissioncraftError,
  LockTimeoutError,
  StorageAllocationError,
  RemoteAuthError,
  ApprovalDeniedError,
  MissionStateError,
  WorkspaceConflictError,
  ConfigValidationError,
  UnsupportedOperationError,
  NetworkRetryExhaustedError,
} from './errors.js';

// ─── Default implementations (Design v4.8 §2.1.x — operator imports + injects via Missioncraft constructor) ───
export { TrustAllPolicy } from './defaults/trust-all-policy.js';
export { LocalGitConfigIdentity } from './defaults/local-git-config-identity.js';
export {
  LocalFilesystemStorage,
  type LocalFilesystemStorageOptions,
} from './defaults/local-filesystem-storage.js';
export { IsomorphicGitEngine } from './defaults/isomorphic-git-engine.js';

// ─── RemoteProvider implementations (Design v4.8 §2.1.5) ───
export { PureGitRemoteProvider } from './providers/pure-git-remote-provider.js';
export {
  GitHubRemoteProvider,
  type GitHubRemoteProviderOptions,
} from './providers/github-remote-provider.js';

// ─── PROVIDER_REGISTRY string-name dispatch (Design v4.8 §2.3.1 v1.3 fold per HIGH-R3.1 — closed registry at v1) ───
export {
  instantiateProvider,
  listProviderNames,
  type PluggableCategory,
} from './core/provider-registry.js';
