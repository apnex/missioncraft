// Default GitEngine implementation (Design v4.8 §2.1.4 + v0.6 fold IsomorphicGitEngine implementation-mapping table).
//
// Pure-TS via isomorphic-git library (no native bindings; portable across Linux + macOS at v1).
// `commitToRef` uses isomorphic-git's low-level plumbing (writeBlob + writeTree + writeCommit + writeRef) per §AA — bypass-INDEX semantic.
// `squashCommit?` capability-aware — shells out to native `git` CLI when available; throws UnsupportedOperationError otherwise (parallel to §2.6.2 bundle-ops native-git breach pattern).

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';

import * as git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';

import type {
  CommitOptions,
  GitEngine,
  GitOptions,
  GitStatus,
  LogEntry,
  MergeStrategy,
  PushOptions,
} from '../pluggables/git-engine.js';
import type { WorkspaceHandle } from '../pluggables/storage.js';
import type { AgentIdentity } from '../pluggables/identity.js';
import { UnsupportedOperationError } from '../errors.js';

const execFileAsync = promisify(execFile);

interface GitOptionsInternal {
  readonly identity: AgentIdentity;
}

const optionsByWorkspacePath = new WeakMap<WorkspaceHandle, GitOptionsInternal>();

function authorFromIdentity(identity: AgentIdentity): { name: string; email: string } {
  return { name: identity.name, email: identity.email };
}

function getIdentity(workspace: WorkspaceHandle): AgentIdentity {
  const options = optionsByWorkspacePath.get(workspace);
  if (!options) {
    throw new UnsupportedOperationError(
      `IsomorphicGitEngine: workspace ${workspace.path} has no associated GitOptions; call init() or clone() first`,
    );
  }
  return options.identity;
}

export class IsomorphicGitEngine implements GitEngine {
  /** v1.5 fold per MEDIUM-R4.2 — providerName contract. */
  static readonly providerName: string = 'isomorphic-git';

  // ─── Lifecycle ───

  async init(workspace: WorkspaceHandle, options: GitOptions): Promise<void> {
    optionsByWorkspacePath.set(workspace, { identity: options.identity });
    await git.init({ fs, dir: workspace.path });
  }

  async clone(workspace: WorkspaceHandle, repoUrl: string, options: GitOptions): Promise<void> {
    optionsByWorkspacePath.set(workspace, { identity: options.identity });
    await git.clone({ fs, http, dir: workspace.path, url: repoUrl });
  }

  // ─── Refs (branches + tags) ───

  async branch(
    workspace: WorkspaceHandle,
    branchName: string,
    options: { from?: string } = {},
  ): Promise<void> {
    await git.branch({
      fs,
      dir: workspace.path,
      ref: branchName,
      object: options.from,
    });
  }

  async checkout(workspace: WorkspaceHandle, branchName: string): Promise<void> {
    await git.checkout({ fs, dir: workspace.path, ref: branchName });
  }

  async getCurrentBranch(workspace: WorkspaceHandle): Promise<string> {
    const branch = await git.currentBranch({ fs, dir: workspace.path, fullname: false });
    if (!branch) {
      throw new UnsupportedOperationError(
        `IsomorphicGitEngine.getCurrentBranch: detached HEAD at ${workspace.path}`,
      );
    }
    return branch;
  }

  async tag(
    workspace: WorkspaceHandle,
    name: string,
    options: { ref?: string; message?: string; force?: boolean } = {},
  ): Promise<void> {
    if (options.message !== undefined) {
      // Annotated tag (v0.6 fold §BBBBB IsomorphicGitEngine implementation-mapping)
      const identity = getIdentity(workspace);
      await git.annotatedTag({
        fs,
        dir: workspace.path,
        ref: name,
        tagger: { ...authorFromIdentity(identity), timestamp: Math.floor(Date.now() / 1000) },
        message: options.message,
        object: options.ref,
        force: options.force,
      });
      return;
    }
    // Lightweight tag
    await git.tag({
      fs,
      dir: workspace.path,
      ref: name,
      object: options.ref,
      force: options.force,
    });
  }

  async revparse(workspace: WorkspaceHandle, ref: string): Promise<string> {
    return git.resolveRef({ fs, dir: workspace.path, ref });
  }

  // ─── Working tree + commit ───

  async stage(workspace: WorkspaceHandle, paths: string[] | 'all'): Promise<void> {
    if (paths === 'all') {
      // isomorphic-git `add` accepts filepath array OR single string; for "all", use status-matrix to enumerate
      const matrix = await git.statusMatrix({ fs, dir: workspace.path });
      const filepaths = matrix
        .filter(([, head, work, stage]) => head !== work || work !== stage)
        .map(([fp]) => fp);
      if (filepaths.length === 0) return;
      await git.add({ fs, dir: workspace.path, filepath: filepaths });
      return;
    }
    if (paths.length === 0) return;
    await git.add({ fs, dir: workspace.path, filepath: paths });
  }

