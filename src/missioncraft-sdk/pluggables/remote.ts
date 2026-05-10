// RemoteProvider pluggable interface (Design v4.8 §2.1.5)
// Capabilities-gated throws-on-unsupported per F13 ratified at v0.2 §G.
// Coord-remote auth (v4.0+ multi-participant per HIGH-R1.1): coord-remote push/pull goes through GitEngine plain-git wire-protocol;
// RemoteProvider is NOT in coord-remote substrate-path (only PR + API operations).

export interface RemoteProviderCapabilities {
  readonly supportsPullRequests: boolean;
  readonly supportsApi: boolean; // can query repo metadata, list PRs, etc.
}

export interface PullRequestSpec {
  readonly title: string;
  readonly body: string;
  readonly head: string; // branch
  readonly base: string; // target branch
  readonly draft?: boolean;
}

export interface PullRequestSummary {
  readonly url: string;
  readonly number: number;
  readonly state: 'open' | 'closed' | 'merged';
  readonly title: string;
  readonly head: string;
  readonly base: string;
}

export interface PullRequestFilter {
  readonly state?: 'open' | 'closed' | 'merged' | 'all';
  readonly head?: string;
  readonly base?: string;
}

export interface RepoMetadata {
  readonly defaultBranch: string;
  readonly visibility: 'public' | 'private';
  readonly description?: string;
}

export interface RemoteUser {
  readonly login: string;
  readonly email?: string;
}

/**
 * v0.2 fold per §G F13 — capabilities-gated throws-on-unsupported pattern.
 * Methods are NOT optional; callers MUST check capabilities + missioncraft throws UnsupportedOperationError if mismatch.
 */
export interface RemoteProvider {
  readonly capabilities: RemoteProviderCapabilities;

  /** Authenticate with the remote (token retrieval + validation). */
  authenticate(): Promise<void>;

  /** Get authenticated user identity. v0.2 fold per §C.3. Throws UnsupportedOperationError if !capabilities.supportsApi. */
  getCurrentUser(): Promise<RemoteUser>;

  /** Open a pull request. Throws UnsupportedOperationError if !capabilities.supportsPullRequests. */
  openPullRequest(repoUrl: string, spec: PullRequestSpec): Promise<PullRequestSummary>;

  /** List pull requests. v0.2 fold per §C.3. Throws UnsupportedOperationError if !capabilities.supportsPullRequests. */
  listPullRequests(repoUrl: string, filter?: PullRequestFilter): Promise<PullRequestSummary[]>;

  /** Read repo metadata via API. Throws UnsupportedOperationError if !capabilities.supportsApi. */
  getRepoMetadata(repoUrl: string): Promise<RepoMetadata>;
}
