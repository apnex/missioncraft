// Daemon-IPC helpers (Design v4.9 §2.6.5; W4.4 slice ii — graft helpers).
//
// Three primitives used by graft-points in start()/complete()/abandon():
//   - triggerDaemonFlush: CLI sets lockfile flag; polls daemon-ack via flag-clear; falls back to SIGTERM on timeout
//   - terminateDaemon: SIGTERM + 60s poll + SIGKILL fallback; pid-reuse mitigation via startTime cross-check
//   - clearDaemonIpcFields: parent-CLI lockfile-cleanup post-SIGTERM (per parent-only-ownership contract)

import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  readLockfileState,
  updateLockfileState,
  type LockfileState,
} from '../state-machine/lockfile-state.js';

const execFileAsync = promisify(execFile);

const DEFAULT_FLUSH_TIMEOUT_MS = 30_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = parseInt(process.env.MSN_DAEMON_SHUTDOWN_TIMEOUT_MS ?? '60000', 10);
const POLL_INTERVAL_MS = 100;

/** Verify process is alive via process.kill(pid, 0). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pid-reuse mitigation per Design v4.9 MEDIUM-R3.1.
 *
 * Cross-check that a pid corresponds to the process spawned at the recorded startTime.
 * Uses POSIX-portable `ps -p <pid> -o etimes=` (elapsed seconds since process start).
 * If the process started AFTER our recorded startTime, it's a different process (pid-reuse).
 *
 * Returns true if pid+startTime match the recorded daemon (safe to signal).
 */
async function verifyPidStartTime(pid: number, expectedStartTimeMs: number): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'etimes=']);
    const elapsedSec = parseInt(stdout.trim(), 10);
    if (Number.isNaN(elapsedSec)) return false;
    const actualStartMs = Date.now() - elapsedSec * 1000;
    // Allow 5s tolerance for clock-skew + ps-rounding
    return Math.abs(actualStartMs - expectedStartTimeMs) < 5000;
  } catch {
    return false;        // ps failed → process likely dead OR pid-reuse hazard
  }
}

/**
 * Trigger daemon-flush via lockfile-state-watch IPC.
 *
 * Per Design v4.9 §2.6.5 MEDIUM-R2.1: CLI sets `pendingFlushBeforeComplete` (or `pendingTick`)
 * to true; daemon detects via lockfile-mtime-watch + flushes pending debounce-buffer + commits to
 * wip-branch + clears the flag. CLI polls for flag-clear with 30s timeout; falls back to SIGTERM.
 *
 * STUB-SEMANTIC: when lockfile is absent OR daemon-pid is absent (W4.3 stub-then-graft baseline),
 * returns 'no-daemon' immediately (no-op). Real flush happens only when daemon present.
 */
export async function triggerDaemonFlush(
  lockfilePath: string,
  field: 'pendingFlushBeforeComplete' | 'pendingTick',
  timeoutMs: number = DEFAULT_FLUSH_TIMEOUT_MS,
): Promise<'flushed' | 'no-daemon' | 'timeout'> {
  if (!existsSync(lockfilePath)) return 'no-daemon';
  const initial = await readLockfileState(lockfilePath);
  if (!initial?.pid || !initial.startTime) return 'no-daemon';

  // Verify daemon is alive + pid-reuse-safe
  if (!isAlive(initial.pid)) return 'no-daemon';
  if (!(await verifyPidStartTime(initial.pid, initial.startTime))) return 'no-daemon';

  // Set the flush flag
  await updateLockfileState(lockfilePath, { [field]: true } as Partial<LockfileState>);

  // Poll for flag-clear (daemon detected mtime change → flushed → cleared flag)
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const current = await readLockfileState(lockfilePath);
    if (!current || current[field] !== true) return 'flushed';
    if (!isAlive(initial.pid)) return 'no-daemon';        // daemon died mid-flush
  }
  return 'timeout';
}

/**
 * Terminate daemon-watcher via SIGTERM + SIGKILL fallback (Design v4.9 §2.6.5 MEDIUM-R2.2).
 *
 * 60s timeout (configurable via MSN_DAEMON_SHUTDOWN_TIMEOUT_MS env-var); polls process.kill(pid, 0)
 * for daemon-death; SIGKILL on timeout. Pid-reuse mitigation via startTime cross-check before signaling.
 *
 * STUB-SEMANTIC: when lockfile or daemon-pid absent, returns 'no-daemon' immediately.
 */
