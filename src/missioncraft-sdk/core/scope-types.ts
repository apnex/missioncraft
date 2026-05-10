// Scope RESOURCE types (Design v4.8 §2.3.1 — v2.0 NEW per Refinement C; multi-mission composition primitive)
// Strict-1.0 commits all SDK return-type shapes (v1.6 fold per MEDIUM-R5.2).
// Separate file from mission-types.ts per parallel-resource-shape discipline (§2.9.1 6-file boundary rationale).

import type { RepoSpec } from './mission-types.js';

export type ScopeStatePhase =
  | 'created'         // scaffolded scope config; mutable until deleted
  | 'deleted';        // terminal; cascade-protection rejected non-terminal mission references at delete-time

export interface ScopeHandle {
  readonly id: string;          // canonical scp-<8-char-hash>
  readonly name?: string;       // optional human-friendly slug
}

export interface ScopeState {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly tags: Record<string, string>;
  readonly repos: readonly RepoSpec[];
  readonly lifecycleState: ScopeStatePhase;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /**
   * Cascade-protection support: which missions reference this scope by id?
   * Engine maintains via reverse-index OR computed-on-getScope by scanning mission-configs.
   * Used by `deleteScope` to enforce cascade-protection invariant.
   */
  readonly referencedByMissions: readonly string[];   // mission-ids
}

export interface ScopeFilter {
  readonly name?: string;                   // exact match
  readonly nameLike?: string;               // case-insensitive plain substring (same semantic as MissionFilter.nameLike)
  readonly tags?: Record<string, string>;
}

/**
 * ScopeConfig is the parse-result of ScopeConfigSchema (§2.5.1).
 * Engine-side persisted as YAML at `<workspace>/scopes/<scope-id>.yaml`.
 */
export interface ScopeConfig {
  readonly scopeConfigSchemaVersion: 1;
  readonly scope: {
    readonly id: string;
    readonly name?: string;
    readonly description?: string;
    readonly lifecycleState: ScopeStatePhase;
    readonly createdAt: Date;
    readonly updatedAt: Date;
    readonly tags?: Record<string, string>;
  };
  readonly repos: readonly RepoSpec[];
}

/**
 * ScopeMutation discriminated-union — 6 kinds at v2.0 (parallel to MissionMutation but simpler — no participant/coord/scope/hub-id concepts).
 *
 * Per §2.3.2 + §2.4.2 — scope-mutations propagate to NOT-YET-STARTED missions referencing this scope (per §2.4.2 hybrid resolution);
 * does NOT propagate to STARTED missions (snapshot already inlined). add-repo / remove-repo follow same propagation discipline.
 */
export type ScopeMutation =
  | { kind: 'add-repo'; repo: RepoSpec }
  | { kind: 'remove-repo'; repoName: string }
  | { kind: 'rename'; newName: string }                  // triggers symlink-rename flow per §2.4
  | { kind: 'set-description'; description: string }
  | { kind: 'set-tag'; key: string; value: string }
  | { kind: 'remove-tag'; key: string };
