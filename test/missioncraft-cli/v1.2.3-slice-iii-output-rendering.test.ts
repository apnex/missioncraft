// mission-81 slice (iii) — output-rendering cluster.
//
// bug-86: `msn scope list` emitted raw JSON unconditionally — should default to a table
//         (operator-DX parity with `msn list`); --output json|yaml is the opt-in.
// bug-87: `msn <id> help` / `msn <id> --help` dumped the full global help — should scope to
//         the mission-targeted verb level (show/start/complete/abandon/workspace/cd/update).
// abandon success-line: a `created`-state mission (never started) has no workspace and no
//         daemon — the CLI success line must not over-claim "workspace removed; daemon stopped"
//         (architect-scoped into slice (iii); shipped in the slice (iv) commit).

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

let tempRoot: string;
const CLI_BIN = join(__dirname, '..', '..', 'dist', 'missioncraft-cli', 'bin.js');

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-v123-iii-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

function runCli(...args: string[]): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync('node', [CLI_BIN, ...args, '--workspace-root', tempRoot], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

// Help commands don't touch the filesystem and don't need --workspace-root. Appending it would
// be absorbed into the help verb-path (the parser's help-form extraction only strips `-`-prefixed
// tokens, not global-flag VALUES) — a separate pre-existing parser edge, surfaced on thread-558.
function runHelp(...args: string[]): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync('node', [CLI_BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

describe('mission-81 slice (iii) bug-86 — msn scope list defaults to table format', () => {
  it('`msn scope list` (no --output) emits a column-aligned table, not raw JSON', () => {
    runCli('scope', 'create', '--name', 'alpha-scope');
    runCli('scope', 'create', '--name', 'beta-scope');

    const { stdout, status } = runCli('scope', 'list');
    expect(status).toBe(0);
    // table: header row + data rows; NOT a JSON array
    expect(stdout).not.toMatch(/^\s*\[/);                                  // not JSON
    expect(stdout).toMatch(/ID\s+NAME\s+LIFECYCLE\s+REPOS-COUNT/);          // table header
    expect(stdout).toMatch(/alpha-scope/);
    expect(stdout).toMatch(/beta-scope/);
  });

  it('`msn scope list --output json` still emits JSON (machine-readable opt-in)', () => {
    runCli('scope', 'create', '--name', 'gamma-scope');

    const { stdout, status } = runCli('scope', 'list', '--output', 'json');
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((s: { name?: string }) => s.name === 'gamma-scope')).toBe(true);
  });

  it('`msn scope list --include-references` table includes the REFERENCED-BY column', () => {
    runCli('scope', 'create', '--name', 'delta-scope');

    const { stdout, status } = runCli('scope', 'list', '--include-references');
    expect(status).toBe(0);
    expect(stdout).toMatch(/ID\s+NAME\s+LIFECYCLE\s+REPOS-COUNT\s+REFERENCED-BY/);
  });

  it('empty `msn scope list` preserves the table header (operator sees the schema)', () => {
    const { stdout, status } = runCli('scope', 'list');
    expect(status).toBe(0);
    expect(stdout).toMatch(/ID\s+NAME\s+LIFECYCLE\s+REPOS-COUNT/);
  });
});

describe('mission-81 slice (iii) bug-87 — msn <id> help scopes to mission-targeted verbs', () => {
  const MISSION_VERBS = ['show', 'start', 'complete', 'abandon', 'workspace', 'cd', 'update'];

  it('`msn <id> help` emits mission-targeted-verb help, NOT the global dump', () => {
    const { stdout, status } = runHelp('msn-deadbeef', 'help');
    expect(status).toBe(0);
    expect(stdout).toMatch(/usage: msn <mission-id> <verb>/);
    expect(stdout).toMatch(/Verbs operable on a specific mission:/);
    for (const v of MISSION_VERBS) {
      expect(stdout).toMatch(new RegExp(`\\b${v}\\b`));
    }
    // must NOT be the global help (which has the "sovereign mission-orchestration substrate" banner)
    expect(stdout).not.toMatch(/sovereign mission-orchestration substrate/);
  });

  it('`msn <id> --help` (flag form) also emits mission-targeted-verb help', () => {
    const { stdout, status } = runHelp('msn-deadbeef', '--help');
    expect(status).toBe(0);
    expect(stdout).toMatch(/Verbs operable on a specific mission:/);
    expect(stdout).not.toMatch(/sovereign mission-orchestration substrate/);
  });

  it('bare `msn help` still emits the full global help (unchanged)', () => {
    const { stdout, status } = runHelp('help');
    expect(status).toBe(0);
    expect(stdout).toMatch(/sovereign mission-orchestration substrate/);
  });

  it('`msn help <verb>` still emits per-verb help (unchanged)', () => {
    const { stdout, status } = runHelp('help', 'start');
    expect(status).toBe(0);
    // per-verb help for `start` — usage line names the verb + its shortDesc paragraph
    expect(stdout).toMatch(/usage: msn .*\bstart\b/);
    expect(stdout).toMatch(/Realize a configured mission/);
    // NOT the mission-targeted-verb scoped help (bug-87's new surface)
    expect(stdout).not.toMatch(/Verbs operable on a specific mission:/);
  });
});

describe('mission-81 — abandon success-line does not over-claim for created-state missions', () => {
  it('`msn <id> abandon` on a never-started mission omits the workspace/daemon claims', () => {
    const created = runCli('create', '--name', 'never-started-mission');
    const id = created.stdout.trim().split('\t')[0];

    const { stdout, status } = runCli(id, 'abandon', 'changed my mind');
    expect(status).toBe(0);
    // created-state success line: explicit "never started", NO workspace/daemon over-claim
    expect(stdout).toMatch(/was never started — no workspace or daemon/);
    expect(stdout).not.toMatch(/workspace removed/);
    expect(stdout).not.toMatch(/daemon stopped/);
  });

  it('`msn <id> abandon --purge-config` on a never-started mission notes config removal', () => {
    const created = runCli('create', '--name', 'purge-me-mission');
    const id = created.stdout.trim().split('\t')[0];

    const { stdout, status } = runCli(id, 'abandon', 'gone', '--purge-config');
    expect(status).toBe(0);
    expect(stdout).toMatch(/was never started/);
    expect(stdout).toMatch(/config removed \(--purge-config\)/);
  });
});
