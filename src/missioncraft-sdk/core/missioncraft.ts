// Missioncraft SDK class — primary contract surface (Design v4.8 §2.3.1).
//
// 16 methods total (v4.x consolidation per Refinement #7 + multi-participant additions per HIGH-R2.2):
// - 5 universal verbs (create / get / list / update / delete) — k8s-shape parameterized by ResourceType
// - 6 mission-specific verbs (start / apply / complete / abandon / tick / workspace)
// - 2 multi-participant verbs (join / leave) — v4.0 NEW per HIGH-R2.2
// - 2 operator-config (configGet / configSet)
// - 1 static (isPlatformSupported)
//
// W3 method-body discipline (per dispatch):
//   - create / get / list / configGet / configSet / static / update-validation: IMPLEMENTED FULLY
//   - start / apply / complete / abandon / tick / workspace: throw MissionStateError("not yet implemented; W4")
//   - join / leave: throw MissionStateError("not yet implemented; W5")

import { randomBytes } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile, unlink, symlink } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { stringify as yamlStringify } from 'yaml';

import {
  ConfigValidationError,
  MissionStateError,
  ReaderAutoCloseError,
  UnsupportedOperationError,
} from '../errors.js';
import type {
  ApprovalPolicy,
  GitEngine,
  IdentityProvider,
  LockHandle,
  RemoteProvider,
  StorageProvider,
  WorkspaceHandle,
} from '../pluggables/index.js';
import type { MissioncraftConfig, ProgressCallback } from './types.js';
import type {
  MissionConfig,
  MissionFilter,
  MissionHandle,
  MissionMutation,
  MissionRepoState,
  MissionState,
  MissionStatePhase,
} from './mission-types.js';
import type {
  ScopeConfig,
  ScopeFilter,
  ScopeHandle,
  ScopeMutation,
  ScopeState,
  ScopeStatePhase,
} from './scope-types.js';
import { instantiateProvider } from './provider-registry.js';
import { OperatorConfigSchema } from './operator-config-schema.js';
import { parseMissionConfig, serializeMissionConfig, kebabToCamelObject, camelToKebabObject } from './yaml-transform.js';
import { ScopeConfigSchema } from './scope-config-schema.js';
import { validateMutationAllowed } from './state-machine/state-restriction-matrix.js';
import { nextState } from './state-machine/lifecycle-state-machine.js';
import type { RepoSpec } from './mission-types.js';
import { spawnDaemonWatcher } from './daemon/spawn-daemon-watcher.js';
import { triggerDaemonFlush, terminateDaemon, clearDaemonIpcFields } from './daemon/daemon-ipc.js';
import { updateLockfileState } from './state-machine/lockfile-state.js';

/** Pluggable resource-types. */
export type ResourceType = 'mission' | 'scope';

/** Per-resource type-map (Design v4.8 §2.3.1 v3.1 fold). */
export interface ResourceMap {
  mission: {
    handle: MissionHandle;
    state: MissionState;
    config: MissionConfig;
    filter: MissionFilter;
    createOpts: {
      name?: string;
      repo?: string | string[];
      scope?: string;
      // mission-78 W4-new (Design v5.0 §2 row 4): reader-mission creation fields
      readOnly?: boolean;                       // true → reader-mission (BRANCH-TRACKER OR PERSISTENT-TRACKER)
      sourceMissionId?: string;                 // BRANCH-TRACKER (msn join <writer-mission-id>)
      sourceRemote?: string;                    // PERSISTENT-TRACKER (msn watch --repo)
      sourceBranch?: string;                    // ref name (both reader-flavors)
    };
    getOpts: { principal?: string };
    listOpts: { principal?: string };
    deletable: false;
    mutation: MissionMutation;
  };
  scope: {
    handle: ScopeHandle;
    state: ScopeState;
    config: ScopeConfig;
    filter: ScopeFilter;
    createOpts: { name?: string; description?: string; repo?: string | string[] };
    getOpts: { includeReferences?: boolean };
    listOpts: { includeReferences?: boolean };
    deletable: true;
    mutation: ScopeMutation;
  };
}

export type DeletableResource = {
  [K in ResourceType]: ResourceMap[K]['deletable'] extends true ? K : never;
}[ResourceType];

/** Generate canonical msn-<8-char-hex> mission-id (v1.2 fold per MEDIUM-1). */
function generateMissionId(): string {
  return `msn-${randomBytes(4).toString('hex')}`;
}

/** Generate canonical scp-<8-char-hex> scope-id. */
function generateScopeId(): string {
  return `scp-${randomBytes(4).toString('hex')}`;
}

function repoNameFromUrl(repoUrl: string): string {
  const stripped = repoUrl.replace(/\/$/, '').replace(/\.git$/, '');
  const idx = Math.max(stripped.lastIndexOf('/'), stripped.lastIndexOf(':'));
  const candidate = idx >= 0 ? stripped.slice(idx + 1) : stripped;
  return candidate.toLowerCase();
}

export class Missioncraft {
  // Pluggables (resolved from constructor opts OR PROVIDER_REGISTRY defaults)
  readonly identity: IdentityProvider;
  readonly approval: ApprovalPolicy;
  readonly storage: StorageProvider;
  readonly gitEngine: GitEngine;
  readonly remote?: RemoteProvider;

  // Constructor opts (preserved for runtime-introspection)
  readonly workspaceRoot: string;
  readonly principal?: string;

  constructor(config: Partial<MissioncraftConfig> = {}) {
    this.identity = config.identity ?? instantiateProvider('identity', 'local-git-config');
    this.approval = config.approval ?? instantiateProvider('approval', 'trust-all');
    this.workspaceRoot = resolve(
      (config.workspaceRoot ?? join(homedir(), '.missioncraft')).replace(/^~(?=$|\/|\\)/, homedir()),
    );
    this.storage = config.storage ?? instantiateProvider('storage', 'local-filesystem', { workspaceRoot: this.workspaceRoot });
    this.gitEngine = config.gitEngine ?? instantiateProvider('gitEngine', 'native-git');
    this.remote = config.remote;                       // optional; pure-git mode if undefined
    this.principal = config.principal;
  }

  // ─── Universal resource verbs (k8s-shape per Refinement #7) ───

  async create<T extends ResourceType>(
    type: T,
    opts?: ResourceMap[T]['createOpts'],
  ): Promise<ResourceMap[T]['handle']> {
    if (type === 'mission') {
      const handle = await this.createMission(opts as ResourceMap['mission']['createOpts']);
      return handle as ResourceMap[T]['handle'];
    }
    if (type === 'scope') {
      const handle = await this.createScope(opts as ResourceMap['scope']['createOpts']);
      return handle as ResourceMap[T]['handle'];
    }
    throw new ConfigValidationError(`Missioncraft.create: unknown resource-type '${type as string}'`);
  }

  async get<T extends ResourceType>(
    type: T,
    id: string,
    opts?: ResourceMap[T]['getOpts'],
  ): Promise<ResourceMap[T]['state']> {
    if (type === 'mission') {
      const resolvedId = this.resolveMissionRef(id);                       // v1.0.3 bug-64 item 5
      const principal = (opts as ResourceMap['mission']['getOpts'] | undefined)?.principal ?? this.principal;
      return this.getMission(resolvedId, principal) as Promise<ResourceMap[T]['state']>;
    }
    if (type === 'scope') {
      const resolvedId = this.resolveScopeRef(id);                         // v1.0.3 bug-64 item 5
      return this.getScope(resolvedId, opts as ResourceMap['scope']['getOpts'] | undefined) as Promise<ResourceMap[T]['state']>;
    }
    throw new ConfigValidationError(`Missioncraft.get: unknown resource-type '${type as string}'`);
  }

  async list<T extends ResourceType>(
    type: T,
    filter?: ResourceMap[T]['filter'],
    opts?: ResourceMap[T]['listOpts'],
  ): Promise<ResourceMap[T]['state'][]> {
    if (type === 'mission') {
      const principal = (opts as ResourceMap['mission']['listOpts'] | undefined)?.principal ?? this.principal;
      return this.listMissions(filter as MissionFilter | undefined, principal) as Promise<ResourceMap[T]['state'][]>;
    }
    if (type === 'scope') {
      return this.listScopes(filter as ScopeFilter | undefined, opts as ResourceMap['scope']['listOpts'] | undefined) as Promise<ResourceMap[T]['state'][]>;
    }
    throw new ConfigValidationError(`Missioncraft.list: unknown resource-type '${type as string}'`);
  }

  async update<T extends ResourceType>(
    type: T,
    id: string,
    mutation: ResourceMap[T]['mutation'],
  ): Promise<ResourceMap[T]['state']> {
    if (type === 'mission') {
      const m = mutation as MissionMutation;
      if (typeof m !== 'object' || m === null || typeof m.kind !== 'string') {
        throw new ConfigValidationError(`Missioncraft.update('mission'): mutation must be a discriminated-union with 'kind' field`);
      }
      const resolvedId = this.resolveMissionRef(id);                       // v1.0.3 bug-64 item 5
      const state = await this.applyMissionMutation(resolvedId, m);
      return state as ResourceMap[T]['state'];
    }
    if (type === 'scope') {
      const m = mutation as ScopeMutation;
      if (typeof m !== 'object' || m === null || typeof m.kind !== 'string') {
        throw new ConfigValidationError(`Missioncraft.update('scope'): mutation must be a discriminated-union with 'kind' field`);
      }
      const resolvedId = this.resolveScopeRef(id);                              // v1.0.4 bug-64 item 5
      const state = await this.applyScopeMutation(resolvedId, m);                // v1.0.5 bug-65
      return state as ResourceMap[T]['state'];
    }
    throw new ConfigValidationError(`Missioncraft.update: unknown resource-type '${type as string}'`);
  }

  async delete<T extends DeletableResource>(type: T, id: string): Promise<void> {
    if (type === 'scope') {
      const resolvedId = this.resolveScopeRef(id);                              // v1.0.5 bug-65
      await this.deleteScope(resolvedId);
      return;
    }
    // Type-system narrows out 'mission' via DeletableResource; runtime guard for dynamic-invocation
    throw new MissionStateError(
      `Missioncraft.delete: 'mission' termination uses complete()/abandon() per Design v4.8 §2.4.1 — delete<T> type-narrowed out per HIGH-7`,
    );
  }

  // ─── Mission-specific verbs (W4.3 runtime-impl wiring) ───

