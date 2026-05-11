#!/usr/bin/env node
// `msn` CLI entry-point (Design v4.8 §2.3.2).
//
// Pipeline: argv → parser (Rules 1-7) → SDK invocation → output-formatter → stdout.
// Sovereign-module SDK consumer per v1.1 reshape Refinement #4 — imports `@apnex/missioncraft` package self-reference.

import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import {
  Missioncraft,
  ConfigValidationError,
  MissioncraftError,
  MissionStateError,
  type MissionMutation,
  type ScopeMutation,
  VERSION,
} from '@apnex/missioncraft';

import { parse, type ParsedCommand } from './grammar/parser.js';
import {
  formatTable,
  formatValue,
  resolveOutputFormat,
  type OutputFormat,
} from './grammar/output-formatter.js';

const HELP_TEXT = `missioncraft ${VERSION} — sovereign mission-orchestration substrate

Usage: msn <verb> [args] [--flags]

Mission verbs:
  msn create [--name <slug>] [--repo <url>...] [--scope <id|name>]
  msn list [--status <state>] [--output json|yaml]
  msn show <id|name>
  msn start <id|name> | -f <path> [--retain]
  msn apply -f <path>
  msn complete <id|name> <message> [--purge-config]
  msn abandon <id|name> <message> [--purge-config]
  msn tick <id|name>
  msn workspace <id|name> [<repo-name>]   (also accepts <id>:<repo>[/<path>] coord-form)

Mission update:
  msn update <id|name> repo-add <url> [--name <slug>] [--branch <name>] [--base <branch>]
  msn update <id|name> repo-remove <repo-name>
  msn update <id|name> name <new-name>
  msn update <id|name> description <text>
  msn update <id|name> hub-id <hub-id>
  msn update <id|name> scope-id <scope-id|name|"">
  msn update <id|name> tags-set <key> <value>
  msn update <id|name> tags-remove <key>

Multi-participant (v4.0):
  msn join <id|name> --coord-remote <url> [--principal <id>]
  msn leave <id|name> [--purge-workspace]

Scope namespace:
  msn scope create [--name <slug>] [--description <text>] [--repo <url>...]
  msn scope list [--include-references] [--output json|yaml]
  msn scope show <id|name> [--include-references]
  msn scope update <id|name> <sub-action> [args]
  msn scope delete <id|name>

Operator-config:
  msn config get <key>
  msn config set <key> <value>

Global flags (apply to all verbs):
  --workspace-root <path>    Override workspace-root for this invocation
  --wip-cadence-ms <ms>      Override WIP commit cadence
  --snapshot-cadence-ms <ms> Override snapshot cadence
  --lock-wait-ms <ms>        Override lock-acquire wait timeout
  --lock-validity-ms <ms>    Override lock-validity TTL
  --output <text|json|yaml>  Override default output format

For more: https://github.com/apnex/missioncraft
`;

async function main(argv: readonly string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parse(argv);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      console.error(`error: ${err.message}`);
      return 64;                                                                    // EX_USAGE
    }
    throw err;
  }

  if (parsed.verb === '--help') {
    console.log(HELP_TEXT);
    return 0;
  }
  if (parsed.verb === '--version') {
    console.log(`missioncraft ${VERSION}`);
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
      console.error(`error: ${err.name}: ${err.message}`);
      return err instanceof MissionStateError ? 65 : 1;                            // EX_DATAERR for state-violations
    }
    throw err;
  }
  return 0;
}

