// Engine-side role-derivation helper (Design v4.8 §2.5 v4.5 fold per MEDIUM-R6.4 schema-factory pattern;
// HIGH-R1.2 partition-spec workspace-path → owning-principal mapping).
//
// Maps `<workspace>/missions/<id>/...` filesystem path → `'writer' | 'reader'` for parse-site role-dispatch.
// Pure function; testable in isolation. Engine constructs role-aware MissionConfigSchema per parse-site.
//
// W1 implementation: heuristic placeholder (writer-default; reader-detected via principal-id-suffix in workspace-root).
// W2+ refinement: full per-principal partition-spec lookup once OperatorConfigSchema multi-principal extension is wired.

/**
 * Derive owning-principal role for a config-file path.
 *
 * Per HIGH-R1.2 partition-spec (Design v4.8 §2.10.9):
 * - Each principal holds own per-principal `<workspace>/config/<id>.yaml`
 * - Engine knows config's owning-principal from file-path mapping
 * - Writer's workspace if owning-OS-user matches writer-principal-resolution; reader's workspace otherwise
 *
 * @param configFilePath - absolute path to mission-config YAML
 * @param currentPrincipal - optional current-principal context (per §2.3.1 4-step precedence chain);
 *                          if provided, resolves owner-principal vs current-principal for reader-vs-writer determination
 * @returns 'writer' | 'reader' — used by makeMissionConfigSchema(role) factory at parse-site
 *
 * W1 placeholder semantic: defaults to 'writer' for v3.6-baseline-compatible behavior (legacy single-principal missions never reach reader-states; default-writer-validation is no-op for them).
 * Reader detection requires participants[] inspection AT PARSE-TIME — chicken-and-egg with schema validation; W2+ engine-side resolves via two-phase parse (base parse → role-derivation → role-aware re-parse).
 */
export function deriveOwningPrincipalRole(
  configFilePath: string,
  currentPrincipal?: string,
): 'writer' | 'reader' {
  // W1: default to writer per backward-compat semantic
  // (V3.6-baseline missions have NO reader-side states; default-writer parse-validation is no-op for them)
  // W2+ TODO: implement full per-principal partition-spec lookup:
  //   1. parse `<workspace>/operator.yaml` for `defaults.workspace-root-by-principal` map
  //   2. find principal whose workspace-root-prefix matches configFilePath
  //   3. compare against currentPrincipal (or IdentityProvider.resolve()) to determine writer-vs-reader
  void configFilePath;
  void currentPrincipal;
  return 'writer';
}
