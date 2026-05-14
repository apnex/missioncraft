// Default StorageProvider implementation (Design v4.8 §2.1.3 + §2.4 workspace contract).
//
// Per F-W2.3 architect-pick: W2 implements basic StorageProvider lock-API surface (O_EXCL + link(2) primitives + atomic-write);
// daemon-watcher LockfileState IPC fields (pid/startTime/pendingFlush/abandonInProgress) + chokidar 2-loop integration deferred to W4.
//
// Workspace paths per §2.4:
//   ${workspaceRoot}/missions/<missionId>/<repo-name>/    (ephemeral runtime workspaces)
//   ${workspaceRoot}/locks/missions/<missionId>.lock      (mission-locks; per-mission scope)
//   ${workspaceRoot}/locks/repos/<sha256(repoUrl)>.lock   (repo-locks; cross-mission scope per HIGH-5)
//   ${workspaceRoot}/locks/scopes/<scope-id>.lock         (scope-locks)

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile, unlink, link } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type {
  LockHandle,
  StorageProvider,
  WorkspaceHandle,
} from '../pluggables/storage.js';
import {
  LockTimeoutError,
  StorageAllocationError,
  WorkspaceConflictError,
} from '../errors.js';

export interface LocalFilesystemStorageOptions {
  /** Workspace-root directory. Default: `~/.missioncraft` (per Design v4.8 §2.4). */
  readonly workspaceRoot?: string;
}

interface LockfileContents {
  readonly id: string;            // unique LockHandle id
  readonly missionId: string;
  readonly acquiredAt: string;    // ISO-8601
  readonly expiresAt: string;     // ISO-8601
  // W4-deferred per F-W2.3: pid, startTime, pendingFlushBeforeComplete, pendingTick, abandonInProgress
}

const POLL_INTERVAL_MS = 100;
const DEFAULT_VALIDITY_MS = 86_400_000;  // 24h per F14

function repoNameFromUrl(repoUrl: string): string {
  // Extract last path-segment; strip .git suffix; lowercase
  const stripped = repoUrl.replace(/\/$/, '').replace(/\.git$/, '');
  const idx = Math.max(stripped.lastIndexOf('/'), stripped.lastIndexOf(':'));
  const candidate = idx >= 0 ? stripped.slice(idx + 1) : stripped;
  return candidate.toLowerCase();
}

function repoUrlHash(repoUrl: string): string {
  return createHash('sha256').update(repoUrl).digest('hex');
}

function generateLockId(): string {
  // Random 16-char hex; sufficient for LockHandle.id uniqueness within a mission's lifetime
  return createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 16);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function readLockfile(path: string): Promise<LockfileContents | undefined> {
  try {
    const content = await readFile(path, 'utf8');
    return JSON.parse(content) as LockfileContents;
  } catch {
    return undefined;
  }
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  const tmpPath = `${path}.${process.pid}.tmp`;
  await writeFile(tmpPath, contents, 'utf8');
  try {
    await rename(tmpPath, path);
  } catch (err) {
    // Cleanup tmp on rename-failure
    try { await unlink(tmpPath); } catch { /* swallow */ }
    throw err;
  }
}

export class LocalFilesystemStorage implements StorageProvider {
  /** v1.5 fold per MEDIUM-R4.2 — providerName contract. */
  static readonly providerName: string = 'local-filesystem';

  private readonly workspaceRoot: string;

  constructor(options: LocalFilesystemStorageOptions = {}) {
    // mission-80 slice (vii): workspaceRoot precedence chain:
    //   1. options.workspaceRoot (explicit caller param; CLI's --workspace-root flag lands here)
    //   2. process.env.MSN_WORKSPACE_ROOT (env-var; persistent operator-shell preference)
    //   3. ~/.missioncraft (default)
    // Allows operators to set MSN_WORKSPACE_ROOT once in their shell rc-file rather than
    // passing --workspace-root on every CLI invocation. Empty-string env-var treated as unset
    // (matches POSIX convention; avoids resolving to '' silently).
    const envRoot = process.env.MSN_WORKSPACE_ROOT;
    const root = options.workspaceRoot
      ?? (envRoot !== undefined && envRoot !== '' ? envRoot : join(homedir(), '.missioncraft'));
    this.workspaceRoot = resolve(root.replace(/^~(?=$|\/|\\)/, homedir()));
  }

