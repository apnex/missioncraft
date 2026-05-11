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
  'version',      // v1.0.4 bug-66 item 1: primary version-verb; `--version` alias retained
  'tree',         // v1.0.4 idea-272: tree-style verb-hierarchy visualization
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

/** Per-verb help example (idea-274). */
export interface VerbExample {
  readonly cmd: string;
  readonly comment?: string;
}

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
  /** Legacy alias (kept for back-compat — readers prefer `shortDesc`). */
  readonly description?: string;
  /** v1.0.4 idea-274 — 1-line summary (REQUIRED for all verbs/sub-verbs in per-verb help). */
  readonly shortDesc?: string;
  /** v1.0.4 idea-274 — paragraph elaborating semantics (optional; required for substantive verbs). */
  readonly longDesc?: string;
  /** v1.0.4 idea-274 — usage examples (optional; required for non-trivial-usage verbs). */
  readonly examples?: readonly VerbExample[];
  /** v1.0.4 idea-274 — cross-refs to related verbs (optional). */
  readonly seeAlso?: readonly string[];
  /** v1.0.4 idea-274 — labels for required + optional positionals in per-verb help (e.g., ['<id|name>', '<message>']). */
  readonly argLabels?: readonly { readonly label: string; readonly description: string }[];
  /** v1.0.4 idea-274 — usage-line syntax override (when default formatter inadequate). */
  readonly usageOverride?: string;
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
    shortDesc: 'Scaffold a new mission config',
    longDesc: 'Generates an msn-<8-char-hash> id and writes the mission YAML to the workspace-root. With --repo flag(s) the mission starts in lifecycle "configured" (ready for `msn start`); without --repo it starts in "created".',
    examples: [
      { cmd: 'msn create', comment: 'minimal mission; no repos; lifecycle=created' },
      { cmd: 'msn create --name alpha --repo https://github.com/x/y.git', comment: 'named single-repo mission; ready for msn start' },
      { cmd: 'msn create --repo https://github.com/x/a.git --repo https://github.com/x/b.git', comment: 'multi-repo mission' },
    ],
    seeAlso: ['start', 'list', 'show'],
  },
  list: {
    required: 0,
    optional: 1,                 // v4.0 drill-down: optional <id|name> for repo-list within mission
    flags: [
      { name: '--status', takesValue: true, description: 'Filter by lifecycle-state' },
    ],
    shortDesc: 'List missions or drill down into a mission\'s repos',
    longDesc: '0-positional form: tabular list of all missions in the workspace. 1-positional form: drill down into <id|name> for row-per-repo detail. --output json|yaml for machine-readable output.',
    argLabels: [{ label: '[<id|name>]', description: 'Optional mission id or name for repo-drill-down' }],
    examples: [
      { cmd: 'msn list', comment: 'all missions, tabular' },
      { cmd: 'msn list --status configured', comment: 'filter to missions in configured state' },
      { cmd: 'msn list alpha', comment: 'drill down to mission \'alpha\' showing per-repo rows' },
      { cmd: 'msn list --output json', comment: 'machine-readable output' },
    ],
    seeAlso: ['show', 'create'],
  },
  show: {
    required: 1,                 // <id|name>; supports coord-form per Rule N
    optional: 0,
    flags: [
      { name: '--repos', takesValue: false, description: 'Show just the repo-list' },
    ],
    shortDesc: 'Show mission details by id or name',
    longDesc: 'Detail view (kubectl-describe style). Accepts coord-form `<id>:<repo>` for repo-granularity. Returns full mission state including lifecycle, repos, participants, daemon-IPC fields, audit progress.',
    argLabels: [{ label: '<id|name>', description: 'Mission identifier or name' }],
    examples: [
      { cmd: 'msn show alpha', comment: 'full mission detail by name' },
      { cmd: 'msn show msn-abc123', comment: 'by id' },
      { cmd: 'msn show alpha --repos', comment: 'just the repo-list section' },
      { cmd: 'msn show alpha --output json', comment: 'JSON for machine consumption' },
    ],
    seeAlso: ['list', 'workspace'],
  },
  start: {
    required: 1,                 // <id|name> default; OR -f <path> (disjunctive)
    optional: 0,
    flags: [
      { name: '-f', takesValue: true, description: 'Start from explicit YAML path (disjunctive with positional)' },
      { name: '--retain', takesValue: false, description: 'Preserve workspace at terminal' },
    ],
    disjunctive: { flagName: '-f', altRequired: 0 },
    shortDesc: 'Realize a configured mission — clone repos, spawn daemon, allocate workspace',
    longDesc: 'Transitions lifecycle "configured" → "started". Clones each repo into the workspace, spawns a per-mission daemon-watcher (writes pid + IPC state to the mission-lockfile), and returns once the daemon is running. Daemon advances to "in-progress" on first tick.',
    argLabels: [{ label: '<id|name>', description: 'Mission identifier or name (disjunctive with -f)' }],
    examples: [
      { cmd: 'msn start alpha', comment: 'start the configured mission named alpha' },
      { cmd: 'msn start -f /path/to/mission.yaml', comment: 'apply config + start in one shot' },
    ],
    seeAlso: ['complete', 'abandon', 'workspace', 'cd'],
    usageOverride: 'msn start <id|name> | -f <path> [--retain]',
  },
  apply: {
    required: 0,
    optional: 0,
    flags: [
      { name: '-f', takesValue: true, required: true, description: 'Apply from YAML path' },
    ],
    shortDesc: 'Upsert mission config from YAML (additive-only mid-mission)',
    longDesc: 'Reads the YAML at -f path and applies it as an upsert: missing missions are created, existing missions accept additive mutations (repo-add, tag-set, etc.). Subtractive changes are rejected mid-mission; use update verbs instead.',
    examples: [
      { cmd: 'msn apply -f ./mission.yaml', comment: 'upsert mission from declarative config' },
    ],
    seeAlso: ['create', 'update'],
  },
  complete: {
    required: 2,                 // <id|name> <message>
    optional: 0,
    flags: [
      { name: '--purge-config', takesValue: false, description: 'Delete config + symlink at terminal' },
    ],
    shortDesc: 'Complete a mission — squash, push, open PRs, terminate daemon',
    longDesc: 'Transitions lifecycle "in-progress|started" → "completed". Per-repo: squash wip-commits, push, open PR via RemoteProvider. SIGTERMs the daemon-watcher, cleans up local mission-branches, destroys the workspace (unless --retain). publishMessage is recorded immutably on first invocation.',
    argLabels: [
      { label: '<id|name>', description: 'Mission identifier or name' },
      { label: '<message>', description: 'Publish message (immutable; used as PR title)' },
    ],
    examples: [
      { cmd: 'msn complete alpha "feat: add login flow"', comment: 'squash + push + open PRs across all repos' },
      { cmd: 'msn complete alpha "..." --purge-config', comment: 'delete the mission config after completion' },
    ],
    seeAlso: ['abandon', 'start'],
  },
  abandon: {
    required: 2,                 // <id|name> <message>
    optional: 0,
    flags: [
      { name: '--purge-config', takesValue: false, description: 'Delete config + symlink at terminal' },
      { name: '--retain', takesValue: false, description: 'Preserve workspace (default: destroy)' },
    ],
    shortDesc: 'Abandon a mission — cleanup only; no PRs created',
    longDesc: 'Transitions lifecycle "in-progress|started" → "abandoned". SIGTERMs daemon, deletes local mission-branches per repo. abandonMessage is recorded immutably on first invocation. Use this when work is wrong or no longer needed; use `complete` for shipping work.',
    argLabels: [
      { label: '<id|name>', description: 'Mission identifier or name' },
      { label: '<message>', description: 'Teardown message (immutable; recorded in audit trail)' },
    ],
    examples: [
      { cmd: 'msn abandon alpha "rolling back: API change too disruptive"', comment: 'standard cleanup' },
      { cmd: 'msn abandon alpha "..." --retain', comment: 'preserve workspace for forensic inspection' },
    ],
    seeAlso: ['complete', 'start'],
  },
  tick: {
    required: 1,                 // <id|name>
    optional: 0,
    flags: [],
    shortDesc: 'Explicit cadence-tick trigger (W4 follow-on)',
    longDesc: 'Fires a pendingTick signal to the daemon for the named mission. Daemon performs its next wip-commit/snapshot cycle immediately rather than waiting for the next cadence-interval. Useful for ad-hoc checkpointing.',
    argLabels: [{ label: '<id|name>', description: 'Mission identifier or name' }],
    seeAlso: ['start'],
  },
  workspace: {
    required: 1,                 // <id|name> OR <coord> per Rule N
    optional: 1,                 // <repo-name>
    flags: [],
    shortDesc: 'Print absolute path to mission workspace directory',
    longDesc: 'Returns the workspace path for a mission\'s repo. For multi-repo missions, supply <repo-name> or use coord-form `<id>:<repo>` or `<id>:<repo>/<path>`. Errors with terminal-state-guard if mission is abandoned/completed (workspace destroyed).',
    argLabels: [
      { label: '<id|name>', description: 'Mission identifier, name, or coord-form `<id>:<repo>[/<path>]`' },
      { label: '[<repo-name>]', description: 'Optional repo name for multi-repo missions (use coord-form instead)' },
    ],
    examples: [
      { cmd: 'msn workspace alpha', comment: 'single-repo mission → repo path' },
      { cmd: 'msn workspace alpha:backend', comment: 'multi-repo coord-form' },
      { cmd: 'msn workspace alpha:backend/src/app.ts', comment: 'coord-form with path suffix' },
      { cmd: 'cd "$(msn workspace alpha)"', comment: 'jump into workspace (or use `msn cd alpha` with shell-init)' },
    ],
    seeAlso: ['cd', 'shell-init', 'show'],
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
          { name: '--name', takesValue: true, description: 'Local repo slug (defaults to URL basename)' },
          { name: '--branch', takesValue: true, description: 'Override mission-branch name (default: mission/<id>)' },
          { name: '--base', takesValue: true, description: 'Override base branch (default: main)' },
        ],
        shortDesc: 'Add a repo to a mission',
        argLabels: [
          { label: '<id|name>', description: 'Mission identifier or name' },
          { label: '<file|url>', description: 'Repo URL (or path to local YAML for advanced upsert)' },
        ],
        examples: [
          { cmd: 'msn update alpha repo-add https://github.com/x/y.git', comment: 'add a repo to alpha' },
          { cmd: 'msn update alpha repo-add https://github.com/x/y.git --name custom --base develop' },
        ],
      },
      'repo-remove': {
        required: 2, optional: 0, flags: [],
        shortDesc: 'Remove a repo from a mission',
        argLabels: [
          { label: '<id|name>', description: 'Mission identifier or name' },
          { label: '<repo-name>', description: 'Local repo slug to remove' },
        ],
      },
      name: {
        required: 2, optional: 0, flags: [],
        shortDesc: 'Rename a mission (updates .names/<new-name>.yaml symlink)',
        argLabels: [
          { label: '<id|name>', description: 'Mission identifier or name' },
          { label: '<new-name>', description: 'New human-readable slug' },
        ],
      },
      description: {
        required: 2, optional: 0, flags: [],
        shortDesc: 'Set mission description',
        argLabels: [
          { label: '<id|name>', description: 'Mission identifier or name' },
          { label: '<text>', description: 'Description text (quote if multi-word)' },
        ],
      },
      'hub-id': {
        required: 2, optional: 0, flags: [],
        shortDesc: 'Bind mission to a Hub mission-id (for orchestration integration)',
      },
      'scope-id': {
        required: 2, optional: 0, flags: [],
        shortDesc: 'Inline a scope into the mission (empty-string to remove)',
        argLabels: [
          { label: '<id|name>', description: 'Mission identifier or name' },
          { label: '<scope-id|name|"">', description: 'Scope to inline, or empty string to clear' },
        ],
      },
      'tags-set': {
        required: 3, optional: 0, flags: [],
        shortDesc: 'Set a mission tag (key/value)',
        argLabels: [
          { label: '<id|name>', description: 'Mission identifier or name' },
          { label: '<key>', description: 'Tag key' },
          { label: '<value>', description: 'Tag value' },
        ],
      },
      'tags-remove': {
        required: 2, optional: 0, flags: [],
        shortDesc: 'Remove a mission tag by key',
      },
    },
    shortDesc: 'Field-targeted mission mutation (declarative sub-actions)',
    longDesc: 'Each sub-action operates on a specific mission field/collection with atomic-write semantics. Run `msn help update <sub-action>` for per-sub-action detail.',
    examples: [
      { cmd: 'msn update alpha name beta', comment: 'rename mission' },
      { cmd: 'msn update alpha description "auth refactor"', comment: 'set description' },
      { cmd: 'msn update alpha tags-set owner team-a', comment: 'set tag' },
    ],
    seeAlso: ['create', 'show'],
  },
  // ─── Multi-participant verbs (v4.0 NEW per HIGH-R2.2) ───
  join: {
    required: 1,                 // <id|name>
    optional: 0,
    flags: [
      { name: '--coord-remote', takesValue: true, required: true, description: 'Coord-remote URL (REQUIRED)' },
      { name: '--principal', takesValue: true, description: 'Optional principal-id override (defaults to IdentityProvider.resolve)' },
    ],
    shortDesc: 'Join an existing mission as a reader-participant',
    longDesc: 'Reader-side bootstrap: clones writer\'s wip-state from the coord-remote, chmod-down\'s the workspace (POSIX 0444/0555 strict-enforce). Transitions reader-local lifecycle "configured" → "joined" → "reading" via 7-step.',
    argLabels: [{ label: '<id|name>', description: 'Mission identifier or name (must match writer\'s)' }],
    examples: [
      { cmd: 'msn join alpha --coord-remote https://github.com/x/coord.git', comment: 'reader joins alpha via coord-remote' },
      { cmd: 'msn join alpha --coord-remote ... --principal me@example.com', comment: 'with explicit principal' },
    ],
    seeAlso: ['leave', 'workspace'],
  },
  leave: {
    required: 1,                 // <id|name>
    optional: 0,
    flags: [
      { name: '--purge-workspace', takesValue: false, description: 'Remove workspace (default: preserve for forensic-history)' },
    ],
    shortDesc: 'Leave a mission as a reader-participant',
    longDesc: 'Reader-side disengagement: chmod-up workspace, optionally destroy it (--purge-workspace), unlink mission-config. Transitions lifecycle "reading" → "leaving" → terminal-removed.',
    argLabels: [{ label: '<id|name>', description: 'Mission identifier or name' }],
    examples: [
      { cmd: 'msn leave alpha', comment: 'disengage; preserve workspace for inspection' },
      { cmd: 'msn leave alpha --purge-workspace', comment: 'disengage + remove workspace' },
    ],
    seeAlso: ['join'],
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
          { name: '--name', takesValue: true, description: 'Optional human-friendly slug' },
          { name: '--description', takesValue: true, description: 'Scope description' },
          { name: '--repo', takesValue: true, repeatable: true, description: 'Repo URL (repeatable)' },
        ],
        shortDesc: 'Create a new scope (reusable repo+config bundle for missions)',
      },
      show: {
        required: 1, optional: 0,
        flags: [{ name: '--include-references', takesValue: false, description: 'Include missions referencing this scope' }],
        shortDesc: 'Show scope details by id or name',
        argLabels: [{ label: '<id|name>', description: 'Scope identifier or name' }],
      },
      list: {
        required: 0, optional: 0,
        flags: [{ name: '--include-references', takesValue: false, description: 'Include missions referencing each scope' }],
        shortDesc: 'List all scopes in the workspace',
      },
      update: {
        required: 2, optional: 0, flags: [],
        subActions: {
          'repo-add': {
            required: 2, optional: 0,
            flags: [
              { name: '--name', takesValue: true, description: 'Local repo slug' },
              { name: '--branch', takesValue: true, description: 'Branch name' },
              { name: '--base', takesValue: true, description: 'Base branch' },
            ],
            shortDesc: 'Add a repo to a scope',
          },
          'repo-remove': { required: 2, optional: 0, flags: [], shortDesc: 'Remove a repo from a scope' },
          name: { required: 2, optional: 0, flags: [], shortDesc: 'Rename a scope' },
          description: { required: 2, optional: 0, flags: [], shortDesc: 'Set scope description' },
          'tags-set': { required: 3, optional: 0, flags: [], shortDesc: 'Set a scope tag (key/value)' },
          'tags-remove': { required: 2, optional: 0, flags: [], shortDesc: 'Remove a scope tag by key' },
        },
        shortDesc: 'Mutate scope fields (sub-actions parallel `msn update`)',
        argLabels: [
          { label: '<id|name>', description: 'Scope identifier or name' },
          { label: '<sub-action>', description: 'One of: repo-add, repo-remove, name, description, tags-set, tags-remove' },
        ],
      },
      delete: {
        required: 1, optional: 0, flags: [],
        shortDesc: 'Delete a scope (rejected if any non-terminal mission references it)',
        argLabels: [{ label: '<id|name>', description: 'Scope identifier or name' }],
      },
    },
    shortDesc: 'Scope namespace — reusable repo+config bundles for missions',
    longDesc: 'A scope is a named bundle of repos that can be inlined into multiple missions. Run `msn help scope <sub-verb>` for per-sub-verb detail.',
    examples: [
      { cmd: 'msn scope create --name auth-svc --repo https://github.com/x/auth.git', comment: 'create scope auth-svc' },
      { cmd: 'msn scope list', comment: 'list all scopes' },
      { cmd: 'msn create --scope auth-svc', comment: 'inline scope into a new mission' },
    ],
  },
  // ─── Operator quick-jump (v1.0.3 idea-269) ───
  cd: {
    required: 1,                 // <id|name>; semantic = `cd $(msn workspace <id>)` via bash-fn wrapper
    optional: 1,                 // <repo-name> for multi-repo missions
    flags: [],
    shortDesc: 'Quick-jump into a mission workspace (requires shell-function wrapper)',
    longDesc: 'When the shell-function wrapper from `msn shell-init` is installed, intercepts `msn cd <id>` to `cd $(msn workspace <id>)`. Without the wrapper, prints the path + a stderr hint to install it.',
    argLabels: [
      { label: '<id|name>', description: 'Mission identifier, name, or coord-form `<id>:<repo>[/<path>]`' },
      { label: '[<repo-name>]', description: 'Optional repo name for multi-repo missions' },
    ],
    examples: [
      { cmd: 'msn cd alpha', comment: 'with wrapper installed: cd into alpha\'s workspace' },
      { cmd: 'eval "$(msn shell-init bash)"', comment: 'one-time setup (append to ~/.bashrc)' },
    ],
    seeAlso: ['shell-init', 'workspace'],
  },
  'shell-init': {
    required: 1,                 // <shell> — one of bash / zsh / fish
    optional: 0,
    flags: [],
    shortDesc: 'Emit shell-function wrapper blob to enable `msn cd`',
    longDesc: 'Outputs a shell function that intercepts `msn cd <args>` and runs `cd $(command msn workspace <args>)`. Install via `eval "$(msn shell-init bash)"` in your ~/.bashrc (or ~/.zshrc / ~/.config/fish/config.fish).',
    argLabels: [{ label: '<shell>', description: 'One of: bash, zsh, fish' }],
    examples: [
      { cmd: 'eval "$(msn shell-init bash)"', comment: 'in ~/.bashrc' },
      { cmd: 'eval "$(msn shell-init zsh)"', comment: 'in ~/.zshrc' },
      { cmd: 'msn shell-init fish | source', comment: 'fish equivalent' },
    ],
    seeAlso: ['cd'],
  },
  // ─── Config namespace ───
  config: {
    required: 1,                 // <sub-verb>; sub-verb validates remaining args
    optional: 0,
    flags: [],
    subActions: {
      get: {
        required: 1, optional: 0, flags: [],
        shortDesc: 'Read an operator-config value',
        argLabels: [{ label: '<key>', description: 'Config key (e.g., wip-cadence-ms)' }],
      },
      set: {
        required: 2, optional: 0, flags: [],
        shortDesc: 'Write an operator-config value',
        argLabels: [
          { label: '<key>', description: 'Config key' },
          { label: '<value>', description: 'Value to set' },
        ],
      },
    },
    shortDesc: 'Operator-config get/set (persistent CLI defaults)',
    longDesc: 'Reads/writes the operator-config YAML at <workspace-root>/operator-config.yaml. Values here become defaults for subsequent invocations (overridable via global flags per-invocation).',
    examples: [
      { cmd: 'msn config get wip-cadence-ms', comment: 'read current value' },
      { cmd: 'msn config set wip-cadence-ms 5000', comment: 'set default cadence' },
    ],
  },
  // ─── Meta verbs (v1.0.3 + v1.0.4) ───
  help: {
    required: 0,
    optional: 8,                 // verb-path can be up to 8 segments deep (way more than needed)
    flags: [],
    shortDesc: 'Print global help OR per-verb help when given a verb-path',
    longDesc: 'Without args: prints the global verb-listing (identical to `msn --help`). With a verb-path: prints per-verb help including usage, description, arguments, flags, examples, and see-also.',
    examples: [
      { cmd: 'msn help', comment: 'global help' },
      { cmd: 'msn help show', comment: 'per-verb help for show' },
      { cmd: 'msn help update repo-add', comment: 'per-sub-action help' },
      { cmd: 'msn help scope create', comment: 'per-sub-verb help' },
    ],
    seeAlso: ['tree'],
  },
  version: {
    required: 0,
    optional: 0,
    flags: [],
    shortDesc: 'Print missioncraft version (alias for --version)',
    examples: [{ cmd: 'msn version' }, { cmd: 'msn --version' }],
  },
  tree: {
    required: 0,
    optional: 0,
    flags: [
      { name: '--depth', takesValue: true, description: 'Limit tree recursion depth (default: unbounded)' },
    ],
    shortDesc: 'Print tree-style visualization of the full verb hierarchy',
    longDesc: 'Walks the same arg-spec data-structure used by per-verb help, rendering an ASCII tree of all verbs + sub-verbs + sub-actions. Useful for operator-discovery and LLM-driven exploration.',
    examples: [
      { cmd: 'msn tree', comment: 'full hierarchy' },
      { cmd: 'msn tree --depth 1', comment: 'top-level verbs only' },
      { cmd: 'msn tree --depth 2', comment: 'top-level + one nesting level' },
    ],
    seeAlso: ['help'],
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
