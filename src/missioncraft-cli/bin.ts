#!/usr/bin/env node
// `msn` CLI entry-point (Design v4.8 §2.3.2).
//
// Pipeline: argv → parser (Rules 1-7) → SDK invocation → output-formatter → stdout.
// Sovereign-module SDK consumer per v1.1 reshape Refinement #4 — imports `@apnex/missioncraft` package self-reference.

import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import { colors } from './colors.js';
import {
  Missioncraft,
  ConfigValidationError,
  MissioncraftError,
  MissionStateError,
  type MissionMutation,
  type ScopeMutation,
  VERSION,
  detectSubstrate,
} from '@apnex/missioncraft';

import { parse, type ParsedCommand } from './grammar/parser.js';
import {
  formatTable,
  formatValue,
  resolveOutputFormat,
  type OutputFormat,
} from './grammar/output-formatter.js';

const HELP_TEXT = `missioncraft ${VERSION} — sovereign mission-orchestration substrate

Usage: msn <verb> [args]                       (verb-first; global + creation verbs)
       msn <mission-id> <verb> [args]          (id-first; mission-targeted verbs per Design v5.0 §10.6)

Hybrid grammar (mission-78 W6-new): three verb-classes per Design v5.0 §10.6:
  (1) GLOBAL          verb-first; no mission target
  (2) CREATION        verb-first; return mission-id (with optional --start flag)
  (3) MISSION-TARGETED  id-first canonical; v1.x verb-first form REMOVED

(1) Global verbs:
  msn list [--status <state>] [--output json|yaml]
  msn config get <key>
  msn config set <key> <value>
  msn scope <sub-verb> [args]                  (see Scope namespace below)
  msn shell-init bash | zsh | fish             Emit shell-fn blob; \`eval "$(msn shell-init bash)"\`
  msn tree [--depth <N>]                       Tree-style verb-hierarchy
  msn version                                  missioncraft + git/gh substrate-detect

(2) Creation verbs (return mission-id; --start flag opts into immediate daemon-spawn):
  msn create [--name <slug>] [--repo <url>...] [--scope <id|name>] [--start]
  msn join <writer-mission-id> [--name <slug>] [--start]      BRANCH-TRACKER reader-mission
  msn watch --repo <url> --branch <ref> [--name <slug>] [--start]   PERSISTENT-TRACKER reader

(3) Mission-targeted verbs (id-first; canonical \`msn <mission-id> <verb>\`):
  msn <id> show
  msn <id> start                               Idempotent (no-op if daemon already running)
  msn <id> complete <message> [--purge-config] [--purge-workspace]
  msn <id> abandon <message> [--retain] [--purge-config]
  msn <id> workspace [<repo-name>]             (also legacy verb-first \`msn workspace <id>:<repo>[/<path>]\` coord-form)
  msn <id> cd [<repo-name>]                    Requires shell-function wrapper (one-time setup)

  Bare-id-default: \`msn <mission-id>\` (no verb) → defaults to \`show\` (operator-DX-convenience)

Mission update (verb-first preserved through W6-new for sub-action shape):
  msn update <id|name> repo-add <url> [--name <slug>] [--branch <name>] [--base <branch>]
  msn update <id|name> repo-remove <repo-name>
  msn update <id|name> name <new-name>
  msn update <id|name> description <text>
  msn update <id|name> hub-id <hub-id>
  msn update <id|name> scope-id <scope-id|name|"">
  msn update <id|name> tags-set <key> <value>
  msn update <id|name> tags-remove <key>
  (id-first form also works: \`msn <id> update <sub-action> [args]\`)

Scope namespace:
  msn scope create [--name <slug>] [--description <text>] [--repo <url>...]
  msn scope list [--include-references] [--output json|yaml]
  msn scope show <id|name> [--include-references]
  msn scope update <id|name> <sub-action> [args]
  msn scope delete <id|name>

Global flags (apply to all verbs):
  --workspace-root <path>    Override workspace-root for this invocation
  --wip-cadence-ms <ms>      Override WIP commit cadence
  --snapshot-cadence-ms <ms> Override snapshot cadence
  --lock-wait-ms <ms>        Override lock-acquire wait timeout
  --lock-validity-ms <ms>    Override lock-validity TTL
  --output <text|json|yaml>  Override default output format

W6-new operator-DX migration note:
  v1.x verb-first form for mission-targeted verbs (\`msn show <id>\` etc.) REMOVED entirely
  per Design v5.0 §12 no-backward-compat ratification. Use id-first form: \`msn <id> show\`.
  To find a mission-id: run \`msn list\`. \`msn apply\` + \`msn <id> tick\` DROPPED entirely
  (apply: overlap with create -f; tick: was unimplemented + W5-new push/pullCadence subsume).

For more: https://github.com/apnex/missioncraft
`;

