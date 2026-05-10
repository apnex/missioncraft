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
});

// ─── MissionConfigSchema factory (v4.5 fold per MEDIUM-R6.4) ───

const baseMissionConfigShape = z.object({
  missionConfigSchemaVersion: z.literal(1),         // REQUIRED top-level; parser-side version-dispatch (v1.3 fold per MINOR-R2.1 — number not string)
  mission: z.object({
    id: z.string().regex(/^msn-[a-f0-9]{8}$/, 'mission.id MUST match msn-<8-char-hex>'),
    name: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'mission.name MUST match DNS-style slug')
      .optional(),
    hubId: z.string().optional(),
    description: z.string().optional(),
    lifecycleState: MissionStatePhaseSchema.default('created'),
    createdAt: z.coerce.date(),
    tags: z.record(z.string(), z.string()).optional(),
    // v4.0 NEW per idea-265 multi-participant
    participants: z.array(MissionParticipantSchema).optional(),
    coordinationRemote: z.string().url().optional(),
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
