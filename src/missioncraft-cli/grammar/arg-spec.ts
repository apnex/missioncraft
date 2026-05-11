// Machine-readable arg-count + flag spec (Design v4.8 §2.3.2 — v1.5 fold per MEDIUM-R4.11 normalized arg-count grammar).
// Reference impl for Rule 6 post-dispatch arg-count validation.
// Strict-1.0 commits this normalized table; any v1.x verb additions are additive.

/** Top-level reserved verbs at v4.0 — Rule 1 (v4.0 fold per idea-265 multi-participant: adds `join` + `leave` reader-side verbs). */
export const RESERVED_VERBS = [
  'create',
  'list',
  'show',
  'start',
  'apply',
  'update',
  'complete',
  'abandon',
  'tick',
  'scope',
  'workspace',
  'config',
  'join',         // v4.0 NEW per HIGH-R2.2
  'leave',        // v4.0 NEW per HIGH-R2.2
  'help',         // v1.0.3 bug-64 item 8: primary help-verb; `--help` alias retained
  'cd',           // v1.0.3 idea-269: operator quick-jump via bash-fn wrapper (msn shell-init)
  'shell-init',   // v1.0.3 idea-269: emits shell-function blob for bash/zsh/fish
  '--help',
  '--version',
] as const;

export type ReservedVerb = (typeof RESERVED_VERBS)[number];

/** Update-scoped sub-actions (after `msn update <mission-id|name>`) — Rule 2. */
export const UPDATE_SUB_ACTIONS = [
  'repo-add',
  'repo-remove',
  'name',
  'description',
  'hub-id',
  'scope-id',
  'tags-set',
  'tags-remove',
] as const;

/** Scope-namespace sub-verbs (after `msn scope`) — Rule 2. */
export const SCOPE_SUB_VERBS = ['create', 'show', 'list', 'update', 'delete'] as const;

/** Scope-update sub-actions (after `msn scope update <scope-id|name>`) — Rule 2. */
export const SCOPE_UPDATE_SUB_ACTIONS = [
  'repo-add',
  'repo-remove',
  'name',
  'description',
  'tags-set',
  'tags-remove',
] as const;

/** Config-namespace sub-verbs (after `msn config`) — Rule 2. */
export const CONFIG_SUB_VERBS = ['get', 'set'] as const;

/** Global flags — apply uniformly across all verbs (Design v4.8 §2.3.2 v1.4 fold per MINOR-R3.1). */
export interface FlagSpec {
  readonly name: string;          // e.g., '--name'
  readonly takesValue: boolean;
  readonly required?: boolean;
  readonly repeatable?: boolean;
  readonly description?: string;
}

export const GLOBAL_FLAGS: readonly FlagSpec[] = [
  { name: '--workspace-root', takesValue: true, description: 'Override workspace-root for this invocation' },
  { name: '--wip-cadence-ms', takesValue: true, description: 'Override WIP commit cadence' },
  { name: '--snapshot-cadence-ms', takesValue: true, description: 'Override snapshot cadence' },
  { name: '--lock-wait-ms', takesValue: true, description: 'Override lock-acquire wait timeout' },
  { name: '--lock-validity-ms', takesValue: true, description: 'Override lock-validity TTL' },
  { name: '--output', takesValue: true, description: 'Override default output format (text|json|yaml; for read-verbs only)' },
];

/** Per-verb arg-count + flag spec — Rule 6 post-dispatch validation reads this. */
export interface VerbArgSpec {
  /** Required positional count (positionals MUST be present). */
  readonly required: number;
  /** Optional positional count (additional; max total = required + optional). */
  readonly optional: number;
  /** Verb-specific flags (excluding global flags). */
  readonly flags: readonly FlagSpec[];
  /**
   * Disjunctive arg-shape (v1.6 fold per MEDIUM-R5.4):
   * verb accepts EITHER (a) flag-form OR (b) positional-form; mutually-exclusive at parser.
   * Example: `msn start -f <path>` (flag-form) OR `msn start <id|name>` (positional-form).
   */
  readonly disjunctive?: {
    /** When this flag is present, switch to alternate arg-count. */
    readonly flagName: string;
    /** Required positional count when disjunctive flag IS present. */
    readonly altRequired: number;
  };
  /** Sub-action map for verbs with verb-scoped vocabularies (`update`, `scope`, `config`). */
  readonly subActions?: Record<string, VerbArgSpec>;
  /** Optional human-readable description. */
  readonly description?: string;
}

