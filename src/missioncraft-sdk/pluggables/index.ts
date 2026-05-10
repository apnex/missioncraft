// Pluggable interfaces barrel — re-exports for convenient consumption.
// Per Design v4.8 §2.1 — 5 pluggable interfaces ship in v1.0.0 (Q1=b full architectural posture).
// Strict-1.0 commitment: every signature is committed contract.

export type { SigningKey, AgentIdentity, IdentityProvider } from './identity.js';
export type {
  ApprovalAction,
  ApprovalContext,
  ApprovalDecision,
  ApprovalPolicy,
} from './approval.js';
export type {
  WorkspaceHandle,
  LockHandle,
  StorageProvider,
} from './storage.js';
export type {
  GitOptions,
  CommitOptions,
  MergeStrategy,
  PushOptions,
  LogEntry,
  GitStatus,
  GitEngine,
} from './git-engine.js';
export type {
  RemoteProviderCapabilities,
  PullRequestSpec,
  PullRequestSummary,
  PullRequestFilter,
  RepoMetadata,
  RemoteUser,
  RemoteProvider,
} from './remote.js';
