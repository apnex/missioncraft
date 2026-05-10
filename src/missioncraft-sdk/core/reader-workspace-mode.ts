// Shared helper for reader-workspace 0444/0555 chmod-down (Design v4.8 §2.10.4 strict-enforce per scope-item #2 + bug-62 v4.9 fix).
//
// Per F-W4.4 architect-recommendation: single helper reused at:
//   (a) §2.4.1.v4 7-step reader-side Step 4 post-clone (W5; reader-side flow)
//   (b) §2.6.5.v4 Loop B post-checkout (W5; reader-daemon sync)
//
// Pattern per bug-62 v4.9 fix: file 0444 (read-only) / dir 0555 (read+execute; no-write); .git/ tree pruned via -prune.
// Cross-platform POSIX-portable (find + chmod).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { StorageAllocationError } from '../errors.js';

const execFileAsync = promisify(execFile);

// Set reader-workspace files to 0444 (read-only) + directories to 0555 (read+execute; no-write).
// Excludes .git/ tree from chmod (engine-internal sync needs write access for fetches/checkouts).
//
// Pattern per bug-62 v4.9 fix (find with -path "STAR/.git" -prune to skip .git tree):
//   find <workspacePath> -path 'STAR/.git' -prune -o -type f -exec chmod 0444 {} ;
//   find <workspacePath> -path 'STAR/.git' -prune -o -type d -exec chmod 0555 {} ;
//
// Cross-platform POSIX-portable. Throws StorageAllocationError on shell-out failure.
export async function setReaderWorkspaceMode(workspacePath: string): Promise<void> {
  try {
    // Files: 0444 (read-only)
    await execFileAsync('find', [workspacePath, '-path', '*/.git', '-prune', '-o', '-type', 'f', '-exec', 'chmod', '0444', '{}', ';']);
    // Directories: 0555 (read + execute; no-write) — preserves traversal per bug-62 v4.9 fix
    await execFileAsync('find', [workspacePath, '-path', '*/.git', '-prune', '-o', '-type', 'd', '-exec', 'chmod', '0555', '{}', ';']);
  } catch (err: unknown) {
    throw new StorageAllocationError(
      `setReaderWorkspaceMode(${workspacePath}) failed: ${err instanceof Error ? err.message : 'unknown'}`,
      { cause: err instanceof Error ? err : undefined },
    );
  }
}

// Restore reader-workspace files + directories to writable mode (chmod-up per bug-62 v4.9 fix step 1).
// Used by Loop B engine-internal git-checkout to allow git operations on working-tree before chmod-down.
//
// Pattern per bug-62 v4.9 fix (find with -path "STAR/.git" -prune to skip .git tree):
//   find <workspacePath> -path 'STAR/.git' -prune -o -type f -exec chmod u+w {} ;
//   find <workspacePath> -path 'STAR/.git' -prune -o -type d -exec chmod u+wx {} ;
export async function setReaderWorkspaceWritable(workspacePath: string): Promise<void> {
  try {
    await execFileAsync('find', [workspacePath, '-path', '*/.git', '-prune', '-o', '-type', 'f', '-exec', 'chmod', 'u+w', '{}', ';']);
    await execFileAsync('find', [workspacePath, '-path', '*/.git', '-prune', '-o', '-type', 'd', '-exec', 'chmod', 'u+wx', '{}', ';']);
  } catch (err: unknown) {
    throw new StorageAllocationError(
      `setReaderWorkspaceWritable(${workspacePath}) failed: ${err instanceof Error ? err.message : 'unknown'}`,
      { cause: err instanceof Error ? err : undefined },
    );
  }
}

// applyReaderRefUpdate — 5-step sentinel-guarded checkout sequence (Design v4.9 §2.10 W5c Q4).
//
// Applies an updated coord-remote ref into the reader's chmod-down workspace via git-native checkout.
// `.daemon-tx-active` sentinel guards Loop A (chokidar fs-watch) self-event re-trigger per v4.6
// MEDIUM-R7.2 (the chmod + checkout activity itself would otherwise fire chokidar 'change' events
// against the same workspace and re-enter the wip-commit pipeline).
//
// Per Design v4.9 §2.10: writer-daemon's wip-commit-on-debounce uses parallel sentinel-guard pattern;
// reader-daemon's apply-ref-update is the symmetric reader-mode counterpart.
//
// Steps:
//   1. Touch `.daemon-tx-active` sentinel at parent (mission-level, OUTSIDE chmod-down scope so
//      cleanup at Step 5 isn't blocked by 0555 dir-mode)
//   2. setReaderWorkspaceWritable (chmod-up u+wx) on workspacePath
//   3. `git --git-dir=<coordMirrorGitDir> --work-tree=<workspacePath> checkout -f <ref>`
//   4. setReaderWorkspaceMode (chmod-down 0444/0555) on workspacePath
//   5. Remove `.daemon-tx-active` sentinel at parent
//
// Best-effort: any step failure is wrapped in StorageAllocationError; sentinel cleanup attempted
// in finally-block to avoid stuck state if an intermediate step throws.
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function applyReaderRefUpdate(
  workspacePath: string,
  coordMirrorGitDir: string,
  ref: string,
): Promise<void> {
  // Sentinel placed at parent dir (mission-level), OUTSIDE the chmod-down scope. Cleanup at Step 5
  // doesn't EACCES on 0555 workspace dir.
  const sentinelDir = dirname(workspacePath);
  const sentinel = join(sentinelDir, '.daemon-tx-active');
  try {
    // Step 1: touch sentinel
    await mkdir(sentinelDir, { recursive: true });
    await writeFile(sentinel, new Date().toISOString(), 'utf8');

    // Step 2: chmod-up
    await setReaderWorkspaceWritable(workspacePath);

    // Step 3: git checkout from cached git-dir into work-tree
    await execFileAsync('git', [
      `--git-dir=${coordMirrorGitDir}`,
      `--work-tree=${workspacePath}`,
      'checkout',
      '-f',
      ref,
    ]);

    // Step 4: chmod-down
    await setReaderWorkspaceMode(workspacePath);
  } catch (err: unknown) {
    throw new StorageAllocationError(
      `applyReaderRefUpdate(${workspacePath}, ${ref}) failed: ${err instanceof Error ? err.message : 'unknown'}`,
      { cause: err instanceof Error ? err : undefined },
    );
  } finally {
    // Step 5: remove sentinel (idempotent on already-removed)
    try { await unlink(sentinel); } catch { /* idempotent */ }
  }
}