export const VERB_SPECS: Record<string, VerbArgSpec> = {
  // ─── Mission verbs ───
  create: {
    required: 0,
    optional: 0,
    flags: [
      { name: '--name', takesValue: true, description: 'Optional human-friendly slug' },
      { name: '--repo', takesValue: true, repeatable: true, description: 'Repo URL (repeatable)' },
      { name: '--scope', takesValue: true, description: 'Scope-id or name to inline' },
    ],
    description: 'Scaffold mission config; auto-generates msn-<8-char-hash>',
  },
  list: {
    required: 0,
    optional: 1,                 // v4.0 drill-down: optional <id|name> for repo-list within mission
    flags: [
      { name: '--status', takesValue: true, description: 'Filter by lifecycle-state' },
    ],
    description: 'Tabular view; 0-positional = list missions; 1-positional = drill-down (row-per-repo)',
  },
  show: {
    required: 1,                 // <id|name>; supports coord-form per Rule N
    optional: 0,
    flags: [
      { name: '--repos', takesValue: false, description: 'Show just the repo-list' },
    ],
    description: 'Detail view (k8s describe). Accepts coord-form per Rule N for repo-granularity.',
  },
  start: {
    required: 1,                 // <id|name> default; OR -f <path> (disjunctive)
    optional: 0,
    flags: [
      { name: '-f', takesValue: true, description: 'Start from explicit YAML path (disjunctive with positional)' },
      { name: '--retain', takesValue: false, description: 'Preserve workspace at terminal' },
    ],
    disjunctive: { flagName: '-f', altRequired: 0 },
    description: 'Realize declared state; spawns daemon-watcher; clones repos; allocates workspace',
  },
  apply: {
    required: 0,
    optional: 0,
    flags: [
      { name: '-f', takesValue: true, required: true, description: 'Apply from YAML path' },
    ],
    description: 'Upsert (refinement #3); additive-only mid-mission',
  },
  complete: {
    required: 2,                 // <id|name> <message>
    optional: 0,
    flags: [
      { name: '--purge-config', takesValue: false, description: 'Delete config + symlink at terminal' },
    ],
    description: 'Atomic PR-set publish-flow per §2.4.1 v3.0 Refinement #4',
  },
  abandon: {
    required: 2,                 // <id|name> <message>
    optional: 0,
    flags: [
      { name: '--purge-config', takesValue: false },
    ],
    description: 'Cleanup-only (NO PR creation); per-repo local mission-branch cleanup',
  },
  tick: {
    required: 1,                 // <id|name>
    optional: 0,
    flags: [],
    description: 'Explicit cadence-tick trigger',
  },
  workspace: {
    required: 1,                 // <id|name> OR <coord> per Rule N
    optional: 1,                 // <repo-name>
    flags: [],
    description: 'Returns absolute path to mission workspace; supports coord-form per Rule N',
  },
  // ─── Update sub-action namespace ───
  update: {
    required: 2,                 // <id|name> <sub-action>; sub-action validates remaining args via subActions map
    optional: 0,
    flags: [],
    subActions: {
      // Note: counts are positionals AFTER sub-action keyword stripped (resource-id KEPT in positionals).
      // E.g., `msn update <id> repo-add <file|url>` → parser strips 'repo-add'; positionals = [<id>, <file|url>]; required=2.
      'repo-add': {
        required: 2,             // <id> + <file|url>
        optional: 0,
        flags: [
          { name: '--name', takesValue: true },
          { name: '--branch', takesValue: true },
          { name: '--base', takesValue: true },
        ],
      },
      'repo-remove': { required: 2, optional: 0, flags: [] },      // <id> + <repo-name>
      name: { required: 2, optional: 0, flags: [] },                // <id> + <new-name>
      description: { required: 2, optional: 0, flags: [] },         // <id> + <text>
      'hub-id': { required: 2, optional: 0, flags: [] },            // <id> + <hub-id>
      'scope-id': { required: 2, optional: 0, flags: [] },          // <id> + <scope-id|name|"">
      'tags-set': { required: 3, optional: 0, flags: [] },          // <id> + <key> + <value>
      'tags-remove': { required: 2, optional: 0, flags: [] },       // <id> + <key>
    },
    description: 'Field-targeted mutation via update<T> polymorphism',
  },
  // ─── Multi-participant verbs (v4.0 NEW per HIGH-R2.2) ───
  join: {
    required: 1,                 // <id|name>
    optional: 0,
    flags: [
      { name: '--coord-remote', takesValue: true, required: true, description: 'Coord-remote URL (REQUIRED)' },
      { name: '--principal', takesValue: true, description: 'Optional principal-id override (defaults to IdentityProvider.resolve)' },
    ],
    description: 'Reader-side mission-engagement; spawns 7-step joined→reading transition',
  },
  leave: {
    required: 1,                 // <id|name>
    optional: 0,
    flags: [
      { name: '--purge-workspace', takesValue: false, description: 'Remove workspace (default: preserve for forensic-history)' },
    ],
    description: 'Reader-side mission-disengagement',
  },
  // ─── Scope namespace ───
  scope: {
    required: 1,                 // <sub-verb>; sub-verb validates remaining args
    optional: 0,
    flags: [],
    subActions: {
      create: {
        required: 0,
        optional: 0,
        flags: [
          { name: '--name', takesValue: true },
          { name: '--description', takesValue: true },
          { name: '--repo', takesValue: true, repeatable: true },
        ],
      },
      show: {
        required: 1,
        optional: 0,
        flags: [
          { name: '--include-references', takesValue: false },
        ],
      },
      list: {
        required: 0,
        optional: 0,
        flags: [
          { name: '--include-references', takesValue: false },
        ],
      },
      update: {
        required: 2,                                    // <scope-id|name> <sub-action>
        optional: 0,
        flags: [],
        subActions: {
          // Counts are positionals AFTER sub-action keyword stripped (scope-id KEPT in positionals).
          'repo-add': {
            required: 2,                                // <scope-id> + <file|url>
            optional: 0,
            flags: [
              { name: '--name', takesValue: true },
              { name: '--branch', takesValue: true },
              { name: '--base', takesValue: true },
            ],
          },
          'repo-remove': { required: 2, optional: 0, flags: [] },   // <scope-id> + <repo-name>
          name: { required: 2, optional: 0, flags: [] },             // <scope-id> + <new-name>
          description: { required: 2, optional: 0, flags: [] },      // <scope-id> + <text>
          'tags-set': { required: 3, optional: 0, flags: [] },       // <scope-id> + <key> + <value>
          'tags-remove': { required: 2, optional: 0, flags: [] },    // <scope-id> + <key>
        },
      },
      delete: { required: 1, optional: 0, flags: [] },
    },
    description: 'Scope-namespace verb (v2.0 NEW per Refinement C)',
  },
  // ─── Operator quick-jump (v1.0.3 idea-269) ───
  cd: {
    required: 1,                 // <id|name>; semantic = `cd $(msn workspace <id>)` via bash-fn wrapper
    optional: 1,                 // <repo-name> for multi-repo missions
    flags: [],
    description: 'Operator quick-jump (requires `eval "$(msn shell-init bash)"` wrapper)',
  },
  'shell-init': {
    required: 1,                 // <shell> — one of bash / zsh / fish
    optional: 0,
    flags: [],
    description: 'Emit shell-function blob; `eval "$(msn shell-init bash)"` in your shell rc enables `msn cd`',
  },
  // ─── Config namespace ───
  config: {
    required: 1,                 // <sub-verb>; sub-verb validates remaining args
    optional: 0,
    flags: [],
    subActions: {
      get: { required: 1, optional: 0, flags: [] },                // <key>
      set: { required: 2, optional: 0, flags: [] },                // <key> <value>
    },
    description: 'Operator-config get/set',
  },
};

/** Reserved-words list for slug-format validation (Rule 5) — operator can't create mission/scope with these names. */
export const RESERVED_NAMES_PROTECTED = new Set<string>([
  ...RESERVED_VERBS,
  ...UPDATE_SUB_ACTIONS,
  ...SCOPE_SUB_VERBS,
  ...SCOPE_UPDATE_SUB_ACTIONS,
  ...CONFIG_SUB_VERBS,
]);
