// Native GitEngine implementation (Path D2 — mission-78 W1; Director-ratified 2026-05-12).
//
// Hard-depends on the `git` CLI binary as substrate (per substrate-detect / `requireSubstrate('git')`).
// Replaces IsomorphicGitEngine as the canonical engine in mission-78 W2 (default-flip);
// IsomorphicGitEngine is removed entirely in W4.
//
// **Argv-only discipline (Path D2 core principle)**:
// - ALL git invocations go through `gitExec(workspace, ...args)` which uses `execFile('git', args, ...)`.
// - NEVER `child_process.exec(cmdString)` — shell parsing forbidden.
// - On error, `gitExec` surfaces git's actual stderr (not Node's argv-joined display string)
//   per `feedback_node_execfile_error_formatter_visual_misleads_diagnosis.md`.
//
// Slice (i) — `gitExec` helper + 6 foundational ops: clone / branch / checkout / log / status / revparse
// Slice (ii) — write-ops + lifecycle + remote-management:
//   init / getCurrentBranch / tag / stage / commit / commitToRef / deleteBranch
//   fetch / push / pull / addRemote / removeRemote / listRemotes
// Slice (iii) — THIS commit — advanced ops:
//   merge (ff / no-ff strategy) / squashCommit / createBundle / restoreBundle
//   The latter 3 are Native-canonical (not capability-gated) — IsoEng's impl already
//   shells out to native git per §2.6.2 v0.4 §AAA bundle-ops native-shell-out + §BBBBBB squash-shell-out;
//   semantics match exactly between IsoEng (shell-out) and NativeGitEngine (native).
// Slice (iv) — PROVIDER_REGISTRY entry `'native-git'` + integration test suite (wave-close).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

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

interface NativeOptionsInternal {
  readonly identity: AgentIdentity;
}

const optionsByWorkspace = new WeakMap<WorkspaceHandle, NativeOptionsInternal>();

/**
 * Resolve identity for commit-firing-time. Tries the per-workspace WeakMap first; on miss,
 * falls back to reading the workspace's local git config (`user.name`/`user.email`) which the
 * SDK lifecycle reliably populates via `git config` writes during workspace setup OR which
 * inherits from the operator's `~/.gitconfig` global. This mirrors IsomorphicGitEngine's
 * implicit reliance on git config for shell-out ops (squashCommit/createBundle/restoreBundle)
 * and ensures W2 canonical-switch is transparent for SDK internal call-sites that thread fresh
 * WorkspaceHandle objects from `storage.list()` (different object identity from the handle
 * passed to `clone()`).
 *
 * Throws UnsupportedOperationError only when BOTH WeakMap AND git config lookups fail.
 */
async function resolveIdentity(workspace: WorkspaceHandle): Promise<AgentIdentity> {
  const stored = optionsByWorkspace.get(workspace);
  if (stored) return stored.identity;
  // Fallback: read git config user.name + user.email from the workspace.
  // Both fall through to ~/.gitconfig global if not set locally — matches native git behavior.
  try {
    const [nameResult, emailResult] = await Promise.all([
      gitExec(workspace, ['config', 'user.name']),
      gitExec(workspace, ['config', 'user.email']),
    ]);
    const name = nameResult.stdout.trim();
    const email = emailResult.stdout.trim();
    if (name && email) return { name, email };
  } catch {
    // git config lookup failed (no .git, no global config) — fall through to throw
  }
  throw new UnsupportedOperationError(
    `NativeGitEngine: workspace ${workspace.path} has no associated identity (WeakMap empty AND git config user.name/user.email unset); call init() or clone() with options.identity, OR set git config user.name + user.email`,
  );
}

/** Build an env object that injects GIT_AUTHOR_/GIT_COMMITTER_ name+email for argv-only commit-firing. */
function commitEnv(identity: AgentIdentity, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email,
  };
}

/**
 * Argv-only git invocation helper.
 *
 * - `cwd` defaults to `workspace.path`; pass `null` for a workspace-agnostic call (e.g., clone-with-explicit-target).
 * - On non-zero exit, throws an Error whose message includes git's actual stderr (not Node's
 *   default argv-joined display string). Engineer-side calibration:
 *   `feedback_node_execfile_error_formatter_visual_misleads_diagnosis.md`.
 * - Returns `{ stdout, stderr }` strings (utf8). Default `maxBuffer` is Node's 1 MiB; raise per-call
 *   when the caller knows the output may be large (e.g., log).
 */