async function main(argv: readonly string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parse(argv);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      // v1.0.4 bug-66 (slice iii): error-line in red (colors.error honors NO_COLOR/FORCE_COLOR/TTY)
      console.error(colors.error(`error: ${err.message}`));
      return 64;                                                                    // EX_USAGE
    }
    throw err;
  }

  if (parsed.verb === '--help') {
    // v1.0.4 idea-274: subNamespacePath populated → per-verb help; empty → global help
    if (parsed.subNamespacePath.length === 0) {
      console.log(HELP_TEXT);
    } else {
      const { renderVerbHelp } = await import('./grammar/help-renderer.js');
      console.log(renderVerbHelp(parsed.subNamespacePath));
    }
    return 0;
  }
  if (parsed.verb === '--version') {
    // v1.0.8 idea-285: extended output via substrate-detect; --version short-circuit uses text-format
    // by default. Operators wanting JSON/YAML use `msn version --output <fmt>` verb form.
    console.log(await renderVersion('text'));
    return 0;
  }

  const workspaceRoot = parsed.globalFlags.get('--workspace-root');
  const mc = new Missioncraft(
    typeof workspaceRoot === 'string' ? { workspaceRoot } : {},
  );

  const format = resolveOutputFormat(parsed.globalFlags);

  try {
    await dispatch(mc, parsed, format);
  } catch (err) {
    if (err instanceof MissioncraftError) {
      // v1.0.5 bug-67 items 1+2: strip SDK class-name + method-path prefixes; append discovery
      // hint when the error matches the `<resource> '<name>' not found` pattern.
      const cleaned = err.message
        .replace(/^Missioncraft\.\w+(\(.*?\))?:\s+/, '')
        .replace(/^\w+Error:\s+/, '');
      const nameNotFoundMatch = /^mission '\S+' not found$/.test(cleaned) || /^scope '\S+' not found$/.test(cleaned);
      // v1.0.6 bug-69: FSM-rejection hints — match `requires lifecycle '...' (current: '...')`
      // OR `requires lifecycle '...' or '...' (current: '...')`
      // OR `requires lifecycle '...', '...', or '...' (current: '...')` (mission-80 slice (i)
      // bug-83 fix: abandon now accepts 3-element list including reader-class 'reading')
      // and emit operator-actionable hint per-verb. parsed.verb names the verb the operator typed;
      // positionals[0] is the id/name.
      const fsmMatch = /requires lifecycle [^(]+\(current: '([^']+)'\)/.exec(cleaned);
      let hint = '';
      if (nameNotFoundMatch) {
        hint = `\n\nhint: run '${cleaned.startsWith('scope') ? 'msn scope list' : 'msn list'}' to see available ${cleaned.startsWith('scope') ? 'scopes' : 'missions'}`;
      } else if (fsmMatch) {
        hint = renderFsmHint(parsed.verb, fsmMatch[1], parsed.positionals[0]);
      }
      console.error(colors.error(`error: ${cleaned}${hint}`));
      return err instanceof MissionStateError ? 65 : 1;                            // EX_DATAERR for state-violations
    }
    throw err;
  }
  return 0;
}

/**
 * v1.0.6 bug-69 — FSM-rejection hint matrix. Returns a `\n\nhint: ...` suffix per verb +
 * rejection-current-state, or empty string when no hint applies.
 *
 * Per spec thread-537:
 *   abandon on terminal       → "manual rm ~/.missioncraft/config/missions/<id>.yaml..."
 *   complete on terminal      → same
 *   complete on 'configured'  → "run 'msn start <id>' first to begin the mission"
 *   start on non-configured   → "run 'msn show <id>' to inspect current lifecycle state"
 *   (mission-78 W6-new slice (v): `tick` hint REMOVED — `tick` verb DROPPED entirely)
 */
function renderFsmHint(verb: string, currentState: string, idOrName: string | undefined): string {
  const TERMINAL = new Set(['completed', 'abandoned']);
  const idToken = idOrName ?? '<id>';
  if ((verb === 'abandon' || verb === 'complete') && TERMINAL.has(currentState)) {
    return (
      `\n\nhint: to remove config for an already-${currentState} mission, manually delete ` +
      `~/.missioncraft/config/missions/${idToken}.yaml (and ~/.missioncraft/config/missions/.names/<name>.yaml if named); ` +
      `'msn delete <id>' verb is on the v1.0.x roadmap`
    );
  }
  if (verb === 'complete' && currentState === 'configured') {
    return `\n\nhint: run 'msn start ${idToken}' first to begin the mission`;
  }
  if (verb === 'start') {
    return `\n\nhint: run 'msn show ${idToken}' to inspect current lifecycle state`;
  }
  return '';
}

