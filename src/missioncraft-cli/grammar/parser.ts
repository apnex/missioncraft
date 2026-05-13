// CLI grammar parser (Design v4.8 §2.3.2 Rules 1-7).
//
// Pipeline: argv[] → tokenize → Rule 1 verb-dispatch → Rule 2 sub-action validation → Rule 4 disambiguation
//        → Rule 6 arg-count validation → Rule 7 coord-form recognition → ParsedCommand.
// Rule 5 reserved-words protection enforced separately at create-time (validates --name slug per spec).

import { ConfigValidationError } from '../../missioncraft-sdk/errors.js';
import {
  GLOBAL_FLAGS,
  type FlagSpec,
  RESERVED_NAMES_PROTECTED,
  RESERVED_VERBS,
  type VerbArgSpec,
  VERB_SPECS,
} from './arg-spec.js';
import { renderVerbHelp } from './help-renderer.js';

/** Substrate-coordinate per Rule 7 (v4.0 NEW per idea-265) — `<mission-id>:<repo>[/<path>]`. */
export interface SubstrateCoordinate {
  readonly mission: string;
  readonly repo?: string;
  readonly path?: string;
}

export interface ParsedCommand {
  /** Top-level verb (Rule 1). */
  readonly verb: string;
  /** Sub-action for update/scope/config namespaces (Rule 2); deepest dispatched sub-action. */
  readonly subAction?: string;
  /** Positionals after verb + sub-action(s) consumed. */
  readonly positionals: readonly string[];
  /** Verb-specific flags. */
  readonly flags: ReadonlyMap<string, string | boolean>;
  /** Global flags (apply uniformly across verbs). */
  readonly globalFlags: ReadonlyMap<string, string | boolean>;
  /** Substrate-coordinate (Rule 7) when first positional contains ':'. */
  readonly coordinate?: SubstrateCoordinate;
  /**
   * mission-78 W6-new slice (ii) (Design v5.0 §10.6 hybrid grammar): id-first form.
   * Set when argv[0] matches the canonical msn-<8hex> pattern → the FIRST positional is taken
   * as the mission-id reference; the SECOND positional becomes the verb. Mission-targeted-verb
   * dispatchers prefer `missionRef` over `positionals[0]` when set.
   *
   * Per (γ) disposition thread-550 round 2: parser-level pattern-detection only (no slug-lookup
   * at parse-time; dispatcher resolves slug → id via `mc.resolveMissionRef` AFTER parse).
   * Slug-detection NOT performed here: mission-name forms still go through verb-first parsing
   * (e.g., `msn show alpha-mission` works; `msn alpha-mission show` does NOT). Slug-validation
   * guard at slice (iv) rejects name-collisions with verb-set at create-time.
   */
  readonly missionRef?: string;
  /** Sub-namespace path (e.g., ['scope', 'update', 'repo-add']) for diagnostics. */
  readonly subNamespacePath: readonly string[];
}

/**
 * mission-78 W6-new slice (ii): canonical mission-id pattern matcher.
 *
 * Matches the auto-id namespace `msn-<8-hex-chars>` (validated at SDK level + schema-v2 regex
 * `^msn-[a-f0-9]{8}$`). Returns true for id-first form detection; false for verb-first.
 *
 * Excludes: mission-name slugs (operator-assigned DNS-style names). Per (γ) disposition,
 * slugs still use verb-first form; if id-first dispatching of slugs is desired in future,
 * extend this matcher OR move slug-lookup to parse-time.
 */
function isMissionId(s: string): boolean {
  return /^msn-[a-f0-9]{8}$/.test(s);
}

/**
 * Parse a substrate-coordinate string per Rule 7 (v4.0 NEW per idea-265 + MEDIUM-R1.3 + F-V4.5).
 * Format: `<mission-id>:<repo>[/<path>]`. Whitespace-in-coordinate rejected.
 *
 * Returns undefined if positional doesn't contain ':' (= not a coordinate; standard positional).
 * Throws ConfigValidationError if coord-form malformed (whitespace inside).
 */
