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
 * - Engine knows config's owning-principal from file-path mapping via OperatorConfig.workspaceRootByPrincipal
 * - Owning-principal compared against currentPrincipal → writer (match) | reader (mismatch) | writer (no map = legacy)
 *
 * W5 slice (i) impl: full per-principal partition-spec lookup per OperatorConfig.workspaceRootByPrincipal map.
 *
 * @param configFilePath - absolute path to mission-config YAML
 * @param currentPrincipal - optional current-principal context (per §2.3.1 4-step precedence chain)
 * @param workspaceRootByPrincipal - optional map from principal-id → workspace-root path; from OperatorConfig
 * @returns 'writer' | 'reader' — used by makeMissionConfigSchema(role) factory at parse-site
 */
export function deriveOwningPrincipalRole(
  configFilePath: string,
  currentPrincipal?: string,
  workspaceRootByPrincipal?: Record<string, string>,
): 'writer' | 'reader' {
  // No principal map OR no current-principal → default writer (v3.6-baseline single-principal compat)
  if (!workspaceRootByPrincipal || !currentPrincipal) return 'writer';

  // Find owning-principal: longest-prefix-match of configFilePath against workspace-root values
  // (handles nested workspace-roots; longest-match wins per HIGH-R1.2 partition-spec)
  let owningPrincipal: string | undefined;
  let longestMatchLen = 0;
  for (const [principal, root] of Object.entries(workspaceRootByPrincipal)) {
    if (configFilePath.startsWith(root) && root.length > longestMatchLen) {
      owningPrincipal = principal;
      longestMatchLen = root.length;
    }
  }

  // No owning-principal match → default writer (legacy single-principal compat)
  if (!owningPrincipal) return 'writer';

  // Owning-principal == current-principal → writer; else → reader
  return owningPrincipal === currentPrincipal ? 'writer' : 'reader';
}

/**
 * Canonicalize a coordinationRemote git-URL per Design v4.8 §2.10.4 wire-format normalization.
 * Strips trailing slash; lowercases scheme; preserves path-case (case-sensitive on remote).
 */
export function canonicalizeCoordinationRemote(url: string): string {
  let canonical = url.trim();
  // Strip trailing slash (single)
  if (canonical.endsWith('/')) canonical = canonical.slice(0, -1);
  // Lowercase scheme (https / git / ssh / file are case-insensitive per RFC 3986)
  canonical = canonical.replace(/^(\w+):\/\//, (_, scheme: string) => `${scheme.toLowerCase()}://`);
  return canonical;
}