/**
 * mission-78 W6-new slice (i): CLI dispatcher restructure into THREE-class taxonomy per Design
 * v5.0 §10.6 hybrid grammar.
 *
 * **Three verb-classes** (operative for slice (ii) parser changes + slice (vi) HELP_TEXT):
 *
 * (1) **GLOBAL VERBS** (verb-first; no mission target):
 *     `msn list` / `msn config` / `msn scope <sub>` / `msn shell-init` / `msn tree` / `msn version`
 *     Always verb-first. Operate on collections OR substrate-state without mission context.
 *
 * (2) **CREATION VERBS** (verb-first; return mission-id):
 *     `msn create [--start] [args]` / `msn join [--start] <writer-id>` / `msn watch [--start] --repo --branch`
 *     Always verb-first. Produce new mission entity. Slice (iii) adds `--start` flag opting into
 *     immediate daemon-spawn post-creation (Hub-integration-friendly).
 *
 * (3) **MISSION-TARGETED VERBS** (id-first under W6-new; currently verb-first under v1.x):
 *     `msn <id> start` / `complete` / `abandon` / `show` / `workspace` / `cd` / `update`
 *     Operate on existing mission-id (positional[0]). Under W6-new slice (ii), parser detects
 *     id-first form: `msn <id> show` (NEW) supersedes `msn show <id>` (v1.x). v1.x verb-first
 *     form is REMOVED entirely at slice (v) per no-backward-compat ratification.
 *
 * **DROPPED at W6-new slice (v)**: `msn apply` (overlap with create -f), `msn <id> tick`
 * (unimplemented), `msn <id> resume` (merged into idempotent start).
 *
 * Slice (i) (this scaffolding) keeps verb-first parser semantics; restructures dispatch into the
 * three classes for clarity + extracts `dispatchMissionTargeted` helper (was invokeRuntimeDeferred).
 * Slice (ii) adds id-first parser detection + wires `parsed.missionRef`. show + update MOVED from
 * main dispatch to dispatchMissionTargeted (they're mission-targeted per W6-new taxonomy).
 */
