// MissionConfigSchema (Design v4.8 §2.5)
// v4.5 fold per MEDIUM-R6.4 — schema-factory pattern for role-based state-validation.
// makeMissionConfigSchema(owningPrincipalRole) returns closure-captured-context schema;
// engine constructs role-aware schema per parse-site (file-path → role → schema-instance).
//
// Naming-convention contract (v1.2 fold per HIGH-4): TypeScript camelCase (this file's exported types) ↔ YAML kebab-case (wire format).
// W1 implementation: schemas accept camelCase (TS-side canonical); kebab↔camelCase YAML-parse transform is W2+ engineering work
// at the YAML-hydration parse-site (per §2.5 spec — single canonical schema reused for YAML hydration + object validation).

import { z } from 'zod';

// ─── RepoSpec (Design v4.8 §2.5; exported separately for mutation-validation) ───
export const RepoSpecSchema = z.object({
  url: z.string(),
  // local-name; auto-derived from URL last segment if omitted; MUST match DNS-style slug per MEDIUM-R2.5
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'name must match DNS-style slug [a-z0-9][a-z0-9-]{1,62}')
    .optional(),
  branch: z.string().optional(),
  base: z.string().optional(),
  commitSha: z.string().optional(),
});

// ─── MissionParticipant (v4.0 NEW per idea-265) ───
export const MissionParticipantSchema = z.object({
  principal: z.string(),                            // opaque-string at v1; format <user>@<host> per MINOR-R1.4
  role: z.enum(['writer', 'reader']),
  addedAt: z.coerce.date(),
});

// ─── MissionStatePhase enum (10 values; 6 writer-side + 4 reader-side per HIGH-R2.3) ───
const WRITER_STATES = [
  'created',
  'configured',
  'started',
  'in-progress',
  'completed',
  'abandoned',
] as const;
const READER_STATES = ['joined', 'reading', 'readonly-completed', 'leaving'] as const;
const ALL_STATES = [...WRITER_STATES, ...READER_STATES] as const;

export const MissionStatePhaseSchema = z.enum(ALL_STATES);

// Internal sets for role-based superRefine (factory pattern per MEDIUM-R6.4)
const WRITER_STATES_SET = new Set<string>(WRITER_STATES);
const READER_STATES_SET = new Set<string>(READER_STATES);

// ─── State-durability config schema (v1.3 fold per MEDIUM-R3.2) ───
const StateDurabilityConfigSchema = z.object({
  mechanism: z.literal('layered').optional(),
  wipCadenceMs: z.number().int().positive().optional(),
  snapshotCadenceMs: z.number().int().positive().optional(),
  snapshotRoot: z.string().optional(),
  snapshotRetention: z
    .object({
      minCount: z.number().int().nonnegative().optional(),
      minAgeHours: z.number().int().nonnegative().optional(),
    })
    .optional(),
  wipBranchCleanup: z
    .enum(['delete-on-complete-retain-on-abandon', 'always-delete', 'always-retain'])
    .optional(),
  processCrashRecovery: z.boolean().optional(),
  diskFailureRecovery: z.boolean().optional(),
  networkPartitionResilience: z.boolean().optional(),
  networkRetry: z
    .object({
      maxAttempts: z.number().int().positive().optional(),
      backoffMs: z.number().int().nonnegative().optional(),
    })
    .optional(),
  // W5c — reader-daemon Loop B coord-poll cadence (1000-300_000ms; default 5000ms)
  coordPollMs: z.number().int().min(1000).max(300_000).optional(),
});

// ─── MissionConfigSchema factory (v4.5 fold per MEDIUM-R6.4) ───

