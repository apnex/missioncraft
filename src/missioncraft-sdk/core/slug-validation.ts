// mission-78 W6-new slice (iv) (Design v5.0 §10.6 perfection-grade revision (d)):
// SDK-side slug-validation guard. Defense-in-depth at the SDK layer so non-CLI consumers
// (Hub-MCP via idea-291 future + direct API users) get the same parser-level validation as
// the CLI parse-time check (`grammar/parser.ts:78` validateSlugFormat).
//
// Per (c) audit+SDK-defense disposition thread-550 round 6: rejects slugs that would collide
// with the hybrid grammar verb-set + namespace-prefix + DNS-pattern rules. CLI's RESERVED_VERBS
// covers all current verbs (create/list/show/start/update/complete/abandon/scope/workspace/
// config/join/watch/help/cd/shell-init/version/tree); apply/tick (W6-new slice v) + leave
// (W7-new slice iii) DROPPED.
//
// Reserved-name set is hardcoded here (cross-ref to CLI `arg-spec.ts:RESERVED_NAMES_PROTECTED`).
// SDK + CLI maintain INDEPENDENT sets to avoid CLI→SDK reverse-dependency. If verb-set evolves,
// both must be updated; cross-ref comments document this invariant.

/**
 * Reserved names that mission/scope slugs cannot collide with.
 * Mirror of CLI `arg-spec.ts:RESERVED_NAMES_PROTECTED` — keep in sync when verb-set evolves.
 *
 * Includes:
 * - All top-level verbs from CLI RESERVED_VERBS (W6-new hybrid grammar set)
 * - Update sub-actions (repo-add, repo-remove, name, description, hub-id, scope-id,
 *   tags-set, tags-remove)
 * - Scope sub-verbs (create, show, list, update, delete)
 * - Scope update sub-actions (same as mission update sub-actions)
 * - Config sub-verbs (get, set)
 */
const RESERVED_NAMES_PROTECTED_SDK: ReadonlySet<string> = new Set([
  // Top-level verbs (mirror RESERVED_VERBS in CLI arg-spec.ts).
  // W6-new slice (v) DROPPED `apply` + `tick`; W7-new slice (iii) DROPPED `leave`.
  // Sync-discipline maintained per cross-ref comment.
  'create', 'list', 'show', 'start', 'update', 'complete', 'abandon',
  'scope', 'workspace', 'config', 'join', 'watch', 'help',
  'cd', 'shell-init', 'version', 'tree', '--help', '--version',
  // Update sub-actions
  'repo-add', 'repo-remove', 'name', 'description', 'hub-id', 'scope-id',
  'tags-set', 'tags-remove',
  // Scope sub-verbs
  'delete',
  // Config sub-verbs
  'get', 'set',
]);

/**
 * Validate a slug-format candidate per Rule 5 reserved-words protection (SDK-side).
 *
 * Returns undefined on valid slug; throws ConfigValidationError on invalid (matches CLI parser
 * behavior + integrates with existing SDK error-class taxonomy).
 *
 * Rejects:
 * - Slugs matching any reserved verb / sub-action (RESERVED_NAMES_PROTECTED_SDK)
 * - Auto-id namespaces (msn-/scp- prefix)
 * - Slugs containing ':' (substrate-coordinate parsing collision)
 * - Slugs not matching DNS-style `[a-z0-9][a-z0-9-]{1,62}` pattern
 *
 * Per (c) disposition thread-550 round 6: SDK-side defense-in-depth complement to CLI's
 * parse-time validation. Both layers must reject the same set; CLI catches at argv-parse,
 * SDK catches at API-call. Hub-MCP (idea-291 future) calling SDK directly will get this
 * rejection without needing CLI parser.
 */
export function validateSlugAtSdk(slug: string): string | undefined {
  if (RESERVED_NAMES_PROTECTED_SDK.has(slug)) {
    return `slug '${slug}' is a reserved verb/sub-action; cannot be used as mission/scope name`;
  }
  if (slug.startsWith('msn-') || slug.startsWith('scp-')) {
    return `slug '${slug}' starts with auto-id namespace prefix (msn-/scp-); reserved`;
  }
  if (slug.includes(':')) {
    return `slug '${slug}' contains ':' which collides with substrate-coordinate parsing`;
  }
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
    return `slug '${slug}' must match DNS-style pattern [a-z0-9][a-z0-9-]{1,62}`;
  }
  return undefined;
}
