// OperatorConfigSchema (Design v4.8 §2.4 v1.7 fold per MEDIUM-R6.4 — global preferences distinct from per-mission config)
// File location: `${MSN_WORKSPACE_ROOT}/operator.yaml` (default `~/.missioncraft/operator.yaml`).
// v4.4 fold per MEDIUM-R1.7 — multi-principal extension with `defaults.workspace-root-by-principal` map.

import { z } from 'zod';

const StateDurabilityDefaultsSchema = z.object({
  wipCadenceMs: z.number().int().positive().optional(),
  snapshotCadenceMs: z.number().int().positive().optional(),
  snapshotRetention: z
    .object({
      minCount: z.number().int().nonnegative().optional(),
      minAgeHours: z.number().int().nonnegative().optional(),
    })
    .optional(),
  wipBranchCleanup: z
    .enum(['delete-on-complete-retain-on-abandon', 'always-delete', 'always-retain'])
    .optional(),
  networkRetry: z
    .object({
      maxAttempts: z.number().int().positive().optional(),
      backoffMs: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

const ProviderConfigSchema = z
  .object({
    'gh-cli': z.object({ path: z.string() }).optional(),
  })
  .catchall(z.unknown());                        // v1.x can ADD provider-config keys (additive-only)

export const OperatorConfigSchema = z.object({
  operatorConfigSchemaVersion: z.literal(1),
  defaults: z.object({
    identityProvider: z.string().optional(),     // PROVIDER_REGISTRY string-name
    approvalProvider: z.string().optional(),
    storageProvider: z.string().optional(),
    gitEngineProvider: z.string().optional(),
    remoteProvider: z.string().optional(),
    workspaceRoot: z.string().optional(),        // operator-default; CLI/env override per precedence chain
    snapshotRoot: z.string().optional(),
    /**
     * v4.4 fold per MEDIUM-R1.7 multi-principal extension —
     * Resolves on multi-principal hosts (per HIGH-R1.2 partition-spec — workspace-root MUST be principal-distinct).
     * Optional: if absent, single-principal-on-host behavior preserved (uses `workspaceRoot` above; v3.6 baseline).
     *
     * Engine resolution (current-principal precedence chain Step 5 per §2.3.1):
     *   1. CLI flag --workspace-root <path>
     *   2. Env-var MSN_WORKSPACE_ROOT
     *   3. mission-config workspaceRoot field (per-mission override)
     *   4. SDK constructor workspaceRoot
     *   5. v4.4 NEW: workspaceRootByPrincipal[<current-principal>]
     *   6. defaults.workspaceRoot (single-principal default)
     *   7. built-in default `~/.missioncraft`
     *
     * Multi-principal-host detection: if MULTIPLE principals invoke missioncraft on same OS-user host
     * AND `workspaceRootByPrincipal` is unset → engine emits MissionStateError.
     * Detection mechanism: principal-id mismatch on existing lockfile in workspace.
     */
    workspaceRootByPrincipal: z.record(z.string(), z.string()).optional(),
    stateDurability: StateDurabilityDefaultsSchema.optional(),
    lockTimeout: z
      .object({
        waitMs: z.number().int().nonnegative().optional(),
        validityMs: z.number().int().positive().optional(),
      })
      .optional(),
  }),
  // v1.8 fold per MINOR-R7.2 — provider-context-implicit naming
  providerConfig: ProviderConfigSchema.optional(),
});
