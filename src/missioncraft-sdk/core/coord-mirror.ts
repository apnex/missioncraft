// coord-mirror.ts — per-mission reader-side coord-remote git mirror (Design v4.9 §2.10 W5c MEDIUM-R8.1).
//
// Maintains a dedicated git repo at `<workspaceRoot>/missions/<missionId>/.coord-mirror/` whose
// purpose is to be the reader-side cached git-dir for `git fetch --tags <coord-remote>`. Reader-daemon
// Loop B fetches into this mirror on cadence; ref-revparse pre/post fetch identifies changed refs;
// detected updates fan out to:
//   - `refs/tags/missioncraft/<id>/terminated` → cascade reader's lifecycle 'reading'→'readonly-completed'
//   - `refs/heads/config/<id>` HEAD-move → re-apply mission-config from mirror branch
//   - `refs/heads/<repoName>/wip/<id>` HEAD-move → applyReaderRefUpdate(workspace, ref) checkout sequence
//
// Symmetric to W5b writer-side `.config-mirror/` per `core/config-mirror.ts`; both keep coord-remote
// ref-touching surfaces single-fetch-per-mission discipline.
//
// Native git invocation via Node child_process: isomorphic-git's `git.fetch` doesn't support
// `--tags` (limited to single-ref fetches per their API); reader-daemon needs all-refs-and-tags
// fetch on each cadence-tick. Native shell-out per §2.6.2 v0.4 §AAA bundle-ops precedent.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function coordMirrorPath(workspaceRoot: string, missionId: string): string {
  return join(workspaceRoot, 'missions', missionId, '.coord-mirror');
}

/** Idempotent init of the coord-mirror as a bare-tracked git repo with `coord-remote` named-remote. */
export async function ensureCoordMirrorInit(
  workspaceRoot: string,
  missionId: string,
  coordRemoteUrl: string,
): Promise<string> {
  const path = coordMirrorPath(workspaceRoot, missionId);
  await mkdir(path, { recursive: true });
  if (!existsSync(join(path, '.git'))) {
    await execFileAsync('git', ['init', '--quiet'], { cwd: path });
    await execFileAsync('git', ['remote', 'add', 'coord-remote', coordRemoteUrl], { cwd: path });
  } else {
    // Idempotent re-init: ensure coord-remote URL matches (allows operator-reconfig)
    try {
      const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'coord-remote'], { cwd: path });
      const currentUrl = stdout.trim();
      if (currentUrl !== coordRemoteUrl) {
        await execFileAsync('git', ['remote', 'set-url', 'coord-remote', coordRemoteUrl], { cwd: path });
      }
    } catch {
      // remote not yet configured; add it
      await execFileAsync('git', ['remote', 'add', 'coord-remote', coordRemoteUrl], { cwd: path });
    }
  }
  return path;
}

/**
 * Run `git fetch --tags coord-remote` from the mirror. Returns silently on success; throws on failure.
 * Best-effort: callers (Loop B) should catch + skip cycle, retry on next tick.
 */
export async function fetchCoordRemote(workspaceRoot: string, missionId: string): Promise<void> {
  const path = coordMirrorPath(workspaceRoot, missionId);
  await execFileAsync('git', ['fetch', '--tags', '--prune', 'coord-remote'], { cwd: path });
}

/**
 * Read a ref's SHA via `git rev-parse <ref>` from the mirror; returns null if ref missing.
 * Used pre/post fetch to detect changed refs.
 */
export async function revparseMirrorRef(
  workspaceRoot: string,
  missionId: string,
  ref: string,
): Promise<string | null> {
  const path = coordMirrorPath(workspaceRoot, missionId);
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', ref], { cwd: path });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Read content at `<ref>:<filepath>` via `git show <ref>:<filepath>` from the mirror.
 * Used for config-update cascade: reads mission.yaml from refs/heads/config/<id>.
 */
export async function showMirrorRefFile(
  workspaceRoot: string,
  missionId: string,
  ref: string,
  filepath: string,
): Promise<string | null> {
  const path = coordMirrorPath(workspaceRoot, missionId);
  try {
    const { stdout } = await execFileAsync('git', ['show', `${ref}:${filepath}`], { cwd: path });
    return stdout;
  } catch {
    return null;
  }
}

/** Compute reader-side ref names for the 3 detection paths. */
export function terminatedTagRef(missionId: string): string {
  return `refs/tags/missioncraft/${missionId}/terminated`;
}

export function configBranchMirrorRef(missionId: string): string {
  return `refs/remotes/coord-remote/config/${missionId}`;
}

export function repoWipMirrorRef(missionId: string, repoName: string): string {
  return `refs/remotes/coord-remote/${repoName}/wip/${missionId}`;
}
