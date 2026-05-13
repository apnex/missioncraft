// Current-principal resolution helper (Design v4.8 §2.3.1 v4.4 fold — 4-step precedence chain).
// Per-principal config-path resolution. (Originally consumed by mc.join + mc.leave; both deleted
// at W7-new. Retained for future per-principal use cases.)
//
// Precedence (per Design §2.3.1 v4.4):
//   1. Explicit `principal` arg (highest priority; per-call override)
//   2. SDK constructor `principal` field (this.principal)
//   3. Env-var `MSN_PRINCIPAL_ID`
//   4. IdentityProvider.resolve() — derives from local-git-config OR provider-default

import type { IdentityProvider } from '../pluggables/index.js';

export interface PrincipalResolutionInput {
  readonly explicitPrincipal?: string;
  readonly constructorPrincipal?: string;
  readonly identity?: IdentityProvider;
  readonly envVar?: string;                  // process.env.MSN_PRINCIPAL_ID; allows test injection
}

/**
 * Resolve current principal per Design §2.3.1 v4.4 4-step precedence chain.
 *
 * Returns format `<user>@<host>` per MINOR-R1.4 (opaque-string at v1; principal-equality via
 * string-comparison). Falls back to identity.email if env-var + explicit + constructor unset.
 *
 * Throws ConfigValidationError if all 4 sources fail (no principal resolvable).
 */
export async function resolveCurrentPrincipal(input: PrincipalResolutionInput): Promise<string> {
  // Step 1: explicit arg
  if (input.explicitPrincipal) return input.explicitPrincipal;
  // Step 2: SDK constructor
  if (input.constructorPrincipal) return input.constructorPrincipal;
  // Step 3: env-var
  const envVar = input.envVar ?? process.env.MSN_PRINCIPAL_ID;
  if (envVar) return envVar;
  // Step 4: identity provider
  if (input.identity) {
    const ident = await input.identity.resolve();
    return ident.email;        // canonical principal = identity.email at v1
  }
  throw new Error(
    'resolveCurrentPrincipal: no principal source resolvable (explicit / constructor / MSN_PRINCIPAL_ID env-var / IdentityProvider all unset)',
  );
}