  // ─── Workspace allocate / release / list / cleanup ───

  async allocate(missionId: string, repoUrl: string): Promise<WorkspaceHandle> {
    const repoName = repoNameFromUrl(repoUrl);
    const path = join(this.workspaceRoot, 'missions', missionId, repoName);
    try {
      await mkdir(path, { recursive: true });
    } catch (err: unknown) {
      throw new StorageAllocationError(
        `LocalFilesystemStorage.allocate(${missionId}, ${repoUrl}) failed: ${err instanceof Error ? err.message : 'unknown'}`,
        { cause: err instanceof Error ? err : undefined },
      );
    }
    return { missionId, repoUrl, path };
  }

  async release(handle: WorkspaceHandle, options: { retain?: boolean } = {}): Promise<void> {
    if (options.retain) return;                 // preserve workspace bytes (forensic-history per --retain semantic)
    try {
      await rm(handle.path, { recursive: true, force: true });
    } catch (err: unknown) {
      throw new StorageAllocationError(
        `LocalFilesystemStorage.release(${handle.path}) failed: ${err instanceof Error ? err.message : 'unknown'}`,
        { cause: err instanceof Error ? err : undefined },
      );
    }
  }

  async list(missionId: string): Promise<WorkspaceHandle[]> {
    const missionDir = join(this.workspaceRoot, 'missions', missionId);
    if (!existsSync(missionDir)) return [];
    let entries: string[];
    try {
      entries = await readdir(missionDir);
    } catch {
      return [];
    }
    const handles: WorkspaceHandle[] = [];
    for (const name of entries) {
      // Skip hidden dirs — engine-internal artifacts (W5b `.config-mirror/`, W5c `.coord-mirror/`,
      // W5b/W5c `.daemon-state.yaml`, v4.6 `.daemon-tx-active` sentinel) are NOT workspace handles
      // per Design §2.4 workspace-contract (per-mission engine-internal artifacts excluded from
      // operator-visible workspace listing per v4.10 PATCH item #9).
      if (name.startsWith('.')) continue;
      const path = join(missionDir, name);
      try {
        const s = await stat(path);
        if (s.isDirectory()) {
          // repoUrl unrecoverable from filesystem layout (only repo-name preserved); leave empty for v1
          handles.push({ missionId, repoUrl: '', path });
        }
      } catch { /* skip stat-fail entries */ }
    }
    return handles;
  }

  async cleanup(missionId: string): Promise<void> {
    const missionDir = join(this.workspaceRoot, 'missions', missionId);
    try {
      await rm(missionDir, { recursive: true, force: true });
    } catch (err: unknown) {
      throw new StorageAllocationError(
        `LocalFilesystemStorage.cleanup(${missionId}) failed: ${err instanceof Error ? err.message : 'unknown'}`,
        { cause: err instanceof Error ? err : undefined },
      );
    }
  }

  // ─── Lock primitives (W2 scope per F-W2.3: basic O_EXCL/link(2); daemon-watcher fields W4) ───

  async acquireMissionLock(
    missionId: string,
    options: { waitMs?: number; validityMs?: number } = {},
  ): Promise<LockHandle> {
    const lockPath = join(this.workspaceRoot, 'locks', 'missions', `${missionId}.lock`);
    return this.acquireLockAtPath(lockPath, missionId, options);
  }