async function dispatch(mc: Missioncraft, parsed: ParsedCommand, format: OutputFormat): Promise<void> {
  switch (parsed.verb) {
    // ─── (2) CREATION VERBS — verb-first; return mission-id ───
    // mission-78 W6-new slice (iii) (Design v5.0 §10.6): all three creation-verbs accept
    // optional `--start` flag for sequential-spawn-post-create per architect-disposition (a).
    // Composition: mc.create(...) → mc.start(handle.id, { idempotent: true }) when flag set.
    // idempotent: true gracefully no-ops if mission lifecycle is already 'started'/'in-progress'
    // (race against concurrent CLI invocations) per architect-disposition idempotent-flag.
    case 'create': {
      // v1.0.5 bug-67 item 4: validate --repo URL via `new URL(...)` parse
      // bug-84: readRepoFlag returns string | string[] | undefined (repeatable-aware)
      const repo = readRepoFlag(parsed);
      // v1.0.6 bug-70: --scope and --repo are mutually exclusive on `msn create`. Scope acts as the
      // repo-template; combining with --repo yields ambiguous attach-semantics (replace vs. append).
      if (parsed.flags.has('--scope') && parsed.flags.has('--repo')) {
        throw new ConfigValidationError(
          "'msn create --scope <id|name> --repo <url>' rejected: --scope and --repo are mutually exclusive (scope provides the repo template)",
        );
      }
      const handle = await mc.create('mission', {
        ...(parsed.flags.has('--name') && { name: String(parsed.flags.get('--name')) }),
        ...(repo !== undefined && { repo }),
        ...(parsed.flags.has('--scope') && { scope: String(parsed.flags.get('--scope')) }),
      });
      if (parsed.flags.has('--start')) {
        await mc.start(handle.id, { idempotent: true });
      }
      console.log(format === 'text' ? handle.name ? `${handle.id}\t${handle.name}` : handle.id : formatValue(handle, format));
      return;
    }
    // (2) `msn watch` — PERSISTENT-TRACKER reader-mission via repo+branch
    case 'watch': {
      const repo = String(parsed.flags.get('--repo') ?? '');
      const branch = String(parsed.flags.get('--branch') ?? '');
      validateRepoUrl(repo);
      const handle = await mc.create('mission', {
        ...(parsed.flags.has('--name') && { name: String(parsed.flags.get('--name')) }),
        repo,
        readOnly: true,
        sourceRemote: repo,
        sourceBranch: branch,
      });
      if (parsed.flags.has('--start')) {
        await mc.start(handle.id, { idempotent: true });
      }
      console.log(format === 'text' ? handle.name ? `${handle.id}\t${handle.name}` : handle.id : formatValue(handle, format));
      return;
    }
    // (2) `msn join <writer-mission-id>` — BRANCH-TRACKER reader-mission
    case 'join': {
      const handle = await mc.create('mission', {
        ...(parsed.flags.has('--name') && { name: String(parsed.flags.get('--name')) }),
        readOnly: true,
        sourceMissionId: parsed.positionals[0],
      });
      if (parsed.flags.has('--start')) {
        await mc.start(handle.id, { idempotent: true });
      }
      console.log(format === 'text' ? handle.name ? `${handle.id}\t${handle.name}` : handle.id : formatValue(handle, format));
      return;
    }

    // ─── (1) GLOBAL VERBS — verb-first; no mission target ───
    case 'list': {
      // 0-positional → list missions; 1-positional → drill-down repos within mission
      if (parsed.positionals.length === 0) {
        const status = parsed.flags.get('--status');
        // v1.0.5 bug-67 item 4: validate --status enum
        if (typeof status === 'string') validateMissionStatus(status);
        const filter = typeof status === 'string' ? { status: status as never } : undefined;
        const states = await mc.list('mission', filter);
        if (format === 'text') {
          console.log(formatTable(
            states.map((s) => ({ id: s.id, name: s.name ?? '', lifecycle: s.lifecycleState, 'repos-count': s.repos.length })),
            ['id', 'name', 'lifecycle', 'repos-count'],
            format,
          ));
        } else {
          console.log(formatValue(states, format));
        }
        return;
      }
      // Drill-down (W4: full repo-state surface; W3 returns mission-level state for the drilled-into mission)
      const id = parsed.positionals[0];
      const state = await mc.get('mission', id);
      if (format === 'text') {
        console.log(formatTable(
          state.repos.map((r) => ({ name: r.name, url: r.url, base: r.base, role: r.role ?? '', 'sync-state': r.syncState ?? '' })),
          ['name', 'url', 'base', 'role', 'sync-state'],
          format,
        ));
      } else {
        console.log(formatValue(state.repos, format));
      }
      return;
    }
    // mission-78 W6-new slice (i): `show` + `update` MOVED to dispatchMissionTargeted (W6-new
    // mission-targeted taxonomy — both consume positional[0]=missionId; slice (ii) parser
    // changes will accept id-first form `msn <id> show` + `msn <id> update <sub>`).
    case 'config': {
      const key = parsed.positionals[0];
      // v1.0.5 bug-67 item 4: validate config key against known registry
      validateConfigKey(key);
      if (parsed.subAction === 'get') {
        const value = await mc.configGet(key);
        console.log(value ?? '');
      } else {
        const value = parsed.positionals[1];
        await mc.configSet(key, value);
        console.log(`set ${key}=${value}`);
      }
      return;
    }
    case 'scope': {
      await dispatchScope(mc, parsed, format);
      return;
    }

    // ─── (3) MISSION-TARGETED VERBS — id-first under W6-new (slice ii parser-changes);
    //         currently verb-first under v1.x (positional[0] = mission-id) ───
    // mission-78 W6-new slice (v): `apply` + `tick` DROPPED entirely; W7-new slice (iii):
    // `leave` DROPPED entirely (v4.x carry-forward cleanup).
    case 'show':
    case 'update':
    case 'start':
    case 'complete':
    case 'abandon':
    case 'workspace':
    case 'cd':
      await dispatchMissionTargeted(mc, parsed, format);
      return;
    case 'shell-init': {
      // v1.0.3 idea-269: emit shell-function blob for bash/zsh/fish. Operator runs
      // `eval "$(msn shell-init bash)"` in their rc-file to enable `msn cd <id>` quick-jump.
      console.log(emitShellInit(parsed.positionals[0]));
      return;
    }
    case 'tree': {
      // v1.0.4 idea-272: tree-style verb-hierarchy visualization. Walks the same arg-spec tree
      // as the per-verb help renderer (idea-274). --depth N limits recursion.
      const { renderTree } = await import('./grammar/tree-renderer.js');
      const depthRaw = parsed.flags.get('--depth');
      const depth = typeof depthRaw === 'string' ? parseInt(depthRaw, 10) : undefined;
      console.log(renderTree(Number.isFinite(depth) ? depth : undefined));
      return;
    }
    case 'version': {
      // v1.0.8 idea-285: extended output — substrate-detect git + gh; tree-format text OR JSON/YAML.
      console.log(await renderVersion(format));
      return;
    }
    default:
      throw new ConfigValidationError(`internal: dispatcher missing case for verb '${parsed.verb}'`);
  }
}