export async function gitExec(
  workspace: WorkspaceHandle | null,
  args: string[],
  options: { maxBuffer?: number; env?: NodeJS.ProcessEnv; timeout?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  const cwd = workspace ? workspace.path : undefined;
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: options.maxBuffer ?? 1024 * 1024,
      env: options.env,
      timeout: options.timeout,
    });
    return { stdout: String(stdout), stderr: String(stderr) };
  } catch (err) {
    // execFile error: { code, killed, signal, cmd, stdout, stderr }; Node's default display joins argv
    // with spaces (looks like shell-tokenization but isn't). Surface git's actual stderr instead.
    const e = err as Error & { stderr?: string; stdout?: string; code?: number };
    const stderrText = (e.stderr ?? '').trim();
    const stdoutText = (e.stdout ?? '').trim();
    const detail = stderrText || stdoutText || e.message;
    const argvDisplay = ['git', ...args].join(' ');
    throw new Error(`git exited with error (${argvDisplay}): ${detail}`, { cause: err });
  }
}

export class NativeGitEngine implements GitEngine {
  static readonly providerName: string = 'native-git';

  // ─── Lifecycle ───

  async init(workspace: WorkspaceHandle, options: GitOptions): Promise<void> {
    optionsByWorkspace.set(workspace, { identity: options.identity });
    await gitExec(workspace, ['init', '--quiet']);
  }

  async clone(workspace: WorkspaceHandle, repoUrl: string, options: GitOptions): Promise<void> {
    optionsByWorkspace.set(workspace, { identity: options.identity });
    // `git clone <url> <path>` — git creates the destination dir if missing; fails if non-empty.
    // Run with no cwd (workspace.path may not exist yet); destination is the absolute path.
    await gitExec(null, ['clone', repoUrl, workspace.path]);
  }

  // ─── Refs (branches + tags) ───

  async branch(
    workspace: WorkspaceHandle,
    branchName: string,
    options: { from?: string } = {},
  ): Promise<void> {
    const args = options.from
      ? ['branch', branchName, options.from]
      : ['branch', branchName];
    await gitExec(workspace, args);
  }

  async checkout(workspace: WorkspaceHandle, branchName: string): Promise<void> {
    await gitExec(workspace, ['checkout', branchName]);
  }