export async function terminateDaemon(
  lockfilePath: string,
  timeoutMs: number = DEFAULT_SHUTDOWN_TIMEOUT_MS,
): Promise<'terminated' | 'killed' | 'no-daemon'> {
  if (!existsSync(lockfilePath)) return 'no-daemon';
  const state = await readLockfileState(lockfilePath);
  if (!state?.pid || !state.startTime) return 'no-daemon';

  if (!isAlive(state.pid)) return 'no-daemon';
  if (!(await verifyPidStartTime(state.pid, state.startTime))) return 'no-daemon';

  try { process.kill(state.pid, 'SIGTERM'); } catch { return 'no-daemon'; }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    if (!isAlive(state.pid)) return 'terminated';
  }

  // Force-kill on timeout
  try { process.kill(state.pid, 'SIGKILL'); } catch { /* already dead */ }
  return 'killed';
}

/**
 * Immediate dead-pid detection 7-step ordered checks (Design v4.9 §2.6.5 MEDIUM-R6.1 + HIGH-6 fold).
 *
 * Per Design: every operator-CLI invocation against `started`/`in-progress` mission performs
 * 7-step ordered checks; auto-cleans daemon-IPC fields if stale.
 *
 * 7-step checks:
 *   1. Read lockfile.pid (if absent → no daemon expected; return 'no-daemon')
 *   2. process.kill(pid, 0) → if dead → STALE
 *   3. ps -p <pid> -o etimes= → cross-check startTime; mismatch → STALE (pid-reuse hazard)
 *   4. daemonExpiresAt expired → STALE (daemon stopped heartbeating)
 *   5. If abandon-in-flight (Steps 5-8) → daemon-respawn SKIPPED per v3.6 MEDIUM-R6.1
 *   6. If STALE: clearDaemonIpcFields (best-effort cleanup)
 *   7. Return diagnostic
 *
 * Returns:
 *   - 'no-daemon': lockfile absent OR pid absent
 *   - 'alive': all checks pass; daemon healthy
 *   - 'stale-cleaned': dead/pid-reuse/expired detected; lockfile-IPC cleared
 *   - 'abandon-skip': mission in abandon-flow Steps 5-8; daemon-respawn deliberately skipped
 */
export async function detectDeadPid(
  lockfilePath: string,
  abandonProgress?: string,
): Promise<'no-daemon' | 'alive' | 'stale-cleaned' | 'abandon-skip'> {
  // Step 1: read lockfile.pid
  if (!existsSync(lockfilePath)) return 'no-daemon';
  const state = await readLockfileState(lockfilePath);
  if (!state?.pid || !state.startTime) return 'no-daemon';

  // Step 5 early-exit: abandon-flow in-flight (Steps 5-8); daemon-respawn skipped per v3.6 MEDIUM-R6.1
  // Caller passes mission-config.abandonProgress; non-undefined means abandon-flow is post-Step-4 +
  // pre-terminal (Steps 5-7) — daemon should NOT be respawned because cleanup is in progress.
  if (abandonProgress !== undefined && abandonProgress !== 'workspace-handled' && abandonProgress !== 'config-purged') {
    return 'abandon-skip';
  }

  // Step 2: process.kill(pid, 0)
  if (!isAlive(state.pid)) {
    await clearDaemonIpcFields(lockfilePath);
    return 'stale-cleaned';
  }

  // Step 3: pid-reuse mitigation via ps etimes
  if (!(await verifyPidStartTime(state.pid, state.startTime))) {
    await clearDaemonIpcFields(lockfilePath);
    return 'stale-cleaned';
  }

  // Step 4: daemonExpiresAt expired (heartbeat stopped)
  if (state.daemonExpiresAt && state.daemonExpiresAt < Date.now()) {
    await clearDaemonIpcFields(lockfilePath);
    return 'stale-cleaned';
  }

  return 'alive';
}

/** Clear daemon-IPC fields from lockfile (parent-CLI cleanup post-terminateDaemon). */
export async function clearDaemonIpcFields(lockfilePath: string): Promise<void> {
  if (!existsSync(lockfilePath)) return;
  await updateLockfileState(lockfilePath, {
    pid: undefined,
    startTime: undefined,
    daemonExpiresAt: undefined,
    pendingFlushBeforeComplete: undefined,
    pendingTick: undefined,
  });
}