/**
 * v1.0.8 idea-285 — render `msn version` output. Tree-format for text (cyan tree chars per
 * existing palette); JSON/YAML emit via formatValue. Calls detectSubstrate non-throwing so
 * missing binaries surface as `NOT FOUND` instead of failing the version probe itself.
 *
 * Text-format example:
 *   missioncraft 1.2.2
 *   ├── git    2.43.0
 *   └── gh     2.42.0
 *
 * JSON: `{"missioncraft":"1.2.2","git":"2.43.0","gh":"2.42.0"}` (null when missing).
 */
async function renderVersion(format: OutputFormat): Promise<string> {
  const detection = await detectSubstrate();
  if (format === 'json' || format === 'yaml') {
    return formatValue(
      { missioncraft: VERSION, git: detection.git, gh: detection.gh },
      format,
    );
  }
  // Text: tree-format with cyan tree-chars per architect spec.
  const branch = colors.info('├──');
  const last = colors.info('└──');
  const renderEntry = (bin: 'git' | 'gh'): string => {
    const version = detection[bin];
    if (version !== null) return `${bin.padEnd(6)}${version}`;
    return `${bin.padEnd(6)}NOT FOUND (${detection.missing[bin]})`;
  };
  return [
    `missioncraft ${VERSION}`,
    `${branch} ${renderEntry('git')}`,
    `${last} ${renderEntry('gh')}`,
  ].join('\n');
}

function emitShellInit(shell: string): string {
  // Shell-function wrapper: intercepts `msn cd <args>` to `cd "$(command msn workspace <args>)"`.
  // All other verbs pass through transparently via `command msn`.
  // bash + zsh share POSIX function syntax; fish requires the function-builtin form.
  if (shell === 'bash' || shell === 'zsh') {
    return [
      `# missioncraft ${shell} shell-init — adds \`msn cd <id|name>\` quick-jump.`,
      `# Install: append \`eval "$(msn shell-init ${shell})"\` to your ~/.${shell}rc`,
      `msn() {`,
      `  if [ "$1" = "cd" ]; then`,
      `    shift`,
      `    cd "$(command msn workspace "$@")" || return $?`,
      `  else`,
      `    command msn "$@"`,
      `  fi`,
      `}`,
    ].join('\n');
  }
  if (shell === 'fish') {
    return [
      `# missioncraft fish shell-init — adds \`msn cd <id|name>\` quick-jump.`,
      `# Install: append \`eval (msn shell-init fish)\` to your ~/.config/fish/config.fish`,
      `function msn`,
      `  if test "$argv[1]" = "cd"`,
      `    cd (command msn workspace $argv[2..])`,
      `  else`,
      `    command msn $argv`,
      `  end`,
      `end`,
    ].join('\n');
  }
  throw new ConfigValidationError(`'shell-init' supports bash / zsh / fish; got '${shell}'`);
}

function buildMissionMutation(parsed: ParsedCommand): MissionMutation {
  const sub = parsed.subAction;
  const positionals = parsed.positionals;            // [<id>, ...args]
  switch (sub) {
    case 'repo-add': {
      validateRepoUrl(positionals[1]);                 // v1.0.5 bug-67 item 4
      const repoSpec: { url: string; name?: string; branch?: string; base?: string } = {
        url: positionals[1],
      };
      const nameFlag = parsed.flags.get('--name');
      const branchFlag = parsed.flags.get('--branch');
      const baseFlag = parsed.flags.get('--base');
      if (typeof nameFlag === 'string') repoSpec.name = nameFlag;
      if (typeof branchFlag === 'string') repoSpec.branch = branchFlag;
      if (typeof baseFlag === 'string') repoSpec.base = baseFlag;
      return { kind: 'add-repo', repo: repoSpec };
    }
    case 'repo-remove':
      return { kind: 'remove-repo', repoName: positionals[1] };
    case 'name':
      return { kind: 'rename', newName: positionals[1] };
    case 'description':
      return { kind: 'set-description', description: positionals[1] };
    case 'hub-id':
      return { kind: 'set-hub-id', hubId: positionals[1] };
    case 'scope-id':
      return { kind: 'set-scope', scopeId: positionals[1] === '' ? null : positionals[1] };
    case 'tags-set':
      return { kind: 'set-tag', key: positionals[1], value: positionals[2] };
    case 'tags-remove':
      return { kind: 'remove-tag', key: positionals[1] };
    default:
      throw new ConfigValidationError(`internal: unknown 'update' sub-action '${sub}'`);
  }
}