const baseMissionConfigShape = z.object({
  // mission-78 W4-new (Design v5.0 §2 row 5): schema-version 1 → 2. Schema-v1 REFUSED at parse
  // per no-backward-compat ship discipline (Design v5.0 §12). z.literal(2) rejects any value
  // other than 2; the ConfigValidationError wrapping at yaml-transform.ts:154-160 surfaces a
  // clear "schema-validation-fail" message for v1 configs.
  missionConfigSchemaVersion: z.literal(2),
  mission: z.object({
    id: z.string().regex(/^msn-[a-f0-9]{8}$/, 'mission.id MUST match msn-<8-char-hex>'),
    name: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'mission.name MUST match DNS-style slug')
      .optional(),
    hubId: z.string().optional(),
    // v1.0.6 bug-70: optional eager-inline scope reference (omitted when not scope-bound).
    // YAML wire-format is `scope-id` per kebab-case transform.
    scopeId: z.string().regex(/^scp-[a-f0-9]{8}$/, 'mission.scopeId MUST match scp-<8-char-hex>').optional(),
    description: z.string().optional(),
    lifecycleState: MissionStatePhaseSchema.default('created'),
    createdAt: z.coerce.date(),
    tags: z.record(z.string(), z.string()).optional(),
    // v4.0 NEW per idea-265 multi-participant
    participants: z.array(MissionParticipantSchema).optional(),
    coordinationRemote: z.string().url().optional(),
    // ─── mission-78 W4-new (Design v5.0 §2 row 4): reader-mission fields ───
    // readOnly: true identifies a reader-mission (BRANCH-TRACKER via msn join OR
    //           PERSISTENT-TRACKER via msn watch). false/undefined = writer-mission.
    // sourceMissionId: present iff BRANCH-TRACKER (msn join <writer-mission-id>); references
    //                  the writer-mission whose branch is tracked. Auto-close on writer-terminal.
    // sourceRemote + sourceBranch: present iff PERSISTENT-TRACKER (msn watch --repo --branch);
    //                              reader-daemon Loop B fetches from this remote+branch at
    //                              pullCadence. Long-lived; operator-explicit-abandon terminal only.
    // Validation: BRANCH-TRACKER uses sourceMissionId; PERSISTENT-TRACKER uses
    //             sourceRemote+sourceBranch; mutually-exclusive (one OR the other, not both).
    readOnly: z.boolean().optional(),
    sourceMissionId: z.string().regex(/^msn-[a-f0-9]{8}$/, 'mission.sourceMissionId MUST match msn-<8-char-hex>').optional(),
    sourceRemote: z.string().url().optional(),
    sourceBranch: z.string().optional(),
    // W4.3 publish-flow + abandon-flow runtime-state (Design v4.9 §2.4.1 lines 640-650)
    publishMessage: z.string().optional(),
    abandonMessage: z.string().optional(),
    publishStatus: z.record(z.string(), z.enum(['pending', 'squashed', 'pushed', 'pr-opened', 'failed'])).optional(),
    publishedPRs: z.array(z.object({ repoName: z.string(), prUrl: z.string() })).optional(),
    abandonProgress: z.enum(['tick-fired', 'daemon-killed', 'message-persisted', 'locks-released', 'branches-cleaned', 'workspace-handled', 'config-purged']).optional(),
    abandonRepoStatus: z.record(z.string(), z.enum(['pending', 'cleaned', 'failed'])).optional(),
  }),
  repos: z.array(RepoSpecSchema),
  identity: z.object({ provider: z.string() }).optional(),
  approval: z.object({ provider: z.string() }).optional(),
  storage: z.object({ provider: z.string() }).optional(),
  gitEngine: z.object({ provider: z.string() }).optional(),
  remote: z.object({ provider: z.string() }).optional(),
  workspaceRoot: z.string().optional(),
  stateDurability: StateDurabilityConfigSchema.optional(),
  autoMerge: z.object({ strategy: z.enum(['ff', 'no-ff']) }).optional(),
  lockTimeout: z
    .object({
      waitMs: z.number().int().nonnegative().optional(),
      validityMs: z.number().int().positive().optional(),
    })
    .optional(),
});

/**
 * MissionConfigSchema factory (v4.5 fold per MEDIUM-R6.4 — schema-factory pattern).
 *
 * Engine constructs role-aware schema per parse-site (file-path → role → schema-instance):
 *
 * ```typescript
 * import { deriveOwningPrincipalRole } from './role-derivation';
 * const role = deriveOwningPrincipalRole(configFilePath);
 * const schema = makeMissionConfigSchema(role);
 * const config = schema.parse(yaml.parse(fs.readFileSync(configFilePath, 'utf8')));
 * ```
 *
 * Refinements applied:
 * - F-V4.2 conditional: `coordinationRemote` required IFF `participants[]` contains a reader
 * - v1: exactly 1 writer per mission; co-writer mode deferred to v1.x per Lean 6 YAGNI
 * - Role-based state-validation: writer-side config rejects reader-side enum-values + vice versa (v4.5 fold per MEDIUM-R6.4)
 *
 * Backward-compat: parse-sites without role default to writer-role (per role-derivation.ts W1 placeholder)
 * for v3.6-baseline-compatible behavior (legacy single-principal missions never reach reader-states).
 */