  /**
   * 9-step configured → started transition (Design v4.9 §2.4.1; v3.2 MEDIUM-R2.4 reorder).
   *
   * W4.3 LITE: implements full configured → started transition LESS daemon-spawn (Step 6
   * stub-point in W4.4 graft-set). End-state is `'started'` per spec line 1542 (transient
   * state — short-lived, not unpersisted; persisted briefly until daemon-tick fires
   * `started → in-progress` advance per state-machine table line 1505 = "operator does work"
   * fired by daemon-tick = W4.4 territory).
   *
   * Daemon-watcher process model + LockfileState IPC fields = W4.4 scope per per-sub-phase
   * pattern; W4.3 keeps state-machine FSM logic independent of daemon process-model.
   *
   * Steps:
   *   1. Validate pre-state (must be 'configured' with ≥1 repo)
   *   2. Acquire mission-lock + per-repo locks (single-writer-per-mission per §2.4)
   *   3. Allocate workspace per repo via storage.allocate
   *   4. Clone repos via gitEngine.clone
   *   5. Atomic-write lifecycle 'configured' → 'started' (transient) via _engineMutate
   *   6. Daemon-spawn (W4.4 graft-set; see sentinel-comment at the Step 6 position below)
   *   7. (W4.4 territory) `started → in-progress` advance fired by daemon-tick (NOT start())
   *   8. Release locks
   */
  async start(
    input: string | { config: MissionConfig },
    opts?: { onProgress?: ProgressCallback; idempotent?: boolean },
  ): Promise<MissionHandle> {
    if (typeof input !== 'string') {
      throw new ConfigValidationError(
        'Missioncraft.start: config-input form (apply()-equivalent) not yet implemented; pass mission-id string for W4.3',
      );
    }
    const missionId = this.resolveMissionRef(input);                       // v1.0.3 bug-64 item 5

    // v1.0.6 bug-68: FSM pre-flight FIRST — no progress emitted for rejected actions.
    // Progress events represent ACTIVE work; rejected pre-state must throw before any onProgress fires.
    const path = this.missionConfigPath(missionId);
    if (!existsSync(path)) {
      throw new MissionStateError(`Missioncraft.start: mission '${missionId}' not found`);
    }
    const initialContent = await readFile(path, 'utf8');
    // mission-78 W4-new slice (v.b): reader-mission has lifecycle 'joined' (per slice-ii/iii
    // createMission initialLifecycle); parse with 'auto' role-derivation so reader-state YAML
    // parses through reader-role schema (matches getMission behavior).
    const initialConfig = parseMissionConfig(initialContent, path, 'auto');
    const isReaderStart = initialConfig.mission.readOnly === true;
    // Reader-mission accepts lifecycle 'joined'; writer-mission requires 'configured' (W4-new v.b).
    const validPreStates: readonly MissionStatePhase[] = isReaderStart ? ['joined'] : ['configured'];
    // mission-78 W6-new slice (iii): idempotent-start semantic per architect-disposition thread-550
    // round 4. When opts.idempotent === true and lifecycleState already in {'started', 'in-progress'},
    // return existing handle gracefully (no-op; daemon-already-running case). Terminal lifecycles
    // (completed/abandoned) still throw with operator-DX-clear error. Used by:
    // - `msn <id> start` (CLI always passes idempotent: true; spawn-if-not-running semantic per
    //   Design v5.0 §10.6 — replaces dedicated `msn start <id>` verb-first form)
    // - `msn create/join/watch --start` flag (CLI sequential mc.create + mc.start composition)
    if (
      opts?.idempotent === true &&
      (initialConfig.mission.lifecycleState === 'started' ||
        initialConfig.mission.lifecycleState === 'in-progress')
    ) {
      return initialConfig.mission.name === undefined
        ? { id: missionId }
        : { id: missionId, name: initialConfig.mission.name };
    }
    if (!validPreStates.includes(initialConfig.mission.lifecycleState)) {
      throw new MissionStateError(
        `Missioncraft.start: requires lifecycle ${validPreStates.map((s) => `'${s}'`).join(' or ')} (current: '${initialConfig.mission.lifecycleState}')`,
      );
    }
    if (initialConfig.repos.length === 0) {
      throw new MissionStateError(
        `Missioncraft.start: requires at least 1 repo (lifecycle '${initialConfig.mission.lifecycleState}' but repos[] empty — invariant violation)`,
      );
    }

    const emit = opts?.onProgress ?? ((): void => undefined);              // v1.0.5 idea-273
    emit({ phase: 'validate', message: `validating mission '${missionId}'` });

    // Step 2: acquire mission-lock + per-repo locks
    emit({ phase: 'acquire-lock', message: 'acquiring mission + repo locks' });
    const missionLock = await this.storage.acquireMissionLock(missionId, { waitMs: 0 });
    const repoLocks: LockHandle[] = [];
    const workspaceHandles: WorkspaceHandle[] = [];
    // SD3 fix (v1.0.2): the mission-lockfile dual-purposes as both a start() mutex AND the
    // daemon-watcher IPC channel (Design v4.9 §2.6.5; per watcher-entry.ts comment "Lockfile-
    // cleanup is PARENT-CLI responsibility (parent invokes SIGTERM as part of complete-flow
    // Step 4 / abandon-flow Step 2; same parent-CLI then ... releases lock entirely via
    // storage.releaseLock)"). Once the daemon spawns successfully at Step 6, the lockfile must
    // persist with daemon-IPC fields (pid/startTime/daemonExpiresAt) until complete()/abandon()
    // cleans it up. start() Step 8 unconditionally releasing the mission-lock destroyed the
    // daemon-IPC state, causing locks/missions/<id>.lock to be empty during mission-active
    // (SD3) + downstream `msn abandon` SIGTERM-no-op orphaning the daemon (SD2).
    let daemonSpawned = false;
    try {
      for (const repo of initialConfig.repos) {
        const repoLock = await this.storage.acquireRepoLock(repo.url, missionId, { waitMs: 0 });
        repoLocks.push(repoLock);
      }

      // Step 3: allocate workspaces + Step 4: clone repos + create+checkout working branch
      const identity = await this.identity.resolve();
      // mission-78 W4-new slice (v.b): reader-mission needs different clone+checkout path.
      // For BRANCH-TRACKER (sourceMissionId): clone writer.repos[i].url + checkout
      // `mission/<sourceMissionId>` (v5.0 single-branch architecture per Design v5.0 §2 row 2).
      // For PERSISTENT-TRACKER (sourceRemote + sourceBranch): clone sourceRemote + checkout
      // sourceBranch. No writer-branch-creation; reader has no mutation surface.
      const readerSourceBranch = isReaderStart
        ? initialConfig.mission.sourceMissionId !== undefined
          ? `mission/${initialConfig.mission.sourceMissionId}`
          : initialConfig.mission.sourceBranch
        : undefined;
      for (const repo of initialConfig.repos) {
        emit({ phase: 'allocate-workspace', message: `allocating workspace for repo '${repo.name ?? repo.url}'` });
        const workspace = await this.storage.allocate(missionId, repo.url);
        workspaceHandles.push(workspace);
        emit({ phase: 'clone', message: `cloning ${repo.url}` });
        await this.gitEngine.clone(workspace, repo.url, {
          fs: undefined,
          identity,
          ...(this.remote !== undefined && { remote: this.remote }),
        });
        if (isReaderStart) {
          // Reader: checkout source-branch directly (no writer-branch creation; workspace is
          // read-only mirror of source). Post-checkout chmod-down to 0444/0555 per slice (v.b).
          if (readerSourceBranch !== undefined) {
            // PERSISTENT-TRACKER source-branch may not exist locally post-clone (clone defaults
            // to remote HEAD); fetch the specific source-branch then checkout.
            try {
              await this.gitEngine.fetch(workspace, { remote: 'origin', branch: readerSourceBranch });
            } catch { /* clone may have already fetched; checkout will surface real issue */ }
            await this.gitEngine.checkout(workspace, readerSourceBranch);
          }
        } else {
          // v1.0.7 bug-73 fix part B (per mission-types.ts:46 / Design v1.7 MINOR-R6.6):
          // engine substitutes `mission/<missionId>` as the working branch and checks it out
          // post-clone. Operator's subsequent `git add` + `git commit` then lands on the mission
          // branch automatically — no operator-side `git checkout` needed (operator-never-runs-git
          // substrate invariant per Director correction 2026-05-12). complete()'s squash-loop later
          // reads from this branch via `headRef = 'mission/<missionId>'` (missioncraft.ts:630).
          const workingBranch = repo.branch ?? `mission/${missionId}`;
          await this.gitEngine.branch(workspace, workingBranch);
          await this.gitEngine.checkout(workspace, workingBranch);
        }
      }

      // mission-78 W4-new slice (v.b): reader-workspace chmod-down post-clone+checkout.
      // 0444 (file read-only) + 0555 (dir read+execute) per Design v4.8 §2.10.4 strict-enforce;
      // .git/ tree excluded so engine-internal fetch/checkout still works. Loop B's fetch+reset
      // cycle then chmod-ups, syncs, chmod-downs (slice-(v.b) Loop B cycle).
      if (isReaderStart) {
        const { setReaderWorkspaceMode } = await import('./reader-workspace-mode.js');
        for (const ws of workspaceHandles) {
          await setReaderWorkspaceMode(ws.path);
        }
      }

      // Step 5: atomic-write lifecycle 'configured'|'joined' → 'started' (transient state per v3.2
      // MEDIUM-R2.4). mission-78 W4-new slice (v.b): reader-mission's pre-state is 'joined';
      // writer's is 'configured'. Both target-transition to 'started'.
      await this._engineMutate(
        missionId,
        (config) => ({ ...config, mission: { ...config.mission, lifecycleState: 'started' } }),
        {
          validate: (config) =>
            validPreStates.includes(config.mission.lifecycleState)
              ? null
              : `transition rejected: expected ${validPreStates.map((s) => `'${s}'`).join(' or ')} got '${config.mission.lifecycleState}'`,
          sourceLabel: `Missioncraft.start.step5-begin('${missionId}')`,
          role: 'auto',
        },
      );

      emit({ phase: 'write-lifecycle', message: "advancing lifecycle 'configured' → 'started'" });
      // Step 6 (W4.4 slice ii graft): daemon-spawn BEFORE state-yaml-persist Step 7 per v3.2
      // MEDIUM-R2.4 ordering. Spawn-failure rollback: revert lifecycle 'started' → 'configured';
      // throw error; finally-block releases locks → mission stays at 'configured' (clean-rollback
      // invariant preserved per v3.2 MEDIUM-R2.4).
      try {
        emit({ phase: 'spawn-daemon', message: 'spawning daemon-watcher' });
        await spawnDaemonWatcher({
          missionId,
          workspaceRoot: this.workspaceRoot,
          lockfilePath: this.missionLockfilePath(missionId),
        });
        daemonSpawned = true;
      } catch (spawnErr: unknown) {
        // Spawn-failure rollback: revert lifecycle to original pre-state (best-effort).
        // mission-78 W4-new slice (v.b): reader's pre-state is 'joined'; writer's is 'configured'.
        const rollbackTarget: MissionStatePhase = isReaderStart ? 'joined' : 'configured';
        try {
          await this._engineMutate(
            missionId,
            (config) => ({ ...config, mission: { ...config.mission, lifecycleState: rollbackTarget } }),
            {
              validate: (config) =>
                config.mission.lifecycleState === 'started'
                  ? null
                  : `rollback rejected: expected 'started' got '${config.mission.lifecycleState}'`,
              sourceLabel: `Missioncraft.start.spawn-failure-rollback('${missionId}')`,
              role: 'auto',
            },
          );
        } catch { /* rollback best-effort; release-locks still runs in finally */ }
        throw new MissionStateError(
          `Missioncraft.start: daemon-spawn failed; lifecycle rolled back to '${rollbackTarget}'; original error: ${spawnErr instanceof Error ? spawnErr.message : String(spawnErr)}`,
          { cause: spawnErr instanceof Error ? spawnErr : undefined },
        );
      }

      // Step 7 territory: `started → in-progress` advance is daemon-tick-driven per Design v4.9
      // §2.4.1 line 1505 state-machine table ("operator does work" = daemon-tick = daemon-side).
      // Daemon's first tick fires the advance via _engineMutate allowed-states ['started'].
      // start() returns at 'started'; the in-progress advance happens asynchronously post-return.
    } finally {
      // Step 8: release locks (idempotent on already-released).
      // Repo-locks always release (mutex-only; no daemon-IPC needs).
      // Mission-lock releases ONLY when daemon DIDN'T spawn — on success it persists as
      // daemon-IPC channel; complete()/abandon() releases it after SIGTERM-cleanup.
      for (const lock of repoLocks) {
        try { await this.storage.releaseLock(lock); } catch { /* idempotent */ }
      }
      if (!daemonSpawned) {
        try { await this.storage.releaseLock(missionLock); } catch { /* idempotent */ }
      }
    }

    const handle: MissionHandle =
      initialConfig.mission.name === undefined
        ? { id: missionId }
        : { id: missionId, name: initialConfig.mission.name };
    return handle;
  }

  /**
   * mission-78 W6-new slice (v): `mc.apply()` SDK method DELETED entirely (verb DROPPED per
   * Design v5.0 §10.6 perfection-grade revisions; was unimplemented + overlapped with
   * `mc.create('mission', { -f spec })` which is the single creation-surface).
   */

  /**
   * 8-step atomic PR-set publish-flow (Design v4.9 §2.4.1 lines 1700+; v3.1+v3.2+v3.3+v3.4 folds).
   *
   * W4.3 LITE: implements full transition LESS daemon-flush + SIGTERM (Steps 1+4 stub-points in W4.4 graft-set).
   *
   * Steps:
   *   1. Daemon-flush via lockfile-state-watch (W4.4 graft-set; sentinel below)
   *   2. Per-repo publish-loop: squashCommit → push → openPullRequest;
   *      `mission.publishStatus[repoName]` per-repo state-tracking; idempotent retry skips 'pr-opened'
   *   3. Atomic-write `lifecycle-state: 'completed'` + `publishedPRs[]` via _engineMutate
   *   4. SIGTERM daemon-watcher 60s + SIGKILL fallback (W4.4 graft-set; sentinel below)
   *   5. Release mission-lock + repo-locks
   *   6. Cleanup local mission-branches in each repo workspace
   *   7. Destroy runtime workspace (per --retain not set)
   *   8. (--purge-config only) delete <id>.yaml + .names/<slug>.yaml symlink atomically
   *
   * publishMessage immutability per v3.2 MEDIUM-R2.6: persisted at first-complete; new message-arg
   * supplied by retry-invocation is IGNORED with operator-warning logged.
   */
  async complete(
    idOrName: string,
    message: string,
    opts: { purgeConfig?: boolean; purgeWorkspace?: boolean; retain?: boolean; onProgress?: ProgressCallback } = {},
  ): Promise<MissionState> {
    if (!message) {
      throw new ConfigValidationError("Missioncraft.complete: message is required (per v3.0 Refinement #4)");
    }
    if (opts.retain && opts.purgeConfig) {
      throw new ConfigValidationError(
        "Missioncraft.complete: --retain and --purge-config are mutually exclusive (purge implies destroy)",
      );
    }
    // v1.0.6 bug-72: --purge-workspace and --retain are mutually exclusive (destroy ↔ preserve).
    if (opts.retain && opts.purgeWorkspace) {
      throw new ConfigValidationError(
        "Missioncraft.complete: --retain and --purge-workspace are mutually exclusive",
      );
    }
    const id = this.resolveMissionRef(idOrName);                           // v1.0.3 bug-64 item 5

    // v1.0.6 bug-68: FSM pre-flight FIRST — no progress emitted for rejected actions.
    const path = this.missionConfigPath(id);
    if (!existsSync(path)) {
      throw new MissionStateError(`Missioncraft.complete: mission '${id}' not found`);
    }
    const initialContent = await readFile(path, 'utf8');
    const initialConfig = parseMissionConfig(initialContent, path);
    const currentState = initialConfig.mission.lifecycleState;
    if (currentState !== 'in-progress' && currentState !== 'started') {
      throw new MissionStateError(
        `Missioncraft.complete: requires lifecycle 'in-progress' or 'started' (current: '${currentState}')`,
      );
    }

    const emit = opts.onProgress ?? ((): void => undefined);               // v1.0.5 idea-273
    emit({ phase: 'final-tick', message: 'flushing final wip-commit' });

    // publishMessage immutability per v3.2 MEDIUM-R2.6 — persisted at first-complete
    const effectiveMessage = initialConfig.mission.publishMessage ?? message;
    const messageWasOverridden = initialConfig.mission.publishMessage !== undefined && initialConfig.mission.publishMessage !== message;

    // SD2/SD3 follow-on (v1.0.2 slice i.5): inherit the mission-lock from start() rather than
    // acquire-fresh. Slice (i) made start() persist the lockfile as the daemon-IPC channel
    // (Design v4.9 §2.6.5); complete() operates as the cleanup-side of that channel per
    // watcher-entry.ts comment-block invariant. Cross-operation guard provided by
    // `abandonInProgress` flag (v3.6 MEDIUM-R6.1; abandon-vs-complete race) + `_engineMutate`
    // atomicity (W4.3 substrate). The pre-W4.4 acquire-release-cycle was mutex-only; W4.4
    // added the flag-based guard which made this acquire vestigial.
    const inheritedHandles = await this.storage.inspectLocks({ missionId: id });
    const missionLock = inheritedHandles.find((h) => h.missionId === id);
    if (!missionLock) {
      throw new MissionStateError(
        `Missioncraft.complete: mission-lock absent at '${this.missionLockfilePath(id)}'; ` +
          `mission may not be active (verify start() was called and lockfile not externally deleted)`,
      );
    }
    const repoLocks: LockHandle[] = [];
    try {
      for (const repo of initialConfig.repos) {
        const lock = await this.storage.acquireRepoLock(repo.url, id, { waitMs: 0 });
        repoLocks.push(lock);
      }

      // Persist publishMessage on first invocation (immutable post-write)
      if (initialConfig.mission.publishMessage === undefined) {
        await this._engineMutate(
          id,
          (config) => ({ ...config, mission: { ...config.mission, publishMessage: effectiveMessage } }),
          {
            validate: (config) =>
              config.mission.lifecycleState === 'in-progress' || config.mission.lifecycleState === 'started'
                ? null
                : `transition rejected: expected 'in-progress' or 'started' got '${config.mission.lifecycleState}'`,
            sourceLabel: `Missioncraft.complete.persist-message('${id}')`,
          },
        );
      } else if (messageWasOverridden) {
        // Operator-warning per v3.2 MEDIUM-R2.6 idempotent-retry semantic
        // (no logger pluggable yet; emit to stderr — logger pluggable is W6 scope)
        process.stderr.write(
          `NOTE: complete already initiated for '${id}' with message '${initialConfig.mission.publishMessage}'; ` +
            `retry uses original message; new message arg ignored. ` +
            `To use a different message, abandon + re-create mission.\n`,
        );
      }

      // Step 1 (W4.4 slice ii graft): daemon-flush via lockfile-state-watch pendingFlushBeforeComplete
      // per v3.2 MEDIUM-R2.1. STUB-SEMANTIC: no-op when daemon absent (W4.3 baseline behavior preserved).
      // On flush-timeout, falls through to publish-loop (daemon SIGTERM happens at Step 4).
      const flushResult = await triggerDaemonFlush(this.missionLockfilePath(id), 'pendingFlushBeforeComplete');
      void flushResult;        // 'flushed' / 'no-daemon' / 'timeout' — all proceed to publish-loop

      // Step 2: per-repo publish-loop (squash + push + openPullRequest)
      emit({ phase: 'publish', message: 'squash + push + open PRs per repo' });
      await this.runPublishLoop(id, initialConfig, effectiveMessage);

      // Step 3: atomic-write 'lifecycle-state: completed' + finalize publishStatus
      emit({ phase: 'write-lifecycle', message: "advancing lifecycle → 'completed'" });
      const finalConfig = await this._engineMutate(
        id,
        (config) => ({ ...config, mission: { ...config.mission, lifecycleState: 'completed' } }),
        {
          validate: (config) =>
            config.mission.lifecycleState === 'in-progress' || config.mission.lifecycleState === 'started'
              ? null
              : `transition rejected: expected 'in-progress' or 'started' got '${config.mission.lifecycleState}'`,
          sourceLabel: `Missioncraft.complete.step3-advance('${id}')`,
        },
      );

      // Step 4 (W4.4 slice ii graft): SIGTERM daemon-watcher 60s + SIGKILL fallback per v3.2
      // MEDIUM-R2.1 + MEDIUM-R2.2. Parent-CLI clears daemon-IPC fields from lockfile post-shutdown
      // (per parent-only-ownership contract per slice i).
      emit({ phase: 'daemon-sigterm', message: 'terminating daemon-watcher' });
      const termResult = await terminateDaemon(this.missionLockfilePath(id));
      if (termResult === 'terminated' || termResult === 'killed') {
        await clearDaemonIpcFields(this.missionLockfilePath(id));
      }

      // W5b slice (ii) item #3: state-machine cascade — emit terminated-tag to coord-remote so
      // mission-78 W5-new slice (ii): emitTerminatedTag DELETED (coord-remote primitive removed
      // per Design v5.0 §10.2). Reader-mission terminal-detection now via Loop B v5.0 dual
      // failure-mode auto-close (slice v.b): writer mission-config missing OR lifecycle terminal.

      // Step 6: cleanup local mission-branches (best-effort; non-aborting)
      for (let i = 0; i < initialConfig.repos.length; i++) {
        const lock = repoLocks[i];
        const handles = await this.storage.list(id);
        // v1.0.7 bug-73 fix: match by basename(path) rather than h.repoUrl. storage.list()
        // returns handles with empty repoUrl per its v1 limitation (filesystem layout preserves
        // repo-name only); URL-equality find always failed. Mirrors working pattern at :1074.
        const expectedRepoName = initialConfig.repos[i].name ?? repoNameFromUrl(initialConfig.repos[i].url);
        const handle = handles.find((h) => basename(h.path) === expectedRepoName);
        if (handle) {
          try {
            await this.gitEngine.deleteBranch(handle, `mission/${id}`, { force: true });
          } catch {
            /* best-effort; remote branch persists for PR-merge per spec */
          }
        }
        void lock;
      }

      // v1.0.6 bug-72: workspace preserved by default at terminal `complete`; --purge-workspace
      // opts-in to destroy (symmetric with abandon Step 6 substrate). The previous default-destroy
      // behavior was never operator-reachable (CLI didn't expose --retain), so flipping the
      // default to preserve is invisible to existing operator-paths.
      if (opts.purgeWorkspace) {
        // v1.0.6 bug-71-symmetry: cwd-rug-pull guard when destroying workspace.
        const workspacePath = join(this.workspaceRoot, 'missions', id);
        try {
          if (process.cwd().startsWith(workspacePath)) {
            process.chdir(join(this.workspaceRoot, 'missions'));
          }
        } catch { /* cwd-resolve failure non-aborting */ }
        await this.storage.cleanup(id);
      }

      // Step 8: --purge-config delete config + name-symlink atomically
      if (opts.purgeConfig) {
        const symlinkPath = initialConfig.mission.name
          ? join(this.missionNamesDir(), `${initialConfig.mission.name}.yaml`)
          : undefined;
        try { await unlink(this.missionConfigPath(id)); } catch { /* idempotent */ }
        if (symlinkPath) {
          try { await unlink(symlinkPath); } catch { /* idempotent */ }
        }
      }

      return this.missionConfigToState(finalConfig, this.principal);
    } finally {
      // Step 5: release locks (idempotent finally-block; runs even on partial-failure)
      for (const lock of repoLocks) {
        try { await this.storage.releaseLock(lock); } catch { /* idempotent */ }
      }
      try { await this.storage.releaseLock(missionLock); } catch { /* idempotent */ }
    }
  }

