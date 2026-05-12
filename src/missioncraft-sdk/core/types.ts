// SDK-INTERNAL constructor types (Design v4.8 §2.3.1)
// MissioncraftConfig — required pluggables + optional config; v1.3 fold per MEDIUM-R2.9
// StateDurabilityConfig — v1.3 fold per MEDIUM-R3.2
// Note: NOT resource-types (those live in mission-types.ts / scope-types.ts);
//       prevents future-implementer drift toward consolidating runtime + types in one file.

import type {
  IdentityProvider,
  ApprovalPolicy,
  StorageProvider,
  GitEngine,
  RemoteProvider,
} from '../pluggables/index.js';

export interface MissioncraftConfig {
  readonly identity: IdentityProvider;        // required (no SDK-default; explicit-injection)
  readonly approval: ApprovalPolicy;          // required (no SDK-default)
  readonly storage: StorageProvider;          // required (no SDK-default)
  readonly gitEngine: GitEngine;              // required (no SDK-default)
  readonly remote?: RemoteProvider;           // optional (mission-config can override; per-mission)
  readonly workspaceRoot?: string;            // optional; default ~/.missioncraft
  readonly stateDurability?: StateDurabilityConfig;
  readonly lockTimeoutWaitMs?: number;        // optional; default 0 (fail-fast); applies to BOTH mission-lock + repo-lock per-acquire defaults (v1.3 fold per MEDIUM-R3.9)
  readonly lockTimeoutValidityMs?: number;    // optional; default 86_400_000 (24h); applies to BOTH mission-lock + repo-lock per-acquire defaults
  // v4.0+ NEW per idea-265 multi-participant + MEDIUM-R3.1 + MEDIUM-R4.1 — current-principal SDK context-dependency Step 2 of 4-step precedence chain.
  // When set, applies to all queries from this Missioncraft instance; per-call override takes precedence (Step 1).
  readonly principal?: string;                // opaque-string per MissionParticipant.principal format
}

/**
 * v1.0.5 idea-273 — progress-event for long-running SDK ops.
 *
 * Emitted by start() / abandon() / complete() at phase-boundaries when caller supplies
 * `onProgress` callback. Operator-pluggable sink (CLI installs default stderr-emit sink;
 * IDEs/GUIs can install custom sinks per Design v4.8 5-pluggable-interfaces philosophy).
 */
export interface ProgressEvent {
  /** Canonical phase identifier (e.g., "clone", "spawn-daemon", "squash"). */
  readonly phase: string;
  /** Operator-readable phase description. */
  readonly message: string;
  /** Optional: 0-100 for trackable progress like clone-with-bytes. */
  readonly percent?: number;
  /** Optional: bytes-transferred / total for clone/push. */
  readonly bytes?: { transferred: number; total: number };
  /** Optional: ms duration of completed phase. */
  readonly duration?: number;
}

/** v1.0.5 idea-273 — caller-supplied progress sink. */
export type ProgressCallback = (event: ProgressEvent) => void;

export interface StateDurabilityConfig {
  readonly mechanism?: 'layered';                // v1: 'layered' only (single mechanism in v1)
  readonly wipCadenceMs?: number;                // default 30_000 (per F4)
  readonly snapshotCadenceMs?: number;           // default 300_000 (5min) per F4
  readonly snapshotRoot?: string;                // required when diskFailureRecovery=true; default `<workspaceRoot>/snapshots`
  readonly snapshotRetention?: {
    readonly minCount?: number;                  // default 5 per F15
    readonly minAgeHours?: number;               // default 24 per F15
  };
  readonly wipBranchCleanup?: 'delete-on-complete-retain-on-abandon' | 'always-delete' | 'always-retain';  // default 'delete-on-complete-retain-on-abandon' per F16
  readonly processCrashRecovery?: boolean;       // default true
  readonly diskFailureRecovery?: boolean;        // default true
  readonly networkPartitionResilience?: boolean; // default true
  readonly networkRetry?: {
    readonly maxAttempts?: number;               // default 5 (v1.5 fold per MEDIUM-R4.3 aligned with §2.5 + §2.6.3)
    readonly backoffMs?: number;                 // default 1000
  };
  // v4.0+ NEW per idea-265 multi-participant + W5c MEDIUM-R8.1 — reader-daemon Loop B coord-poll cadence.
  // Reader-mode setInterval timer-poll fires `git fetch --tags <coord-remote>` every coordPollMs.
  // Bounds: 1000ms (1s) to 300_000ms (5min); default 5000ms (5s).
  // mission-78 W5-new slice (iv): SUPERSEDED by `pullIntervalSeconds` (cadence-config in seconds);
  // coordPollMs retained for v4.x back-compat through W7-new but deprecated for v5.0 missions.
  readonly coordPollMs?: number;
  // ─── mission-78 W5-new slice (i) (Design v5.0 §10.2 + §10.5): symmetric push/pull cadence ───
  // pushCadence (writer-side): 'on-complete-only' (no auto-push; manual msn complete only) |
  //                            'every-Ns' (auto-push every pushIntervalSeconds; default) |
  //                            'on-demand' (manual API-trigger only — operator-DX call)
  // pushIntervalSeconds: int ≥10s (default 60s); ignored unless pushCadence === 'every-Ns'.
  // pullCadence (reader-side): 'every-Ns' (auto-pull at pullIntervalSeconds; default) |
  //                            'on-demand' (manual API-trigger only)
  // pullIntervalSeconds: int ≥5s (default 30s); ignored unless pullCadence === 'every-Ns'.
  // Asymmetric defaults: push 60s + pull 30s (2x readers-per-write rate; catches new pushes promptly).
  // Validation NOT role-conditional at schema layer — writer-side fields on reader-mission are
  // operator-DX-irrelevant (not consumed); same for reader-side fields on writer-mission. Parallel
  // to existing pattern of wipCadenceMs (writer-side) + coordPollMs (reader-side) coexisting in
  // StateDurabilityConfigSchema without role-conditional validation.
  readonly pushCadence?: 'on-complete-only' | 'every-Ns' | 'on-demand';
  readonly pushIntervalSeconds?: number;
  readonly pullCadence?: 'every-Ns' | 'on-demand';
  readonly pullIntervalSeconds?: number;
}