  async commit(workspace: WorkspaceHandle, options: CommitOptions): Promise<string> {
    const identity = options.author ?? getIdentity(workspace);
    const author = authorFromIdentity(identity);
    if (options.autoStage) {
      await this.stage(workspace, 'all');
    }
    return git.commit({
      fs,
      dir: workspace.path,
      message: options.message,
      author,
      amend: options.amend,
    });
  }

  /**
   * v0.3 fold per §AA — commit-to-ref bypass-HEAD bypass-INDEX.
   *
   * Implementation: walk working-tree → per-file writeBlob → writeTree → writeCommit → writeRef.
   * Operator's `git status` post-call shows no staged paths (INDEX untouched).
   * Load-bearing for §2.6.1 wip-branch mechanism.
   */
  async commitToRef(
    workspace: WorkspaceHandle,
    ref: string,
    options: CommitOptions,
  ): Promise<string> {
    const identity = options.author ?? getIdentity(workspace);
    const author = authorFromIdentity(identity);

    // Walk working-tree via statusMatrix; collect non-ignored files
    const matrix = await git.statusMatrix({ fs, dir: workspace.path });
    type TreeEntry = { mode: string; path: string; oid: string; type: 'blob' };
    const treeEntries: TreeEntry[] = [];
    for (const [filepath, head] of matrix) {
      void head;
      try {
        const blob = await fs.readFile(`${workspace.path}/${filepath}`);
        const oid = await git.writeBlob({ fs, dir: workspace.path, blob });
        treeEntries.push({ mode: '100644', path: filepath, oid, type: 'blob' });
      } catch {
        // skip files removed from working-tree but still in HEAD
      }
    }

    // Build tree-objects from flat path-list (build directory structure recursively)
    const treeOid = await this.buildTreeFromPaths(workspace, treeEntries);

    // Determine parent (existing tip of ref if present)
    let parents: string[] = [];
    try {
      const existing = await git.resolveRef({ fs, dir: workspace.path, ref });
      parents = [existing];
    } catch {
      // ref doesn't exist yet — no parents
    }

    const now = Math.floor(Date.now() / 1000);
    const commitOid = await git.writeCommit({
      fs,
      dir: workspace.path,
      commit: {
        message: options.message,
        tree: treeOid,
        parent: parents,
        author: { ...author, timestamp: now, timezoneOffset: 0 },
        committer: { ...author, timestamp: now, timezoneOffset: 0 },
      },
    });

    await git.writeRef({
      fs,
      dir: workspace.path,
      ref,
      value: commitOid,
      force: true,
    });

    return commitOid;
  }

  async deleteBranch(
    workspace: WorkspaceHandle,
    branchName: string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    void options;       // isomorphic-git deleteBranch doesn't expose force flag at v1; accepted for interface-uniformity
    await git.deleteBranch({ fs, dir: workspace.path, ref: branchName });
  }

  // ─── Wire ───

  async fetch(
    workspace: WorkspaceHandle,
    options: { remote?: string; branch?: string; prune?: boolean } = {},
  ): Promise<void> {
    await git.fetch({
      fs,
      http,
      dir: workspace.path,
      remote: options.remote,
      ref: options.branch,
      prune: options.prune,
    });
  }

  async push(workspace: WorkspaceHandle, options: PushOptions = {}): Promise<void> {
    await git.push({
      fs,
      http,
      dir: workspace.path,
      remote: options.remote,
      ref: options.branch,
      force: options.force,
    });
  }

  async pull(
    workspace: WorkspaceHandle,
    options: { branch?: string; remote?: string } = {},
  ): Promise<void> {
    const identity = getIdentity(workspace);
    await git.pull({
      fs,
      http,
      dir: workspace.path,
      ref: options.branch,
      author: authorFromIdentity(identity),
    });
  }

  async merge(
    workspace: WorkspaceHandle,
    sourceBranch: string,
    options: { strategy?: MergeStrategy } = {},
  ): Promise<void> {
    const identity = getIdentity(workspace);
    const strategy = options.strategy ?? 'no-ff';
    // v0.7 fold §BBBBBB micro: ff = require-fast-forward (fail-otherwise); no-ff = always create merge-commit
    const fastForwardOnly = strategy === 'ff';
    const fastForward = strategy === 'ff';
    const ours = await this.getCurrentBranch(workspace);
    await git.merge({
      fs,
      dir: workspace.path,
      ours,
      theirs: sourceBranch,
      fastForwardOnly,
      fastForward,
      author: authorFromIdentity(identity),
    });
  }