export function parseCoordinate(positional: string): SubstrateCoordinate | undefined {
  if (!positional.includes(':')) return undefined;
  if (/\s/.test(positional)) {
    throw new ConfigValidationError(
      `substrate-coordinate parsing: whitespace inside coordinate '${positional}' is rejected`,
    );
  }
  const [mission, rest] = positional.split(':', 2);
  if (!rest) return { mission };
  const slashIdx = rest.indexOf('/');
  if (slashIdx === -1) return { mission, repo: rest };
  return {
    mission,
    repo: rest.slice(0, slashIdx),
    path: rest.slice(slashIdx + 1),
  };
}

/**
 * Validate a slug-format candidate per Rule 5 reserved-words protection.
 *
 * Rejects:
 * - Slugs matching any reserved-verb / sub-action (RESERVED_NAMES_PROTECTED)
 * - Auto-id namespaces (msn-/scp- prefix)
 * - Slugs containing ':' (v4.0 colon-protection per Rule 5 + Rule 7 coord-form parsing collision)
 * - Slugs not matching DNS-style `[a-z0-9][a-z0-9-]{1,62}` pattern (per MEDIUM-R2.5)
 *
 * Returns undefined on valid slug; returns error-message string on invalid.
 */
export function validateSlugFormat(slug: string): string | undefined {
  if (RESERVED_NAMES_PROTECTED.has(slug)) {
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

interface TokenizeResult {
  readonly positionals: string[];
  readonly flags: Map<string, string | boolean>;
  readonly globalFlags: Map<string, string | boolean>;
}

const GLOBAL_FLAG_NAMES = new Set(GLOBAL_FLAGS.map((f) => f.name));
const GLOBAL_FLAG_SPEC = new Map(GLOBAL_FLAGS.map((f) => [f.name, f] as const));

/**
 * Tokenize argv into positionals + flags (verb-specific vs global).
 * Two-pass: first pass collects all flags/positionals; second-pass classifier separates global vs verb-specific
 * once verb-context is known (caller passes acceptableVerbFlags set after Rule 1 dispatch).
 */
function tokenize(argv: readonly string[], acceptableVerbFlags: Set<string>): TokenizeResult {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  const globalFlags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--') || token.startsWith('-')) {
      const isGlobal = GLOBAL_FLAG_NAMES.has(token);
      const isVerbSpecific = acceptableVerbFlags.has(token);
      if (!isGlobal && !isVerbSpecific) {
        throw new ConfigValidationError(`unknown flag '${token}'`);
      }
      const flagSpec = isGlobal ? GLOBAL_FLAG_SPEC.get(token) : undefined;
      // For verb-specific flags, lookup via passed-in spec (not directly available here);
      // tokenize takes value-iff-arg-follows-and-isn't-flag heuristic
      const next = argv[i + 1];
      const takesValue = flagSpec
        ? flagSpec.takesValue
        : next !== undefined && !next.startsWith('-');
      if (takesValue && next !== undefined && !next.startsWith('-')) {
        const value = next;
        if (isGlobal) globalFlags.set(token, value);
        else flags.set(token, value);
        i++;                                                   // skip consumed value
      } else {
        if (isGlobal) globalFlags.set(token, true);
        else flags.set(token, true);
      }
    } else {
      positionals.push(token);
    }
  }
  return { positionals, flags, globalFlags };
}

function flagNameSet(spec: VerbArgSpec): Set<string> {
  const set = new Set<string>(spec.flags.map((f) => f.name));
  if (spec.subActions) {
    for (const sub of Object.values(spec.subActions)) {
      for (const f of sub.flags) set.add(f.name);
      if (sub.subActions) {
        for (const subSub of Object.values(sub.subActions)) {
          for (const f of subSub.flags) set.add(f.name);
        }
      }
    }
  }
  if (spec.disjunctive) set.add(spec.disjunctive.flagName);
  return set;
}

