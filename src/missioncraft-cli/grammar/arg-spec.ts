// Machine-readable arg-count + flag spec (Design v4.8 §2.3.2 — v1.5 fold per MEDIUM-R4.11 normalized arg-count grammar).
// Reference impl for Rule 6 post-dispatch arg-count validation.
// Strict-1.0 commits this normalized table; any v1.x verb additions are additive.

/** Top-level reserved verbs — Rule 1.
 * `join` is BRANCH-TRACKER reader (W4-new slice (iii)); `watch` is PERSISTENT-TRACKER reader
 * (W4-new). `apply`/`tick` DROPPED at W6-new slice (v); `leave` DROPPED at W7-new slice (iii). */
export const RESERVED_VERBS = [
  'create',
  'list',
  'show',
  'start',
  'update',
  'complete',
  'abandon',
  'scope',
  'workspace',
  'config',
  'join',         // BRANCH-TRACKER reader (W4-new slice (iii))
  'watch',        // PERSISTENT-TRACKER reader (W4-new)
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
  { name: '--quiet', takesValue: false, description: 'Suppress progress output on stderr (v1.0.5 idea-273)' },
  { name: '-q', takesValue: false, description: 'Alias for --quiet' },
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
      // mission-78 W6-new slice (iii) (Design v5.0 §10.6): immediate daemon-spawn post-create
      { name: '--start', takesValue: false, description: 'Spawn daemon immediately post-create (sequential mc.create + mc.start)' },
    ],
    shortDesc: 'Scaffold a new mission config',
    longDesc: 'Generates an msn-<8-char-hash> id and writes the mission YAML to the workspace-root. With --repo flag(s) the mission starts in lifecycle "configured" (ready for `msn start`); without --repo it starts in "created". `--start` flag opts into immediate daemon-spawn post-creation (Hub-integration-friendly).',
    examples: [
      { cmd: 'msn create', comment: 'minimal mission; no repos; lifecycle=created' },
      { cmd: 'msn create --name alpha --repo https://github.com/x/y.git', comment: 'named single-repo mission; ready for msn start' },
      { cmd: 'msn create --repo https://github.com/x/y.git --start', comment: 'create + immediate-spawn (W6-new --start flag)' },
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
  // mission-78 W6-new slice (v.b): mission-targeted verbs require id-first form per Design v5.0
  // §10.6 (`msn <id> show` etc.); v1.x verb-first `msn show <id>` REMOVED. Examples + usage
  // updated to reflect canonical id-first shape.
  show: {
    required: 1,                 // <id|name>; supports coord-form per Rule N (deprecated under W6-new)
    optional: 0,
    flags: [
      { name: '--repos', takesValue: false, description: 'Show just the repo-list' },
    ],
    shortDesc: 'Show mission details (id-first per W6-new: `msn <id> show`)',
    longDesc: 'Detail view (kubectl-describe style). Returns full mission state including lifecycle, repos, participants, daemon-IPC fields, audit progress. **W6-new id-first form**: `msn <mission-id> show` (legacy `msn show <id>` REMOVED per Design v5.0 §12 no-backward-compat). Bare `msn <mission-id>` (no verb) defaults to `show` for operator-DX-convenience.',
    argLabels: [{ label: '<id|name>', description: 'Mission identifier or name (id-first form: `msn <id> show`)' }],
    examples: [
      { cmd: 'msn msn-abc12345 show', comment: 'id-first form (W6-new canonical)' },
      { cmd: 'msn msn-abc12345', comment: 'bare-id default-to-show convenience' },
      { cmd: 'msn msn-abc12345 show --repos', comment: 'just the repo-list section' },
      { cmd: 'msn msn-abc12345 show --output json', comment: 'JSON for machine consumption' },
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
    shortDesc: 'Realize a configured mission (id-first per W6-new; idempotent — no-op if running)',
    longDesc: 'Transitions lifecycle "configured" → "started". Clones each repo into the workspace, spawns a per-mission daemon-watcher (writes pid + IPC state to the mission-lockfile), and returns once the daemon is running. Daemon advances to "in-progress" on first tick. **W6-new id-first form**: `msn <mission-id> start` (idempotent: no-op if daemon already running; replaces dropped v1.x `msn <id> resume` verb). Creation-verbs (`msn create/join/watch`) accept `--start` flag for sequential mc.create + mc.start composition.',
    argLabels: [{ label: '<id|name>', description: 'Mission identifier or name (id-first form: `msn <id> start`)' }],
    examples: [
      { cmd: 'msn msn-abc12345 start', comment: 'id-first form (W6-new canonical; idempotent)' },
      { cmd: 'msn create --repo X --start', comment: 'sequential create + start via --start flag' },
    ],
    seeAlso: ['complete', 'abandon', 'workspace', 'cd', 'create', 'join', 'watch'],
    usageOverride: 'msn <mission-id> start | msn start -f <path> [--retain]',
  },
  // mission-78 W6-new slice (v) (Design v5.0 §10.6 perfection-grade revisions): `apply` DROPPED
  // entirely. Overlap with `msn create -f` (single creation surface; no need for separate verb).
  complete: {
    required: 2,                 // <id|name> <message>
    optional: 0,
    flags: [
      { name: '--purge-config', takesValue: false, description: 'Delete config + symlink at terminal' },
      { name: '--purge-workspace', takesValue: false, description: 'Remove workspace at terminal (default: preserve for forensic-history)' },
    ],
    shortDesc: 'Complete a mission (id-first per W6-new) — squash, force-push (Fix #12), open PRs, terminate daemon',
    longDesc: 'Transitions lifecycle "in-progress|started" → "completed". Per-repo: squash wip-commits, force-push (per W5-new Fix #12 — overrides daemon-chain pushed by push-cadence), open PR via RemoteProvider. SIGTERMs the daemon-watcher, cleans up local mission-branches. Workspace preserved by default (forensic-history); pass --purge-workspace to remove. publishMessage is recorded immutably on first invocation. **W6-new id-first form**: `msn <mission-id> complete <message>`.',
    argLabels: [
      { label: '<id|name>', description: 'Mission identifier or name (id-first form: `msn <id> complete`)' },
      { label: '<message>', description: 'Publish message (immutable; used as PR title)' },
    ],
    examples: [
      { cmd: 'msn msn-abc12345 complete "feat: add login flow"', comment: 'id-first form (W6-new canonical); squash + force-push + open PRs across all repos' },
      { cmd: 'msn msn-abc12345 complete "..." --purge-config', comment: 'delete the mission config after completion' },
      { cmd: 'msn msn-abc12345 complete "..." --purge-workspace --purge-config', comment: 'full cleanup (workspace + config)' },
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
    shortDesc: 'Abandon a mission (id-first per W6-new) — cleanup only; no PRs created',
    longDesc: 'Transitions lifecycle "in-progress|started" → "abandoned". SIGTERMs daemon, deletes local mission-branches per repo. abandonMessage is recorded immutably on first invocation. Use this when work is wrong or no longer needed; use `complete` for shipping work. **W6-new id-first form**: `msn <mission-id> abandon <message>`.',
    argLabels: [
      { label: '<id|name>', description: 'Mission identifier or name (id-first form: `msn <id> abandon`)' },
      { label: '<message>', description: 'Teardown message (immutable; recorded in audit trail)' },
    ],
    examples: [
      { cmd: 'msn msn-abc12345 abandon "rolling back: API change too disruptive"', comment: 'id-first form (W6-new canonical); standard cleanup' },
      { cmd: 'msn msn-abc12345 abandon "..." --retain', comment: 'preserve workspace for forensic inspection' },
    ],
    seeAlso: ['complete', 'start'],
  },
  // mission-78 W6-new slice (v) (Design v5.0 §10.6 perfection-grade revisions): `tick` DROPPED
  // entirely. Was unimplemented (SDK threw "not yet implemented; planned for v1.x roadmap");
  // documentation-lie risk. W5-new pushCadence/pullCadence already provide the cadence-tick
  // semantic at substrate-level (no need for explicit operator-trigger).
  workspace: {
    required: 1,                 // <id|name> OR <coord> per Rule N
    optional: 1,                 // <repo-name>
    flags: [],
    shortDesc: 'Print mission workspace path (id-first per W6-new + coord-form exception)',
    longDesc: 'Returns the workspace path for a mission\'s repo. **W6-new id-first form**: `msn <mission-id> workspace [<repo-name>]`. **Coord-form exception**: legacy `msn workspace <id>:<repo>[/<path>]` PRESERVED (coord-form embeds mission-id; redundant to require id-first prefix). For multi-repo missions, supply <repo-name> or use coord-form. Errors with terminal-state-guard if mission is abandoned/completed (workspace destroyed).',
    argLabels: [
      { label: '<id|name>', description: 'Mission identifier (id-first) OR coord-form `<id>:<repo>[/<path>]` (coord-form exception)' },
      { label: '[<repo-name>]', description: 'Optional repo name for multi-repo missions (use coord-form instead)' },
    ],
    examples: [
      { cmd: 'msn msn-abc12345 workspace', comment: 'id-first form (W6-new canonical); single-repo mission → repo path' },
      { cmd: 'msn msn-abc12345 workspace backend', comment: 'id-first form + repo-name for multi-repo' },
      { cmd: 'msn workspace msn-abc12345:backend', comment: 'coord-form exception (legacy verb-first preserved)' },
      { cmd: 'msn workspace msn-abc12345:backend/src/app.ts', comment: 'coord-form with path suffix' },
      { cmd: 'cd "$(msn msn-abc12345 workspace)"', comment: 'jump into workspace (or use `msn <id> cd` with shell-init)' },
    ],
    seeAlso: ['cd', 'shell-init', 'show'],
  },
  // ─── Update sub-action namespace ───
  //
  // **Hybrid grammar permits BOTH `msn update <id|slug> <sub>` (verb-first) AND `msn <id> update
  // <sub>` (id-first) forms through v1.2.0 ship** (W7-new slice (v) architect-confirmed PRESERVE;
  // structurally-required for slug-resolution-via-verb-first invariant from (γ) parser disposition
  // — see parser.ts:360 docblock for full rationale). W8-new closing-audit HELP_TEXT reconciliation
  // will surface both forms in operator-facing examples; current `examples` below use slug-first
  // verb-first form as the canonical operator-DX shape for sub-action invocations.
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
          { cmd: 'msn update alpha repo-add https://github.com/x/y.git', comment: 'verb-first form (slug-named mission)' },
          { cmd: 'msn msn-abc12345 update repo-add https://github.com/x/y.git', comment: 'id-first form (W6-new canonical for canonical-id missions)' },
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
        examples: [
          { cmd: 'msn update alpha repo-remove backend', comment: 'verb-first form (slug-named mission)' },
          { cmd: 'msn msn-abc12345 update repo-remove backend', comment: 'id-first form' },
        ],
      },
      name: {
        required: 2, optional: 0, flags: [],
        shortDesc: 'Rename a mission (updates .names/<new-name>.yaml symlink)',
        argLabels: [
          { label: '<id|name>', description: 'Mission identifier or name' },
          { label: '<new-name>', description: 'New human-readable slug' },
        ],
        examples: [
          { cmd: 'msn update alpha name beta', comment: 'verb-first form: rename slug alpha → beta' },
          { cmd: 'msn msn-abc12345 update name beta', comment: 'id-first form: assign slug beta to canonical-id mission' },
        ],
      },
      description: {
        required: 2, optional: 0, flags: [],
        shortDesc: 'Set mission description',
        argLabels: [
          { label: '<id|name>', description: 'Mission identifier or name' },
          { label: '<text>', description: 'Description text (quote if multi-word)' },
        ],
        examples: [
          { cmd: 'msn update alpha description "ship feature X"', comment: 'verb-first form (quote multi-word)' },
          { cmd: 'msn msn-abc12345 update description "ship feature X"', comment: 'id-first form' },
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
  // ─── Reader-mission verbs (mission-78 W4-new; Design v5.0 §2 row 4) ───
  // `msn join` REPURPOSED at W4-new from v4.x multi-participant shared-mission to
  // BRANCH-TRACKER reader-mission (creation-verb; positional writer-mission-id; auto-close on
  // writer-terminal via Loop B detection — auto-close logic lands at slice (v); slice (iii)
  // is creation-plumbing + scope-inheritance only).
  join: {
    required: 1,                 // <writer-mission-id>
    optional: 0,
    flags: [
      { name: '--name', takesValue: true, description: 'Optional human-friendly slug for the reader-mission' },
      // mission-78 W6-new slice (iii): immediate daemon-spawn post-join
      { name: '--start', takesValue: false, description: 'Spawn reader-daemon immediately post-create (sequential mc.create + mc.start)' },
    ],
    shortDesc: 'Create a BRANCH-TRACKER reader-mission tied to a writer-mission (mission-78 W4-new)',
    longDesc: 'mission-78 W4-new repurpose (Design v5.0 §2 row 4): creates an independent reader-mission with readOnly: true + sourceMissionId pointing at the writer-mission. Inherits writer-mission\'s repos[] (scope-inheritance). Reader-daemon Loop B (slice v) will fetch writer\'s mission-branch updates + auto-close when writer terminates (fetch-not-found OR branch-tip stale). v1.x slice (iii) is creation-plumbing only; auto-close logic lands at slice (v). Distinct from `msn watch` (PERSISTENT-TRACKER; long-lived remote+branch).',
    argLabels: [{ label: '<writer-mission-id>', description: 'Writer-mission id (msn-<8hex>) OR name to track' }],
    examples: [
      { cmd: 'msn join msn-deadbeef', comment: 'create reader-mission tracking writer msn-deadbeef' },
      { cmd: 'msn join alpha --name alpha-reader', comment: 'named reader by writer-mission name' },
    ],
    seeAlso: ['watch', 'workspace'],
  },
  // ─── mission-78 W4-new (Design v5.0 §2 row 4) — PERSISTENT-TRACKER reader-mission verb ───
  watch: {
    required: 0,
    optional: 0,
    flags: [
      { name: '--repo', takesValue: true, required: true, description: 'Remote URL to watch (REQUIRED)' },
      { name: '--branch', takesValue: true, required: true, description: 'Branch ref to track (REQUIRED)' },
      { name: '--name', takesValue: true, description: 'Optional human-friendly slug for the reader-mission' },
      // mission-78 W6-new slice (iii): immediate daemon-spawn post-watch
      { name: '--start', takesValue: false, description: 'Spawn reader-daemon immediately post-create (sequential mc.create + mc.start)' },
    ],
    shortDesc: 'Create a PERSISTENT-TRACKER reader-mission (long-lived branch like main)',
    longDesc: 'mission-78 W4-new (Design v5.0 §2 row 4): creates an independent reader-mission that tracks <remote>:<branch> via reader-daemon Loop B (lands at W4-new slice v). Long-lived; operator-explicit-abandon terminal only (no auto-close). Distinct from `msn join` (BRANCH-TRACKER; coupled to writer-mission lifetime). Mission-config schema-v2 with readOnly: true + sourceRemote + sourceBranch.',
    examples: [
      { cmd: 'msn watch --repo https://github.com/x/y.git --branch main', comment: 'persistently track upstream main' },
      { cmd: 'msn watch --repo ... --branch develop --name dev-watch', comment: 'named watcher mission' },
    ],
    seeAlso: ['join', 'start'],
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
    shortDesc: 'Quick-jump into mission workspace (id-first per W6-new + coord-form exception; requires shell-fn wrapper)',
    longDesc: 'When the shell-function wrapper from `msn shell-init` is installed, intercepts `msn <id> cd` (or coord-form `msn cd <id>:<repo>`) to `cd $(msn workspace ...)`. Without the wrapper, prints the path + a stderr hint to install it. **W6-new id-first form**: `msn <mission-id> cd`. **Coord-form exception**: `msn cd <id>:<repo>` PRESERVED.',
    argLabels: [
      { label: '<id|name>', description: 'Mission identifier (id-first) OR coord-form `<id>:<repo>[/<path>]` (coord-form exception)' },
      { label: '[<repo-name>]', description: 'Optional repo name for multi-repo missions' },
    ],
    examples: [
      { cmd: 'msn msn-abc12345 cd', comment: 'id-first form (W6-new canonical); cd into workspace via shell-fn wrapper' },
      { cmd: 'msn cd msn-abc12345:backend', comment: 'coord-form exception (legacy verb-first preserved)' },
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