async function dispatchScope(mc: Missioncraft, parsed: ParsedCommand, format: OutputFormat): Promise<void> {
  // bug-81: parser overwrites `parsed.subAction` to the level-3 inner sub-action (e.g.,
  // 'name', 'description') for `msn scope update <id> <sub-action>`, which made every
  // `scope update X` invocation fall into the default case below. Use subNamespacePath[1]
  // for the level-2 sub-verb routing; buildScopeMutation continues reading parsed.subAction
  // for the level-3 inner.
  const scopeSubVerb = parsed.subNamespacePath[1];
  switch (scopeSubVerb) {
    case 'create': {
      // bug-84: readRepoFlag returns string | string[] | undefined (repeatable-aware)
      const repo = readRepoFlag(parsed);
      const handle = await mc.create('scope', {
        ...(parsed.flags.has('--name') && { name: String(parsed.flags.get('--name')) }),
        ...(parsed.flags.has('--description') && { description: String(parsed.flags.get('--description')) }),
        ...(repo !== undefined && { repo }),
      });
      console.log(format === 'text' ? handle.name ? `${handle.id}\t${handle.name}` : handle.id : formatValue(handle, format));
      return;
    }
    case 'list': {
      // v1.0.6 bug-70: --include-references triggers compute-on-demand scan per scope
      const includeReferences = parsed.flags.has('--include-references');
      const states = await mc.list('scope', undefined, includeReferences ? { includeReferences: true } : undefined);
      console.log(formatValue(states, format));
      return;
    }
    case 'show': {
      // v1.0.6 bug-70: --include-references triggers compute-on-demand scan of missions referencing this scope
      const includeReferences = parsed.flags.has('--include-references');
      const state = await mc.get('scope', parsed.positionals[0], includeReferences ? { includeReferences: true } : undefined);
      console.log(formatValue(state, format));
      return;
    }
    case 'update': {
      const id = parsed.positionals[0];
      const mutation = buildScopeMutation(parsed);
      const state = await mc.update('scope', id, mutation);
      console.log(formatValue(state, format));
      return;
    }
    case 'delete': {
      await mc.delete('scope', parsed.positionals[0]);
      console.log(`deleted ${parsed.positionals[0]}`);
      return;
    }
    default:
      throw new ConfigValidationError(`internal: unknown 'scope' sub-verb '${scopeSubVerb}'`);
  }
}

function buildScopeMutation(parsed: ParsedCommand): ScopeMutation {
  // Same structure as buildMissionMutation but only the 6 ScopeMutation kinds
  const sub = parsed.subAction;
  const positionals = parsed.positionals;            // [<scope-id>, ...args]
  switch (sub) {
    case 'repo-add':
      return { kind: 'add-repo', repo: { url: positionals[1] } };
    case 'repo-remove':
      return { kind: 'remove-repo', repoName: positionals[1] };
    case 'name':
      return { kind: 'rename', newName: positionals[1] };
    case 'description':
      return { kind: 'set-description', description: positionals[1] };
    case 'tags-set':
      return { kind: 'set-tag', key: positionals[1], value: positionals[2] };
    case 'tags-remove':
      return { kind: 'remove-tag', key: positionals[1] };
    default:
      throw new ConfigValidationError(`internal: unknown 'scope update' sub-action '${sub}'`);
  }
}

// v1.0.5 bug-67 item 4: input-validation helpers (operator-facing errors via ConfigValidationError;
// main() catch emits via colors.error + exit 64).
const VALID_MISSION_STATUS = ['created', 'configured', 'in-progress', 'started', 'completed', 'abandoned'] as const;
const VALID_CONFIG_KEYS = ['wip-cadence-ms', 'snapshot-cadence-ms', 'lock-wait-ms', 'lock-validity-ms'] as const;

function validateMissionStatus(value: string): void {
  if (!(VALID_MISSION_STATUS as readonly string[]).includes(value)) {
    throw new ConfigValidationError(
      `'--status ${value}' is not a valid lifecycle state. Valid: ${VALID_MISSION_STATUS.join(', ')}`,
    );
  }
}

function validateConfigKey(key: string): void {
  if (!(VALID_CONFIG_KEYS as readonly string[]).includes(key)) {
    throw new ConfigValidationError(
      `'config' key '${key}' is not recognized. Valid keys: ${VALID_CONFIG_KEYS.join(', ')}`,
    );
  }
}