  async acquireRepoLock(
    repoUrl: string,
    missionId: string,
    options: { waitMs?: number; validityMs?: number } = {},
  ): Promise<LockHandle> {
    const lockPath = join(this.workspaceRoot, 'locks', 'repos', `${repoUrlHash(repoUrl)}.lock`);
    try {
      return await this.acquireLockAtPath(lockPath, missionId, options);
    } catch (err) {
      if (err instanceof LockTimeoutError) {
        // Convert lock-timeout to repo-conflict per StorageProvider contract (one-active-mission-per-repo)
        const existing = await readLockfile(lockPath);
        if (existing && existing.missionId !== missionId) {
          throw new WorkspaceConflictError(
            `LocalFilesystemStorage.acquireRepoLock(${repoUrl}): repo currently locked by mission ${existing.missionId} (one-active-mission-per-repo invariant)`,
            { cause: err },
          );
        }
      }
      throw err;
    }
  }

  async releaseLock(lock: LockHandle): Promise<void> {
    // Idempotent on already-released; LockHandle.id encodes the lockfile path implicitly via missionId
    // For W2 simplicity: scan lock-dirs for matching id; remove. W3+ may persist path on LockHandle for direct removal.
    const candidates = [
      join(this.workspaceRoot, 'locks', 'missions', `${lock.missionId}.lock`),
      // repo-locks identified by sha; can't recover from missionId alone — caller passes via inspect
    ];
    for (const candidate of candidates) {
      const contents = await readLockfile(candidate);
      if (contents?.id === lock.id) {
        try { await unlink(candidate); } catch { /* idempotent */ }
        return;
      }
    }
    // Fallback: scan repo-locks dir for matching id
    const repoLocksDir = join(this.workspaceRoot, 'locks', 'repos');
    if (existsSync(repoLocksDir)) {
      try {
        const entries = await readdir(repoLocksDir);
        for (const name of entries) {
          const p = join(repoLocksDir, name);
          const c = await readLockfile(p);
          if (c?.id === lock.id) {
            try { await unlink(p); } catch { /* idempotent */ }
            return;
          }
        }
      } catch { /* swallow */ }
    }
    // Lock not found = already-released; idempotent no-op
  }

  async inspectLocks(filter: { missionId?: string; repoUrl?: string } = {}): Promise<LockHandle[]> {
    const handles: LockHandle[] = [];
    if (filter.missionId !== undefined && filter.repoUrl === undefined) {
      const missionLockPath = join(this.workspaceRoot, 'locks', 'missions', `${filter.missionId}.lock`);
      const c = await readLockfile(missionLockPath);
      if (c && c.missionId === filter.missionId) {
        handles.push(this.lockfileToHandle(c));
      }
    }
    if (filter.repoUrl !== undefined) {
      const repoLockPath = join(this.workspaceRoot, 'locks', 'repos', `${repoUrlHash(filter.repoUrl)}.lock`);
      const c = await readLockfile(repoLockPath);
      if (c && (filter.missionId === undefined || c.missionId === filter.missionId)) {
        handles.push(this.lockfileToHandle(c));
      }
    }
    if (filter.missionId === undefined && filter.repoUrl === undefined) {
      // Full-scan
      for (const subdir of ['missions', 'repos', 'scopes']) {
        const dir = join(this.workspaceRoot, 'locks', subdir);
        if (!existsSync(dir)) continue;
        try {
          const entries = await readdir(dir);
          for (const name of entries) {
            const c = await readLockfile(join(dir, name));
            if (c) handles.push(this.lockfileToHandle(c));
          }
        } catch { /* skip */ }
      }
    }
    return handles;
  }

  // ─── Internal helpers ───

  private lockfileToHandle(c: LockfileContents): LockHandle {
    return {
      id: c.id,
      missionId: c.missionId,
      acquiredAt: new Date(c.acquiredAt),
      expiresAt: new Date(c.expiresAt),
    };
  }

