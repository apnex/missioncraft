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