function validateRepoUrl(url: string): void {
  try {
    new URL(url);
  } catch {
    throw new ConfigValidationError(
      `'--repo ${url}' is not a parseable URL (https://, ssh://, git://, file://)`,
    );
  }
}

/**
 * bug-84: read --repo flag values, supporting repeatable form.
 * Returns string for single occurrence, string[] for 2+, undefined when absent.
 * Each URL validated via `validateRepoUrl`.
 */
function readRepoFlag(parsed: ParsedCommand): string | string[] | undefined {
  if (!parsed.flags.has('--repo')) return undefined;
  const raw = parsed.flags.get('--repo');
  if (Array.isArray(raw)) {
    for (const url of raw) validateRepoUrl(url);
    return raw;
  }
  const single = String(raw);
  validateRepoUrl(single);
  return single;
}

/**
 * v1.0.5 idea-273 — CLI default progress sink. Emits `[<phase>] <message>` to stderr in cyan
 * when stdout-isTTY AND --quiet/-q not set AND NO_COLOR not set. No-op otherwise (machine-
 * consumers piping stdout get clean output; `$(msn workspace <id>)` shell-eval not polluted).
 */
function makeProgressSink(parsed: ParsedCommand): (event: import('@apnex/missioncraft').ProgressEvent) => void {
  const quietFlag = parsed.flags.has('--quiet') || parsed.flags.has('-q')
    || parsed.globalFlags.has('--quiet') || parsed.globalFlags.has('-q');
  if (quietFlag) return (): void => undefined;
  if (process.stderr.isTTY !== true) return (): void => undefined;
  return (event): void => {
    const line = `[${event.phase}] ${event.message}`;
    process.stderr.write(`${colors.info(line)}\n`);
  };
}

function readDaemonPid(workspaceRoot: string, missionId: string): number | undefined {
  // bug-64 item 6: lookup daemon-pid from mission-lockfile (populated by start() spawnDaemonWatcher
  // per v1.0.2 SD3 fix). Undefined when lockfile absent or unparseable (substrate-bypass tests, etc.).
  const lockfilePath = pathJoin(workspaceRoot, 'locks', 'missions', `${missionId}.lock`);
  if (!existsSync(lockfilePath)) return undefined;
  try {
    const c = JSON.parse(readFileSync(lockfilePath, 'utf8'));
    return typeof c.pid === 'number' ? c.pid : undefined;
  } catch { return undefined; }
}

/**
 * mission-78 W6-new slice (i): mission-targeted verb dispatcher (renamed from invokeRuntimeDeferred).
 *
 * Handles class (3) verbs per Design v5.0 §10.6 hybrid grammar: operate on existing mission-id.
 * Currently consumes `parsed.positionals[0]` as mission-id (verb-first form preserved through
 * slice (i)). Slice (ii) parser-changes will surface `parsed.missionRef` for id-first form;
 * this dispatcher will adapt to read from either source.
 *
 * Verb coverage:
 * - W6-new keepers: `start` / `complete` / `abandon` / `show` / `workspace` / `cd` / `update`
 * - DROPPED at slice (v): `apply` (overlap with `create -f`), `tick` (unimplemented)
 * - DROPPED at slice (iii) of W7-new: `leave` (v4.x carry-forward cleanup)
 * - W6-new `resume` (was unimplemented) merged into idempotent `start`
 *
 * `format` arg added to signature (was missing from invokeRuntimeDeferred) — show + update need it.
 */
