// Mission RESOURCE types (Design v4.8 §2.3.1 — k8s-shape primary resource)
// Strict-1.0 commits all SDK return-type shapes (v1.6 fold per MEDIUM-R5.2).
// v4.0+ extensions per idea-265 multi-participant + HIGH-R2.3 reader-side enum + MEDIUM-R1.4 MissionParticipant + MINOR-R1.2 MissionRepoState.

import type { StateDurabilityConfig } from './types.js';

/**
 * Mission lifecycle-state enum — 10 values total (v4.0+ broadening per HIGH-R2.3).
 *
 * Per HIGH-R1.2 partition-spec: each principal holds own per-principal config with own lifecycle-state field;
 * reader-side states orthogonal to writer-side. Engine-side role-based superRefine validation
 * (per v4.5 fold MEDIUM-R6.4 schema-factory pattern) rejects writer-side enum-values in reader-side config + vice versa.
 */
export type MissionStatePhase =
  // Writer-side (existing v3.6 baseline)
  | 'created'        // scaffolded config; no repos
  | 'configured'     // ≥1 repo declared; not yet started
  | 'started'        // transient transition state during configured→in-progress
  | 'in-progress'    // active mission; workspace allocated; locks held
  | 'completed'      // terminal; complete-event fired
  | 'abandoned'      // terminal; abandon-event fired
  // Reader-side (v4.0 NEW per idea-265 multi-participant + HIGH-R2.3 — additive enum extension)
  | 'joined'              // transient transition state during reader-side `msn join` (atomically written at Step 3.5 per v4.5 fold MEDIUM-R6.3)
  | 'reading'             // active reader-side mission; per-principal workspace allocated; coord-remote sync running
  | 'readonly-completed'  // terminal reader-side; writer terminated (refs/tags/missioncraft/<id>/terminated detected); reader transitioned to read-only-archive mode
  | 'leaving';            // transient transition state during reader-side `msn leave`

export interface MissionHandle {
  readonly id: string;          // canonical msn-<8-char-hash>
  readonly name?: string;       // optional human-friendly slug
}

/**
 * v4.0 NEW per idea-265 multi-participant + MEDIUM-R1.4 — MissionParticipant resource interface.
 * v1: exactly 1 writer per mission; co-writer mode (multi-writer with atomic-tx discipline) deferred to v1.x per Lean 6 YAGNI.
 */
export interface MissionParticipant {
  readonly principal: string;                  // opaque-string at v1; format <user>@<host> per MINOR-R1.4 (operator-supplied; principal-equality via string-comparison)
  readonly role: 'writer' | 'reader';
  readonly addedAt: Date;
}

export interface RepoSpec {
  readonly url: string;             // git URL (HTTPS, SSH, file://)
  readonly name?: string;           // local-name override; auto-derived from URL last segment if omitted; MUST match DNS-style slug `[a-z0-9][a-z0-9-]{1,62}` (v1.3 fold per MEDIUM-R2.5)
  readonly branch?: string;         // mission's working branch; default DERIVED AT RUNTIME-CLONE-TIME (v1.7 fold per MINOR-R6.6): engine substitutes `mission/<missionId>` if undefined when startMission clones
  readonly base?: string;           // base-branch to branch from; default: repo's default-branch
  readonly commitSha?: string;      // optional pin to specific commit for reproducibility
}

/**
 * v4.0 NEW per idea-265 + MINOR-R1.2 — MissionRepoState extends RepoSpec with engine-derived runtime-state for `msn show <id>:<repo>` columns.
 *
 * Per-repo runtime-state fields (role/syncState/remoteRef/lastSyncAt) are engine-derived; not config-persisted.
 * `role` is the role of the CURRENT principal viewing this state (derived from MissionState.participants[] lookup
 * via current-principal precedence chain at §2.3.1 v4.4 fold).
 */
export interface MissionRepoState {
  readonly name: string;                       // existing v3.6 (from RepoSpec)
  readonly url: string;                        // existing v3.6
  readonly base: string;                       // existing v3.6
  readonly branch?: string;                    // existing v3.6
  readonly commitSha?: string;                 // existing v3.6
  // v4.0 NEW per-repo runtime-state (engine-derived; not config-persisted)
  readonly role?: 'writer' | 'reader';         // role of CURRENT principal viewing this state
  readonly syncState?: 'synced' | 'fetching' | 'stale' | 'no-coord';   // reader-side sync-state; writer-side always 'no-coord' if no readers
  readonly remoteRef?: string;                 // coord-remote ref name (e.g., 'refs/heads/design-repo/wip/m-foo')
  readonly lastSyncAt?: Date;                  // reader-side last successful coord-fetch
}

