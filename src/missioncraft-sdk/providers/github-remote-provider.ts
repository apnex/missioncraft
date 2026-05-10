// Opt-in RemoteProvider implementation — gh-cli subprocess wrapper (Design v4.8 §2.1.5 opt-in v1 implementation).
//
// gh-cli is a runtime dependency at this provider's scope; missioncraft validates `gh` presence + minimum version
// at authenticate(). Operator opts in via mission-config `remote.provider: gh-cli` OR SDK constructor `remote: new GitHubRemoteProvider(...)`.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type {
  PullRequestFilter,
  PullRequestSpec,
  PullRequestSummary,
  RemoteProvider,
  RemoteProviderCapabilities,
  RemoteUser,
  RepoMetadata,
} from '../pluggables/remote.js';
import { RemoteAuthError, UnsupportedOperationError } from '../errors.js';

const execFileAsync = promisify(execFile);

/** Minimum gh-CLI version (Design v4.8 §2.1.5 v0.7 fold per §CCCCCC micro). */
const MIN_GH_VERSION = { major: 2, minor: 40 };

export interface GitHubRemoteProviderOptions {
  /** Path to `gh` binary (default: 'gh' — resolved via PATH). */
  readonly ghCliPath?: string;
}

interface SemverPair {
  readonly major: number;
  readonly minor: number;
}

function parseGhVersion(stdout: string): SemverPair | undefined {
  // `gh --version` output starts with `gh version 2.40.1 (...)`
  const m = stdout.match(/gh version (\d+)\.(\d+)/);
  if (!m) return undefined;
  return { major: Number(m[1]), minor: Number(m[2]) };
}

function meetsMinVersion(actual: SemverPair, min: SemverPair): boolean {
  if (actual.major > min.major) return true;
  if (actual.major < min.major) return false;
  return actual.minor >= min.minor;
}

/**
 * Repo-URL → `<owner>/<repo>` slug for `gh` invocations.
 * Accepts: https://github.com/owner/repo[.git], git@github.com:owner/repo[.git], owner/repo
 */
function repoUrlToSlug(repoUrl: string): string {
  // owner/repo plain form
  if (/^[\w.-]+\/[\w.-]+$/.test(repoUrl)) {
    return repoUrl.replace(/\.git$/, '');
  }
  // SSH: git@github.com:owner/repo[.git]
  const sshMatch = repoUrl.match(/[^:/]+:([^/]+)\/([^/]+?)(\.git)?$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }
  // HTTPS: https://github.com/owner/repo[.git]
  const httpsMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(\.git)?\/?$/);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }
  throw new UnsupportedOperationError(
    `GitHubRemoteProvider: cannot parse repo-URL '${repoUrl}' to <owner>/<repo> slug`,
  );
}

export class GitHubRemoteProvider implements RemoteProvider {
  /** v1.5 fold per MEDIUM-R4.2 — providerName contract. */
  static readonly providerName: string = 'gh-cli';

  readonly capabilities: RemoteProviderCapabilities = {
    supportsPullRequests: true,
    supportsApi: true,
  };

  private readonly ghCliPath: string;

  constructor(options: GitHubRemoteProviderOptions = {}) {
    this.ghCliPath = options.ghCliPath ?? 'gh';
  }

  /**
   * Validates gh CLI presence + minimum version (`gh >= 2.40.0` per v0.7 fold §CCCCCC micro).
   * Confirms authenticated state via `gh auth status` (which exits non-zero if not auth'd).
   */
  async authenticate(): Promise<void> {
    let versionStdout: string;
    try {
      const { stdout } = await execFileAsync(this.ghCliPath, ['--version']);
      versionStdout = stdout;
    } catch (err: unknown) {
      throw new UnsupportedOperationError(
        `GitHubRemoteProvider: '${this.ghCliPath}' CLI not found on PATH; install gh >= ${MIN_GH_VERSION.major}.${MIN_GH_VERSION.minor}.0 from https://cli.github.com`,
        { cause: err instanceof Error ? err : undefined },
      );
    }
    const actual = parseGhVersion(versionStdout);
    if (!actual) {
      throw new UnsupportedOperationError(
        `GitHubRemoteProvider: cannot parse '${this.ghCliPath} --version' output: ${versionStdout.trim().slice(0, 80)}`,
      );
    }
    if (!meetsMinVersion(actual, MIN_GH_VERSION)) {
      throw new UnsupportedOperationError(
        `GitHubRemoteProvider: gh ${actual.major}.${actual.minor} below minimum ${MIN_GH_VERSION.major}.${MIN_GH_VERSION.minor}; upgrade via https://cli.github.com`,
      );
    }
    try {
      await execFileAsync(this.ghCliPath, ['auth', 'status']);
    } catch (err: unknown) {
      throw new RemoteAuthError(
        `GitHubRemoteProvider: 'gh auth status' failed; run 'gh auth login' to authenticate`,
        { cause: err instanceof Error ? err : undefined },
      );
    }
  }

