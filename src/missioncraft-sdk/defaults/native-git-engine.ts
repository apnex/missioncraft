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
// Slice (i) — this commit — implements the `gitExec` helper + 6 foundational ops:
//   clone / branch / checkout / log / status / revparse
// Slice (ii) — write-ops: commit / push / fetch / tag / reset / diff / ls-remote
// Slice (iii) — advanced ops: merge --squash / capability-gated bundle ops
// Slice (iv) — PROVIDER_REGISTRY entry `'native-git'` + integration test suite (wave-close).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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

  async init(_workspace: WorkspaceHandle, _options: GitOptions): Promise<void> {
    throw new UnsupportedOperationError(
      'NativeGitEngine.init: implemented in W1 slice (ii) (write-ops); slice (i) covers clone/branch/checkout/log/status/revparse only',
    );
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

  async getCurrentBranch(_workspace: WorkspaceHandle): Promise<string> {
    throw new UnsupportedOperationError(
      'NativeGitEngine.getCurrentBranch: implemented in W1 slice (ii)',
    );
  }

  async tag(
    _workspace: WorkspaceHandle,
    _name: string,
    _options: { ref?: string; message?: string; force?: boolean } = {},
  ): Promise<void> {
    throw new UnsupportedOperationError('NativeGitEngine.tag: implemented in W1 slice (ii)');
  }

  async revparse(workspace: WorkspaceHandle, ref: string): Promise<string> {
    const { stdout } = await gitExec(workspace, ['rev-parse', ref]);
    return stdout.trim();
  }

  // ─── Working tree + commit ───

  async stage(_workspace: WorkspaceHandle, _paths: string[] | 'all'): Promise<void> {
    throw new UnsupportedOperationError('NativeGitEngine.stage: implemented in W1 slice (ii)');
  }

  async commit(_workspace: WorkspaceHandle, _options: CommitOptions): Promise<string> {
    throw new UnsupportedOperationError('NativeGitEngine.commit: implemented in W1 slice (ii)');
  }

  async commitToRef(
    _workspace: WorkspaceHandle,
    _ref: string,
    _options: CommitOptions,
  ): Promise<string> {
    throw new UnsupportedOperationError(
      'NativeGitEngine.commitToRef: implemented in W1 slice (ii)',
    );
  }

  async deleteBranch(
    _workspace: WorkspaceHandle,
    _branchName: string,
    _options: { force?: boolean } = {},
  ): Promise<void> {
    throw new UnsupportedOperationError(
      'NativeGitEngine.deleteBranch: implemented in W1 slice (ii)',
    );
  }

  // ─── Wire ───

  async fetch(
    _workspace: WorkspaceHandle,
    _options: { remote?: string; branch?: string; prune?: boolean } = {},
  ): Promise<void> {
    throw new UnsupportedOperationError('NativeGitEngine.fetch: implemented in W1 slice (ii)');
  }

  async push(_workspace: WorkspaceHandle, _options: PushOptions = {}): Promise<void> {
    throw new UnsupportedOperationError('NativeGitEngine.push: implemented in W1 slice (ii)');
  }

  async pull(
    _workspace: WorkspaceHandle,
    _options: { branch?: string; remote?: string } = {},
  ): Promise<void> {
    throw new UnsupportedOperationError('NativeGitEngine.pull: implemented in W1 slice (ii)');
  }

  async merge(
    _workspace: WorkspaceHandle,
    _sourceBranch: string,
    _options: { strategy?: MergeStrategy } = {},
  ): Promise<void> {
    throw new UnsupportedOperationError('NativeGitEngine.merge: implemented in W1 slice (iii)');
  }

  // squashCommit?, createBundle?, restoreBundle? are optional capability-gated methods (slice iii).

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

  async addRemote(_workspace: WorkspaceHandle, _name: string, _url: string): Promise<void> {
    throw new UnsupportedOperationError('NativeGitEngine.addRemote: implemented in W1 slice (ii)');
  }

  async removeRemote(_workspace: WorkspaceHandle, _name: string): Promise<void> {
    throw new UnsupportedOperationError(
      'NativeGitEngine.removeRemote: implemented in W1 slice (ii)',
    );
  }

  async listRemotes(_workspace: WorkspaceHandle): Promise<{ name: string; url: string }[]> {
    throw new UnsupportedOperationError(
      'NativeGitEngine.listRemotes: implemented in W1 slice (ii)',
    );
  }

  // ─── Internal accessors (forward-compat for slice (ii) commit() identity-resolve) ───

  /** @internal — slice (ii) commit() will read this WeakMap to resolve identity at commit-firing-time. */
  static _identityForWorkspace(workspace: WorkspaceHandle): AgentIdentity | undefined {
    return optionsByWorkspace.get(workspace)?.identity;
  }
}