  async getCurrentBranch(workspace: WorkspaceHandle): Promise<string> {
    const { stdout } = await gitExec(workspace, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const branch = stdout.trim();
    if (branch === 'HEAD') {
      throw new UnsupportedOperationError(
        `NativeGitEngine.getCurrentBranch: detached HEAD at ${workspace.path}`,
      );
    }
    return branch;
  }

  async tag(
    workspace: WorkspaceHandle,
    name: string,
    options: { ref?: string; message?: string; force?: boolean } = {},
  ): Promise<void> {
    const args: string[] = ['tag'];
    if (options.force) args.push('-f');
    if (options.message !== undefined) {
      // Annotated tag — git records identity + message; needs commit-env vars
      args.push('-a', '-m', options.message);
    }
    args.push(name);
    if (options.ref !== undefined) args.push(options.ref);
    const env = options.message !== undefined
      ? commitEnv(await resolveIdentity(workspace))
      : process.env;
    await gitExec(workspace, args, { env });
  }

  async revparse(workspace: WorkspaceHandle, ref: string): Promise<string> {
    const { stdout } = await gitExec(workspace, ['rev-parse', ref]);
    return stdout.trim();
  }

  // ─── Working tree + commit ───

  async stage(workspace: WorkspaceHandle, paths: string[] | 'all'): Promise<void> {
    if (paths === 'all') {
      await gitExec(workspace, ['add', '-A']);
      return;
    }
    if (paths.length === 0) return;
    // `--` separates flags from paths so leading-dash filenames don't get parsed as flags
    await gitExec(workspace, ['add', '--', ...paths]);
  }

  async commit(workspace: WorkspaceHandle, options: CommitOptions): Promise<string> {
    const identity = options.author ?? (await resolveIdentity(workspace));
    const env = commitEnv(identity);
    if (options.autoStage) {
      await gitExec(workspace, ['add', '-A']);
    }
    const args = ['commit', '-m', options.message];
    if (options.amend) args.push('--amend');
    // --allow-empty-message would let empty messages through; require non-empty message at API.
    await gitExec(workspace, args, { env });
    const { stdout } = await gitExec(workspace, ['rev-parse', 'HEAD']);
    return stdout.trim();
  }

  /**
   * Commit-to-ref bypass-HEAD bypass-INDEX (Design v4.8 §AA / load-bearing for §2.6.1 wip-branch).
   *
   * Native impl: allocate a temporary GIT_INDEX_FILE → seed from existing ref's tree if present →
   * `git add -A` against the temp index (operator's index untouched) → `git write-tree` →
   * `git commit-tree` (with author/committer env-vars + parent linkage) → `git update-ref`.
   * Operator's `git status` post-call shows no staged paths from the wip-commit operation.
   */
  async commitToRef(
    workspace: WorkspaceHandle,
    ref: string,
    options: CommitOptions,
  ): Promise<string> {
    const identity = options.author ?? (await resolveIdentity(workspace));
    // Temp index lives inside .git/ so it's auto-collected with the workspace; UUID-suffixed for
    // concurrency-safety across overlapping wip-commit invocations.
    const tempIndex = join(workspace.path, '.git', `wip-index-${randomUUID()}`);
    const indexEnv = { ...process.env, GIT_INDEX_FILE: tempIndex };
    const cEnv = commitEnv(identity, indexEnv);

    try {
      // Seed temp index from the target ref's existing tree if it exists; else fall back to HEAD
      // so the wip-branch is FF-anchored to base-branch (load-bearing for §2.6.2 squash-merge
      // downstream — orphan-root wip-commits cause `git merge --squash` to fail with
      // "refusing to merge unrelated histories"). mission-78 W2-extension Fix #3: dogfood
      // surfaced via thread-543 — defect symmetric in both NativeEng + IsoEng commitToRef.
      let parentSha: string | undefined;
      try {
        const { stdout } = await gitExec(workspace, ['rev-parse', ref]);
        parentSha = stdout.trim();
        await gitExec(workspace, ['read-tree', parentSha], { env: indexEnv });
      } catch {
        // Target ref doesn't exist yet — anchor to HEAD so resulting wip-branch chain is
        // FF-equivalent to base-branch (mission/<id>) at first wip-commit time.
        try {
          const { stdout: headSha } = await gitExec(workspace, ['rev-parse', 'HEAD']);
          parentSha = headSha.trim();
          await gitExec(workspace, ['read-tree', parentSha], { env: indexEnv });
        } catch {
          // Truly empty repo (no HEAD; e.g., post-init pre-first-commit) — fall through to
          // orphan-root case (parentSha stays undefined; commit-tree omits -p)
        }
      }

      // Stage entire working tree into the TEMP index (operator's index untouched).
      await gitExec(workspace, ['add', '-A'], { env: indexEnv });

      // Write tree from temp index
      const treeResult = await gitExec(workspace, ['write-tree'], { env: indexEnv });
      const treeSha = treeResult.stdout.trim();

      // commit-tree with optional parent linkage; identity supplied via env
      const commitArgs = ['commit-tree', treeSha];
      if (parentSha) commitArgs.push('-p', parentSha);
      commitArgs.push('-m', options.message);
      const commitResult = await gitExec(workspace, commitArgs, { env: cEnv });
      const commitSha = commitResult.stdout.trim();

      // Update the ref to point at the new commit (creates ref if missing)
      await gitExec(workspace, ['update-ref', ref, commitSha]);

      return commitSha;
    } finally {
      await unlink(tempIndex).catch(() => { /* idempotent — already-cleaned-up is fine */ });
    }
  }

  async deleteBranch(
    workspace: WorkspaceHandle,
    branchName: string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    void options;       // contract-uniform with IsomorphicGitEngine; force is implicit at the ref level
    // Use `git update-ref -d refs/heads/<name>` (low-level ref-removal) instead of `git branch -d/-D`
    // to MATCH IsomorphicGitEngine's `git.deleteBranch` semantic exactly: checkout-state-agnostic.
    // `git branch -D` refuses to delete the currently-checked-out branch; isomorphic-git's
    // deleteBranch unlinks the ref unconditionally. For substrate-transparency at the W2
    // canonical-switch (mission-78), the engines must agree. Caller (e.g., abandon-flow) handles
    // workspace teardown immediately after, so the orphan-HEAD that update-ref leaves behind is
    // not a footgun in the SDK lifecycle.
    const ref = branchName.startsWith('refs/') ? branchName : `refs/heads/${branchName}`;
    await gitExec(workspace, ['update-ref', '-d', ref]);
  }

  // ─── Wire ───

  async fetch(
    workspace: WorkspaceHandle,
    options: { remote?: string; branch?: string; prune?: boolean } = {},
  ): Promise<void> {
    const args: string[] = ['fetch'];
    if (options.prune) args.push('--prune');
    if (options.remote !== undefined) args.push(options.remote);
    if (options.branch !== undefined) args.push(options.branch);
    await gitExec(workspace, args);
  }

  async push(workspace: WorkspaceHandle, options: PushOptions = {}): Promise<void> {
    const args: string[] = ['push'];
    if (options.force) args.push('--force');
    if (options.tags) args.push('--tags');
    // git push positional grammar: `push [<remote>] [<refspec>]` — the FIRST positional is always
    // the remote (or URL). When caller specifies a branch but no remote/url, default remote to
    // 'origin' so the branch arg lands in the refspec slot (parallel to isomorphic-git internal default).
    const target = options.url ?? options.remote ?? (options.branch !== undefined ? 'origin' : undefined);
    if (target !== undefined) args.push(target);
    if (options.branch !== undefined) {
      // Refspec when source/dest differ; else just the branch name
      if (options.remoteRef !== undefined && options.remoteRef !== options.branch) {
        args.push(`${options.branch}:${options.remoteRef}`);
      } else {
        args.push(options.branch);
      }
    }
    await gitExec(workspace, args);
  }

  async pull(
    workspace: WorkspaceHandle,
    options: { branch?: string; remote?: string } = {},
  ): Promise<void> {
    // Default git pull behavior is fast-forward (--ff); merge-commit happens if config overrides.
    // Identity is needed in case pull triggers a merge-commit; inject env defensively.
    const identity = optionsByWorkspace.get(workspace)?.identity;
    const env = identity ? commitEnv(identity) : process.env;
    const args: string[] = ['pull'];
    if (options.remote !== undefined) args.push(options.remote);
    if (options.branch !== undefined) args.push(options.branch);
    await gitExec(workspace, args, { env });
  }

  async merge(
    workspace: WorkspaceHandle,
    sourceBranch: string,
    options: { strategy?: MergeStrategy } = {},
  ): Promise<void> {
    // Strategy mapping (parallel to IsomorphicGitEngine §BBBBBB micro-fold):
    //   'ff'    → require-fast-forward (fail otherwise) → --ff-only
    //   'no-ff' → always create merge-commit (default)  → --no-ff
    const strategy = options.strategy ?? 'no-ff';
    const strategyFlag = strategy === 'ff' ? '--ff-only' : '--no-ff';
    // Identity needed for the merge-commit case (env-injected; argv-only end-to-end)
    const identity = optionsByWorkspace.get(workspace)?.identity;
    const env = identity ? commitEnv(identity) : process.env;
    await gitExec(workspace, ['merge', strategyFlag, sourceBranch], { env });
  }

  /**
   * Squash-merge primitive (Design v4.8 §HIGH-R3.1 v3.3 fold; §2.4.1 v3.0 atomic PR-set publish-flow).
   *
   * Bypass-INDEX impl (mission-78 W2-extension Fix #4 per thread-543; replaces the prior
   * checkout + merge --squash + commit chain that failed when working tree had untracked files
   * matching headRef's tree). Pattern parallel-symmetric to commitToRef:
   *   1. rev-parse <headRef>^{tree} → headTree (the wip-branch content to squash)
   *   2. rev-parse <baseRef>          → parent (the mission-branch tip = target ancestor)
   *   3. commit-tree <headTree> -p <parent> -m <message>  → squashedSha (env-injected identity)
   *   4. update-ref refs/heads/<baseRef> <squashedSha>
   *
   * HEAD + working tree are NOT touched. The publish-flow's downstream push() uses the ref directly;
   * doesn't depend on HEAD position. Eliminates "untracked files would be overwritten by merge"
   * surface (architect-side scenario-02 dogfood Fix #4 verification).
   *
   * Note: in IsomorphicGitEngine this is `squashCommit?` (capability-gated optional, native shell-out).
   * NativeGitEngine implements unconditionally — git CLI is a hard dep per Path D2.
   */
  async squashCommit(
    workspace: WorkspaceHandle,
    baseRef: string,
    headRef: string,
    message: string,
  ): Promise<string> {
    const identity = await resolveIdentity(workspace);
    const env = commitEnv(identity);

    // (1) Get headRef's tree — the wip-branch content to squash
    const treeResult = await gitExec(workspace, ['rev-parse', `${headRef}^{tree}`]);
    const treeSha = treeResult.stdout.trim();

    // (2) Get baseRef's tip — parent for the squashed commit
    const parentResult = await gitExec(workspace, ['rev-parse', baseRef]);
    const parentSha = parentResult.stdout.trim();

    // (3) Create the squashed commit pointing at baseRef's history with headRef's tree
    const commitResult = await gitExec(
      workspace,
      ['commit-tree', treeSha, '-p', parentSha, '-m', message],
      { env },
    );
    const commitSha = commitResult.stdout.trim();

    // (4) Update baseRef to point at the new squashed commit
    const baseRefFull = baseRef.startsWith('refs/') ? baseRef : `refs/heads/${baseRef}`;
    await gitExec(workspace, ['update-ref', baseRefFull, commitSha]);

    return commitSha;
  }

  /**
   * Bundle-create (W6 slice (v) Director (Y); §2.6.2 v0.4 §AAA snapshot mechanism for disk-failure recovery).
   *
   * Native git CLI is the canonical impl (parallel to IsoEng's native shell-out per architect (p)
   * disposition); creates `git bundle` archive at `bundlePath` containing `ref` + ancestors.
   * Returns the bundle file path on success.
   */
  async createBundle(workspace: WorkspaceHandle, bundlePath: string, ref: string): Promise<string> {
    const { mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(bundlePath), { recursive: true });
    await gitExec(workspace, ['bundle', 'create', bundlePath, ref]);
    return bundlePath;
  }

  /**
   * Bundle-restore (W6 slice (v) Director (Y); §2.6.2 v0.4 §AAA snapshot mechanism).
   *
   * Calls `git bundle unbundle` to extract objects + refs into the workspace's git-dir, then
   * `git update-ref` to set the named ref (parallel to IsoEng's native shell-out impl).
   */
  async restoreBundle(workspace: WorkspaceHandle, bundlePath: string, ref: string): Promise<void> {
    // `git bundle unbundle` output: "<sha> <ref>\n..." (one or more lines)
    const { stdout } = await gitExec(workspace, ['bundle', 'unbundle', bundlePath]);
    let bundleSha: string | undefined;
    for (const line of stdout.trim().split('\n')) {
      const [sha, bundleRef] = line.trim().split(/\s+/);
      if (bundleRef === ref) {
        bundleSha = sha;
        break;
      }
    }
    if (!bundleSha) {
      // Fallback: single-ref bundle case — use first line's sha
      const first = stdout.trim().split('\n')[0];
      bundleSha = first?.trim().split(/\s+/)[0];
    }
    if (!bundleSha) {
      throw new UnsupportedOperationError(
        `NativeGitEngine.restoreBundle: bundle '${bundlePath}' contains no extractable refs`,
      );
    }
    await gitExec(workspace, ['update-ref', ref, bundleSha]);
  }

  // ─── Read ───

  async status(workspace: WorkspaceHandle): Promise<GitStatus> {
    // Branch + head via rev-parse (avoid `git status -b` parsing burden).
    const branchResult = await gitExec(workspace, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const branch = branchResult.stdout.trim();

    let head = '';
    try {
      const headResult = await gitExec(workspace, ['rev-parse', 'HEAD']);
      head = headResult.stdout.trim();
    } catch {
      // unborn branch (no commits yet) — leave head as empty string per IsomorphicGitEngine convention
    }

    // Porcelain v1 lines: `XY <path>` where X = staged, Y = unstaged. `??` = untracked.
    // Use `-z` for NUL-terminated output (handles paths with spaces/newlines deterministically).
    const porcelain = await gitExec(workspace, ['status', '--porcelain=v1', '-z']);
    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];

    if (porcelain.stdout.length > 0) {
      // Each entry is `XY <path>\0`; rename entries are `XY <to>\0<from>\0` — slice (i) handles
      // the simple case (no rename special-casing); rename-impl follows in slice (ii) when commit
      // exists to exercise renames end-to-end.
      const entries = porcelain.stdout.split('\0').filter((e) => e.length > 0);
      for (const entry of entries) {
        if (entry.length < 3) continue;
        const x = entry.charAt(0);
        const y = entry.charAt(1);
        const path = entry.slice(3);

        if (x === '?' && y === '?') {
          untracked.push(path);
          continue;
        }
        if (x !== ' ' && x !== '?') staged.push(path);
        if (y !== ' ' && y !== '?') modified.push(path);
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
    // Custom format with US (\x1f) field-separators + RS (\x1e) record-separator. NUL inside
    // commit messages is rare-but-possible per git docs; US/RS are even rarer.
    // Fields: %H = full SHA, %an = author name, %ae = author email, %aI = author date strict-ISO,
    // %P = parent SHAs (space-separated), %B = full commit body.
    const FORMAT = '--pretty=format:%H%x1f%an%x1f%ae%x1f%aI%x1f%P%x1f%B%x1e';
    const args: string[] = ['log', FORMAT];
    if (options.maxCount !== undefined) args.push(`-n${options.maxCount}`);
    if (options.since !== undefined) args.push(`--since=${options.since.toISOString()}`);
    if (options.ref !== undefined) args.push(options.ref);
    if (options.path !== undefined) {
      args.push('--', options.path);
    }

    const { stdout } = await gitExec(workspace, args, {
      maxBuffer: 64 * 1024 * 1024,
    });
    if (stdout.length === 0) return [];

    const records = stdout.split('\x1e').filter((r) => r.trim().length > 0);
    return records.map((record) => {
      // Strip the leading newline that git emits between records (post-%x1e separator)
      const trimmed = record.startsWith('\n') ? record.slice(1) : record;
      const fields = trimmed.split('\x1f');
      const [sha, name, email, dateIso, parentsRaw, ...messageParts] = fields;
      const message = messageParts.join('\x1f');
      return {
        sha,
        author: { name, email },
        message,
        timestamp: new Date(dateIso),
        parents: parentsRaw.length > 0 ? parentsRaw.split(' ') : [],
      };
    });
  }

  // ─── Remote management ───

  async addRemote(workspace: WorkspaceHandle, name: string, url: string): Promise<void> {
    await gitExec(workspace, ['remote', 'add', name, url]);
  }

  async removeRemote(workspace: WorkspaceHandle, name: string): Promise<void> {
    await gitExec(workspace, ['remote', 'remove', name]);
  }

  async listRemotes(workspace: WorkspaceHandle): Promise<{ name: string; url: string }[]> {
    // `git remote -v` lines: `<name>\t<url> (fetch|push)\n` — fetch + push pair per remote.
    // Dedupe by remote name, returning the fetch-URL.
    const { stdout } = await gitExec(workspace, ['remote', '-v']);
    const seen = new Map<string, string>();
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const tabIdx = trimmed.indexOf('\t');
      if (tabIdx < 0) continue;
      const name = trimmed.slice(0, tabIdx);
      const rest = trimmed.slice(tabIdx + 1);
      const spaceIdx = rest.lastIndexOf(' ');
      const url = spaceIdx >= 0 ? rest.slice(0, spaceIdx) : rest;
      if (!seen.has(name)) seen.set(name, url);
    }
    return Array.from(seen, ([name, url]) => ({ name, url }));
  }

  // ─── Internal accessors (forward-compat for slice (ii) commit() identity-resolve) ───

  /** @internal — slice (ii) commit() will read this WeakMap to resolve identity at commit-firing-time. */
  static _identityForWorkspace(workspace: WorkspaceHandle): AgentIdentity | undefined {
    return optionsByWorkspace.get(workspace)?.identity;
  }
}
