// LockfileState — daemon-watcher IPC fields (Design v4.9 §2.6.5; W4.4 slice (i)).
//
// Per spec: the mission-lockfile carries both base lock-acquisition fields (id/missionId/
// acquiredAt/expiresAt; W2 baseline) AND daemon-watcher IPC fields written by the daemon-process
// + read by CLI invocations for cross-process coordination.
//
// 6 W4.4 IPC fields (per Design §2.6.5):
//   pid: number                     — daemon PID (pid-reuse mitigation via startTime cross-check)
//   startTime: number               — daemon-spawn epoch-ms (pid-reuse mitigation per round-2 ask 3 fold)
//   expiresAt: number               — TTL extension by daemon-heartbeat (epoch-ms)
//   pendingFlushBeforeComplete: boolean — CLI sets; daemon detects via mtime-watch + flushes wip-buffer
//   pendingTick: boolean            — CLI signals on-demand tick
//   abandonInProgress: boolean      — Steps 2-4 window per v3.6 MEDIUM-R6.1
//
// Wire-format: JSON-on-disk at <workspace>/locks/missions/<missionId>.lock.

import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';

/**
 * LockfileState — full on-disk shape for mission-lockfile.
 *
 * Combines W2-baseline lock-acquisition fields with W4.4 daemon-IPC fields per Design §2.6.5.
 * All daemon-IPC fields are optional (absent when daemon hasn't yet spawned OR after lockfile
 * stale-takeover; CLI consumers MUST handle absence gracefully).
 */
export interface LockfileState {
  // ─── W2-baseline lock-acquisition fields ───
  readonly id: string;
  readonly missionId: string;
  readonly acquiredAt: string;            // ISO-8601
  readonly expiresAt: string;             // ISO-8601 (lock TTL; distinct from daemon's epoch-ms expiresAt)

  // ─── W4.4 daemon-watcher IPC fields (all optional) ───
  readonly pid?: number;
  readonly startTime?: number;            // epoch-ms (pid-reuse mitigation)
  readonly daemonExpiresAt?: number;      // epoch-ms TTL extended by daemon-heartbeat
  readonly pendingFlushBeforeComplete?: boolean;
  readonly pendingTick?: boolean;
  readonly abandonInProgress?: boolean;
}

/** Read + parse lockfile from disk; returns undefined if absent. */
export async function readLockfileState(lockfilePath: string): Promise<LockfileState | undefined> {
  if (!existsSync(lockfilePath)) return undefined;
  const content = await readFile(lockfilePath, 'utf8');
  try {
    return JSON.parse(content) as LockfileState;
  } catch {
    return undefined;
  }
}

/** Atomic-write lockfile (write-tmp + rename per MEDIUM-11). */
export async function writeLockfileStateAtomic(lockfilePath: string, state: LockfileState): Promise<void> {
  const tmp = `${lockfilePath}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await rename(tmp, lockfilePath);
}

/** Read-modify-write helper for daemon-IPC field updates (e.g., daemon writing pid+startTime). */
export async function updateLockfileState(
  lockfilePath: string,
  updates: Partial<LockfileState>,
): Promise<LockfileState | undefined> {
  const current = await readLockfileState(lockfilePath);
  if (!current) return undefined;
  const next = { ...current, ...updates };
  await writeLockfileStateAtomic(lockfilePath, next);
  return next;
}
