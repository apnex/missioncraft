// Default RemoteProvider implementation — null-object pattern (Design v4.8 §2.1.5 v1.5 fold per HIGH-R4.1(3)).
//
// Enables uniform PROVIDER_REGISTRY dispatch (`'pure-git'` factory) without special-case handling for `remote: undefined`.
// `push`/`pull` semantics flow through GitEngine plain-git wire-protocol (RemoteProvider not invoked for push/pull;
// only for PR + API operations).

import type {
  PullRequestFilter,
  PullRequestSpec,
  PullRequestSummary,
  RemoteProvider,
  RemoteProviderCapabilities,
  RemoteUser,
  RepoMetadata,
} from '../pluggables/remote.js';
import { UnsupportedOperationError } from '../errors.js';

export class PureGitRemoteProvider implements RemoteProvider {
  /** v1.5 fold per MEDIUM-R4.2 — providerName contract. */
  static readonly providerName: string = 'pure-git';

  readonly capabilities: RemoteProviderCapabilities = {
    supportsPullRequests: false,
    supportsApi: false,
  };

  /** No-op succeeds (no remote auth required for pure-git mode). */
  async authenticate(): Promise<void> {
    // null-object pattern; no-op
  }

  /**
   * Engineer-discretion forward-fold (W2): spec text at §2.1.5 says "returns `null`" but RemoteProvider
   * interface signature is `Promise<RemoteUser>` (cannot return null). Per F13 capabilities-gated
   * throws-on-unsupported pattern + interface-signature consistency, throws UnsupportedOperationError.
   * Spec-internal-inconsistency (§2.1.5 default-impl prose vs interface signature); surface for v4.9 PATCH disposition.
   */
  async getCurrentUser(): Promise<RemoteUser> {
    throw new UnsupportedOperationError(
      'PureGitRemoteProvider does not support API operations (capabilities.supportsApi = false); use GitHubRemoteProvider for getCurrentUser()',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async openPullRequest(_repoUrl: string, _spec: PullRequestSpec): Promise<PullRequestSummary> {
    throw new UnsupportedOperationError(
      'PureGitRemoteProvider does not support pull-requests (capabilities.supportsPullRequests = false); use GitHubRemoteProvider for openPullRequest()',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async listPullRequests(
    _repoUrl: string,
    _filter?: PullRequestFilter,
  ): Promise<PullRequestSummary[]> {
    throw new UnsupportedOperationError(
      'PureGitRemoteProvider does not support pull-requests (capabilities.supportsPullRequests = false); use GitHubRemoteProvider for listPullRequests()',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getRepoMetadata(_repoUrl: string): Promise<RepoMetadata> {
    throw new UnsupportedOperationError(
      'PureGitRemoteProvider does not support API operations (capabilities.supportsApi = false); use GitHubRemoteProvider for getRepoMetadata()',
    );
  }
}