export interface MissionState {
  readonly id: string;
  readonly name?: string;
  readonly hubId?: string;
  // v1.0.6 bug-70: eager-inline scope reference; absent when not scope-bound.
  readonly scopeId?: string;
  readonly description?: string;
  readonly tags: Record<string, string>;
  readonly repos: readonly MissionRepoState[];           // v4.0 fold per MINOR-R1.2 — type widened from RepoSpec[] to MissionRepoState[]
  // v4.0 NEW per idea-265 multi-participant
  readonly participants?: readonly MissionParticipant[]; // absent OR exactly 1 writer + 0 readers = solo writer-only mission (v3.6 baseline preserved)
  readonly coordinationRemote?: string;                  // git remote URL for wip-coordination; required IFF participants[] contains a reader (zod superRefine per F-V4.2)
  readonly lastPushSuccessAt?: Date;                     // v4.0 fold per MEDIUM-R2.8 + MEDIUM-R1.9 — operator-DX visibility for coord-remote push-cadence health (engine-derived from .daemon-state.yaml per v4.4 MEDIUM-R3.3; NOT config-persisted)
  // ─── mission-78 W4-new (Design v5.0 §2 row 4): reader-mission projection fields ───
  readonly readOnly?: boolean;                           // true → reader-mission (BRANCH-TRACKER OR PERSISTENT-TRACKER)
  readonly sourceMissionId?: string;                     // BRANCH-TRACKER (msn join) references writer-mission
  readonly sourceRemote?: string;                        // PERSISTENT-TRACKER (msn watch) source URL
  readonly sourceBranch?: string;                        // ref name (both reader-flavors via different mechanisms)
  readonly lifecycleState: MissionStatePhase;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  // Symmetric pluggable-name exposure (v1.7 fold per MINOR-R6.1) — runtime-introspection without re-parsing config
  readonly identityProviderName: string;
  readonly approvalProviderName: string;
  readonly storageProviderName: string;
  readonly gitEngineProviderName: string;
  readonly remoteProviderName?: string;     // PROVIDER_REGISTRY string-name; optional only because remote pluggable itself is optional
  // v3.2 fold per MEDIUM-R2.6 — publish-message persisted at first `complete`; immutable post-write
  readonly publishMessage?: string;
  // v3.3 fold per round-3 ask 3 — abandon-message persisted at first `abandon`; immutable post-write
  readonly abandonMessage?: string;
  /**
   * v3.5+v3.6 fold — abandon-step partial-failure recovery; symmetric with publishStatus discipline.
   *
   * Final-value lifecycle-semantics:
   * - undefined: no abandon attempted; OR config purged (--purge-config terminal)
   * - 'workspace-handled': abandon Step 6 completed; lifecycle-state advanced to 'abandoned' atomically (v3.6 fold per MINOR-R6.2 — retain-aware semantic)
   * - 'config-purged': transient — never observed in stable terminal state
   * - any other value: abandon-flow failed at this step; mission stays 'in-progress'; idempotent retry resumes from this step
   */
  readonly abandonProgress?:
    | 'tick-fired'
    | 'daemon-killed'
    | 'message-persisted'
    | 'locks-released'
    | 'branches-cleaned'
    | 'workspace-handled'
    | 'config-purged';
  /** v3.5 fold per MEDIUM-R5.2 — per-repo abandon-cleanup state; granular operator-visibility */
  readonly abandonRepoStatus?: Record<string, 'pending' | 'cleaned' | 'failed'>;
  /** v3.1 fold per MEDIUM-R1.9 — per-repo publish-state during/after `complete` execution; idempotent-retry surface */
  readonly publishStatus?: Record<string, 'pending' | 'squashed' | 'pushed' | 'pr-opened' | 'failed'>;
  /** v3.1 fold — per-repo PR URLs after successful complete-publish-flow */
  readonly publishedPRs?: readonly { readonly repoName: string; readonly prUrl: string }[];
  /** v1.7 fold per MEDIUM-R6.3 — populated ONLY when workspace exists on-disk (state-gated; see spec for full lifecycle) */
  readonly workspacePath?: string;
}

export interface MissionFilter {
  readonly status?: MissionStatePhase | readonly MissionStatePhase[];
  readonly name?: string;                   // exact match (case-sensitive)
  readonly nameLike?: string;               // case-insensitive plain substring match (v1.7 fold per MINOR-R6.3 — String.prototype.toLowerCase().includes(...) semantic; NOT glob, NOT regex)
  readonly hubId?: string;
  readonly scopeId?: string;                // v2.0 fold per Refinement C
  readonly tags?: Record<string, string>;   // all-must-match
}

/**
 * MissionConfig is the parse-result of MissionConfigSchema (§2.5).
 * Engine-side persisted as YAML with kebab-case keys; zod schema transforms to camelCase TS at parse-time.
 */