function validateArgCount(spec: VerbArgSpec, positionals: readonly string[], flags: ReadonlyMap<string, string | boolean>, contextPath: readonly string[]): void {
  // disjunctive arg-shape (v1.6 fold per MEDIUM-R5.4)
  if (spec.disjunctive) {
    const flagPresent = flags.has(spec.disjunctive.flagName);
    const altRequired = spec.disjunctive.altRequired;
    if (flagPresent) {
      if (positionals.length > altRequired) {
        throw new ConfigValidationError(
          `'${contextPath.join(' ')} ${spec.disjunctive.flagName} <value>' is mutually-exclusive with the positional form (extra positional '${positionals[altRequired]}')`,
        );
      }
      if (positionals.length < altRequired) {
        throw new ConfigValidationError(
          renderMissingArgError(spec, contextPath, `'${contextPath.join(' ')}' with '${spec.disjunctive.flagName}' requires ${altRequired} positional(s)`),
        );
      }
      return;
    }
  }
  if (positionals.length < spec.required) {
    // v1.0.4 bug-66 items 3+5+10: drop "Rule N" jargon + render per-verb help inline.
    // v1.0.5 bug-67 item 3: report the ACTUALLY-missing positional (next-expected after
    // already-provided), not always argLabels[0]. Example: `msn abandon <id>` (id provided,
    // message missing) now reports `requires <message>` instead of the wrong `requires <id|name>`.
    const missingLabel = spec.argLabels?.[positionals.length]?.label;
    const argSummary = missingLabel
      ? `'${contextPath.join(' ')}' requires ${missingLabel}`
      : `'${contextPath.join(' ')}' requires ${spec.required} positional(s)`;
    throw new ConfigValidationError(renderMissingArgError(spec, contextPath, argSummary));
  }
  const max = spec.required + spec.optional;
  if (positionals.length > max) {
    throw new ConfigValidationError(
      `'${contextPath.join(' ')}' accepts up to ${max} positional(s); got ${positionals.length} (extra: '${positionals[max]}')`,
    );
  }
  // Required-flag check
  for (const flagSpec of spec.flags) {
    if (flagSpec.required && !flags.has(flagSpec.name)) {
      throw new ConfigValidationError(
        renderMissingArgError(spec, contextPath, `'${contextPath.join(' ')}' requires flag '${flagSpec.name}'`),
      );
    }
  }
}

/**
 * v1.0.4 bug-66 item 5/10: compose a missing-arg error message that includes the per-verb help
 * (idea-274 renderer) below the error prefix. Falls back to plain prefix if renderer fails.
 */
function renderMissingArgError(spec: VerbArgSpec, contextPath: readonly string[], errorPrefix: string): string {
  void spec;
  try {
    const help = renderVerbHelp(contextPath);
    const verb = contextPath[0];
    // mission-78 W6-new slice (v): `tick` REMOVED (verb DROPPED); `apply` was never in this set
    const ID_NAME_VERBS = new Set(['show', 'start', 'abandon', 'complete', 'workspace', 'update', 'cd']);
    const hint = ID_NAME_VERBS.has(verb)
      ? `\n\nhint: run 'msn list' to see available missions`
      : '';
    return `${errorPrefix}\n\n${help}${hint}`;
  } catch {
    return errorPrefix;
  }
}

/**
 * v1.0.4 bug-66 item 4: compose a missing-sub-verb error that includes multi-line listing
 * of available sub-verbs with their shortDesc (pulled from the arg-spec).
 */
function renderMissingSubVerbError(parentSpec: VerbArgSpec, parentPath: readonly string[], errorPrefix: string): string {
  if (!parentSpec.subActions) return errorPrefix;
  const subNames = Object.keys(parentSpec.subActions);
  const width = Math.max(...subNames.map((n) => n.length));
  const lines = [`error: ${errorPrefix}`, '', `Available sub-${parentPath[0] === 'scope' || parentPath[0] === 'config' ? 'verbs' : 'actions'}:`];
  for (const name of subNames) {
    const sub = parentSpec.subActions[name];
    const desc = sub.shortDesc ?? sub.description ?? '';
    lines.push(`  ${name.padEnd(width)}  ${desc}`);
  }
  // Strip the "error: " prefix since bin.ts main() adds it
  return lines.join('\n').replace(/^error: /, '');
}

/**
 * Parse argv into a ParsedCommand per Rules 1-7.
 *
 * @param argv - command-line arguments AFTER the binary-name (e.g., `process.argv.slice(2)`)
 */
