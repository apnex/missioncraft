// StorageProvider pluggable interface (Design v4.8 §2.1.3)
// Default v1 implementation: LocalFilesystemStorage (under ${MSN_WORKSPACE_ROOT}; default ~/.missioncraft).

export interface WorkspaceHandle {
  readonly missionId: string;
  readonly repoUrl: string;
  readonly path: string; // absolute filesystem path
}

export interface LockHandle {
  readonly id: string;            // unique identifier for the lock
  readonly missionId: string;
  readonly acquiredAt: Date;
  readonly expiresAt: Date;
}

export interface StorageProvider {
  /** Allocate workspace for mission + repo. Idempotent on re-allocate. */
  allocate(missionId: string, repoUrl: string): Promise<WorkspaceHandle>;

  /** Release workspace (destroy unless retained). */
  release(handle: WorkspaceHandle, options?: { retain?: boolean }): Promise<void>;

  /** List active workspaces for a mission. */
  list(missionId: string): Promise<WorkspaceHandle[]>;

  /** Bulk-release for mission cleanup. v0.2 fold per §C.4. */
  cleanup(missionId: string): Promise<void>;

  // ─── Lock primitives (v0.2 fold per §C.4; v0.3 fold per §CC — split waitMs + validityMs) ───

  /**
   * Acquire mission-lock (single-writer-per-mission).
   * Throws LockTimeoutError if waitMs exceeded; auto-releases stale locks where Date.now() > existing.expiresAt.
   */
  acquireMissionLock(missionId: string, options: {
    waitMs?: number;        // wait-timeout (how long to wait if held by another); default 0 (fail-fast)
    validityMs?: number;    // lock TTL (auto-expiry for stale-recovery); default 86400000 (24h per F14)
  }): Promise<LockHandle>;

  /**
   * Acquire repo-lock (one-active-mission-per-repo).
   * Throws WorkspaceConflictError if held by different mission.
   */
  acquireRepoLock(repoUrl: string, missionId: string, options: {
    waitMs?: number;        // default 0 (fail-fast)
    validityMs?: number;    // default 86400000 (24h)
  }): Promise<LockHandle>;

  /** Release lock (idempotent on already-released). */
  releaseLock(lock: LockHandle): Promise<void>;

  /** Check lock state without acquiring. v0.3 fold per §CC — generalized over both lock-types. */
  inspectLocks(filter?: { missionId?: string; repoUrl?: string }): Promise<LockHandle[]>;
}
