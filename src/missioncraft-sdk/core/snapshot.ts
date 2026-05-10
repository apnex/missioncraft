// snapshot.ts — bundle-ops snapshot mechanism (Design v4.9 §2.6.2 v0.4 §AAA + W6 slice (v) Director (Y)).
//
// Per architect's slice (v) scope (thread-526 round 5):
//
//   1. snapshotRoot directory layout: <snapshotRoot>/<missionId>/<repo-name>/<sha>.bundle
//      out-of-band from workspaceRoot to survive `rm -rf workspaceRoot` mid-mission scenarios
//   2. Bundle naming + retention: per-repo per-sha pattern; all-bundles-retained with
//      mtime-based latest-pick (consistent with W4.4 .daemon.log + W5b publishStatus
//      partial-failure forensic-trail discipline)
//   3. Recovery flow: latest-mtime per repo per mission → restoreBundle reconstructs git-dir
//
// Bundle-prune is post-v1.0.0 operator-config concern per architect; default = retain-all.

import { existsSync } from 'node:fs';
import { readdir, mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * Default snapshotRoot per architect dispatch: out-of-band from workspaceRoot. Operator-config
 * `defaults.snapshotRoot` overrides; default = `<workspaceRoot>/../.missioncraft-snapshots/`.
 */
export function defaultSnapshotRoot(workspaceRoot: string): string {
  // Sibling-of-workspaceRoot location preserves out-of-band-from-workspace property
  // (rm -rf workspaceRoot doesn't touch sibling .missioncraft-snapshots/).
  return resolve(dirname(workspaceRoot), '.missioncraft-snapshots');
}

/** Compute the snapshot directory for a mission's repo (per-repo namespacing). */
export function snapshotRepoDir(snapshotRoot: string, missionId: string, repoName: string): string {
  return join(snapshotRoot, missionId, repoName);
}

/** Compute the bundle filename for a specific commit-sha. */
export function snapshotBundlePath(
  snapshotRoot: string,
  missionId: string,
  repoName: string,
  sha: string,
): string {
  return join(snapshotRepoDir(snapshotRoot, missionId, repoName), `${sha}.bundle`);
}

/** Ensure snapshot directory tree exists for a mission's repo (idempotent). */
export async function ensureSnapshotRepoDir(
  snapshotRoot: string,
  missionId: string,
  repoName: string,
): Promise<string> {
  const dir = snapshotRepoDir(snapshotRoot, missionId, repoName);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Find the latest bundle (by mtime) for a mission's repo. Returns null if no bundles present.
 * Used by recovery flow to pick the most-recent snapshot for restore.
 */
export async function findLatestBundle(
  snapshotRoot: string,
  missionId: string,
  repoName: string,
): Promise<string | null> {
  const dir = snapshotRepoDir(snapshotRoot, missionId, repoName);
  if (!existsSync(dir)) return null;
  const entries = await readdir(dir);
  const bundles = entries.filter((n) => n.endsWith('.bundle'));
  if (bundles.length === 0) return null;
  // mtime-based latest-pick (consistent with .daemon.log forensic-trail pattern)
  let latestPath: string | null = null;
  let latestMtime = 0;
  for (const name of bundles) {
    const path = join(dir, name);
    try {
      const s = await stat(path);
      const mtime = s.mtimeMs;
      if (mtime > latestMtime) {
        latestMtime = mtime;
        latestPath = path;
      }
    } catch { /* skip stat-fail entries */ }
  }
  return latestPath;
}

/**
 * Resolve operator-configured snapshotRoot OR default sibling-of-workspaceRoot location.
 * `mission.stateDurability.snapshotRoot` overrides the default if set.
 */
export function resolveSnapshotRoot(workspaceRoot: string, configuredSnapshotRoot?: string): string {
  return configuredSnapshotRoot ?? defaultSnapshotRoot(workspaceRoot);
}

/** List bundles for a mission's repo (sorted by mtime descending). */
export async function listMissionBundles(
  snapshotRoot: string,
  missionId: string,
  repoName: string,
): Promise<{ path: string; mtimeMs: number }[]> {
  const dir = snapshotRepoDir(snapshotRoot, missionId, repoName);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const result: { path: string; mtimeMs: number }[] = [];
  for (const name of entries) {
    if (!name.endsWith('.bundle')) continue;
    const path = join(dir, name);
    try {
      const s = await stat(path);
      result.push({ path, mtimeMs: s.mtimeMs });
    } catch { /* skip */ }
  }
  result.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return result;
}

void homedir;
