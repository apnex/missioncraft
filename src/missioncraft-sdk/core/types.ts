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
}