async function dispatchMissionTargeted(mc: Missioncraft, parsed: ParsedCommand, format: OutputFormat): Promise<void> {
  switch (parsed.verb) {
    case 'show': {
      const id = parsed.positionals[0];
      const state = await mc.get('mission', id);
      console.log(formatValue(state, format));
      return;
    }
    case 'update': {
      // mutation built from sub-action + remaining positionals
      const id = parsed.positionals[0];
      const mutation = buildMissionMutation(parsed);
      const state = await mc.update('mission', id, mutation);
      console.log(formatValue(state, format));
      return;
    }
    case 'start': {
      const progressSink = makeProgressSink(parsed);                       // v1.0.5 idea-273
      let handle;
      if (parsed.flags.has('-f')) {
        handle = await mc.start({ config: { missionConfigSchemaVersion: 2, mission: { id: 'placeholder', lifecycleState: 'created', createdAt: new Date() }, repos: [] } }, { onProgress: progressSink });
      } else {
        // mission-78 W6-new slice (iii) (Design v5.0 §10.6): idempotent-spawn-if-not-running.
        // CLI always passes `idempotent: true` for `msn <id> start` (and `msn start <id>` legacy
        // verb-first) — graceful no-op when daemon already running. Per architect-disposition
        // thread-550 round 4: idempotent-flag at SDK level avoids race between concurrent CLI
        // invocations + replaces the dropped `msn <id> resume` verb (merged into idempotent start).
        handle = await mc.start(parsed.positionals[0], { onProgress: progressSink, idempotent: true });
      }
      // bug-64 item 6 (v1.0.3 slice iv): emit success-confirmation line on stdout
      const nameSuffix = handle.name ? ` ('${handle.name}')` : '';
      const pid = readDaemonPid(mc.workspaceRoot, handle.id);
      const pidSuffix = pid !== undefined ? `; daemon-pid ${pid}` : '';
      // v1.0.4 bug-66 (slice iii): success-line in green
      console.log(colors.success(`started mission ${handle.id}${nameSuffix}${pidSuffix}`));
      return;
    }
    // mission-78 W6-new slice (v): `apply` + `tick` cases REMOVED; both verbs DROPPED entirely.
    case 'complete': {
      const progressSink = makeProgressSink(parsed);                       // v1.0.5 idea-273
      // v1.0.6 bug-72: --purge-workspace flag; default preserves workspace at terminal.
      const result = await mc.complete(
        parsed.positionals[0],
        parsed.positionals[1],
        {
          onProgress: progressSink,
          ...(parsed.flags.has('--purge-config') && { purgeConfig: true }),
          ...(parsed.flags.has('--purge-workspace') && { purgeWorkspace: true }),
        },
      );
      // bug-64 item 6+7 scope-extension (architect-pre-approved): symmetric `complete` line
      const nameSuffix = result.name ? ` ('${result.name}')` : '';
      const prs = result.publishedPRs ?? [];
      const prSuffix = prs.length > 0
        ? `; PRs opened: ${prs.map((p) => p.prUrl).join(', ')}`
        : '';
      console.log(colors.success(`completed mission ${result.id}${nameSuffix}${prSuffix}`));
      return;
    }
    case 'abandon': {
      const progressSink = makeProgressSink(parsed);                       // v1.0.5 idea-273
      const opts: { purgeConfig?: boolean; retain?: boolean; onProgress?: typeof progressSink } = { onProgress: progressSink };
      if (parsed.flags.has('--purge-config')) opts.purgeConfig = true;
      if (parsed.flags.has('--retain')) opts.retain = true;
      const result = await mc.abandon(parsed.positionals[0], parsed.positionals[1], opts);
      // bug-64 item 7 (v1.0.3 slice iv): emit success-confirmation line on stdout
      const nameSuffix = result.name ? ` ('${result.name}')` : '';
      const wsSuffix = parsed.flags.has('--retain') ? '; workspace preserved (--retain)' : '; workspace removed';
      console.log(colors.success(`abandoned mission ${result.id}${nameSuffix}${wsSuffix}; daemon stopped`));
      return;
    }
    case 'workspace': {
      // SD1 fix (v1.0.2 slice iii): print the resolved workspace path to stdout. Pre-fix the
      // return value was discarded → silent exit-0; SDK API worked but CLI never emitted output.
      const path = await mc.workspace(parsed.positionals[0], parsed.positionals[1]);
      console.log(path);
      return;
    }
    case 'cd': {
      // v1.0.3 idea-269: when the shell-function wrapper is INSTALLED (`eval "$(msn shell-init bash)"`),
      // this code-path is never reached — the wrapper intercepts `msn cd` and runs `cd $(msn workspace ...)`.
      // When wrapper is NOT installed, the CLI binary can't change the parent shell's cwd; we emit the
      // path to stdout (operator can `cd "$(msn cd <id>)"`) + a stderr hint to install the wrapper.
      const path = await mc.workspace(parsed.positionals[0], parsed.positionals[1]);
      console.log(path);
      process.stderr.write(
        `hint: 'msn cd' inside the binary can't change your shell's cwd; install the shell-function wrapper via \`eval "$(msn shell-init bash)"\` (or zsh/fish) for direct cd.\n`,
      );
      return;
    }
    default:
      throw new ConfigValidationError(`internal: dispatchMissionTargeted missing case for '${parsed.verb}'`);
  }
}

// Entry-point — only invoke when run as binary (allows test-import without side-effects).
// Symlink-safe guard: under `npm install -g`, the bin shim is a symlink and Node 24's default
// `--preserve-symlinks-main=false` resolves `import.meta.url` to the realpath while `argv[1]`
// retains the symlink path — direct equality fails. Compare via realpath on both sides.
const isMainModule = (() => {
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1] ?? '');
  } catch {
    return false;
  }
})();
if (isMainModule) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      process.exit(1);
    },
  );
}

export { main };