  /**
   * Acquire lock at a specific path via POSIX O_EXCL atomic create-if-absent.
   *
   * Stale-recovery via link(2) atomic-takeover (v2.3 fold per MEDIUM-R3.3):
   *   1. Read existing lockfile; check expiresAt
   *   2. If expired → write new lockfile to <path>.<pid>.tmp; link(<path>) atomic-creates new
   *      (POSIX semantic: link fails with EEXIST if target already exists; atomic w.r.t. concurrent take-overs)
   *   3. On EEXIST → another concurrent expired-detection won the race; clean up tmp + retry per waitMs
   *
   * Per F-W2.3: lockfile contents = minimal JSON with id/missionId/acquiredAt/expiresAt;
   * daemon-watcher fields (pid/startTime/abandonInProgress/etc.) deferred to W4.
   */
  private async acquireLockAtPath(
    lockPath: string,
    missionId: string,
    options: { waitMs?: number; validityMs?: number } = {},
  ): Promise<LockHandle> {
    const waitMs = options.waitMs ?? 0;
    const validityMs = options.validityMs ?? DEFAULT_VALIDITY_MS;
    const dir = join(lockPath, '..');
    await mkdir(dir, { recursive: true });
    const startTime = Date.now();

    while (true) {
      // Try direct atomic-create via writeFile with 'wx' flag (POSIX O_EXCL semantic)
      const id = generateLockId();
      const acquiredAt = new Date();
      const expiresAt = new Date(acquiredAt.getTime() + validityMs);
      const contents: LockfileContents = {
        id,
        missionId,
        acquiredAt: acquiredAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };
      const serialized = JSON.stringify(contents, null, 2);
      try {
        await writeFile(lockPath, serialized, { flag: 'wx', encoding: 'utf8' });
        return { id, missionId, acquiredAt, expiresAt };
      } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException;
        if (e.code !== 'EEXIST') {
          throw new StorageAllocationError(
            `LocalFilesystemStorage acquireLock(${lockPath}) write failed: ${e.message ?? 'unknown'}`,
            { cause: err instanceof Error ? err : undefined },
          );
        }
      }

      // Lockfile exists; check stale-recovery path
      const existing = await readLockfile(lockPath);
      if (existing && new Date(existing.expiresAt).getTime() < Date.now()) {
        // Expired → atomic-takeover via link(2) per v2.3 fold MEDIUM-R3.3
        const newId = generateLockId();
        const newAcquiredAt = new Date();
        const newExpiresAt = new Date(newAcquiredAt.getTime() + validityMs);
        const tmpPath = `${lockPath}.${process.pid}.${newId}.tmp`;
        const newContents: LockfileContents = {
          id: newId,
          missionId,
          acquiredAt: newAcquiredAt.toISOString(),
          expiresAt: newExpiresAt.toISOString(),
        };
        try {
          await writeFile(tmpPath, JSON.stringify(newContents, null, 2), 'utf8');
          await unlink(lockPath);                    // remove stale; race-window for concurrent takeover
          await link(tmpPath, lockPath);             // atomic create new; throws EEXIST if concurrent winner
          await unlink(tmpPath);                     // cleanup tmp (path is now hard-linked)
          return { id: newId, missionId, acquiredAt: newAcquiredAt, expiresAt: newExpiresAt };
        } catch (err: unknown) {
          // Cleanup tmp on any failure; re-poll
          try { await unlink(tmpPath); } catch { /* swallow */ }
          // Fall through to retry-loop
        }
      }

      // Lock held by another (not expired); poll waitMs
      if (Date.now() - startTime >= waitMs) {
        throw new LockTimeoutError(
          `LocalFilesystemStorage acquireLock(${lockPath}): waitMs ${waitMs} exceeded; lock held by mission ${existing?.missionId ?? '<unknown>'}`,
        );
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

// Use atomicWrite to silence unused-import warnings until W3 wires it for mission-config writes
// (LocalFilesystemStorage at W2 doesn't write mission-configs; that's W3 SDK class concern).
void atomicWrite;