export function makeMissionConfigSchema(owningPrincipalRole: 'writer' | 'reader' = 'writer') {
  return baseMissionConfigShape.superRefine((config, ctx) => {
    // F-V4.2 conditional-validation: coordinationRemote required IFF participants[] contains a reader
    const hasReader =
      config.mission.participants?.some((p) => p.role === 'reader') ?? false;
    if (hasReader && !config.mission.coordinationRemote) {
      ctx.addIssue({
        code: 'custom',
        message:
          'mission.coordinationRemote required when mission.participants[] contains a reader (F-V4.2 conditional-validation per Design v4.8 §2.5)',
        path: ['mission', 'coordinationRemote'],
      });
    }
    // ─── mission-78 W4-new (Design v5.0 §2 row 4): reader-mission field validation ───
    // readOnly: true → MUST have sourceMissionId (BRANCH-TRACKER) XOR
    //                   sourceRemote+sourceBranch (PERSISTENT-TRACKER)
    // readOnly: false/undefined → MUST NOT have source* fields (writer-missions don't track sources)
    const isReadOnly = config.mission.readOnly === true;
    const hasBranchTracker = config.mission.sourceMissionId !== undefined;
    const hasPersistentTracker =
      config.mission.sourceRemote !== undefined && config.mission.sourceBranch !== undefined;
    const hasPersistentPartial =
      (config.mission.sourceRemote !== undefined) !== (config.mission.sourceBranch !== undefined);

    if (isReadOnly) {
      if (hasBranchTracker && (hasPersistentTracker || hasPersistentPartial)) {
        ctx.addIssue({
          code: 'custom',
          message:
            'reader-mission MUST be either BRANCH-TRACKER (sourceMissionId only) OR PERSISTENT-TRACKER (sourceRemote+sourceBranch); both specified',
          path: ['mission', 'readOnly'],
        });
      } else if (hasPersistentPartial) {
        // sourceRemote OR sourceBranch (one but not both) — surface the partial-spec error
        // BEFORE the "EITHER...OR" no-source error (more specific takes precedence)
        ctx.addIssue({
          code: 'custom',
          message:
            'PERSISTENT-TRACKER reader-mission MUST specify BOTH sourceRemote AND sourceBranch (one without the other is invalid)',
          path: ['mission', config.mission.sourceRemote === undefined ? 'sourceRemote' : 'sourceBranch'],
        });
      } else if (!hasBranchTracker && !hasPersistentTracker) {
        ctx.addIssue({
          code: 'custom',
          message:
            'reader-mission (readOnly: true) MUST specify EITHER sourceMissionId (BRANCH-TRACKER via msn join) OR sourceRemote+sourceBranch (PERSISTENT-TRACKER via msn watch)',
          path: ['mission', 'readOnly'],
        });
      }
    } else {
      // writer-mission (readOnly false/undefined): source* fields are not applicable
      if (hasBranchTracker || config.mission.sourceRemote !== undefined || config.mission.sourceBranch !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message:
            'writer-mission (readOnly false/undefined) MUST NOT specify source* fields (sourceMissionId/sourceRemote/sourceBranch are reader-mission-only)',
          path: ['mission', 'readOnly'],
        });
      }
    }
    // v1 exactly-1-writer enforcement; co-writer mode deferred to v1.x per Lean 6 YAGNI
    if (config.mission.participants && config.mission.participants.length > 0) {
      const writerCount = config.mission.participants.filter((p) => p.role === 'writer').length;
      if (writerCount !== 1) {
        ctx.addIssue({
          code: 'custom',
          message: `exactly 1 writer required at v1 (found ${writerCount}); co-writer mode deferred to v1.x per Lean 6 YAGNI`,
          path: ['mission', 'participants'],
        });
      }
    }
    // v4.5 fold per MEDIUM-R6.4 — role-based state-validation
    // Engine determines config's owning-principal from file-path mapping per HIGH-R1.2 partition-spec;
    // factory closes over owningPrincipalRole.
    const lifecycleState = config.mission.lifecycleState;
    if (owningPrincipalRole === 'writer' && !WRITER_STATES_SET.has(lifecycleState)) {
      ctx.addIssue({
        code: 'custom',
        message: `writer-side config rejects reader-side lifecycle-state '${lifecycleState}' (per v4.5 fold MEDIUM-R6.4 role-based state-validation)`,
        path: ['mission', 'lifecycleState'],
      });
    }
    if (owningPrincipalRole === 'reader' && !READER_STATES_SET.has(lifecycleState)) {
      ctx.addIssue({
        code: 'custom',
        message: `reader-side config rejects writer-side lifecycle-state '${lifecycleState}' (per v4.5 fold MEDIUM-R6.4 role-based state-validation)`,
        path: ['mission', 'lifecycleState'],
      });
    }
  });
}

/**
 * Default-export MissionConfigSchema = writer-role factory invocation.
 *
 * v3.6-baseline parse-sites that don't pass role get the writer-role schema (legacy single-principal compat).
 * V4.0+ engine-internal parse-sites SHOULD use makeMissionConfigSchema(role) explicitly with role-derivation.
 */
export const MissionConfigSchema = makeMissionConfigSchema('writer');