  async getCurrentUser(): Promise<RemoteUser> {
    try {
      const { stdout } = await execFileAsync(this.ghCliPath, [
        'api',
        'user',
        '--jq',
        '{login, email}',
      ]);
      const parsed = JSON.parse(stdout) as { login?: string; email?: string | null };
      if (!parsed.login) {
        throw new RemoteAuthError(
          `GitHubRemoteProvider.getCurrentUser(): 'gh api user' returned no login field`,
        );
      }
      return parsed.email == null
        ? { login: parsed.login }
        : { login: parsed.login, email: parsed.email };
    } catch (err: unknown) {
      if (err instanceof RemoteAuthError) throw err;
      throw new RemoteAuthError(
        `GitHubRemoteProvider.getCurrentUser() failed: ${err instanceof Error ? err.message : 'unknown'}`,
        { cause: err instanceof Error ? err : undefined },
      );
    }
  }

  async openPullRequest(repoUrl: string, spec: PullRequestSpec): Promise<PullRequestSummary> {
    const slug = repoUrlToSlug(repoUrl);
    const args = [
      'pr',
      'create',
      '--repo',
      slug,
      '--title',
      spec.title,
      '--body',
      spec.body,
      '--head',
      spec.head,
      '--base',
      spec.base,
    ];
    if (spec.draft) args.push('--draft');
    let prUrl: string;
    try {
      const { stdout } = await execFileAsync(this.ghCliPath, args);
      prUrl = stdout.trim().split('\n').filter(Boolean).pop() ?? '';
    } catch (err: unknown) {
      throw new RemoteAuthError(
        `GitHubRemoteProvider.openPullRequest(${slug}) failed: ${err instanceof Error ? err.message : 'unknown'}`,
        { cause: err instanceof Error ? err : undefined },
      );
    }
    if (!prUrl) {
      throw new RemoteAuthError(
        `GitHubRemoteProvider.openPullRequest(${slug}): 'gh pr create' returned no URL`,
      );
    }
    // gh-CLI returns the PR URL only; fetch metadata to assemble summary
    const numberMatch = prUrl.match(/\/pull\/(\d+)/);
    const prNumber = numberMatch ? Number(numberMatch[1]) : 0;
    return {
      url: prUrl,
      number: prNumber,
      state: 'open',
      title: spec.title,
      head: spec.head,
      base: spec.base,
    };
  }

  async listPullRequests(
    repoUrl: string,
    filter?: PullRequestFilter,
  ): Promise<PullRequestSummary[]> {
    const slug = repoUrlToSlug(repoUrl);
    const args = [
      'pr',
      'list',
      '--repo',
      slug,
      '--json',
      'url,number,state,title,headRefName,baseRefName',
    ];
    if (filter?.state && filter.state !== 'all') {
      args.push('--state', filter.state);
    } else if (filter?.state === 'all') {
      args.push('--state', 'all');
    }
    if (filter?.head) {
      args.push('--head', filter.head);
    }
    if (filter?.base) {
      args.push('--base', filter.base);
    }
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(this.ghCliPath, args));
    } catch (err: unknown) {
      throw new RemoteAuthError(
        `GitHubRemoteProvider.listPullRequests(${slug}) failed: ${err instanceof Error ? err.message : 'unknown'}`,
        { cause: err instanceof Error ? err : undefined },
      );
    }
    const parsed = JSON.parse(stdout) as Array<{
      url: string;
      number: number;
      state: string;
      title: string;
      headRefName: string;
      baseRefName: string;
    }>;
    return parsed.map((p) => ({
      url: p.url,
      number: p.number,
      state: (p.state.toLowerCase() === 'open' ||
      p.state.toLowerCase() === 'closed' ||
      p.state.toLowerCase() === 'merged'
        ? p.state.toLowerCase()
        : 'closed') as 'open' | 'closed' | 'merged',
      title: p.title,
      head: p.headRefName,
      base: p.baseRefName,
    }));
  }

  async getRepoMetadata(repoUrl: string): Promise<RepoMetadata> {
    const slug = repoUrlToSlug(repoUrl);
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(this.ghCliPath, [
        'repo',
        'view',
        slug,
        '--json',
        'defaultBranchRef,visibility,description',
      ]));
    } catch (err: unknown) {
      throw new RemoteAuthError(
        `GitHubRemoteProvider.getRepoMetadata(${slug}) failed: ${err instanceof Error ? err.message : 'unknown'}`,
        { cause: err instanceof Error ? err : undefined },
      );
    }
    const parsed = JSON.parse(stdout) as {
      defaultBranchRef?: { name?: string };
      visibility?: string;
      description?: string;
    };
    const defaultBranch = parsed.defaultBranchRef?.name ?? 'main';
    const visibility = (parsed.visibility ?? 'public').toLowerCase() === 'public' ? 'public' : 'private';
    const description = parsed.description?.length ? parsed.description : undefined;
    return description === undefined
      ? { defaultBranch, visibility }
      : { defaultBranch, visibility, description };
  }
}