  /**
   * Per-repo publish-loop (complete() Step 2; Design v4.9 §2.4.1 v3.1+v3.3+v3.4 folds).
   *
   * Atomic across mission's repos; preserves partial state via `mission.publishStatus[<repoName>]`.
   * Idempotent retry: skips repos already at 'pr-opened'; resumes from first non-'pr-opened'.
   */
  private async runPublishLoop(
    missionId: string,
    initialConfig: MissionConfig,
    publishMessage: string,
  ): Promise<void> {
    for (const repo of initialConfig.repos) {
      const repoName = repo.name ?? repoNameFromUrl(repo.url);
      // Re-load latest publishStatus (may have advanced since we started loop)
      const currentContent = await readFile(this.missionConfigPath(missionId), 'utf8');
      const currentConfig = parseMissionConfig(currentContent, this.missionConfigPath(missionId));
      const status = currentConfig.mission.publishStatus?.[repoName];
      if (status === 'pr-opened') {
        continue;        // idempotent retry — already published
      }

      const handles = await this.storage.list(missionId);
      // v1.0.7 bug-73 fix: basename(path) match — see Step 6 cleanup-branches site for rationale.
      const handle = handles.find((h) => basename(h.path) === repoName);
      if (!handle) {
        await this.recordPublishStatus(missionId, repoName, 'failed');
        throw new MissionStateError(
          `Missioncraft.complete: workspace handle missing for repo '${repoName}'; mission cannot publish; verify start() was called`,
        );
      }

      try {
        // Squash wip-commits via gitEngine.squashCommit (W2 default per HIGH-R3.1 dispatch-chain)
        const baseRef = repo.base ?? 'main';
        const headRef = `mission/${missionId}`;
        if (typeof this.gitEngine.squashCommit === 'function') {
          await this.gitEngine.squashCommit(handle, baseRef, headRef, publishMessage);
        }
        // (No fallback path at W4.3; engine-internal-fallback shell-out per MINOR-R4.1 = W4.x follow-on)
        await this.recordPublishStatus(missionId, repoName, 'squashed');

        // Push squashed mission/<id> to upstream with network-partition retry per §2.6.3.
        // Exponential backoff: 100ms, 400ms, 1600ms (3 attempts max; ~2.1s total max delay).
        //
        // mission-78 W5-new Fix #12 (architect-dogfood-surfaced thread-548 round 13 BLOCKER):
        // **force: true** is required because slice (iii) push-cadence may have already pushed
        // the pre-squash daemon-chain mission/<id> to upstream (independent setInterval at 60s
        // default per Design v5.0 §10.2). complete()'s squashCommit then rewrites mission/<id>
        // history (single squashed commit on top of base); the subsequent push to upstream is
        // NON-FAST-FORWARD relative to the daemon-chain version. Force-push semantically: "this
        // published squash supersedes the in-progress daemon-chain". Pre-Fix-#12 (pre-slice-iii)
        // push was always FIRST push of mission/<id> upstream → fast-forward succeeded; post-
        // slice-iii push-cadence breaks that invariant under the architect's real-upstream
        // dogfood scenario (msn complete after waiting > pushIntervalSeconds).
        await this.pushWithRetry(handle, { branch: headRef, force: true });
        await this.recordPublishStatus(missionId, repoName, 'pushed');

        // Open PR via RemoteProvider (capability-gated; SKIP if not supported per F13)
        if (this.remote && this.remote.capabilities.supportsPullRequests) {
          const pr = await this.remote.openPullRequest(repo.url, {
            head: headRef,
            base: baseRef,
            title: publishMessage,
            body: `Automated mission-publish for ${missionId}`,
          });
          await this.recordPublishedPR(missionId, repoName, pr.url);
        }
        // Mark pr-opened regardless of capabilities (push-only mode also marks per spec line 1717)
        await this.recordPublishStatus(missionId, repoName, 'pr-opened');
      } catch (err) {
        await this.recordPublishStatus(missionId, repoName, 'failed');
        throw err;        // Re-throw; partial-state preserved for idempotent retry
      }
    }
  }