  /**
   * v3.3 fold per HIGH-R3.1 — squash-merge primitive.
   *
   * Pure-TS breach: shells out to native `git` CLI per §2.1.4 v0.6 fold IsomorphicGitEngine implementation-mapping
   * (`git checkout <baseRef>` + `git merge --squash <headRef>` + `git commit -m <message>` + `git rev-parse HEAD` capture sha).
   *
   * Capabilities-gated per F13 throws-on-unsupported pattern; throws UnsupportedOperationError if `git` CLI absent.
   */
  async squashCommit(
    workspace: WorkspaceHandle,
    baseRef: string,
    headRef: string,
    message: string,
  ): Promise<string> {
    // Probe git CLI availability
    try {
      await execFileAsync('git', ['--version']);
    } catch (err: unknown) {
      throw new UnsupportedOperationError(
        `IsomorphicGitEngine.squashCommit requires native git CLI (pure-TS squash-merge unsupported per §AAAAA); install git OR use 3rd-party GitEngine implementation`,
        { cause: err instanceof Error ? err : undefined },
      );
    }
    const cwd = workspace.path;
    await execFileAsync('git', ['checkout', baseRef], { cwd });
    await execFileAsync('git', ['merge', '--squash', headRef], { cwd });
    await execFileAsync('git', ['commit', '-m', message], { cwd });
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd });
    return stdout.trim();
  }

  // ─── Read ───

  async status(workspace: WorkspaceHandle): Promise<GitStatus> {
    const branch = (await git.currentBranch({ fs, dir: workspace.path, fullname: false })) ?? 'HEAD';
    const head = await git.resolveRef({ fs, dir: workspace.path, ref: 'HEAD' }).catch(() => '');
    const matrix = await git.statusMatrix({ fs, dir: workspace.path });
    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];
    for (const [filepath, headBit, workBit, stageBit] of matrix) {
      if (headBit === 0 && workBit === 2 && stageBit === 0) {
        untracked.push(filepath);
      } else if (workBit !== headBit) {
        modified.push(filepath);
      }
      if (stageBit !== headBit && stageBit !== 0) {
        staged.push(filepath);
      }
    }
    return {
      branch,
      head,
      clean: staged.length === 0 && modified.length === 0 && untracked.length === 0,
      staged,
      modified,
      untracked,
    };
  }

  async log(
    workspace: WorkspaceHandle,
    options: { ref?: string; maxCount?: number; since?: Date; path?: string } = {},
  ): Promise<LogEntry[]> {
    const entries = await git.log({
      fs,
      dir: workspace.path,
      ref: options.ref,
      depth: options.maxCount,
      since: options.since,
      filepath: options.path,
    });
    return entries.map((e) => ({
      sha: e.oid,
      author: { name: e.commit.author.name, email: e.commit.author.email },
      message: e.commit.message,
      timestamp: new Date(e.commit.author.timestamp * 1000),
      parents: e.commit.parent,
    }));
  }

  // ─── Remote management ───

  async addRemote(workspace: WorkspaceHandle, name: string, url: string): Promise<void> {
    await git.addRemote({ fs, dir: workspace.path, remote: name, url });
  }

  async removeRemote(workspace: WorkspaceHandle, name: string): Promise<void> {
    await git.deleteRemote({ fs, dir: workspace.path, remote: name });
  }

  async listRemotes(workspace: WorkspaceHandle): Promise<{ name: string; url: string }[]> {
    const remotes = await git.listRemotes({ fs, dir: workspace.path });
    return remotes.map((r) => ({ name: r.remote, url: r.url }));
  }

  // ─── Internal helpers ───

  /**
   * Build hierarchical git-tree from flat path-list via recursive writeTree.
   * Used by commitToRef to construct tree-object bypass-INDEX per §AA.
   */
  private async buildTreeFromPaths(
    workspace: WorkspaceHandle,
    entries: { mode: string; path: string; oid: string; type: 'blob' }[],
  ): Promise<string> {
    // Group entries by top-level dir vs root-files
    type TreeNode =
      | { kind: 'blob'; mode: string; oid: string }
      | { kind: 'subtree'; mode: string; entries: Map<string, TreeNode> };
    const root: Map<string, TreeNode> = new Map();
    for (const e of entries) {
      const parts = e.path.split('/');
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const segment = parts[i];
        let existing = node.get(segment);
        if (!existing || existing.kind !== 'subtree') {
          existing = { kind: 'subtree', mode: '040000', entries: new Map() };
          node.set(segment, existing);
        }
        node = existing.entries;
      }
      node.set(parts[parts.length - 1], { kind: 'blob', mode: e.mode, oid: e.oid });
    }

    const writeNode = async (m: Map<string, TreeNode>): Promise<string> => {
      const treeArray: { mode: string; path: string; oid: string; type: 'blob' | 'tree' }[] = [];
      for (const [name, child] of m.entries()) {
        if (child.kind === 'blob') {
          treeArray.push({ mode: child.mode, path: name, oid: child.oid, type: 'blob' });
        } else {
          const subtreeOid = await writeNode(child.entries);
          treeArray.push({ mode: child.mode, path: name, oid: subtreeOid, type: 'tree' });
        }
      }
      return git.writeTree({ fs, dir: workspace.path, tree: treeArray });
    };

    return writeNode(root);
  }
}
