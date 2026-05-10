// GitEngine pluggable interface (Design v4.8 §2.1.4 — v0.2 fold per §C.1 comprehensive API)
// Default v1 implementation: IsomorphicGitEngine (pure-TS; portable; no native bindings).

import type { AgentIdentity } from './identity.js';
import type { WorkspaceHandle } from './storage.js';
import type { RemoteProvider } from './remote.js';

export interface GitOptions {
  readonly fs: unknown; // filesystem abstraction (IsomorphicGit-compatible)
  readonly identity: AgentIdentity;
  readonly remote?: RemoteProvider;
}

export interface CommitOptions {
  readonly message: string;
  readonly author?: AgentIdentity;
  readonly amend?: boolean;
  readonly autoStage?: boolean; // v0.2 fold — explicit stage-everything-tracked vs caller-controlled
}

// v0.6 fold per §AAAAA — IsomorphicGit only supports ff/no-ff per official docs;
// v1.x can add squash/rebase via major-bump if substrate evolves OR via shell-out fold.
export type MergeStrategy = 'ff' | 'no-ff';

export interface PushOptions {
  readonly branch?: string;
  readonly remote?: string;        // v0.2 fold per §C.1 — explicit remote (default 'origin')
  readonly force?: boolean;
  readonly tags?: boolean;         // v0.2 fold — push tags
}

export interface LogEntry {
  readonly sha: string;
  readonly author: AgentIdentity;
  readonly message: string;
  readonly timestamp: Date;
  readonly parents: string[];
}

export interface GitStatus {
  readonly branch: string;
  readonly head: string; // sha
  readonly clean: boolean;
  readonly staged: string[];
  readonly modified: string[];
  readonly untracked: string[];
}

export interface GitEngine {
  // ─── Lifecycle ───
  init(workspace: WorkspaceHandle, options: GitOptions): Promise<void>;
  clone(workspace: WorkspaceHandle, repoUrl: string, options: GitOptions): Promise<void>;

  // ─── Refs (branches + tags) ───
  branch(workspace: WorkspaceHandle, branchName: string, options?: { from?: string }): Promise<void>;
  /** v0.2 fold per §C.1 — branch-switch primitive */
  checkout(workspace: WorkspaceHandle, branchName: string): Promise<void>;
  /** v0.2 fold per §C.1 */
  getCurrentBranch(workspace: WorkspaceHandle): Promise<string>;
  /** v0.2 fold per §C.1 — release-tag primitive; v0.3 fold per §EE — +force for re-tag scenarios */
  tag(
    workspace: WorkspaceHandle,
    name: string,
    options?: { ref?: string; message?: string; force?: boolean },
  ): Promise<void>;
  /** v0.2 fold per §C.1 — ref→sha resolution */
  revparse(workspace: WorkspaceHandle, ref: string): Promise<string>;

  // ─── Working tree + commit ───
  /** v0.2 fold per §C.1 — explicit staging primitive */
  stage(workspace: WorkspaceHandle, paths: string[] | 'all'): Promise<void>;
  commit(workspace: WorkspaceHandle, options: CommitOptions): Promise<string /* sha */>;
  /**
   * v0.3 fold per §AA — commit-to-ref WITHOUT moving HEAD AND WITHOUT polluting operator's INDEX (staging area).
   *
   * Implementation contract: filesystem-walk of working-tree → per-file `git.writeBlob` → explicit tree-construction
   * via `git.writeTree({ tree: [...] })` overload (NOT the index-derived form) → `git.writeCommit` → `git.writeRef`.
   * Operator's `git status` post-call shows no staged paths from the wip-commit operation.
   * Load-bearing for §2.6.1 wip-branch mechanism.
   */
  commitToRef(workspace: WorkspaceHandle, ref: string, options: CommitOptions): Promise<string /* sha */>;
  /** v0.3 fold per §EE — branch-delete primitive; load-bearing for F16 wip-branch cleanup on mission-complete */
  deleteBranch(workspace: WorkspaceHandle, branchName: string, options?: { force?: boolean }): Promise<void>;

  // ─── Wire ───
  /** v0.3 fold per §EE — +prune */
  fetch(
    workspace: WorkspaceHandle,
    options?: { remote?: string; branch?: string; prune?: boolean },
  ): Promise<void>;
  push(workspace: WorkspaceHandle, options?: PushOptions): Promise<void>;
  pull(workspace: WorkspaceHandle, options?: { branch?: string; remote?: string }): Promise<void>;
  merge(
    workspace: WorkspaceHandle,
    sourceBranch: string,
    options?: { strategy?: MergeStrategy },
  ): Promise<void>;
  /**
   * v3.3 fold per HIGH-R3.1 — squash-merge primitive for atomic PR-set publish-flow (§2.4.1 v3.0 Refinement #4).
   *
   * 3rd-party engines MAY implement; if not implemented, throw `UnsupportedOperationError`;
   * engine falls back to internal shell-out to `git merge --squash` + `git commit -m <message>`
   * (parallel to §2.6.2 bundle-ops native-git breach pattern).
   *
   * Returns squashed-commit-sha. Capabilities-gated per F13 throws-on-unsupported pattern.
   */
  squashCommit?(
    workspace: WorkspaceHandle,
    baseRef: string,
    headRef: string,
    message: string,
  ): Promise<string /* squashed-commit-sha */>;

  // ─── Read ───
  status(workspace: WorkspaceHandle): Promise<GitStatus>;
  /** v0.3 fold per §EE — +since +path */
  log(
    workspace: WorkspaceHandle,
    options?: { ref?: string; maxCount?: number; since?: Date; path?: string },
  ): Promise<LogEntry[]>;

  // ─── Remote management (v0.2 fold per §C.1) ───
  addRemote(workspace: WorkspaceHandle, name: string, url: string): Promise<void>;
  removeRemote(workspace: WorkspaceHandle, name: string): Promise<void>;
  listRemotes(workspace: WorkspaceHandle): Promise<{ name: string; url: string }[]>;
}
