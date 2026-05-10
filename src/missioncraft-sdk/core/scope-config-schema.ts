// ScopeConfigSchema (Design v4.8 §2.5.1 — v2.0 NEW per Refinement C; multi-mission composition primitive)
// Parallel structure to MissionConfigSchema; simpler (no pluggable overrides; no state-durability; no lock-timeout — scopes are templates not active resources).

import { z } from 'zod';
import { RepoSpecSchema } from './mission-config-schema.js';

const ScopeStatePhaseSchema = z.enum(['created', 'deleted']);

export const ScopeConfigSchema = z.object({
  scopeConfigSchemaVersion: z.literal(1),
  scope: z.object({
    id: z.string().regex(/^scp-[a-f0-9]{8}$/, 'scope.id MUST match scp-<8-char-hex>'),
    name: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'scope.name MUST match DNS-style slug')
      .optional(),
    description: z.string().optional(),
    lifecycleState: ScopeStatePhaseSchema.default('created'),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
    tags: z.record(z.string(), z.string()).optional(),
  }),
  repos: z.array(RepoSpecSchema),
});