export function parse(argv: readonly string[]): ParsedCommand {
  // bug-64 item 1: bare `msn` falls through to help (mirrors `git`/`npm`/`docker` convention)
  // bug-64 item 8: `help` is the primary verb; `--help` retained as alias
  if (argv.length === 0) {
    return {
      verb: '--help',
      positionals: [],
      flags: new Map(),
      globalFlags: new Map(),
      subNamespacePath: [],
    };
  }

  // v1.0.4 idea-274: multi-syntax per-verb help — `--help` / `-h` flag at any verb-path depth
  // OR `help <verb-path>` prefix-verb form. Both produce verb='--help' + subNamespacePath
  // populated with the verb-path so the dispatcher can resolve the per-verb spec.
  const helpFlagIdx = argv.findIndex((a) => a === '--help' || a === '-h');
  if (helpFlagIdx >= 0) {
    // Strip the help-flag; verb-path = everything before it (and after, if any — unusual but accepted)
    const verbPath = argv.filter((a, i) => i !== helpFlagIdx && !a.startsWith('-'));
    return {
      verb: '--help',
      positionals: verbPath,
      flags: new Map(),
      globalFlags: new Map(),
      subNamespacePath: verbPath,
    };
  }
  // `help <verb-path>` prefix-form
  if (argv[0] === 'help' && argv.length > 1) {
    const verbPath = argv.slice(1).filter((a) => !a.startsWith('-'));
    return {
      verb: '--help',
      positionals: verbPath,
      flags: new Map(),
      globalFlags: new Map(),
      subNamespacePath: verbPath,
    };
  }
  // v1.0.4 bug-66 item 1: `version` is the primary version-verb; `--version` retained as alias
  if (argv[0] === 'version' && argv.length === 1) {
    return {
      verb: '--version',
      positionals: [],
      flags: new Map(),
      globalFlags: new Map(),
      subNamespacePath: ['version'],
    };
  }

  // mission-78 W6-new slice (ii) (Design v5.0 §10.6 hybrid grammar): id-first form detection.
  // If argv[0] matches canonical msn-<8hex> pattern → shift: argv[0] becomes missionRef;
  // argv[1] becomes the verb. Slugs (operator-assigned names) NOT detected here (still use
  // verb-first form per γ disposition); slug-validation guard at slice (iv) prevents future
  // collisions. Special case: bare `msn <id>` (length 1) defaults to `show` verb for operator-
  // DX-convenience (quick mission-state inspection without explicit `show` verb).
  let missionRefOverride: string | undefined;
  let effectiveArgv: readonly string[] = argv;
  if (isMissionId(argv[0])) {
    missionRefOverride = argv[0];
    if (argv.length === 1) {
      // bare `msn msn-<id>` → defaults to `show` verb
      effectiveArgv = ['show'];
    } else {
      effectiveArgv = argv.slice(1);                       // shift: argv[1+] becomes verb-and-rest
    }
  }

  const verb = effectiveArgv[0];
  // ─── Rule 1: reserved-verbs ───
  if (!(RESERVED_VERBS as readonly string[]).includes(verb)) {
    throw new ConfigValidationError(
      `unknown verb '${verb}'\n\nhint: run 'msn help' to see the verb list`,
    );
  }
  // Special-case help/version short-circuits; `help` verb dispatches to identical handler as `--help`
  if (verb === '--help' || verb === '--version' || verb === 'help') {
    return {
      verb: verb === 'help' ? '--help' : verb,
      positionals: [],
      flags: new Map(),
      globalFlags: new Map(),
      subNamespacePath: verb === '--help' || verb === 'help' ? [] : [verb],
    };
  }
  // mission-78 W6-new slice (v.b) (Design v5.0 §10.6 + no-backward-compat ratification):
  // verb-first form for mission-targeted verbs is REMOVED entirely. These verbs require id-first
  // form (`msn <msn-id> <verb>`) per Design v5.0 §10.6 hybrid grammar three-class taxonomy.
  //
  // **`update` exception PRESERVED through v1.2.0 ship** (W7-new slice (v) architect-confirmed
  // PRESERVE disposition; thread-552 §C): `update` permits BOTH `msn update <id|slug> <sub>` AND
  // `msn <id> update <sub>` forms. Structurally-required (NOT backward-compat exception): under
  // (γ) parser shape from W6-new slice (ii), only canonical `msn-<8hex>` ids trigger id-first
  // form; slugs fall through to verb-first. Removing update verb-first would force operators
  // to look up canonical id for slug-named missions just to invoke sub-actions → significant
  // operator-DX regression. Sub-action grammar fits verb-first naturally per Design v5.0 §10.6
  // hybrid grammar tolerance for sub-action structures. (Calibration #73 directional-vs-mechanism
  // diagnostic: MECHANISM choice within stable substrate-target-state; preserving the slug-
  // resolution-via-verb-first invariant from (γ) parser disposition.)
  //
  // Operator-DX-clear error directs to id-first form for the other 5 mission-targeted verbs.
  // Slug access via id-lookup pattern (operator runs `msn list` to find id; then types
  // `msn <id> <verb>`).
  //
  // **Coord-form exception** (workspace/cd): `msn workspace <id>:<repo>` legacy form preserved
  // because coord-form embeds the mission-id; redundant to require id-first prefix. Detected
  // by argv[1] containing ':' (Rule 7 substrate-coordinate; parseCoordinate validates further).
  const MISSION_TARGETED_REQUIRES_ID_FIRST = new Set(['show', 'start', 'complete', 'abandon', 'workspace', 'cd']);
  const COORD_FORM_VERBS = new Set(['workspace', 'cd']);
  if (MISSION_TARGETED_REQUIRES_ID_FIRST.has(verb) && missionRefOverride === undefined) {
    // Coord-form exception: workspace/cd accept `<coord>` positional containing ':' as legacy form
    const firstPositional = effectiveArgv[1];
    const isCoordForm = COORD_FORM_VERBS.has(verb) && typeof firstPositional === 'string' && firstPositional.includes(':');
    if (!isCoordForm) {
      throw new ConfigValidationError(
        `verb '${verb}' requires id-first form: \`msn <mission-id> ${verb}\` (W6-new no-backward-compat)\n\n` +
        `hint: run 'msn list' to find the mission-id, then 'msn <mission-id> ${verb}'`,
      );
    }
  }
  const verbSpec = VERB_SPECS[verb];
  if (!verbSpec) {
    throw new ConfigValidationError(
      `internal: verb '${verb}' has no VerbArgSpec entry — VERB_SPECS table out-of-sync with RESERVED_VERBS`,
    );
  }

  const acceptableFlags = flagNameSet(verbSpec);
  // Under id-first form: tokenize the shifted argv (effectiveArgv.slice(1)) so the missionRef
  // isn't redundantly consumed as a positional. The missionRef will be PREPENDED to positionals
  // post-tokenize so existing per-verb dispatch logic (which reads positionals[0] as mission-id)
  // continues working unchanged. missionRef field is set for slice (iv) slug-validation +
  // future-state transparency.
  const tokenizeArgv = effectiveArgv.slice(1);
  const { positionals: tokenizedPositionals, flags, globalFlags } = tokenize(tokenizeArgv, acceptableFlags);
  const rawPositionals: string[] = missionRefOverride !== undefined
    ? [missionRefOverride, ...tokenizedPositionals]
    : tokenizedPositionals;

  // ─── Rule 2: sub-action dispatch for update/scope/config namespaces ───
  // Track sub-action-keyword indexes (for filtering from reported positionals);
  // resource-id positionals KEPT; sub-action keywords STRIPPED.
  let activeSpec = verbSpec;
  let subAction: string | undefined;
  const subNamespacePath: string[] = [verb];
  const subActionKeywordIndexes: number[] = [];

  if (activeSpec.subActions) {
    if (verb === 'update') {
      // Shape: `msn update <id|name> <sub-action> [args]` — sub-action at positional[1]
      if (rawPositionals.length < 2) {
        throw new ConfigValidationError(
          renderMissingSubVerbError(activeSpec, ['update'], `'update' requires <id|name> + sub-action`),
        );
      }
      subAction = rawPositionals[1];
      const subSpec = activeSpec.subActions[subAction];
      if (!subSpec) {
        throw new ConfigValidationError(
          renderMissingSubVerbError(activeSpec, ['update'], `unknown 'update' sub-action '${subAction}'`),
        );
      }
      activeSpec = subSpec;
      subNamespacePath.push(subAction);
      subActionKeywordIndexes.push(1);             // sub-action keyword at index 1; <id> at index 0 KEPT
    } else if (verb === 'scope' || verb === 'config') {
      // Shape: `msn scope <sub-verb> [args]` OR `msn config <get|set> <key> [<value>]`
      if (rawPositionals.length < 1) {
        throw new ConfigValidationError(
          renderMissingSubVerbError(activeSpec, [verb], `'${verb}' requires sub-verb`),
        );
      }
      subAction = rawPositionals[0];
      const subSpec = activeSpec.subActions[subAction];
      if (!subSpec) {
        throw new ConfigValidationError(
          renderMissingSubVerbError(activeSpec, [verb], `unknown '${verb}' sub-verb '${subAction}'`),
        );
      }
      activeSpec = subSpec;
      subNamespacePath.push(subAction);
      subActionKeywordIndexes.push(0);             // sub-verb at index 0; remaining positionals KEPT
      // Special-case: `msn scope update <scope-id|name> <sub-action> [args]`
      if (verb === 'scope' && subAction === 'update' && activeSpec.subActions) {
        if (rawPositionals.length < 3) {
          throw new ConfigValidationError(
            renderMissingSubVerbError(activeSpec, ['scope', 'update'], `'scope update' requires <scope-id|name> + sub-action`),
          );
        }
        const scopeUpdateSubAction = rawPositionals[2];
        const subSubSpec = activeSpec.subActions[scopeUpdateSubAction];
        if (!subSubSpec) {
          throw new ConfigValidationError(
            renderMissingSubVerbError(activeSpec, ['scope', 'update'], `unknown 'scope update' sub-action '${scopeUpdateSubAction}'`),
          );
        }
        activeSpec = subSubSpec;
        subNamespacePath.push(scopeUpdateSubAction);
        subAction = scopeUpdateSubAction;
        subActionKeywordIndexes.push(2);           // sub-sub-action at index 2; <scope-id> at index 1 KEPT
      }
    }
  }

  // Compute remaining positionals AFTER sub-action keywords stripped (for Rule 6 validation + reporting)
  const subActionSet = new Set(subActionKeywordIndexes);
  const remainingPositionals = rawPositionals.filter((_, i) => !subActionSet.has(i));

  // ─── Rule 6: post-dispatch arg-count validation (against remaining positionals only) ───
  validateArgCount(activeSpec, remainingPositionals, flags, subNamespacePath);

  // ─── Rule 7 (Rule N): substrate-coordinate parsing on first positional after verb ───
  // Coord-form recognition: scan all positionals; first one containing ':' is the coordinate
  let coordinate: SubstrateCoordinate | undefined;
  for (let i = 0; i < rawPositionals.length; i++) {
    if (rawPositionals[i].includes(':')) {
      coordinate = parseCoordinate(rawPositionals[i]);
      // Ambiguity check: coord-form repo-component + a separate positional naming a repo (next positional)
      if (coordinate?.repo && rawPositionals.length > i + 1) {
        throw new ConfigValidationError(
          `coordinate-form '${rawPositionals[i]}' already specifies repo via colon-notation; extra positional '${rawPositionals[i + 1]}' rejected`,
        );
      }
      break;
    }
  }

  // For repo-add with --name flag, validate slug per Rule 5
  if (subAction === 'repo-add') {
    const nameFlag = flags.get('--name');
    if (typeof nameFlag === 'string') {
      const err = validateSlugFormat(nameFlag);
      if (err) throw new ConfigValidationError(`slug-format: ${err}`);
    }
  }
  if (verb === 'create') {
    const nameFlag = flags.get('--name');
    if (typeof nameFlag === 'string') {
      const err = validateSlugFormat(nameFlag);
      if (err) throw new ConfigValidationError(`slug-format: ${err}`);
    }
  }
  if (verb === 'scope' && subAction === 'create') {
    const nameFlag = flags.get('--name');
    if (typeof nameFlag === 'string') {
      const err = validateSlugFormat(nameFlag);
      if (err) throw new ConfigValidationError(`slug-format: ${err}`);
    }
  }

  return {
    verb,
    subAction,
    positionals: remainingPositionals,  // Positionals after sub-action KEYWORDS stripped; resource-id KEPT
    flags,
    globalFlags,
    coordinate,
    ...(missionRefOverride !== undefined && { missionRef: missionRefOverride }),
    subNamespacePath,
  };
}

/** Helper: re-export FlagSpec for downstream consumers. */
export type { FlagSpec };