async function dispatch(mc: Missioncraft, parsed: ParsedCommand, format: OutputFormat): Promise<void> {
  switch (parsed.verb) {
    case 'create': {
      const handle = await mc.create('mission', {
        ...(parsed.flags.has('--name') && { name: String(parsed.flags.get('--name')) }),
        ...(parsed.flags.has('--repo') && { repo: String(parsed.flags.get('--repo')) }),
        ...(parsed.flags.has('--scope') && { scope: String(parsed.flags.get('--scope')) }),
      });
      console.log(format === 'text' ? handle.name ? `${handle.id}\t${handle.name}` : handle.id : formatValue(handle, format));
      return;
    }
    case 'list': {
      // 0-positional → list missions; 1-positional → drill-down repos within mission
      if (parsed.positionals.length === 0) {
        const status = parsed.flags.get('--status');
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
    case 'config': {
      const key = parsed.positionals[0];
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
    // ─── Runtime-deferred (W4/W5) — verbs that the SDK throws "not yet implemented" ───
    case 'start':
    case 'apply':
    case 'complete':
    case 'abandon':
    case 'tick':
    case 'workspace':
    case 'join':
    case 'leave':
      await invokeRuntimeDeferred(mc, parsed);
      return;
    default:
      throw new ConfigValidationError(`internal: dispatcher missing case for verb '${parsed.verb}'`);
  }
}

function buildMissionMutation(parsed: ParsedCommand): MissionMutation {
  const sub = parsed.subAction;
  const positionals = parsed.positionals;            // [<id>, ...args]
  switch (sub) {
    case 'repo-add': {
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
  switch (parsed.subAction) {
    case 'create': {
      const handle = await mc.create('scope', {
        ...(parsed.flags.has('--name') && { name: String(parsed.flags.get('--name')) }),
        ...(parsed.flags.has('--description') && { description: String(parsed.flags.get('--description')) }),
        ...(parsed.flags.has('--repo') && { repo: String(parsed.flags.get('--repo')) }),
      });
      console.log(format === 'text' ? handle.name ? `${handle.id}\t${handle.name}` : handle.id : formatValue(handle, format));
      return;
    }
    case 'list': {
      const states = await mc.list('scope');
      console.log(formatValue(states, format));
      return;
    }
    case 'show': {
      const state = await mc.get('scope', parsed.positionals[0]);
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
      throw new ConfigValidationError(`internal: unknown 'scope' sub-verb '${parsed.subAction}'`);
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

async function invokeRuntimeDeferred(mc: Missioncraft, parsed: ParsedCommand): Promise<void> {
  // These verbs throw MissionStateError("not yet implemented; W4/W5") at SDK level;
  // the dispatch let-throws and main() catches.
  switch (parsed.verb) {
    case 'start': {
      let handle;
      if (parsed.flags.has('-f')) {
        handle = await mc.start({ config: { missionConfigSchemaVersion: 1, mission: { id: 'placeholder', lifecycleState: 'created', createdAt: new Date() }, repos: [] } });
      } else {
        handle = await mc.start(parsed.positionals[0]);
      }
      // bug-64 item 6 (v1.0.3 slice iv): emit success-confirmation line on stdout
      const nameSuffix = handle.name ? ` ('${handle.name}')` : '';
      const pid = readDaemonPid(mc.workspaceRoot, handle.id);
      const pidSuffix = pid !== undefined ? `; daemon-pid ${pid}` : '';
      console.log(`started mission ${handle.id}${nameSuffix}${pidSuffix}`);
      return;
    }
    case 'apply':
      await mc.apply({ missionConfigSchemaVersion: 1, mission: { id: 'placeholder', lifecycleState: 'created', createdAt: new Date() }, repos: [] });
      return;
    case 'complete': {
      const result = await mc.complete(
        parsed.positionals[0],
        parsed.positionals[1],
        parsed.flags.has('--purge-config') ? { purgeConfig: true } : undefined,
      );
      // bug-64 item 6+7 scope-extension (architect-pre-approved): symmetric `complete` line
      const nameSuffix = result.name ? ` ('${result.name}')` : '';
      const prs = result.publishedPRs ?? [];
      const prSuffix = prs.length > 0
        ? `; PRs opened: ${prs.map((p) => p.prUrl).join(', ')}`
        : '';
      console.log(`completed mission ${result.id}${nameSuffix}${prSuffix}`);
      return;
    }
    case 'abandon': {
      const opts = parsed.flags.has('--purge-config')
        ? { purgeConfig: true }
        : (parsed.flags.has('--retain') ? { retain: true } : undefined);
      const result = await mc.abandon(parsed.positionals[0], parsed.positionals[1], opts);
      // bug-64 item 7 (v1.0.3 slice iv): emit success-confirmation line on stdout
      const nameSuffix = result.name ? ` ('${result.name}')` : '';
      const wsSuffix = parsed.flags.has('--retain') ? '; workspace preserved (--retain)' : '; workspace removed';
      console.log(`abandoned mission ${result.id}${nameSuffix}${wsSuffix}; daemon stopped`);
      return;
    }
    case 'tick':
      await mc.tick(parsed.positionals[0]);
      return;
    case 'workspace': {
      // SD1 fix (v1.0.2 slice iii): print the resolved workspace path to stdout. Pre-fix the
      // return value was discarded → silent exit-0; SDK API worked but CLI never emitted output.
      const path = await mc.workspace(parsed.positionals[0], parsed.positionals[1]);
      console.log(path);
      return;
    }
    case 'join': {
      const coordRemote = String(parsed.flags.get('--coord-remote') ?? '');
      const principal = parsed.flags.get('--principal');
      await mc.join(parsed.positionals[0], coordRemote, typeof principal === 'string' ? principal : undefined);
      return;
    }
    case 'leave':
      await mc.leave(parsed.positionals[0], parsed.flags.has('--purge-workspace') ? { purgeWorkspace: true } : undefined);
      return;
    default:
      throw new ConfigValidationError(`internal: invokeRuntimeDeferred missing case for '${parsed.verb}'`);
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
