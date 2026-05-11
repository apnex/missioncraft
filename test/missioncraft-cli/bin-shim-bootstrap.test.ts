import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Regression test for v1.0.1 fix — CLI bin-shim silent-failure under symlinked-bin invocation.
//
// Defect surfaced at v1.0.0 publish: `msn --help` via `npm install -g @apnex/missioncraft` silent-exited 0
// because `bin.ts` `isMainModule` guard compared `import.meta.url` (realpath-resolved by Node 24 default
// `--preserve-symlinks-main=false`) with `process.argv[1]` (symlink path retained). Both equality + fallback
// branches failed → `main()` never invoked.
//
// This test exercises the symlinked-bin code-path directly without requiring `npm pack` + install (which
// would add network/filesystem overhead). The symlink we create has the same shape as npm's bin-shim:
// a symlink in a sibling directory pointing at `dist/missioncraft-cli/bin.js`.

describe('CLI bin-shim symlink-bootstrap regression', () => {
  let tmpDir: string;
  let symlinkPath: string;
  const realBinPath = join(process.cwd(), 'dist', 'missioncraft-cli', 'bin.js');

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'missioncraft-bin-shim-'));
    const binDir = join(tmpDir, 'bin');
    mkdirSync(binDir);
    symlinkPath = join(binDir, 'msn');
    symlinkSync(realBinPath, symlinkPath);
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('symlink + realpath resolve to different paths (precondition for the bug)', () => {
    expect(realpathSync(symlinkPath)).toBe(realBinPath);
    expect(symlinkPath).not.toBe(realBinPath);
  });

  it('`node $SYMLINK_PATH --help` produces stdout (defeats silent-exit-0 defect)', () => {
    const result = spawnSync(process.execPath, [symlinkPath, '--help'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(/missioncraft 1\.0\.\d+ — sovereign mission-orchestration substrate/);
    expect(result.stdout).toMatch(/Usage: msn <verb>/);
  });

  it('`node $SYMLINK_PATH --version` produces version string', () => {
    const result = spawnSync(process.execPath, [symlinkPath, '--version'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^missioncraft 1\.0\.\d+/);
  });

  // bug-64 item 1 (v1.0.3): bare `msn` falls through to help (mirrors git/npm/docker)
  it('bug-64 item 1 — bare `msn` (no args) prints help + exits 0', () => {
    const result = spawnSync(process.execPath, [symlinkPath], {
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(/Usage: msn <verb>/);
  });

  // bug-64 item 8 (v1.0.3): `msn help` verb dispatches to identical output as `--help` flag
  it('bug-64 item 8 — `msn help` verb produces help output (== --help)', () => {
    const result = spawnSync(process.execPath, [symlinkPath, 'help'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(/Usage: msn <verb>/);
  });

  // bug-64 item 2 (v1.0.3): `msn list` empty preserves header + emits `(no entries)`
  it('bug-64 item 2 — `msn list` empty preserves header row + (no entries) indicator', () => {
    const wsRoot = mkdtempSync(join(tmpdir(), 'msn-item2-empty-'));
    try {
      const result = spawnSync(
        process.execPath,
        [symlinkPath, 'list', '--workspace-root', wsRoot],
        { encoding: 'utf8', timeout: 10000 },
      );
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      // Header row preserved (column names upper-cased)
      expect(result.stdout).toMatch(/ID\s+NAME\s+LIFECYCLE\s+REPOS-COUNT/);
      // Empty-state indicator line
      expect(result.stdout).toMatch(/\(no entries\)/);
    } finally {
      rmSync(wsRoot, { recursive: true, force: true });
    }
  });

  // bug-64 item 3 (v1.0.3): `msn show` no-arg → enriched LLM-discoverable error
  it('bug-64 item 3 — `msn show` no-arg emits enriched error with discovery hint', () => {
    const result = spawnSync(process.execPath, [symlinkPath, 'show'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.status).toBe(64);  // EX_USAGE per bin.ts main()
    expect(result.stderr).toMatch(/'show' requires <id\|name> arg; run 'msn list'/);
  });

  // SD1 regression (v1.0.2 slice iii): `msn workspace <id>` must print the resolved workspace
  // path to stdout. Pre-fix the CLI dispatcher discarded the SDK return value → silent exit-0.
  // Verified via real CLI invocation against a tmp workspace-root with a pre-staged mission.
  it('SD1 regression — `msn workspace <id>` prints the resolved workspace path to stdout', () => {
    const wsRoot = mkdtempSync(join(tmpdir(), 'msn-sd1-ws-'));
    try {
      // Step 1: create a mission via SDK direct invocation (subprocess so it runs against the
      // same dist bundle the CLI uses; CLI's `msn create` works fine — see v1.0.1 verified
      // create+list flow). Embed the script inline to keep test self-contained.
      const createResult = spawnSync(
        process.execPath,
        [
          '-e',
          `(async () => {
            const { Missioncraft } = await import('${process.cwd()}/dist/missioncraft-sdk/index.js');
            const mc = new Missioncraft({ workspaceRoot: ${JSON.stringify(wsRoot)} });
            const h = await mc.create('mission', { repo: 'file:///tmp/sd1-repo' });
            await mc.storage.allocate(h.id, 'file:///tmp/sd1-repo');
            console.log(h.id);
          })().catch((e) => { console.error(e); process.exit(1); });`,
        ],
        { encoding: 'utf8', timeout: 15000 },
      );
      expect(createResult.status).toBe(0);
      const missionId = createResult.stdout.trim();
      expect(missionId).toMatch(/^msn-[a-f0-9]{8}$/);

      // Step 2: run `msn workspace <id> --workspace-root <wsRoot>` via symlinked bin
      const workspaceResult = spawnSync(
        process.execPath,
        [symlinkPath, 'workspace', missionId, '--workspace-root', wsRoot],
        { encoding: 'utf8', timeout: 10000 },
      );
      expect(workspaceResult.status).toBe(0);
      expect(workspaceResult.stderr).toBe('');
      // stdout must contain the resolved workspace path (allocated under wsRoot)
      expect(workspaceResult.stdout.trim()).toContain(wsRoot);
      expect(workspaceResult.stdout.trim()).toContain(missionId);
    } finally {
      rmSync(wsRoot, { recursive: true, force: true });
    }
  });
});
