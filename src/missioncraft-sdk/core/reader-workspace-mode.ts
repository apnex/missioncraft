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