export interface MissionConfig {
  // mission-78 W4-new (Design v5.0 §2 row 5): schema-version 1 → 2 (no-backward-compat;
  // schema-v1 REFUSED at parse per Design v5.0 §12).
  readonly missionConfigSchemaVersion: 2;
  readonly mission: {
    readonly id: string;
    readonly name?: string;
    readonly hubId?: string;
    // v1.0.6 bug-70: eager-inline scope reference; absent when not scope-bound.
    readonly scopeId?: string;
    readonly description?: string;
    readonly lifecycleState: MissionStatePhase;
    readonly createdAt: Date;
    readonly tags?: Record<string, string>;
    // v4.0 NEW per idea-265 multi-participant — populated when mission has multi-participant flow
    readonly participants?: readonly MissionParticipant[];
    readonly coordinationRemote?: string;       // git remote URL; required IFF participants[] contains a reader (zod superRefine)
    // ─── mission-78 W4-new (Design v5.0 §2 row 4): reader-mission fields ───
    // readOnly: true → reader-mission (BRANCH-TRACKER via msn join OR PERSISTENT-TRACKER via msn watch)
    // sourceMissionId: BRANCH-TRACKER references writer-mission whose branch is tracked
    // sourceRemote + sourceBranch: PERSISTENT-TRACKER references long-lived remote+branch
    // Validation: BRANCH-TRACKER (sourceMissionId only) XOR PERSISTENT-TRACKER (sourceRemote+sourceBranch);
    //             writer-missions (readOnly false/undefined) MUST NOT specify source* fields.
    readonly readOnly?: boolean;
    readonly sourceMissionId?: string;          // msn-<8-char-hex>
    readonly sourceRemote?: string;             // git remote URL
    readonly sourceBranch?: string;             // ref name (e.g., 'main', 'mission/msn-<id>')
    // ─── W4.3 publish-flow + abandon-flow runtime-state (Design v4.9 §2.4.1 lines 640-650) ───
    // Persisted in YAML; written by complete()/abandon() flows; read for idempotent retry semantics.
    readonly publishMessage?: string;                     // immutable post-first-complete per v3.2 MEDIUM-R2.6
    readonly abandonMessage?: string;                     // immutable post-first-abandon per v3.3 fold
    readonly publishStatus?: Record<string, 'pending' | 'squashed' | 'pushed' | 'pr-opened' | 'failed'>;
    readonly publishedPRs?: readonly { readonly repoName: string; readonly prUrl: string }[];
    readonly abandonProgress?:
      | 'tick-fired'
      | 'daemon-killed'
      | 'message-persisted'
      | 'locks-released'
      | 'branches-cleaned'
      | 'workspace-handled'
      | 'config-purged';
    readonly abandonRepoStatus?: Record<string, 'pending' | 'cleaned' | 'failed'>;
  };
  readonly repos: readonly RepoSpec[];
  readonly identity?: { readonly provider: string };           // PROVIDER_REGISTRY string-name
  readonly approval?: { readonly provider: string };
  readonly storage?: { readonly provider: string };
  readonly gitEngine?: { readonly provider: string };
  readonly remote?: { readonly provider: string };
  readonly workspaceRoot?: string;
  readonly stateDurability?: StateDurabilityConfig;
  readonly autoMerge?: { readonly strategy: 'ff' | 'no-ff' };
  readonly lockTimeout?: { readonly waitMs?: number; readonly validityMs?: number };
}

/**
 * MissionMutation discriminated-union — 11 kinds at v4.0+ (8 v3.6 baseline + 3 v4.0 NEW participant/coord-mutations).
 *
 * Per-field state-restriction matrix at §2.4.1 (v4.5 fold MEDIUM-R1.5 + MEDIUM-R6.3 reader-side rejection):
 * - add-repo: pre-start full upsert; post-start additive only
 * - remove-repo: pre-start only
 * - rename / set-description / set-tag / remove-tag: any pre-terminal state
 * - set-hub-id: ANY state including terminal (informational-only at v1)
 * - set-scope: pre-start only
 * - add-participant / remove-participant: created/configured/started/in-progress; ERROR on terminal
 * - set-coordination-remote: created/configured ONLY (post-start change orphans readers)
 * Reader-side: ALL mutations rejected (`MissionStateError("read-only participant; mutation rejected")`)
 */
export type MissionMutation =
  | { kind: 'add-repo'; repo: RepoSpec }                                            // pre-start full upsert OR post-start additive
  | { kind: 'remove-repo'; repoName: string }                                       // pre-start only
  | { kind: 'rename'; newName: string }                                             // triggers symlink-rename flow per §2.4
  | { kind: 'set-description'; description: string }
  | { kind: 'set-hub-id'; hubId: string }                                           // informational-only at v1
  | { kind: 'set-scope'; scopeId: string | null }                                   // pre-start only; null clears scope-reference
  | { kind: 'set-tag'; key: string; value: string }
  | { kind: 'remove-tag'; key: string }
  // v4.0 NEW per idea-265 multi-participant + MEDIUM-R1.4 — participant-mutation via existing update<T> polymorphism
  | { kind: 'add-participant'; principal: string; role: 'writer' | 'reader' }
  | { kind: 'remove-participant'; principal: string }
  | { kind: 'set-coordination-remote'; remote: string };
