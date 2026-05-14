// mission-81 slice (ii) — bug-89: `msn shell-init` wrapper must intercept the W6-new
// id-first `msn <id> cd [<repo>]` form, not just the legacy verb-first `msn cd <args>`.
//
// Pre-fix the emitted wrapper only matched `$1 == "cd"`. W6-new (mission-78) migrated `cd`
// to id-first (`msn <id> cd`), where `$1` is the mission-id and `$2` is `cd` — so the wrapper
// fell through to the binary, which prints the path + a hint telling the operator to install
// the wrapper they already installed. This was the missing coverage that let it ship: the
// wrapper is shell-script-generated output, not TS-covered.
//
// These tests evaluate the REAL emitted wrapper in a bash subprocess, with a stub `msn` on
// PATH (echoes a known dir), and assert the wrapper's cd-interception routing.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const CLI_BIN = join(__dirname, '..', '..', 'dist', 'missioncraft-cli', 'bin.js');

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-bug89-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

/** Emit the real bash wrapper via the dist CLI binary. */
function emitWrapper(shell: 'bash' | 'zsh' | 'fish'): string {
  return execFileSync('node', [CLI_BIN, 'shell-init', shell], { encoding: 'utf8' });
}

/**
 * Run a bash script that: evals the real wrapper, puts a stub `msn` on PATH (the stub logs its
 * argv to ARGV_LOG and echoes RESOLVED_DIR), runs the given `msn ...` invocation, prints `pwd`.
 * Returns { finalPwd, stubArgv }.
 */
async function runWrapperWith(invocation: string): Promise<{ finalPwd: string; stubArgv: string }> {
  const stubDir = join(tempRoot, 'stub-bin');
  const resolvedDir = join(tempRoot, 'resolved-workspace');
  const argvLog = join(tempRoot, 'argv.log');
  await mkdir(stubDir, { recursive: true });
  await mkdir(resolvedDir, { recursive: true });
  // Stub `msn`: log argv, echo the resolved dir (stands in for `msn <id> workspace <repo>`).
  await writeFile(
    join(stubDir, 'msn'),
    `#!/bin/sh\nprintf '%s\\n' "$*" > "${argvLog}"\nprintf '%s\\n' "${resolvedDir}"\n`,
    'utf8',
  );
  await chmod(join(stubDir, 'msn'), 0o755);

  // Write the real wrapper to a file + `source` it — equivalent to the operator's
  // `eval "$(msn shell-init bash)"` but robust against quote-escaping in a nested string.
  const wrapperFile = join(tempRoot, 'wrapper.sh');
  await writeFile(wrapperFile, emitWrapper('bash'), 'utf8');
  // The wrapper uses `command msn` — `command` resolves via PATH, so the stub dir must be first.
  const script = [
    `export PATH="${stubDir}:$PATH"`,
    `source "${wrapperFile}"`,
    invocation,
    `pwd`,
  ].join('\n');
  const out = execFileSync('bash', ['-c', script], { encoding: 'utf8' });
  const finalPwd = out.trim().split('\n').pop() ?? '';
  let stubArgv = '';
  try {
    stubArgv = execFileSync('cat', [argvLog], { encoding: 'utf8' }).trim();
  } catch {
    stubArgv = '<stub not invoked>';
  }
  return { finalPwd, stubArgv };
}

describe('mission-81 slice (ii) bug-89 — shell-init wrapper intercepts id-first `msn <id> cd`', () => {
  it('emitted bash wrapper contains the id-first interception branch', () => {
    const wrapper = emitWrapper('bash');
    // legacy verb-first branch preserved
    expect(wrapper).toMatch(/\[ "\$1" = "cd" \]/);
    // NEW: id-first branch — `$2 == cd` guarded by mission-id pattern on `$1`
    expect(wrapper).toMatch(/\[ "\$2" = "cd" \]/);
    expect(wrapper).toMatch(/\$1" =~ \^msn-\[a-f0-9\]\{8\}\$/);
    expect(wrapper).toMatch(/command msn "\$_msn_id" workspace/);
  });

  it('emitted fish wrapper contains the id-first interception branch', () => {
    const wrapper = emitWrapper('fish');
    expect(wrapper).toMatch(/test "\$argv\[1\]" = "cd"/);                       // legacy preserved
    expect(wrapper).toMatch(/test "\$argv\[2\]" = "cd"/);                       // NEW id-first
    expect(wrapper).toMatch(/string match -qr '\^msn-\[a-f0-9\]\{8\}\$'/);
  });

  it('id-first `msn <id> cd <repo>` is intercepted — wrapper cd-s + calls `<id> workspace <repo>`', async () => {
    const { finalPwd, stubArgv } = await runWrapperWith('msn msn-deadbeef cd somerepo');
    // wrapper changed cwd to the stub-resolved dir (NOT fell through to the binary)
    expect(finalPwd).toBe(join(tempRoot, 'resolved-workspace'));
    // wrapper routed to the id-first `<id> workspace <repo>` form
    expect(stubArgv).toBe('msn-deadbeef workspace somerepo');
  });

  it('id-first `msn <id> cd` (bare, no repo) is intercepted — routes to `<id> workspace`', async () => {
    const { finalPwd, stubArgv } = await runWrapperWith('msn msn-deadbeef cd');
    expect(finalPwd).toBe(join(tempRoot, 'resolved-workspace'));
    expect(stubArgv).toBe('msn-deadbeef workspace');
  });

  it('legacy verb-first `msn cd <coord>` still intercepted (regression net)', async () => {
    const { finalPwd, stubArgv } = await runWrapperWith('msn cd msn-deadbeef:somerepo');
    expect(finalPwd).toBe(join(tempRoot, 'resolved-workspace'));
    expect(stubArgv).toBe('workspace msn-deadbeef:somerepo');
  });

  it('non-cd id-first invocations pass through untouched (no false-positive interception)', async () => {
    // `msn msn-deadbeef show` — $2 is "show", not "cd"; must NOT be intercepted.
    const { finalPwd, stubArgv } = await runWrapperWith('msn msn-deadbeef show');
    // cwd unchanged (still the bash -c default cwd, not the resolved-workspace)
    expect(finalPwd).not.toBe(join(tempRoot, 'resolved-workspace'));
    // stub WAS called (pass-through), with the verbatim argv
    expect(stubArgv).toBe('msn-deadbeef show');
  });

  it('`$2 == cd` with a non-mission-id `$1` passes through (guard prevents mis-interception)', async () => {
    // `msn list cd` — $1 is "list" (not a mission-id), $2 is "cd". The mission-id guard must
    // prevent interception; this passes through to the binary verbatim.
    const { finalPwd, stubArgv } = await runWrapperWith('msn list cd');
    expect(finalPwd).not.toBe(join(tempRoot, 'resolved-workspace'));
    expect(stubArgv).toBe('list cd');
  });
});
