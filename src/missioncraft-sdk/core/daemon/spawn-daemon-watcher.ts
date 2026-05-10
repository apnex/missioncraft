// spawnDaemonWatcher — child_process.spawn wrapper for per-mission daemon-watcher process.
// Design v4.9 §2.6.5; W4.4 slice (i).
//
// Spawn discipline:
//   - detached: true + child.unref() so daemon survives parent-CLI exit
//   - stdio: 'ignore' so daemon doesn't hold parent's stdout/stderr handles
//   - Daemon writes pid + startTime to lockfile via updateLockfileState (the watcher entry-point
//     handles this; spawn primitive returns child handle + writes initial pid/startTime fields
//     synchronously to ensure CLI can detect daemon-spawn-success vs spawn-failure)
//   - Spawn-failure rollback: caller (e.g., start() Step 6 graft) handles release-locks +
//     YAML-rollback to 'configured' (slice ii territory)

import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

import { writeLockfileStateAtomic, type LockfileState } from '../state-machine/lockfile-state.js';

/**
 * Resolve the watcher entry-point path. SDK ships a compiled `dist/missioncraft-sdk/core/daemon/watcher-entry.js`
 * that the daemon spawn invokes via `node <path> <missionId>`.
 *
 * Resolution order:
 *   1. If invoked from compiled dist/, sibling `watcher-entry.js` is the entry
 *   2. If invoked from src/ (dev/test), find dist/ counterpart by path-substitution
 *   3. Throw with build-required hint
 */
function resolveWatcherEntryPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Try sibling .js first (production: dist/.../core/daemon/watcher-entry.js)
  const siblingJs = join(here, 'watcher-entry.js');
  if (existsSync(siblingJs)) return siblingJs;
  // Dev/test: replace `/src/` with `/dist/` in path
  if (here.includes('/src/')) {
    const distEquiv = here.replace('/src/', '/dist/');
    const distJs = join(distEquiv, 'watcher-entry.js');
    if (existsSync(distJs)) return distJs;
  }
  throw new Error(
    `watcher entry-point not found (looked at: ${siblingJs}); ` +
      `run \`npm run build\` to compile dist/ before spawning daemon`,
  );
}

export interface SpawnDaemonOptions {
  readonly missionId: string;
  readonly workspaceRoot: string;
  readonly lockfilePath: string;
}

export interface SpawnDaemonResult {
  readonly pid: number;
  readonly startTime: number;
  readonly child: ChildProcess;
}

/**
 * Spawn detached daemon-watcher process for the given mission.
 *
 * Atomically updates lockfile with pid + startTime + daemonExpiresAt fields BEFORE returning,
 * so subsequent CLI invocations see daemon-spawn-success. Caller-side spawn-failure rollback
 * (release locks; YAML-rollback) handled at graft-site (slice ii).
 *
 * Returns ChildProcess handle for caller cleanup hooks (e.g., test SIGKILL on hang).
 */
export async function spawnDaemonWatcher(opts: SpawnDaemonOptions): Promise<SpawnDaemonResult> {
  const entry = resolveWatcherEntryPath();
  const child = spawn('node', [entry, opts.missionId, opts.workspaceRoot], {
    detached: true,
    stdio: 'ignore',
  });

  if (!child.pid) {
    throw new Error(`spawnDaemonWatcher(${opts.missionId}): child.pid is undefined; spawn failed`);
  }

  const pid = child.pid;
  const startTime = Date.now();
  // Default daemon-TTL = 24h (extended by daemon-heartbeat); align with lock TTL discipline
  const daemonExpiresAt = startTime + 86_400_000;

  // Atomic write of daemon-IPC fields to lockfile (preserves W2-baseline lock fields)
  const { readLockfileState } = await import('../state-machine/lockfile-state.js');
  const current = await readLockfileState(opts.lockfilePath);
  if (!current) {
    // Lockfile must exist (acquired via storage.acquireMissionLock prior to spawn)
    child.kill('SIGKILL');
    throw new Error(`spawnDaemonWatcher(${opts.missionId}): lockfile absent at ${opts.lockfilePath}; acquire mission-lock first`);
  }
  const next: LockfileState = {
    ...current,
    pid,
    startTime,
    daemonExpiresAt,
  };
  await writeLockfileStateAtomic(opts.lockfilePath, next);

  // Detach child from event loop (allows parent CLI to exit while daemon continues)
  child.unref();

  return { pid, startTime, child };
}
