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
});