  /**
   * Push with network-partition retry (Design v4.9 §2.6.3 — exponential backoff).
   * 3 attempts max; backoff 100ms → 400ms → 1600ms (~2.1s total).
   *
   * W5b slice (ii) extension: accepts refspec options (url + remoteRef) for coord-remote push
   * with source-ref `refs/heads/wip/<id>` → destination-ref `refs/heads/<repo-name>/wip/<id>` per
   * MEDIUM-R6.1. Backwards-compat: string-arg form still works (origin remote default-branch push).
   */
  async pushWithRetry(
    handle: WorkspaceHandle,
    branchOrOptions: string | { branch: string; url?: string; remote?: string; remoteRef?: string; force?: boolean },
  ): Promise<void> {
    // mission-78 W5-new Fix #12.b (architect-dogfood-surfaced): `force?: boolean` added to options-
    // type. Used by complete()'s squash-publish push (Fix #12) when push-cadence has pre-pushed
    // daemon-chain to upstream. NativeGitEngine.push already handles options.force → '--force' arg;
    // type-narrowing was the only blocker. tsc-strict-build error at missioncraft.ts:714 cleared.
    // vitest+esbuild masked this (502/502 green) → calibration #76 candidate: build-gate
    // `npm run build` MUST be clean as ship-verify alongside `npm test`.
    const opts = typeof branchOrOptions === 'string' ? { branch: branchOrOptions } : branchOrOptions;
    const backoffsMs = [100, 400, 1600];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= backoffsMs.length; attempt++) {
      try {
        await this.gitEngine.push(handle, opts);
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < backoffsMs.length) {
          await new Promise((r) => setTimeout(r, backoffsMs[attempt]));
        }
      }
    }
    throw lastErr;
  }

  /** Atomic Record-key update of publishStatus[repoName] per _engineMutate primitive. */
  private async recordPublishStatus(
    missionId: string,
    repoName: string,
    status: 'pending' | 'squashed' | 'pushed' | 'pr-opened' | 'failed',
  ): Promise<void> {
    await this._engineMutate(
      missionId,
      (config) => ({
        ...config,
        mission: {
          ...config.mission,
          publishStatus: { ...(config.mission.publishStatus ?? {}), [repoName]: status },
        },
      }),
      {
        validate: (config) =>
          config.mission.lifecycleState === 'in-progress' || config.mission.lifecycleState === 'started'
            ? null
            : `publish-status update rejected: lifecycle '${config.mission.lifecycleState}' not in [in-progress, started]`,
        sourceLabel: `Missioncraft.complete.publishStatus['${repoName}']('${missionId}')`,
      },
    );
  }

  /** Atomic append to publishedPRs[] per _engineMutate primitive. */
  private async recordPublishedPR(missionId: string, repoName: string, prUrl: string): Promise<void> {
    await this._engineMutate(
      missionId,
      (config) => ({
        ...config,
        mission: {
          ...config.mission,
          publishedPRs: [...(config.mission.publishedPRs ?? []), { repoName, prUrl }],
        },
      }),
      {
        validate: (config) =>
          config.mission.lifecycleState === 'in-progress' || config.mission.lifecycleState === 'started'
            ? null
            : `publishedPRs append rejected: lifecycle '${config.mission.lifecycleState}' not in [in-progress, started]`,
        sourceLabel: `Missioncraft.complete.publishedPRs.append('${missionId}', '${repoName}')`,
      },
    );
  }

  /**
   * 8-step abandon-flow (Design v4.9 §2.4.1 lines 1739+; v3.4+v3.5+v3.6 folds).
   *
   * W4.3 LITE: implements full abandon-flow LESS daemon-flush + SIGTERM (Steps 1+2 stub-points
   * in W4.4 graft-set).
   *
   * Symmetric partial-failure recovery model with publish-flow:
   * - mission stays 'in-progress' throughout cleanup-flow (per v3.5 MEDIUM-R5.1 — reverted from v3.4)
   * - lifecycle-state advances ATOMICALLY to 'abandoned' at Step 6 single-lock-cycle (per v3.6 MINOR-R6.1)
   * - per-step progress via mission.abandonProgress field for idempotent retry
   * - per-repo cleanup via mission.abandonRepoStatus (parallel to publishStatus discipline)
   *
   * Steps:
   *   1. Final cadence-tick (W4.4 graft-set; sentinel below); mark 'tick-fired'
   *   2. SIGTERM daemon-watcher (W4.4 graft-set; sentinel below); mark 'daemon-killed'
   *   3. Atomic-write abandonMessage (immutable post-write); lifecycle STAYS 'in-progress'; mark 'message-persisted'
   *   4. Release mission-lock + repo-locks; mark 'locks-released'
   *   5. Per-repo local-branch cleanup with abandonRepoStatus per-repo state; mark 'branches-cleaned' iff ALL 'cleaned'
   *   6. Atomic single-lock-cycle: workspace handle + lifecycle 'abandoned' + abandonProgress 'workspace-handled' under SAME lock
   *   7. --purge-config: re-acquire mission-lock; delete <id>.yaml + .names/<slug>.yaml symlink; mark 'config-purged'
   *   8. Marker step (lifecycle-advance integrated into Step 6 per v3.6 MINOR-R6.1)
   *
   * Post-Step-4 dispatch signal handoff per v3.6 MEDIUM-R6.1: lockfile-based abandonInProgress
   * (Steps 2-4 window) → mission-config abandonProgress (Steps 5-8 window) — survives lockfile-delete.
   */
  async abandon(
    idOrName: string,
    message: string,
    opts: { purgeConfig?: boolean; retain?: boolean; onProgress?: ProgressCallback } = {},
  ): Promise<MissionState> {
    if (!message) {
      throw new ConfigValidationError("Missioncraft.abandon: message is required (per v3.0 Refinement #4)");
    }
    if (opts.retain && opts.purgeConfig) {
      throw new ConfigValidationError(
        "Missioncraft.abandon: --retain and --purge-config are mutually exclusive (purge implies destroy)",
      );
    }
    const id = this.resolveMissionRef(idOrName);                           // v1.0.3 bug-64 item 5

    // v1.0.6 bug-68: FSM pre-flight FIRST — no progress emitted for rejected actions.
    const path = this.missionConfigPath(id);
    if (!existsSync(path)) {
      throw new MissionStateError(`Missioncraft.abandon: mission '${id}' not found`);
    }
    const initialContent = await readFile(path, 'utf8');
    const initialConfig = parseMissionConfig(initialContent, path);
    const currentState = initialConfig.mission.lifecycleState;
    if (currentState !== 'in-progress' && currentState !== 'started') {
      throw new MissionStateError(
        `Missioncraft.abandon: requires lifecycle 'in-progress' or 'started' (current: '${currentState}')`,
      );
    }

    const emit = opts.onProgress ?? ((): void => undefined);               // v1.0.5 idea-273
    emit({ phase: 'final-tick', message: 'flushing final wip-commit + setting abandon-flag' });

    // abandonMessage immutability per v3.3 fold + symmetric with publishMessage
    const effectiveMessage = initialConfig.mission.abandonMessage ?? message;
    const messageWasOverridden = initialConfig.mission.abandonMessage !== undefined && initialConfig.mission.abandonMessage !== message;

    // First lock-cycle: Steps 1-3 (inherit + Steps 1-3 + release at Step 4).
    // SD2/SD3 follow-on (v1.0.2 slice i.5): inherit the mission-lock from start() rather than
    // acquire-fresh per Design v4.9 §2.6.5 + watcher-entry.ts comment-block invariant. Cross-
    // operation guard provided by `abandonInProgress` flag (v3.6 MEDIUM-R6.1; this exact flag
    // is set BELOW at line ~760 within this same cycle) + `_engineMutate` atomicity (W4.3).
    const inheritedHandles = await this.storage.inspectLocks({ missionId: id });
    const missionLock = inheritedHandles.find((h) => h.missionId === id);
    if (!missionLock) {
      throw new MissionStateError(
        `Missioncraft.abandon: mission-lock absent at '${this.missionLockfilePath(id)}'; ` +
          `mission may not be active (verify start() was called and lockfile not externally deleted)`,
      );
    }
    const repoLocks: LockHandle[] = [];
    try {
      for (const repo of initialConfig.repos) {
        const lock = await this.storage.acquireRepoLock(repo.url, id, { waitMs: 0 });
        repoLocks.push(lock);
      }

      // Step 1 (W4.4 slice ii graft): final cadence-tick via daemon-flush pendingTick per v3.2
      // MEDIUM-R2.1. STUB-SEMANTIC: no-op when daemon absent.
      const tickResult = await triggerDaemonFlush(this.missionLockfilePath(id), 'pendingTick');
      void tickResult;
      await this.recordAbandonProgress(id, 'tick-fired');

      // Step 2 (W4.4 slice ii graft): set lockfile.abandonInProgress = true (Steps 2-4 window
      // dispatch-signal per v3.6 MEDIUM-R6.1) THEN SIGTERM daemon. Parent clears daemon-IPC fields
      // post-shutdown (per parent-only-ownership contract).
      await updateLockfileState(this.missionLockfilePath(id), { abandonInProgress: true });
      emit({ phase: 'daemon-sigterm', message: 'terminating daemon-watcher' });
      const abandonTermResult = await terminateDaemon(this.missionLockfilePath(id));
      if (abandonTermResult === 'terminated' || abandonTermResult === 'killed') {
        await clearDaemonIpcFields(this.missionLockfilePath(id));
      }
      await this.recordAbandonProgress(id, 'daemon-killed');

      // Step 3: atomic-write abandonMessage (RMW; immutable post-write per v3.3); lifecycle STAYS 'in-progress'
      if (initialConfig.mission.abandonMessage === undefined) {
        await this._engineMutate(
          id,
          (config) => ({ ...config, mission: { ...config.mission, abandonMessage: effectiveMessage } }),
          {
            validate: (config) =>
              config.mission.lifecycleState === 'in-progress' || config.mission.lifecycleState === 'started'
                ? null
                : `transition rejected: expected 'in-progress' or 'started' got '${config.mission.lifecycleState}'`,
            sourceLabel: `Missioncraft.abandon.persist-message('${id}')`,
          },
        );
      } else if (messageWasOverridden) {
        process.stderr.write(
          `NOTE: abandon already initiated for '${id}' with message '${initialConfig.mission.abandonMessage}'; ` +
            `retry uses original message; new message arg ignored.\n`,
        );
      }
      await this.recordAbandonProgress(id, 'message-persisted');
    } finally {
      // Step 4: release locks (idempotent; lockfile-delete clears abandonInProgress flag implicitly)
      for (const lock of repoLocks) {
        try { await this.storage.releaseLock(lock); } catch { /* idempotent */ }
      }
      try { await this.storage.releaseLock(missionLock); } catch { /* idempotent */ }
    }
    await this.recordAbandonProgress(id, 'locks-released');

    emit({ phase: 'cleanup-branches', message: 'cleaning local mission-branches per repo' });
    // Step 5: per-repo local-branch cleanup (NO LOCK; post-Step-4 dispatch signal is mission-config.abandonProgress)
    let allCleaned = true;
    for (const repo of initialConfig.repos) {
      const repoName = repo.name ?? repoNameFromUrl(repo.url);
      const handles = await this.storage.list(id);
      // v1.0.7 bug-73 fix: basename(path) match — see complete()'s Step 6 site for rationale.
      const handle = handles.find((h) => basename(h.path) === repoName);
      if (handle) {
        try {
          await this.gitEngine.deleteBranch(handle, `mission/${id}`, { force: true });
          await this.recordAbandonRepoStatus(id, repoName, 'cleaned');
        } catch {
          await this.recordAbandonRepoStatus(id, repoName, 'failed');
          allCleaned = false;
          /* non-aborting per spec; idempotent retry re-attempts only failed/pending repos */
        }
      } else {
        await this.recordAbandonRepoStatus(id, repoName, 'cleaned');        // no workspace = nothing to clean
      }
    }
    if (allCleaned) {
      await this.recordAbandonProgress(id, 'branches-cleaned');
    }

    emit({ phase: 'destroy-workspace', message: opts.retain ? 'preserving workspace (--retain)' : 'destroying workspace' });
    // Step 6: atomic single-lock-cycle (v3.6 MINOR-R6.1 option-b)
    const step6Lock = await this.storage.acquireMissionLock(id, { waitMs: 0 });
    let finalConfig: MissionConfig;
    try {
      // Workspace handling (destroy default; preserve if --retain)
      if (!opts.retain) {
        // v1.0.6 bug-71: cwd-rug-pull guard. If the current process cwd is inside the workspace
        // about to be destroyed, chdir up to the parent first — otherwise `rm -rf workspace/...`
        // pulls the cwd from under us and subsequent code (or operator's shell prompt) breaks.
        // --retain branch is exempt: workspace preserved → no rug-pull risk.
        const workspacePath = join(this.workspaceRoot, 'missions', id);
        try {
          if (process.cwd().startsWith(workspacePath)) {
            process.chdir(join(this.workspaceRoot, 'missions'));
          }
        } catch { /* cwd-resolve failure non-aborting — proceed with cleanup */ }
        await this.storage.cleanup(id);
      }
      // Atomic-write lifecycle 'abandoned' + abandonProgress 'workspace-handled' under SAME lock-cycle
      finalConfig = await this._engineMutate(
        id,
        (config) => ({
          ...config,
          mission: {
            ...config.mission,
            lifecycleState: 'abandoned',
            abandonProgress: 'workspace-handled',
          },
        }),
        {
          validate: (config) =>
            config.mission.lifecycleState === 'in-progress' || config.mission.lifecycleState === 'started'
              ? null
              : `step6 atomic-advance rejected: lifecycle '${config.mission.lifecycleState}' not in [in-progress, started]`,
          sourceLabel: `Missioncraft.abandon.step6-atomic('${id}')`,
        },
      );
    } finally {
      try { await this.storage.releaseLock(step6Lock); } catch { /* idempotent */ }
    }

    // W5b slice (ii) item #3: state-machine cascade — emit terminated-tag to coord-remote.
    // mission-78 W5-new slice (ii): emitTerminatedTag DELETED (coord-remote primitive removed
    // per Design v5.0 §10.2). Reader-mission terminal-detection now via Loop B v5.0 auto-close.

    // Step 7: --purge-config delete config + symlink (separate lock-cycle; lifecycle already terminal)
    if (opts.purgeConfig) {
      const step7Lock = await this.storage.acquireMissionLock(id, { waitMs: 0 });
      try {
        const symlinkPath = initialConfig.mission.name
          ? join(this.missionNamesDir(), `${initialConfig.mission.name}.yaml`)
          : undefined;
        try { await unlink(this.missionConfigPath(id)); } catch { /* idempotent */ }
        if (symlinkPath) {
          try { await unlink(symlinkPath); } catch { /* idempotent */ }
        }
      } finally {
        try { await this.storage.releaseLock(step7Lock); } catch { /* idempotent */ }
      }
      // mark 'config-purged' transient — never observed in stable terminal state since config is deleted
    }

    // Step 8: marker step (no-op; lifecycle-advance integrated into Step 6 per v3.6 MINOR-R6.1)
    return this.missionConfigToState(finalConfig, this.principal);
  }

  /** Atomic update of abandonProgress field per _engineMutate primitive. */
  private async recordAbandonProgress(
    missionId: string,
    progress: 'tick-fired' | 'daemon-killed' | 'message-persisted' | 'locks-released' | 'branches-cleaned' | 'workspace-handled' | 'config-purged',
  ): Promise<void> {
    await this._engineMutate(
      missionId,
      (config) => ({
        ...config,
        mission: { ...config.mission, abandonProgress: progress },
      }),
      {
        validate: (config) =>
          config.mission.lifecycleState === 'in-progress' || config.mission.lifecycleState === 'started'
            ? null
            : `abandonProgress update rejected: lifecycle '${config.mission.lifecycleState}' not in [in-progress, started]`,
        sourceLabel: `Missioncraft.abandon.abandonProgress=${progress}('${missionId}')`,
      },
    );
  }

  /** Atomic Record-key update of abandonRepoStatus[repoName] per _engineMutate primitive. */
  private async recordAbandonRepoStatus(
    missionId: string,
    repoName: string,
    status: 'pending' | 'cleaned' | 'failed',
  ): Promise<void> {
    await this._engineMutate(
      missionId,
      (config) => ({
        ...config,
        mission: {
          ...config.mission,
          abandonRepoStatus: { ...(config.mission.abandonRepoStatus ?? {}), [repoName]: status },
        },
      }),
      {
        validate: (config) =>
          config.mission.lifecycleState === 'in-progress' || config.mission.lifecycleState === 'started'
            ? null
            : `abandonRepoStatus update rejected: lifecycle '${config.mission.lifecycleState}' not in [in-progress, started]`,
        sourceLabel: `Missioncraft.abandon.abandonRepoStatus['${repoName}']('${missionId}')`,
      },
    );
  }

  /**
   * mission-78 W6-new slice (v): `mc.tick()` SDK method DELETED entirely (verb DROPPED per
   * Design v5.0 §10.6 perfection-grade revisions; was unimplemented + W5-new pushCadence/
   * pullCadence subsume the cadence-tick semantic at substrate-level).
   */

  /**
   * Resolve workspace filesystem-path for a mission-id or substrate-coordinate (Design v4.9 §2.3
   * Rule 7 + W5c MEDIUM-R8.1 substrate-coordinate runtime-resolution per idea-265).
   *
   * Forms:
   *   - `<mission-id>` + optional `<repoName>` arg: returns workspace path for the named repo
   *     (or first repo if mission has only one + repoName omitted).
   *   - `<mission-id>:<repo>[/<path>]` (Rule 7 coordinate; gsutil-style): parsed via
   *     `parseSubstrateCoordinate`; workspace + optional path-suffix appended.
   *
   * Errors:
   *   - mission not found → MissionStateError
   *   - coordinate's repo not in mission's repos[] → MissionStateError
   *   - mission has multiple repos AND idOrCoordinate is plain id AND repoName omitted → ConfigValidationError
   */
  async workspace(idOrCoordinate: string, repoName?: string): Promise<string> {
    if (!idOrCoordinate) {
      throw new ConfigValidationError('Missioncraft.workspace: idOrCoordinate is required');
    }
    const { parseSubstrateCoordinate } = await import('./coordinate.js');
    const coord = parseSubstrateCoordinate(idOrCoordinate);
    // v1.0.3 bug-64 item 5: resolve id-or-name uniformly (coordinate-form embeds the mission ref
    // at coord.mission; non-coordinate form is the raw arg). Post-resolve we have the canonical id.
    const missionId = this.resolveMissionRef(coord ? coord.mission : idOrCoordinate);
    const path = this.missionConfigPath(missionId);
    if (!existsSync(path)) {
      throw new MissionStateError(`Missioncraft.workspace: mission '${missionId}' not found at '${path}'`);
    }
    const content = await readFile(path, 'utf8');
    const config = parseMissionConfig(content, path, 'auto');

    // idea-268 (v1.0.3 slice vi): terminal-state-guard. Pre-fix, `workspace` returned the
    // resolved path regardless of mission lifecycle — if the mission was abandoned/completed
    // (workspace destroyed by cleanup), the path was stale and `cd <path>` would fail with a
    // cryptic shell error. Fast-path: lifecycle-check terminal states + emit clear diagnostic.
    const lifecycle = config.mission.lifecycleState;
    if (lifecycle === 'abandoned' || lifecycle === 'completed') {
      throw new MissionStateError(
        `Missioncraft.workspace: workspace destroyed; mission '${missionId}' in terminal state '${lifecycle}'`,
      );
    }

    // Resolve target repo: coordinate.repo > repoName arg > unique repo
    const targetRepoName = coord?.repo ?? repoName ?? (config.repos.length === 1
      ? (config.repos[0].name ?? repoNameFromUrl(config.repos[0].url))
      : undefined);

    if (!targetRepoName) {
      throw new ConfigValidationError(
        `Missioncraft.workspace: mission '${missionId}' has ${config.repos.length} repos; ` +
          `repoName arg required (or use coordinate-form '<id>:<repo>')`,
      );
    }

    const targetRepo = config.repos.find((r) => (r.name ?? repoNameFromUrl(r.url)) === targetRepoName);
    if (!targetRepo) {
      throw new MissionStateError(
        `Missioncraft.workspace: repo '${targetRepoName}' not in mission '${missionId}' repos[]`,
      );
    }

    // idea-268 (v1.0.3 slice vi): use READ-ONLY storage.list (no mkdir side-effect) to find an
    // EXISTING workspace handle. Pre-fix `workspace` called storage.allocate which create-on-
    // demand'd the directory — returning a stale path that didn't represent reality post-cleanup
    // OR pre-start. Post-fix: safety-net catches non-terminal-but-missing-workspace.
    //
    // Match by repo-name (extracted from path basename) since storage.list returns repoUrl=''
    // (filesystem layout doesn't preserve original URLs; only repo-names per v4.10 PATCH item #9).
    const handles = await this.storage.list(missionId);
    const targetHandle = handles.find((h) => basename(h.path) === targetRepoName);
    if (!targetHandle) {
      throw new MissionStateError(
        `Missioncraft.workspace: workspace not found for repo '${targetRepoName}' in mission '${missionId}' (try 'msn start' to re-create)`,
      );
    }
    return coord?.path ? join(targetHandle.path, coord.path) : targetHandle.path;
  }

  /**
   * Snapshot a mission's daemon-watched branch into the snapshotRoot bundle (Design v4.9 §2.6.2
   * v0.4 §AAA; W6 slice (v) Director (Y); v5.0 single-branch refactor at mission-78 W3-new).
   * Called best-effort post daemon-commit-to-mission-branch; preserves disk-failure recovery substrate.
   * Bundle path: `<snapshotRoot>/<missionId>/<repoName>/<sha>.bundle`.
   *
   * Method retains its W6-era name (`snapshotWipBranches`) for API backward-compat through v1.x;
   * under v5.0 single-branch architecture the snapshotted ref is `refs/heads/mission/<id>` (not
   * `refs/heads/wip/<id>` as in pre-v5.0). Future rename to `snapshotMissionBranches` at W8-new
   * closing-audit OR via standalone idea-filing post-v1.2.0 ship.
   *
   * Conditional gating: returns 0 IF gitEngine doesn't implement createBundle (capability-gated
   * per F13). Per-repo failure non-aborting; returns count of successful bundle-creates.
   */
  async snapshotWipBranches(missionId: string): Promise<number> {
    if (typeof this.gitEngine.createBundle !== 'function') return 0;     // capability-gated
    const path = this.missionConfigPath(missionId);
    if (!existsSync(path)) return 0;
    const content = await readFile(path, 'utf8');
    const config = parseMissionConfig(content, path, 'auto');

    const { resolveSnapshotRoot, ensureSnapshotRepoDir, snapshotBundlePath } =
      await import('./snapshot.js');
    const snapshotRoot = resolveSnapshotRoot(this.workspaceRoot, config.stateDurability?.snapshotRoot);

    // v5.0 single-branch: daemon commits to mission-branch directly; snapshot the same.
    const missionRef = `refs/heads/mission/${missionId}`;
    let successCount = 0;
    for (const repo of config.repos) {
      const repoName = repo.name ?? repoNameFromUrl(repo.url);
      const handle = await this.storage.allocate(missionId, repo.url);
      try {
        // Resolve current SHA of mission-ref (skip if doesn't exist yet)
        const sha = await this.gitEngine.revparse(handle, missionRef).catch(() => null);
        if (!sha) continue;
        await ensureSnapshotRepoDir(snapshotRoot, missionId, repoName);
        const bundlePath = snapshotBundlePath(snapshotRoot, missionId, repoName, sha);
        if (existsSync(bundlePath)) {
          successCount++;     // already-snapshotted at this SHA; idempotent
          continue;
        }
        await this.gitEngine.createBundle(handle, bundlePath, missionRef);
        successCount++;
      } catch {
        // Per-repo bundle-create failure non-aborting; next snapshot-cycle retries
      }
    }
    return successCount;
  }

  /**
   * Restore a mission from snapshotRoot bundles after disk-failure (`rm -rf workspaceRoot`
   * recovery scenario per Design v4.9 §2.6.2 + W6 slice (v) Director (Y)).
   *
   * For each repo: locates latest-mtime bundle in `<snapshotRoot>/<missionId>/<repoName>/`,
   * re-allocates workspace via storage.allocate (init's a fresh git-dir), then restoreBundle
   * unbundles + updates the mission-ref (v5.0 single-branch; was wip-ref pre-v5.0).
   * Capability-gated per F13.
   *
   * Returns count of repos successfully restored. Per-repo failure non-aborting (mission-level
   * partial-recovery preserved per W5b publishStatus discipline).
   */
  async restoreFromSnapshot(missionId: string): Promise<number> {
    if (typeof this.gitEngine.restoreBundle !== 'function') return 0;
    const path = this.missionConfigPath(missionId);
    if (!existsSync(path)) {
      // Mission-config also gone; full-recovery would require config-mirror restore (separate concern)
      return 0;
    }
    const content = await readFile(path, 'utf8');
    const config = parseMissionConfig(content, path, 'auto');

    const { resolveSnapshotRoot, findLatestBundle } = await import('./snapshot.js');
    const snapshotRoot = resolveSnapshotRoot(this.workspaceRoot, config.stateDurability?.snapshotRoot);

    // v5.0 single-branch: restore unbundles into mission-ref (was wip-ref pre-v5.0)
    const missionRef = `refs/heads/mission/${missionId}`;
    let successCount = 0;
    for (const repo of config.repos) {
      const repoName = repo.name ?? repoNameFromUrl(repo.url);
      try {
        const latestBundle = await findLatestBundle(snapshotRoot, missionId, repoName);
        if (!latestBundle) continue;
        const handle = await this.storage.allocate(missionId, repo.url);
        // Initialize git-dir if not already (storage.allocate creates the dir; gitEngine.init populates .git)
        if (!existsSync(`${handle.path}/.git`)) {
          await this.gitEngine.init(handle, { fs: undefined, identity: await this.identity.resolve() });
        }
        await this.gitEngine.restoreBundle(handle, latestBundle, missionRef);
        successCount++;
      } catch {
        // Per-repo restore failure non-aborting
      }
    }
    return successCount;
  }

  /**
   * Writer-daemon push-cadence — push `refs/heads/mission/<id>` to upstream per repo
   * (mission-78 W5-new slice (iii); Design v5.0 §10.2 symmetric push/pull cadence).
   *
   * Invoked by daemon-watcher's setInterval timer at `pushIntervalSeconds` cadence WHEN
   * `pushCadence === 'every-Ns'` (default). Independent of chokidar debounce — fires regardless
   * of working-tree activity (per (β) disposition thread-548 round 5; Design v5.0 §10.5
   * 2x-readers-per-write rate). Idempotent no-op push if mission-branch already up-to-date on
   * upstream (cheap — `git push` returns immediately).
   *
   * Per-repo failure non-aborting (uses pushWithRetry's exponential backoff 100ms→400ms→1600ms;
   * 3 attempts). No-op for reader-missions (readOnly === true) since they have no mission-branch
   * to push. Returns count of repos with successful push.
   *
   * GAP-2 from W4-new architect-dogfood (BRANCH-TRACKER reader pre-publish failure) is naturally
   * resolved by this method: mission-branch on upstream within ≤pushIntervalSeconds (default 60s)
   * post-mission-creation; BRANCH-TRACKER reader can join writer-in-progress without `msn complete`
   * prerequisite.
   */
  async pushMissionBranchToUpstream(missionId: string): Promise<number> {
    const path = this.missionConfigPath(missionId);
    if (!existsSync(path)) return 0;
    const content = await readFile(path, 'utf8');
    const config = parseMissionConfig(content, path, 'auto');

    // Reader-mission has no mission-branch to push (Loop B v5.0 fetches from upstream instead).
    if (config.mission.readOnly === true) return 0;
    // Mission must have at least 1 repo + non-terminal lifecycle to be push-target-active.
    if (config.repos.length === 0) return 0;
    const lifecycle = config.mission.lifecycleState;
    if (lifecycle === 'completed' || lifecycle === 'abandoned') return 0;

    const missionRef = `refs/heads/mission/${missionId}`;
    let successCount = 0;
    for (const repo of config.repos) {
      const repoName = repo.name ?? repoNameFromUrl(repo.url);
      try {
        const handle = await this.storage.allocate(missionId, repo.url);
        // Push to repo's `origin` remote (configured at mc.start clone-step) with refspec
        // mission/<id>:mission/<id> (push local mission-branch to upstream same name).
        await this.pushWithRetry(handle, {
          branch: missionRef,
          remote: 'origin',
          remoteRef: missionRef,
        });
        successCount++;
      } catch {
        // Per-repo push failure non-aborting; next push-cadence tick retries (idempotent
        // no-op when mission-branch already at upstream tip).
        void repoName;
      }
    }
    return successCount;
  }

  /**
   * Reader-daemon Loop B v5.0 — direct fetch+reset against source-remote+source-branch
   * (mission-78 W4-new slice (v); Design v5.0 §2 row 4 + task-408 §6 component-change 5).
   *
   * v5.0 reader-mission (BRANCH-TRACKER or PERSISTENT-TRACKER) per-tick:
   *   1. Read mission config; require `readOnly: true`; resolve sourceRemote+sourceBranch
   *      (PERSISTENT-TRACKER: explicit config fields; BRANCH-TRACKER: derive from writer-mission
   *      lookup via sourceMissionId → writer.repos[0].url + `refs/heads/mission/<writer-id>`)
   *   2. For each repo-workspace: `git fetch source-remote source-branch:refs/remotes/source/source-branch`
   *   3. `git reset --hard refs/remotes/source/source-branch` — sync working-tree to source-tip
   *
   * Returns count of repos successfully synced (0 on no-op or all-failed; per-repo failure
   * non-aborting; next tick retries).
   *
   * Auto-close on writer-terminal (BRANCH-TRACKER): fetch-not-found OR branch-tip-stale-detection
   * deferred to slice-(v) extension OR follow-on idea — slice (v) core is fetch+reset; auto-close
   * polish post-architect-disposition.
   *
   * No-op for writer-missions (readOnly false/undefined) — daemon-watcher's writer-mode dispatch
   * runs Loop A (chokidar) instead of this method.
   */
  async readerLoopBV5Tick(missionId: string): Promise<number> {
    const path = this.missionConfigPath(missionId);
    if (!existsSync(path)) return 0;
    const content = await readFile(path, 'utf8');
    const config = parseMissionConfig(content, path, 'auto');

    if (config.mission.readOnly !== true) return 0;        // writer-mission — Loop B no-op

    // Resolve source-remote + source-branch per reader-flavor.
    // mission-78 W4-new slice (v.b) auto-close mechanics: BRANCH-TRACKER detects writer-terminal
    // via 2 paths — (1) writer mission-config gone OR (2) writer lifecycle in terminal-states.
    // Both surface as ReaderAutoCloseError → watcher-entry catches → atomic lifecycle advance
    // to 'abandoned' + SIGTERM-self. PERSISTENT-TRACKER has no writer-mission lookup; its
    // auto-close path is via fetch-failure ("branch not found" upstream).
    let sourceRemote: string;
    let sourceBranch: string;
    if (config.mission.sourceRemote !== undefined && config.mission.sourceBranch !== undefined) {
      // PERSISTENT-TRACKER (msn watch): explicit source-remote + source-branch in config
      sourceRemote = config.mission.sourceRemote;
      sourceBranch = config.mission.sourceBranch;
    } else if (config.mission.sourceMissionId !== undefined) {
      // BRANCH-TRACKER (msn join): resolve writer-mission's first-repo URL +
      // `refs/heads/mission/<writer-id>` (v5.0 single-branch architecture).
      // mission-78 W4-new slice (v.b) auto-close: writer mission-config missing OR terminal →
      // ReaderAutoCloseError (failure-mode 2 + writer-local-terminal detection).
      const writerPath = this.missionConfigPath(config.mission.sourceMissionId);
      if (!existsSync(writerPath)) {
        throw new ReaderAutoCloseError(
          `BRANCH-TRACKER reader '${missionId}' auto-close: writer-mission '${config.mission.sourceMissionId}' config-file missing`,
        );
      }
      const writerContent = await readFile(writerPath, 'utf8');
      const writerConfig = parseMissionConfig(writerContent, writerPath, 'auto');
      const writerLifecycle = writerConfig.mission.lifecycleState;
      if (writerLifecycle === 'completed' || writerLifecycle === 'abandoned') {
        throw new ReaderAutoCloseError(
          `BRANCH-TRACKER reader '${missionId}' auto-close: writer-mission '${config.mission.sourceMissionId}' is terminal (${writerLifecycle})`,
        );
      }
      if (writerConfig.repos.length === 0) return 0;       // writer has no repos
      sourceRemote = writerConfig.repos[0].url;
      sourceBranch = `mission/${config.mission.sourceMissionId}`;
    } else {
      return 0;                                              // schema invariant violation; should not reach
    }

    let successCount = 0;
    for (const repo of config.repos) {
      const repoName = repo.name ?? repoNameFromUrl(repo.url);
      try {
        const handles = await this.storage.list(missionId);
        const handle = handles.find((h) => basename(h.path) === repoName);
        if (!handle) continue;                              // workspace not allocated yet — skip
        // mission-78 W4-new slice (v.b): chmod-up workspace BEFORE fetch+reset (working-tree
        // needs write-permission for `git reset --hard` to update files). chmod-down AFTER
        // sync per slice (v.b) workspace-0444 invariant. .git/ tree excluded from chmod
        // (engine-internal sync needs write throughout).
        const { setReaderWorkspaceMode, setReaderWorkspaceWritable } = await import('./reader-workspace-mode.js');
        let chmodUpApplied = false;
        try {
          await setReaderWorkspaceWritable(handle.path);
          chmodUpApplied = true;
          // git fetch source-remote source-branch:refs/remotes/source/source-branch
          await this.gitEngine.fetch(handle, {
            remote: sourceRemote,
            branch: `${sourceBranch}:refs/remotes/source/source-branch`,
          });
          // git reset --hard refs/remotes/source/source-branch — sync working-tree to source-tip.
          // GitEngine doesn't expose reset directly; shell out via gitExec helper if NativeEng,
          // else fall back to checkout. Use a private helper to keep engine-pluggable surface clean.
          await this.gitResetHard(handle, 'refs/remotes/source/source-branch');
          successCount++;
        } finally {
          // chmod-down ALWAYS — even on fetch/reset failure (preserves 0444 invariant; best-effort)
          if (chmodUpApplied) {
            try { await setReaderWorkspaceMode(handle.path); } catch { /* best-effort */ }
          }
        }
      } catch {
        // Per-repo fetch+reset failure non-aborting; next tick retries
      }
    }
    return successCount;
  }

  /**
   * Reader-mission auto-abandon path — daemon-side atomic lifecycle advance to 'abandoned' when
   * Loop B detects writer-terminal (mission-78 W4-new slice (v.b) auto-close mechanics).
   *
   * Daemon-side mutation (not CLI-side abandon flow): just advances lifecycle to 'abandoned' +
   * writes abandonMessage; lock-cleanup left to operator's subsequent `msn list` discovery + any
   * cleanup pass. Watcher-entry calls this when ReaderAutoCloseError surfaces from Loop B, then
   * SIGTERMs self.
   *
   * Idempotent: if mission already in terminal state, no-ops without error.
   */
  async readerAutoAbandon(missionId: string, reason: string): Promise<void> {
    const path = this.missionConfigPath(missionId);
    if (!existsSync(path)) return;
    try {
      await this._engineMutate(
        missionId,
        (config) => ({
          ...config,
          mission: {
            ...config.mission,
            lifecycleState: 'abandoned' as MissionStatePhase,
            abandonMessage: config.mission.abandonMessage ?? reason,
          },
        }),
        {
          validate: (config) => {
            const state = config.mission.lifecycleState;
            if (state === 'completed' || state === 'abandoned') {
              return `already-terminal: lifecycle '${state}'`;
            }
            return null;
          },
          sourceLabel: `Missioncraft.readerAutoAbandon('${missionId}')`,
          role: 'auto',
        },
      );
    } catch {
      // Idempotent on already-terminal: validate-rejection swallowed (mission already auto-closed).
    }
  }

  /**
   * Internal helper: `git reset --hard <ref>` via direct execFile (substrate-bypass; GitEngine
   * pluggable contract doesn't expose reset at v1 per `reset/diff/lsRemote` deferred-idea filing).
   * Used by readerLoopBV5Tick to sync working-tree to source-branch tip.
   *
   * Native git CLI is hard-dep per Path D2; this helper is engine-agnostic shell-out.
   */
  private async gitResetHard(workspace: WorkspaceHandle, ref: string): Promise<void> {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    await execFileAsync('git', ['reset', '--hard', ref], { cwd: workspace.path });
  }


  /**
   * Daemon-tick lifecycle advance: `'started' → 'in-progress'` (Design v4.9 §2.4.1 line 1505).
   *
   * Invoked by daemon-watcher's first-tick to fire the daemon-driven advance per state-machine
   * table ("operator does work" = daemon-tick = THIS code-path). Routes through `_engineMutate`
   * to preserve validate→apply→atomic-write abstraction discipline.
   *
   * Idempotent: returns silently if lifecycle is not 'started' (already advanced OR not yet there).
   */
  async daemonTickAdvance(missionId: string): Promise<void> {
    try {
      await this._engineMutate(
        missionId,
        (config) => ({ ...config, mission: { ...config.mission, lifecycleState: 'in-progress' } }),
        {
          validate: (config) =>
            config.mission.lifecycleState === 'started'
              ? null
              : `daemon-tick advance skipped: lifecycle '${config.mission.lifecycleState}' (only 'started' triggers advance)`,
          sourceLabel: `Missioncraft.daemonTickAdvance('${missionId}')`,
        },
      );
    } catch {
      // Idempotent best-effort: skip on validation-failure (already advanced OR not at 'started')
    }
  }

  // ─── Multi-participant verbs (W5b slice (i) — runtime impl) ───
  //
  // v4.x mc.join SDK method was DELETED at v1.2.0 W7-new slice (ii). v5.0 reader-mission creation
  // flows are `msn join <writer-mission-id>` (BRANCH-TRACKER) + `msn watch --repo --branch`
  // (PERSISTENT-TRACKER); both go through `mc.create('mission', ...)` with `readOnly: true` +
  // reader-flavor fields per W4-new.

  /**
   * Reader-side disengagement (Design v4.9 §2.4.1.v4 leave-flow; lifecycle 'reading' → 'leaving').
   *
   * W5b slice (i): atomic 'leaving' transition + optional workspace cleanup + config-purge on
   * `--purge-workspace` (terminal-removed semantic per FSM `leave-complete`).
   *
   * Steps:
   *   1. Validate inputs; resolve current-principal
   *   2. Acquire mission-lock
   *   3. Atomic-write 'leaving' via _engineMutate (idempotent on already 'leaving')
   *   4. (--purge-workspace) chmod-up via setReaderWorkspaceWritable + storage.cleanup + unlink config
   */
  async leave(idOrName: string, opts?: { purgeWorkspace?: boolean }): Promise<void> {
    if (!idOrName) {
      throw new ConfigValidationError("Missioncraft.leave: mission-id is required");
    }
    const id = this.resolveMissionRef(idOrName);                           // v1.0.3 bug-64 item 5
    const { resolveCurrentPrincipal } = await import('./principal-resolution.js');
    const currentPrincipal = await resolveCurrentPrincipal({
      constructorPrincipal: this.principal,
      identity: this.identity,
    });
    void currentPrincipal;

    const path = this.missionConfigPath(id);
    if (!existsSync(path)) {
      throw new MissionStateError(`Missioncraft.leave: mission '${id}' not found at '${path}'`);
    }

    // Pre-flight read with role='auto' so writer-state mission produces the read-only-participant
    // rejection message rather than a parse-validation-fail (HIGH-R2.3 boundary preserved).
    const preflightContent = await readFile(path, 'utf8');
    const preflightConfig = parseMissionConfig(preflightContent, path, 'auto');
    const preflightState = preflightConfig.mission.lifecycleState;
    if (preflightState !== 'reading' && preflightState !== 'joined' && preflightState !== 'leaving') {
      throw new MissionStateError(
        `Missioncraft.leave: lifecycle '${preflightState}' not in [reading, joined, leaving] ` +
          `(read-only participant per HIGH-R2.3)`,
      );
    }

    const missionLock = await this.storage.acquireMissionLock(id, { waitMs: 0 });
    try {
      // Step 3: atomic-write 'leaving' (per FSM 'reading' → 'leaving' via leave-begin event)
      await this._engineMutate(
        id,
        (cfg) => ({ ...cfg, mission: { ...cfg.mission, lifecycleState: 'leaving' } }),
        {
          validate: (cfg) => {
            const s = cfg.mission.lifecycleState;
            if (s === 'leaving') return null;     // idempotent-retry
            if (s === 'reading') return null;
            if (s === 'joined') return null;      // recovery-path: leave from transient 'joined' allowed
            return `leave rejected: lifecycle '${s}' not in [reading, joined, leaving] ` +
              `(read-only participant per HIGH-R2.3)`;
          },
          sourceLabel: `Missioncraft.leave('${id}')`,
          role: 'reader',
        },
      );

      // Step 4: --purge-workspace cleanup (terminal-removed per FSM leave-complete)
      if (opts?.purgeWorkspace) {
        const { setReaderWorkspaceWritable } = await import('./reader-workspace-mode.js');
        const handles = await this.storage.list(id);
        for (const h of handles) {
          try { await setReaderWorkspaceWritable(h.path); } catch { /* best-effort */ }
        }
        await this.storage.cleanup(id);
        try { await unlink(path); } catch { /* idempotent */ }
      }
    } finally {
      try { await this.storage.releaseLock(missionLock); } catch { /* idempotent */ }
    }
  }

  // ─── Operator-config (key-value namespace) ───

  async configGet(key: string): Promise<string | undefined> {
    const config = await this.loadOperatorConfig();
    return getNestedValue(config as Record<string, unknown>, key);
  }

  async configSet(key: string, value: string): Promise<void> {
    const operatorConfigPath = join(this.workspaceRoot, 'operator.yaml');
    let raw: Record<string, unknown> = {};
    if (existsSync(operatorConfigPath)) {
      const content = await readFile(operatorConfigPath, 'utf8');
      const parsed = (await import('yaml')).parse(content);
      raw = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } else {
      raw = { 'operator-config-schema-version': 1 };
    }
    setNestedValue(raw, key, value);
    // Validate via OperatorConfigSchema (kebab→camelCase pre-parse)
    const camelCased = kebabToCamelObject(raw);
    try {
      OperatorConfigSchema.parse(camelCased);
    } catch (err) {
      throw new ConfigValidationError(
        `Missioncraft.configSet('${key}', ...): OperatorConfigSchema validation failed — ${err instanceof Error ? err.message : 'unknown'}`,
        { cause: err instanceof Error ? err : undefined },
      );
    }
    // Atomic-write (write-temp + rename) per MEDIUM-11
    const tmp = `${operatorConfigPath}.${process.pid}.tmp`;
    await mkdir(this.workspaceRoot, { recursive: true });
    await writeFile(tmp, yamlStringify(raw), 'utf8');
    const { rename } = await import('node:fs/promises');
    await rename(tmp, operatorConfigPath);
  }

  // ─── Static helpers ───

  /**
   * v1.6 fold per MINOR-R5.3 — Adapter implementer uses at MCP-tool-list-time.
   * v1 supports Linux + macOS only (POSIX symlink + O_EXCL mechanism); Windows deferred per v1.5 fold MEDIUM-R4.1.
   */
  static isPlatformSupported(): boolean {
    return platform() !== 'win32';
  }

  // ─── Internal helpers (private; W3 implementations of universal verbs) ───

  private missionConfigPath(id: string): string {
    // v1.0.5 idea-271: layout consolidation — mission YAMLs now live under config/missions/
    return join(this.workspaceRoot, 'config', 'missions', `${id}.yaml`);
  }

  /** v1.0.5 idea-271: mission name-symlink directory. */
  private missionNamesDir(): string {
    return join(this.workspaceRoot, 'config', 'missions', '.names');
  }

  /** Mission-lockfile path per Design v4.9 §2.4 + §2.6.5; same path used for lock-acquisition + daemon-IPC. */
  private missionLockfilePath(id: string): string {
    return join(this.workspaceRoot, 'locks', 'missions', `${id}.lock`);
  }

  private scopeConfigPath(id: string): string {
    // v1.0.5 idea-271: layout consolidation — scope YAMLs now live under config/scopes/
    return join(this.workspaceRoot, 'config', 'scopes', `${id}.yaml`);
  }

  /** v1.0.5 idea-271: scope name-symlink directory. */
  private scopeNamesDir(): string {
    return join(this.workspaceRoot, 'config', 'scopes', '.names');
  }

  /**
   * Resolve a mission ref (id OR human-readable name) to its canonical id.
   *
   * v1.0.3 bug-64 item 5 fix: lifts CLI help-text's `<id|name>` promise into the SDK substrate
   * so every method taking a mission ref (show/start/abandon/complete/workspace/update/tick/join/leave)
   * resolves uniformly. Pre-fix the `.names/<name>.yaml` symlink existed (written by createMission)
   * but no method ever READ it — leading to "mission not found: 'test-readonly'" despite the
   * symlink being in place.
   *
   * Strategy:
   *   1. If `<workspaceRoot>/config/<idOrName>.yaml` exists → idOrName is already the id; return.
   *   2. Else if `<workspaceRoot>/config/.names/<idOrName>.yaml` (symlink) exists → realpath-resolve
   *      to `<id>.yaml`; return basename minus `.yaml`.
   *   3. Else throw MissionStateError with both paths in the message (LLM-discoverable diagnostic).
   *
   * Returns the canonical id (never the name).
   */
  private resolveMissionRef(idOrName: string): string {
    const directPath = this.missionConfigPath(idOrName);
    if (existsSync(directPath)) return idOrName;
    const symlinkPath = join(this.missionNamesDir(), `${idOrName}.yaml`);
    if (existsSync(symlinkPath)) {
      try {
        return basename(realpathSync(symlinkPath), '.yaml');
      } catch { /* fall through to throw */ }
    }
    // v1.0.4 bug-66 item 8: concise error; no filesystem-path leaks (debug-mode follow-on for full
    // diagnostic — `MSN_DEBUG=1` env-var route deferred until/unless substantive scope).
    throw new MissionStateError(
      process.env.MSN_DEBUG
        ? `mission '${idOrName}' not found (no config at '${directPath}' or name-symlink at '${symlinkPath}')`
        : `mission '${idOrName}' not found`,
    );
  }

  /** Resolve a scope ref (id OR human-readable name) to its canonical id. Symmetric with resolveMissionRef. */
  private resolveScopeRef(idOrName: string): string {
    const directPath = this.scopeConfigPath(idOrName);
    if (existsSync(directPath)) return idOrName;
    const symlinkPath = join(this.scopeNamesDir(), `${idOrName}.yaml`);
    if (existsSync(symlinkPath)) {
      try {
        return basename(realpathSync(symlinkPath), '.yaml');
      } catch { /* fall through to throw */ }
    }
    // v1.0.4 bug-66 item 8: concise error; no filesystem-path leaks (MSN_DEBUG=1 for full diag).
    throw new MissionStateError(
      process.env.MSN_DEBUG
        ? `scope '${idOrName}' not found (no config at '${directPath}' or name-symlink at '${symlinkPath}')`
        : `scope '${idOrName}' not found`,
    );
  }

  private async createMission(opts: ResourceMap['mission']['createOpts'] = {}): Promise<MissionHandle> {
    // mission-78 W6-new slice (iv) (Design v5.0 §10.6 perfection-grade revision (d)): SDK-side
    // slug-validation guard per (c) audit+SDK-defense disposition. Defense-in-depth at SDK layer
    // so non-CLI consumers (Hub-MCP via idea-291 future + direct API users) get the same
    // parser-level validation as CLI parse-time check. CLI parser ALSO validates at parse-time
    // for early-error operator-DX; SDK validation is the back-stop.
    if (opts.name !== undefined) {
      const { validateSlugAtSdk } = await import('./slug-validation.js');
      const err = validateSlugAtSdk(opts.name);
      if (err) {
        throw new ConfigValidationError(`mc.create('mission'): slug-format: ${err}`);
      }
    }

    const id = generateMissionId();
    const now = new Date();

    // v1.0.6 bug-70: eager-inline scope expansion. When opts.scope set, the scope acts as a
    // TEMPLATE at attach-time: repos[] are COPIED into mission YAML + scopeId persisted as metadata.
    // Combination with explicit opts.repo rejected at CLI level for unambiguous attach-semantics.
    let scopeBoundRepos: RepoSpec[] | null = null;
    let resolvedScopeId: string | undefined;
    if (opts.scope !== undefined && opts.scope !== '') {
      resolvedScopeId = this.resolveScopeRef(opts.scope);
      const scopePath = this.scopeConfigPath(resolvedScopeId);
      if (!existsSync(scopePath)) {
        throw new MissionStateError(`scope '${opts.scope}' not found`);
      }
      const scopeContent = await readFile(scopePath, 'utf8');
      const { parse: yamlParse } = await import('yaml');
      const scopeRaw = yamlParse(scopeContent);
      const scopeCamel = kebabToCamelObject(scopeRaw);
      const scopeConfig = ScopeConfigSchema.parse(scopeCamel);
      scopeBoundRepos = scopeConfig.repos.map((r) => ({ ...r }));
    }

    // mission-78 W4-new slice (iii): BRANCH-TRACKER reader scope-inheritance — when readOnly +
    // sourceMissionId AND no explicit opts.repo, copy writer-mission's repos[] (scope-inheritance
    // per task-408 §6 component-change 6; multi-repo at slice (vi)). Reject with clear error if
    // writer-mission doesn't exist. CLI accepts id-OR-name for `msn join <writer-mission-id>`;
    // resolveMissionRef normalizes name→canonical-id so the persisted sourceMissionId matches
    // schema's msn-<8hex> regex.
    let writerInheritedRepos: RepoSpec[] | null = null;
    let resolvedSourceMissionId: string | undefined = opts.sourceMissionId;
    if (opts.readOnly === true && opts.sourceMissionId !== undefined) {
      try {
        resolvedSourceMissionId = this.resolveMissionRef(opts.sourceMissionId);
      } catch {
        throw new MissionStateError(
          `writer-mission '${opts.sourceMissionId}' not found; cannot create BRANCH-TRACKER reader-mission`,
        );
      }
      if (opts.repo === undefined) {
        const writerPath = this.missionConfigPath(resolvedSourceMissionId);
        const writerContent = await readFile(writerPath, 'utf8');
        const writerConfig = parseMissionConfig(writerContent, writerPath, 'auto');
        // Inherit writer's repos[] verbatim (reader-mission is read-only; same upstream URL set)
        writerInheritedRepos = writerConfig.repos.map((r) => ({ ...r }));
      }
    }

    const repos: RepoSpec[] = scopeBoundRepos ?? writerInheritedRepos ?? (
      opts.repo
        ? (Array.isArray(opts.repo) ? opts.repo : [opts.repo]).map((url) => ({ url, name: repoNameFromUrl(url) }))
        : []
    );

    // mission-78 W4-new (Design v5.0 §2 row 4): reader-mission detection.
    // PERSISTENT-TRACKER (msn watch): readOnly=true + sourceRemote + sourceBranch (no sourceMissionId)
    // BRANCH-TRACKER (msn join):       readOnly=true + sourceMissionId (no sourceRemote/Branch)
    // Validation rejects writer-with-readOnly + reader-without-source + partial-source per schema.
    const isReaderMission = opts.readOnly === true;
    // Reader-mission's initial lifecycle is 'joined' (reader-state); writer-mission's is 'created'
    // (no repos) or 'configured' (with repos). MissionStatePhaseSchema.default('created') would
    // override our explicit 'joined' for reader-missions — set explicitly.
    const initialLifecycle: MissionStatePhase = isReaderMission
      ? 'joined'
      : (repos.length === 0 ? 'created' : 'configured');

    const config: MissionConfig = {
      missionConfigSchemaVersion: 2,
      mission: {
        id,
        ...(opts.name !== undefined && { name: opts.name }),
        ...(resolvedScopeId !== undefined && { scopeId: resolvedScopeId }),
        lifecycleState: initialLifecycle,
        createdAt: now,
        ...(isReaderMission && { readOnly: true }),
        ...(resolvedSourceMissionId !== undefined && { sourceMissionId: resolvedSourceMissionId }),
        ...(opts.sourceRemote !== undefined && { sourceRemote: opts.sourceRemote }),
        ...(opts.sourceBranch !== undefined && { sourceBranch: opts.sourceBranch }),
      },
      repos,
    };
    await mkdir(join(this.workspaceRoot, 'config', 'missions'), { recursive: true });
    await writeFile(this.missionConfigPath(id), serializeMissionConfig(config), 'utf8');
    // Name-symlink (per §2.4 name-symlink scheme; operator-supplied --name only)
    // W4.2 fold per W3 forward-fold #1: replaces W3 placeholder pointer-file with true POSIX symlink
    if (opts.name) {
      const namesDir = this.missionNamesDir();
      await mkdir(namesDir, { recursive: true });
      const symlinkPath = join(namesDir, `${opts.name}.yaml`);
      // Symlink target = relative path to <id>.yaml (../id.yaml from .names/ subdir)
      const symlinkTarget = `../${id}.yaml`;
      try {
        // fs.symlink is atomic create-or-fail-on-EEXIST per POSIX O_EXCL semantic (v1.4 fold per MEDIUM-R3.3)
        await symlink(symlinkTarget, symlinkPath);
      } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'EEXIST') {
          // Cleanup the just-written config + throw name-collision
          try { await unlink(this.missionConfigPath(id)); } catch { /* swallow */ }
          throw new MissionStateError(`mission name '${opts.name}' already taken (per §2.4 name-uniqueness invariant per MEDIUM-R2.4)`);
        }
        throw err;
      }
    }
    const handle: MissionHandle = opts.name === undefined ? { id } : { id, name: opts.name };
    return handle;
  }

  private async createScope(opts: ResourceMap['scope']['createOpts'] = {}): Promise<ScopeHandle> {
    // mission-78 W6-new slice (iv): SDK-side slug-validation guard for scope (sister to mission)
    if (opts.name !== undefined) {
      const { validateSlugAtSdk } = await import('./slug-validation.js');
      const err = validateSlugAtSdk(opts.name);
      if (err) {
        throw new ConfigValidationError(`mc.create('scope'): slug-format: ${err}`);
      }
    }

    const id = generateScopeId();
    const now = new Date();
    const repos = opts.repo
      ? (Array.isArray(opts.repo) ? opts.repo : [opts.repo]).map((url) => ({ url, name: repoNameFromUrl(url) }))
      : [];
    const config: ScopeConfig = {
      scopeConfigSchemaVersion: 1,
      scope: {
        id,
        ...(opts.name !== undefined && { name: opts.name }),
        ...(opts.description !== undefined && { description: opts.description }),
        lifecycleState: 'created',
        createdAt: now,
        updatedAt: now,
      },
      repos,
    };
    await mkdir(join(this.workspaceRoot, 'config', 'scopes'), { recursive: true });
    const kebabed = camelToKebabObject(config);
    await writeFile(this.scopeConfigPath(id), yamlStringify(kebabed), 'utf8');
    // Scope name-symlink per §2.4 (parallel to mission name-symlink scheme; v4.2 POSIX symlink)
    if (opts.name) {
      const namesDir = this.scopeNamesDir();
      await mkdir(namesDir, { recursive: true });
      const symlinkPath = join(namesDir, `${opts.name}.yaml`);
      const symlinkTarget = `../${id}.yaml`;
      try {
        await symlink(symlinkTarget, symlinkPath);
      } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'EEXIST') {
          try { await unlink(this.scopeConfigPath(id)); } catch { /* swallow */ }
          throw new MissionStateError(`scope name '${opts.name}' already taken (per §2.4 name-uniqueness invariant)`);
        }
        throw err;
      }
    }
    const handle: ScopeHandle = opts.name === undefined ? { id } : { id, name: opts.name };
    return handle;
  }

  private async getMission(id: string, principal?: string): Promise<MissionState> {
    const path = this.missionConfigPath(id);
    if (!existsSync(path)) {
      throw new MissionStateError(`mission not found: '${id}' (no config at ${path})`);
    }
    const content = await readFile(path, 'utf8');
    // mission-78 W4-new: use 'auto' role-derivation so reader-mission configs (lifecycleState in
    // reader-states) parse successfully through the reader-role schema. Pre-W4-new default-writer
    // role would reject reader-side lifecycle-states.
    const config = parseMissionConfig(content, path, 'auto');
    return this.missionConfigToState(config, principal);
  }

  private async listMissions(filter?: MissionFilter, principal?: string): Promise<MissionState[]> {
    // v1.0.5 idea-271: missions now live under config/missions/
    const dir = join(this.workspaceRoot, 'config', 'missions');
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir);
    const states: MissionState[] = [];
    for (const name of entries) {
      if (!name.endsWith('.yaml') || name.startsWith('.')) continue;
      const id = name.slice(0, -5);
      try {
        const state = await this.getMission(id, principal);
        if (this.matchesMissionFilter(state, filter)) {
          states.push(state);
        }
      } catch {
        // skip configs that fail to parse (forensic-history; W4 may surface as warning)
      }
    }
    return states;
  }

  private matchesMissionFilter(state: MissionState, filter?: MissionFilter): boolean {
    if (!filter) return true;
    if (filter.status) {
      const allowed = Array.isArray(filter.status) ? filter.status : [filter.status];
      if (!allowed.includes(state.lifecycleState)) return false;
    }
    if (filter.name !== undefined && state.name !== filter.name) return false;
    if (filter.nameLike !== undefined) {
      const haystack = (state.name ?? '').toLowerCase();
      if (!haystack.includes(filter.nameLike.toLowerCase())) return false;
    }
    if (filter.hubId !== undefined && state.hubId !== filter.hubId) return false;
    if (filter.tags) {
      for (const [k, v] of Object.entries(filter.tags)) {
        if (state.tags[k] !== v) return false;
      }
    }
    return true;
  }

  private missionConfigToState(config: MissionConfig, principal?: string): MissionState {
    const m = config.mission;
    const repos: readonly MissionRepoState[] = config.repos.map((r) => {
      const role = principal && m.participants
        ? (m.participants.find((p) => p.principal === principal)?.role)
        : undefined;
      const base: MissionRepoState = {
        name: r.name ?? repoNameFromUrl(r.url),
        url: r.url,
        base: r.base ?? 'main',
        ...(r.branch !== undefined && { branch: r.branch }),
        ...(r.commitSha !== undefined && { commitSha: r.commitSha }),
        ...(role !== undefined && { role }),
      };
      return base;
    });
    return {
      id: m.id,
      ...(m.name !== undefined && { name: m.name }),
      ...(m.hubId !== undefined && { hubId: m.hubId }),
      ...(m.scopeId !== undefined && { scopeId: m.scopeId }),
      ...(m.description !== undefined && { description: m.description }),
      tags: m.tags ?? {},
      repos,
      ...(m.participants !== undefined && { participants: m.participants }),
      // mission-78 W5-new slice (ii): coordinationRemote field DELETED per Design v5.0 §10.2
      lifecycleState: m.lifecycleState as MissionStatePhase,
      createdAt: m.createdAt,
      updatedAt: m.createdAt,                                                                // W4: mutate on transitions
      identityProviderName: extractProviderName(this.identity),
      approvalProviderName: extractProviderName(this.approval),
      storageProviderName: extractProviderName(this.storage),
      gitEngineProviderName: extractProviderName(this.gitEngine),
      ...(this.remote !== undefined && { remoteProviderName: extractProviderName(this.remote) }),
      // W4.3 publish-flow + abandon-flow runtime-state
      ...(m.publishMessage !== undefined && { publishMessage: m.publishMessage }),
      ...(m.abandonMessage !== undefined && { abandonMessage: m.abandonMessage }),
      ...(m.publishStatus !== undefined && { publishStatus: m.publishStatus }),
      ...(m.publishedPRs !== undefined && { publishedPRs: m.publishedPRs }),
      ...(m.abandonProgress !== undefined && { abandonProgress: m.abandonProgress }),
      ...(m.abandonRepoStatus !== undefined && { abandonRepoStatus: m.abandonRepoStatus }),
      // mission-78 W4-new (Design v5.0 §2 row 4): reader-mission projection fields
      ...(m.readOnly !== undefined && { readOnly: m.readOnly }),
      ...(m.sourceMissionId !== undefined && { sourceMissionId: m.sourceMissionId }),
      ...(m.sourceRemote !== undefined && { sourceRemote: m.sourceRemote }),
      ...(m.sourceBranch !== undefined && { sourceBranch: m.sourceBranch }),
    };
  }

  private async getScope(id: string, opts?: ResourceMap['scope']['getOpts']): Promise<ScopeState> {
    const path = this.scopeConfigPath(id);
    if (!existsSync(path)) {
      throw new MissionStateError(`scope not found: '${id}' (no config at ${path})`);
    }
    const content = await readFile(path, 'utf8');
    const yamlMod = await import('yaml');
    const raw = yamlMod.parse(content);
    const camel = kebabToCamelObject(raw);
    const config = ScopeConfigSchema.parse(camel);
    // v1.0.6 bug-70: compute-on-demand referencedByMissions scan when --include-references set.
    // Architect-pre-disposed: simpler than a maintained ledger; missions are O(10-100s) so scan is fast.
    const referencedByMissions = opts?.includeReferences === true
      ? await this.computeReferencingMissions(id)
      : [];
    return {
      id: config.scope.id,
      ...(config.scope.name !== undefined && { name: config.scope.name }),
      ...(config.scope.description !== undefined && { description: config.scope.description }),
      tags: config.scope.tags ?? {},
      repos: config.repos,
      lifecycleState: config.scope.lifecycleState as ScopeStatePhase,
      createdAt: config.scope.createdAt,
      updatedAt: config.scope.updatedAt,
      referencedByMissions,
    };
  }

  /**
   * v1.0.6 bug-70 — scan `<workspace>/config/missions/*.yaml` for mission.scope-id matching this scope-id.
   * Returns mission-ids (canonical msn-<hex> form). Compute-on-demand vs. maintained ledger
   * (architect-pre-disposed) — missions are O(10-100s) and the scan is sub-ms.
   *
   * Used by:
   * - getScope (opt-in via --include-references)
   * - listScopes (opt-in via --include-references)
   * - deleteScope cascade-protection (always; v1.0.5 bug-65 — uses raw kebab-case read)
   */
  private async computeReferencingMissions(scopeId: string): Promise<string[]> {
    const missionsDir = join(this.workspaceRoot, 'config', 'missions');
    if (!existsSync(missionsDir)) return [];
    const entries = await readdir(missionsDir);
    const refs: string[] = [];
    for (const name of entries) {
      if (!name.endsWith('.yaml') || name.startsWith('.')) continue;
      const missionPath = join(missionsDir, name);
      try {
        const content = await readFile(missionPath, 'utf8');
        const { parse: yamlParse } = await import('yaml');
        const raw = yamlParse(content) as { mission?: { 'scope-id'?: string } };
        if (raw?.mission?.['scope-id'] === scopeId) {
          refs.push(name.slice(0, -5));
        }
      } catch { /* skip unparseable */ }
    }
    return refs;
  }

  private async listScopes(filter?: ScopeFilter, opts?: ResourceMap['scope']['listOpts']): Promise<ScopeState[]> {
    // v1.0.5 idea-271: scopes now live under config/scopes/
    const dir = join(this.workspaceRoot, 'config', 'scopes');
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir);
    const states: ScopeState[] = [];
    for (const name of entries) {
      if (!name.endsWith('.yaml') || name.startsWith('.')) continue;
      const id = name.slice(0, -5);
      try {
        // v1.0.6 bug-70: propagate includeReferences opt to getScope for compute-on-demand scan
        const state = await this.getScope(id, opts);
        if (this.matchesScopeFilter(state, filter)) {
          states.push(state);
        }
      } catch {
        // skip
      }
    }
    return states;
  }

  private matchesScopeFilter(state: ScopeState, filter?: ScopeFilter): boolean {
    if (!filter) return true;
    if (filter.name !== undefined && state.name !== filter.name) return false;
    if (filter.nameLike !== undefined) {
      const haystack = (state.name ?? '').toLowerCase();
      if (!haystack.includes(filter.nameLike.toLowerCase())) return false;
    }
    if (filter.tags) {
      for (const [k, v] of Object.entries(filter.tags)) {
        if (state.tags[k] !== v) return false;
      }
    }
    return true;
  }

  private async loadOperatorConfig(): Promise<unknown> {
    const path = join(this.workspaceRoot, 'operator.yaml');
    if (!existsSync(path)) return undefined;
    const content = await readFile(path, 'utf8');
    const yamlMod = await import('yaml');
    const raw = yamlMod.parse(content);
    return kebabToCamelObject(raw);
  }

  /**
   * v1.0.5 bug-65 — apply a ScopeMutation to a scope's persisted config.
   * Parallel to applyMissionMutation but simpler (no daemon-IPC, no state-machine FSM beyond
   * 'created'). Read → apply → atomic-write. Updates `updatedAt` automatically.
   */
  private async applyScopeMutation(id: string, mutation: ScopeMutation): Promise<ScopeState> {
    const path = this.scopeConfigPath(id);
    const content = await readFile(path, 'utf8');
    const yamlMod = await import('yaml');
    const raw = yamlMod.parse(content);
    const camel = kebabToCamelObject(raw);
    const config = ScopeConfigSchema.parse(camel);

    const nextRaw = this.applyScopeMutationToConfig(config, mutation);
    const next: ScopeConfig = { ...nextRaw, scope: { ...nextRaw.scope, updatedAt: new Date() } };
    const kebabed = camelToKebabObject(next);
    await writeFile(path, yamlStringify(kebabed), 'utf8');

    // Handle name-symlink update for rename mutations (parallel to mission name-symlink discipline).
    if (mutation.kind === 'rename') {
      const namesDir = this.scopeNamesDir();
      await mkdir(namesDir, { recursive: true });
      // Remove old symlink (config.scope.name was the OLD name); add new
      if (config.scope.name) {
        try { await unlink(join(namesDir, `${config.scope.name}.yaml`)); } catch { /* idempotent */ }
      }
      const symlinkPath = join(namesDir, `${mutation.newName}.yaml`);
      try {
        await symlink(`../${id}.yaml`, symlinkPath);
      } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'EEXIST') {
          throw new MissionStateError(`scope name '${mutation.newName}' already taken`);
        }
        throw err;
      }
    }

    return this.getScope(id);
  }

  /** Pure mutation-application — returns new ScopeConfig with mutation applied. */
  private applyScopeMutationToConfig(config: ScopeConfig, mutation: ScopeMutation): ScopeConfig {
    switch (mutation.kind) {
      case 'add-repo': {
        const newRepo = { ...mutation.repo, name: mutation.repo.name ?? repoNameFromUrl(mutation.repo.url) };
        // Reject duplicate repo-name
        if (config.repos.some((r) => (r.name ?? repoNameFromUrl(r.url)) === newRepo.name)) {
          throw new MissionStateError(`scope '${config.scope.id}' already has repo with name '${newRepo.name}'`);
        }
        return { ...config, repos: [...config.repos, newRepo] };
      }
      case 'remove-repo':
        return { ...config, repos: config.repos.filter((r) => (r.name ?? repoNameFromUrl(r.url)) !== mutation.repoName) };
      case 'rename':
        return { ...config, scope: { ...config.scope, name: mutation.newName } };
      case 'set-description':
        return { ...config, scope: { ...config.scope, description: mutation.description } };
      case 'set-tag': {
        const tags = { ...(config.scope.tags ?? {}), [mutation.key]: mutation.value };
        return { ...config, scope: { ...config.scope, tags } };
      }
      case 'remove-tag': {
        const tags = { ...(config.scope.tags ?? {}) };
        delete tags[mutation.key];
        return { ...config, scope: { ...config.scope, tags } };
      }
    }
  }

  /**
   * v1.0.5 bug-65 — delete a scope with cascade-protection.
   *
   * Cascade-protection: scan all missions in the workspace; if any references this scope-id via
   * `scope-id` field, reject with operator-actionable error. Otherwise unlink the scope YAML +
   * its name-symlink (if any).
   */
  private async deleteScope(id: string): Promise<void> {
    // Cascade-protection: find missions referencing this scope-id
    const missionsDir = join(this.workspaceRoot, 'config', 'missions');
    if (existsSync(missionsDir)) {
      const entries = await readdir(missionsDir);
      const referencingMissions: string[] = [];
      for (const name of entries) {
        if (!name.endsWith('.yaml') || name.startsWith('.')) continue;
        const missionPath = join(missionsDir, name);
        try {
          const missionContent = await readFile(missionPath, 'utf8');
          const yamlMod = await import('yaml');
          const raw = yamlMod.parse(missionContent) as { mission?: { 'scope-id'?: string } };
          if (raw?.mission?.['scope-id'] === id) {
            referencingMissions.push(name.slice(0, -5));
          }
        } catch { /* skip unparseable */ }
      }
      if (referencingMissions.length > 0) {
        throw new MissionStateError(
          `scope '${id}' has ${referencingMissions.length} referencing mission(s): ${referencingMissions.join(', ')}. ` +
            `Remove references via 'msn update <mission-id> scope-id ""' before deleting scope.`,
        );
      }
    }

    // Load scope config to get the name (for symlink cleanup)
    const scopePath = this.scopeConfigPath(id);
    let scopeName: string | undefined;
    try {
      const content = await readFile(scopePath, 'utf8');
      const yamlMod = await import('yaml');
      const raw = yamlMod.parse(content);
      const camel = kebabToCamelObject(raw) as { scope?: { name?: string } };
      scopeName = camel?.scope?.name;
    } catch { /* fall through */ }

    // Unlink scope YAML + name-symlink (if any)
    try { await unlink(scopePath); } catch { /* idempotent */ }
    if (scopeName) {
      const symlinkPath = join(this.scopeNamesDir(), `${scopeName}.yaml`);
      try { await unlink(symlinkPath); } catch { /* idempotent */ }
    }
  }

  /**
   * Apply a MissionMutation to a mission's persisted config (W4.3 _engineMutate refactor).
   *
   * W4.1 inlined load + validate + apply + atomic-write; W4.3 routes through _engineMutate
   * primitive for symmetric rejection-error discipline with engine-internal flows
   * (publish-flow, abandon-flow per Design v4.9 §2.4.1).
   *
   * Per-field state-restriction matrix (validateMutationAllowed) wraps as the validate
   * callback; FSM auto-advance (add-first-repo / remove-last-repo) lives in apply callback.
   */
  private async applyMissionMutation(id: string, mutation: MissionMutation): Promise<MissionState> {
    // v1.0.6 bug-70: set-scope attach requires async scope-config read for eager-inline repo copy.
    // Resolve scope-name → canonical id + load repos[] BEFORE entering pure-mutation closure.
    // Detach (scopeId === null) stays on the pure-mutation path.
    let resolvedAttachScopeId: string | undefined;
    let attachScopeRepos: RepoSpec[] | undefined;
    if (mutation.kind === 'set-scope' && mutation.scopeId !== null) {
      resolvedAttachScopeId = this.resolveScopeRef(mutation.scopeId);
      const scopePath = this.scopeConfigPath(resolvedAttachScopeId);
      if (!existsSync(scopePath)) {
        throw new MissionStateError(`scope '${mutation.scopeId}' not found`);
      }
      const scopeContent = await readFile(scopePath, 'utf8');
      const { parse: yamlParse } = await import('yaml');
      const scopeRaw = yamlParse(scopeContent);
      const scopeCamel = kebabToCamelObject(scopeRaw);
      const scopeConfig = ScopeConfigSchema.parse(scopeCamel);
      attachScopeRepos = scopeConfig.repos.map((r) => ({ ...r }));
    }

    const updated = await this._engineMutate(
      id,
      (config) => {
        // set-scope attach: REPLACE repos[] with scope's; persist scopeId; auto-advance lifecycle
        // 'created' → 'configured' if attached scope has ≥1 repo.
        if (mutation.kind === 'set-scope' && mutation.scopeId !== null) {
          const nextRepos = attachScopeRepos!;
          const baseMission = { ...config.mission, scopeId: resolvedAttachScopeId! };
          const nextMission = nextRepos.length > 0 && baseMission.lifecycleState === 'created'
            ? { ...baseMission, lifecycleState: 'configured' as MissionStatePhase }
            : baseMission;
          return { ...config, mission: nextMission, repos: nextRepos };
        }
        return this.applyMissionMutationToConfig(config, mutation);
      },
      {
        validate: (config) => validateMutationAllowed(mutation, config.mission.lifecycleState),
        sourceLabel: `Missioncraft.update('mission', '${id}')`,
      },
    );

    // mission-78 W5-new slice (ii): propagateConfigToCoordRemote DELETED (coord-remote primitive
    // removed per Design v5.0 §10.2). Config-mutation propagation no longer applicable in v5.0
    // standalone-capable architecture; future Hub-coupling (idea-291) lands its own mechanism.

    return this.missionConfigToState(updated, this.principal);
  }

  /**
   * `_engineMutate` — uniform internal-wire primitive for all mission-config mutations.
   *
   * W4.3 architect-spec per Design v4.9 §2.4.1 thread-519 round 1: extract single primitive
   * that both `update<T>('mission', ...)` AND engine-flows (publish-flow, abandon-flow) call
   * through; rejection-error symmetric across surfaces.
   *
   * Pipeline:
   * 1. Load mission-config from storage (single read)
   * 2. Run `validate(config)`; throw `MissionStateError` on non-null rejection
   * 3. Run `applyFn(config)` to compute new config (pure transform)
   * 4. Atomic-write new config (write-temp + rename per MEDIUM-11)
   * 5. Return new config (caller projects to MissionState if needed)
   *
   * Operator-mutations supply matrix-derived validate; engine-internal mutations supply
   * lifecycle-state-allowed-list validate. Both surfaces share atomic-write + error format.
   *
   * NOTE: mission-lock acquisition + cross-mission concurrency control still W4.3 follow-on
   * (start() acquires; engine-internal flows in slices ii+iii will acquire via same pattern).
   */
  private async _engineMutate(
    missionId: string,
    applyFn: (config: MissionConfig) => MissionConfig,
    options: {
      validate: (config: MissionConfig) => string | null;
      sourceLabel: string;
      role?: 'writer' | 'reader' | 'auto';
    },
  ): Promise<MissionConfig> {
    const path = this.missionConfigPath(missionId);
    if (!existsSync(path)) {
      throw new MissionStateError(`mission not found: '${missionId}' (no config at ${path})`);
    }
    const content = await readFile(path, 'utf8');
    const config = parseMissionConfig(content, path, options.role);

    const rejection = options.validate(config);
    if (rejection !== null) {
      throw new MissionStateError(`${options.sourceLabel}: ${rejection}`);
    }

    const updated = applyFn(config);
    await this.writeMissionConfigAtomic(missionId, updated);
    return updated;
  }

  /**
   * Pure mutation-application: returns new MissionConfig with mutation applied + lifecycle-state advanced if applicable.
   * Caller (applyMissionMutation) handles persistence.
   */
  private applyMissionMutationToConfig(
    config: MissionConfig,
    mutation: MissionMutation,
  ): MissionConfig {
    const m = config.mission;
    let nextRepos = config.repos;
    let nextMission: MissionConfig['mission'] = m;

    switch (mutation.kind) {
      case 'add-repo': {
        const newRepo: RepoSpec = {
          ...mutation.repo,
          ...(mutation.repo.name === undefined && { name: repoNameFromUrl(mutation.repo.url) }),
        };
        // Reject duplicate repo-name
        const repoName = newRepo.name ?? repoNameFromUrl(newRepo.url);
        if (nextRepos.some((r) => (r.name ?? repoNameFromUrl(r.url)) === repoName)) {
          throw new MissionStateError(`add-repo rejected: repo '${repoName}' already in mission`);
        }
        nextRepos = [...nextRepos, newRepo];
        // FSM: add-first-repo → 'configured'
        if (config.repos.length === 0 && m.lifecycleState === 'created') {
          const next = nextState(m.lifecycleState, 'add-first-repo');
          if (next !== null) nextMission = { ...m, lifecycleState: next };
        }
        break;
      }
      case 'remove-repo': {
        const before = nextRepos.length;
        nextRepos = nextRepos.filter((r) => (r.name ?? repoNameFromUrl(r.url)) !== mutation.repoName);
        if (nextRepos.length === before) {
          throw new MissionStateError(`remove-repo rejected: repo '${mutation.repoName}' not found`);
        }
        // FSM: remove-last-repo → 'created'
        if (nextRepos.length === 0 && m.lifecycleState === 'configured') {
          const next = nextState(m.lifecycleState, 'remove-last-repo');
          if (next !== null) nextMission = { ...m, lifecycleState: next };
        }
        break;
      }
      case 'rename':
        nextMission = { ...m, name: mutation.newName };
        break;
      case 'set-description':
        nextMission = { ...m, description: mutation.description };
        break;
      case 'set-hub-id':
        nextMission = { ...m, hubId: mutation.hubId };
        break;
      case 'set-scope': {
        // v1.0.6 bug-70: detach (null) clears scopeId; repos[] preserved (mission is self-contained
        // post-attach; scope is just an initial template). Attach (non-null) handled in async pre-step
        // of applyMissionMutation — pure path is never reached for attach.
        if (mutation.scopeId === null) {
          const { scopeId: _drop, ...rest } = m;
          void _drop;
          nextMission = rest as MissionConfig['mission'];
        } else {
          throw new ConfigValidationError(
            `internal: set-scope attach must be resolved by applyMissionMutation async pre-step before applyMissionMutationToConfig`,
          );
        }
        break;
      }
      case 'set-tag': {
        const tags = { ...(m.tags ?? {}), [mutation.key]: mutation.value };
        nextMission = { ...m, tags };
        break;
      }
      case 'remove-tag': {
        const tags = { ...(m.tags ?? {}) };
        delete tags[mutation.key];
        nextMission = { ...m, tags };
        break;
      }
      case 'add-participant': {
        const existing = m.participants ?? [];
        if (existing.some((p) => p.principal === mutation.principal)) {
          throw new MissionStateError(`add-participant rejected: principal '${mutation.principal}' already participant`);
        }
        nextMission = {
          ...m,
          participants: [
            ...existing,
            { principal: mutation.principal, role: mutation.role, addedAt: new Date() },
          ],
        };
        break;
      }
      case 'remove-participant': {
        const existing = m.participants ?? [];
        if (!existing.some((p) => p.principal === mutation.principal)) {
          throw new MissionStateError(`remove-participant rejected: principal '${mutation.principal}' not found`);
        }
        nextMission = {
          ...m,
          participants: existing.filter((p) => p.principal !== mutation.principal),
        };
        break;
      }
      case 'set-coordination-remote':
        // mission-78 W5-new slice (ii): coordinationRemote field DELETED per Design v5.0 §10.2.
        // Mutation-kind retained on MissionMutation type for v4.x test-fixture back-compat
        // through W7-new (architect-disposition); this case-arm is a no-op (v.x mutation has no
        // effect since the field doesn't exist on schema-v2).
        void mutation;
        break;
      default: {
        const _exhaustive: never = mutation;
        void _exhaustive;
        throw new ConfigValidationError(`internal: unhandled mutation kind`);
      }
    }

    return { ...config, mission: nextMission, repos: nextRepos };
  }

  /** Atomic-write updated mission-config (write-temp + rename per MEDIUM-11). */
  private async writeMissionConfigAtomic(id: string, config: MissionConfig): Promise<void> {
    const path = this.missionConfigPath(id);
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, serializeMissionConfig(config), 'utf8');
    const { rename } = await import('node:fs/promises');
    await rename(tmp, path);
  }
}

/** Extract `static readonly providerName` from a pluggable instance. */
function extractProviderName(pluggable: object): string {
  const cls = (pluggable.constructor as { providerName?: string });
  return cls.providerName ?? 'unknown';
}

/** Read nested value via dot-notation key (e.g., "defaults.workspaceRoot"). */
function getNestedValue(obj: Record<string, unknown>, key: string): string | undefined {
  if (!obj) return undefined;
  const parts = key.split('.');
  let cursor: unknown = obj;
  for (const p of parts) {
    if (cursor !== null && typeof cursor === 'object' && p in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  if (typeof cursor === 'string') return cursor;
  if (cursor === undefined || cursor === null) return undefined;
  return String(cursor);
}

/** Set nested value via dot-notation key (kebab-case keys preserved per Naming-convention contract). */
function setNestedValue(obj: Record<string, unknown>, key: string, value: string): void {
  const parts = key.split('.');
  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (typeof cursor[p] !== 'object' || cursor[p] === null) {
      cursor[p] = {};
    }
    cursor = cursor[p] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

// Use UnsupportedOperationError (re-exported for parser-side use; not invoked by Missioncraft methods directly at W3)
void UnsupportedOperationError;
