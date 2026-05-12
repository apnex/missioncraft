// v1.1.0 W1 slice (i) — mission-78 NativeGitEngine canonical build (Path D2 substrate-replacement).
//
// Architect-disposition (α) 2026-05-12T02:14Z: file at `defaults/native-git-engine.ts` parallel-sibling
// to existing IsomorphicGitEngine. PROVIDER_REGISTRY entry `'native-git'` lands W1 slice (iv).
//
// Slice (i) coverage:
// - `gitExec` helper — argv-only discipline; surfaces git stderr (not Node's argv-joined display
//   per `feedback_node_execfile_error_formatter_visual_misleads_diagnosis.md`)
// - 6 foundational ops: clone / branch / checkout / log / status / revparse
// - 1 integration test against HTTP fixture (clone-from-server end-to-end)
//
// Helper-to-be-implemented methods (init/commit/push/etc.) are NOT exercised — they throw
// UnsupportedOperationError until slice (ii)/(iii). Asserting that is part of the test suite
// to lock the slice-progression contract.

import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NativeGitEngine, gitExec } from '../../src/missioncraft-sdk/defaults/native-git-engine.js';
import type { WorkspaceHandle } from '../../src/missioncraft-sdk/pluggables/storage.js';
import type { AgentIdentity } from '../../src/missioncraft-sdk/pluggables/identity.js';
import { UnsupportedOperationError } from '../../src/missioncraft-sdk/errors.js';
import { createGitHttpFixture, type GitHttpFixture } from '../fixtures/git-http-fixture.js';

const execFileAsync = promisify(execFile);

const IDENTITY: AgentIdentity = { name: 'Slice I Test', email: 'slice-i@native-engine.test' };

function makeWorkspace(path: string, missionId = 'm-test', repoUrl = 'test://local'): WorkspaceHandle {
  return { missionId, repoUrl, path };
}

/** Seed an on-disk repo with N commits on `main`. Returns the path. */
async function seedRepo(dir: string, commitCount = 1): Promise<void> {
  await mkdir(dir, { recursive: true });
  await execFileAsync('git', ['init', '--quiet'], { cwd: dir });
  // Pre-2.28 git lacks `--initial-branch`; explicit symbolic-ref works on all versions.
  await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'seed@x.com'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'Seed'], { cwd: dir });
  for (let i = 0; i < commitCount; i++) {
    await writeFile(join(dir, `file-${i}.txt`), `content ${i}\n`, 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: dir });
    await execFileAsync('git', ['commit', '--quiet', '-m', `commit ${i}`], { cwd: dir });
  }
}

/** Seed a bare upstream with one commit on `main`. */
async function seedBareUpstream(bareDir: string, seedDir: string): Promise<void> {
  await mkdir(bareDir, { recursive: true });
  await execFileAsync('git', ['init', '--quiet', '--bare'], { cwd: bareDir });
  await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: bareDir });
  await mkdir(seedDir, { recursive: true });
  await execFileAsync('git', ['init', '--quiet'], { cwd: seedDir });
  await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: seedDir });
  await execFileAsync('git', ['config', 'user.email', 'seed@x.com'], { cwd: seedDir });
  await execFileAsync('git', ['config', 'user.name', 'Seed'], { cwd: seedDir });
  await writeFile(join(seedDir, 'README.md'), '# upstream\n', 'utf8');
  await execFileAsync('git', ['add', '.'], { cwd: seedDir });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: seedDir });
  await execFileAsync('git', ['remote', 'add', 'origin', bareDir], { cwd: seedDir });
  await execFileAsync('git', ['push', '--quiet', 'origin', 'main'], { cwd: seedDir });
}

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w1-i-native-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('v1.1.0 W1 slice (i) — gitExec helper (Path D2 argv-only discipline)', () => {
  it('happy-path: returns stdout + stderr as utf8 strings', async () => {
    const repoDir = join(tempRoot, 'repo');
    await seedRepo(repoDir);
    const ws = makeWorkspace(repoDir);

    const result = await gitExec(ws, ['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(result.stdout.trim()).toBe('main');
    expect(typeof result.stderr).toBe('string');
  });

  it('non-zero exit surfaces git stderr in the thrown error message', async () => {
    const repoDir = join(tempRoot, 'repo');
    await seedRepo(repoDir);
    const ws = makeWorkspace(repoDir);

    // `git rev-parse non-existent-ref` exits non-zero with a message on stderr.
    await expect(gitExec(ws, ['rev-parse', 'non-existent-ref-xyz'])).rejects.toThrow(
      /git exited with error.*non-existent-ref-xyz/,
    );
  });

  it('null-cwd mode: caller provides absolute path arg, no workspace cwd needed', async () => {
    // `git --version` works anywhere; verify null-cwd path through the helper.
    const result = await gitExec(null, ['--version']);
    expect(result.stdout).toMatch(/^git version /);
  });
});

describe('v1.1.0 W1 slice (i) — NativeGitEngine.clone', () => {
  it('clone copies upstream content into the target workspace', async () => {
    const bareDir = join(tempRoot, 'origin.git');
    const seedDir = join(tempRoot, 'seed');
    await seedBareUpstream(bareDir, seedDir);

    const targetDir = join(tempRoot, 'cloned');
    const ws = makeWorkspace(targetDir, 'm-clone', `file://${bareDir}`);

    const engine = new NativeGitEngine();
    await engine.clone(ws, bareDir, { fs: undefined, identity: IDENTITY });

    expect(existsSync(join(targetDir, '.git'))).toBe(true);
    expect(existsSync(join(targetDir, 'README.md'))).toBe(true);
  });

  it('clone stores identity for later commit-firing-time resolution (slice ii forward-compat)', async () => {
    const bareDir = join(tempRoot, 'origin.git');
    const seedDir = join(tempRoot, 'seed');
    await seedBareUpstream(bareDir, seedDir);

    const targetDir = join(tempRoot, 'cloned');
    const ws = makeWorkspace(targetDir);
    const engine = new NativeGitEngine();
    await engine.clone(ws, bareDir, { fs: undefined, identity: IDENTITY });

    // @internal accessor — slice (ii) commit() will read this via the same WeakMap.
    const stored = NativeGitEngine._identityForWorkspace(ws);
    expect(stored).toEqual(IDENTITY);
  });
});

describe('v1.1.0 W1 slice (i) — NativeGitEngine.branch + checkout', () => {
  it('branch creates a new branch at HEAD; checkout switches to it', async () => {
    const repoDir = join(tempRoot, 'repo');
    await seedRepo(repoDir);
    const ws = makeWorkspace(repoDir);
    const engine = new NativeGitEngine();

    await engine.branch(ws, 'feature-x');
    await engine.checkout(ws, 'feature-x');

    const { stdout } = await gitExec(ws, ['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(stdout.trim()).toBe('feature-x');
  });

  it('branch with options.from creates branch at explicit ref', async () => {
    const repoDir = join(tempRoot, 'repo');
    await seedRepo(repoDir, 3);                          // 3 commits on main
    const ws = makeWorkspace(repoDir);
    const engine = new NativeGitEngine();

    // Get the second-to-last commit SHA; branch from it
    const log = await gitExec(ws, ['rev-list', '--reverse', 'HEAD']);
    const shas = log.stdout.trim().split('\n');
    const middleSha = shas[1];

    await engine.branch(ws, 'from-middle', { from: middleSha });
    await engine.checkout(ws, 'from-middle');
    const headSha = (await gitExec(ws, ['rev-parse', 'HEAD'])).stdout.trim();
    expect(headSha).toBe(middleSha);
  });
});

describe('v1.1.0 W1 slice (i) — NativeGitEngine.revparse', () => {
  it('resolves HEAD to a 40-char SHA', async () => {
    const repoDir = join(tempRoot, 'repo');
    await seedRepo(repoDir);
    const ws = makeWorkspace(repoDir);
    const engine = new NativeGitEngine();

    const sha = await engine.revparse(ws, 'HEAD');
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('resolves a branch name to its tip SHA', async () => {
    const repoDir = join(tempRoot, 'repo');
    await seedRepo(repoDir);
    const ws = makeWorkspace(repoDir);
    const engine = new NativeGitEngine();

    const headSha = await engine.revparse(ws, 'HEAD');
    const mainSha = await engine.revparse(ws, 'main');
    expect(mainSha).toBe(headSha);
  });
});

describe('v1.1.0 W1 slice (i) — NativeGitEngine.status', () => {
  it('clean repo: clean=true; all lists empty; branch + head populated', async () => {
    const repoDir = join(tempRoot, 'repo');
    await seedRepo(repoDir);
    const ws = makeWorkspace(repoDir);
    const engine = new NativeGitEngine();

    const status = await engine.status(ws);
    expect(status.clean).toBe(true);
    expect(status.staged).toEqual([]);
    expect(status.modified).toEqual([]);
    expect(status.untracked).toEqual([]);
    expect(status.branch).toBe('main');
    expect(status.head).toMatch(/^[0-9a-f]{40}$/);
  });

  it('untracked file shows in untracked[]', async () => {
    const repoDir = join(tempRoot, 'repo');
    await seedRepo(repoDir);
    await writeFile(join(repoDir, 'new-file.txt'), 'untracked\n', 'utf8');
    const ws = makeWorkspace(repoDir);
    const engine = new NativeGitEngine();

    const status = await engine.status(ws);
    expect(status.clean).toBe(false);
    expect(status.untracked).toContain('new-file.txt');
    expect(status.modified).not.toContain('new-file.txt');
    expect(status.staged).not.toContain('new-file.txt');
  });

  it('modified-not-staged file shows in modified[]', async () => {
    const repoDir = join(tempRoot, 'repo');
    await seedRepo(repoDir);
    await writeFile(join(repoDir, 'file-0.txt'), 'modified content\n', 'utf8');
    const ws = makeWorkspace(repoDir);
    const engine = new NativeGitEngine();

    const status = await engine.status(ws);
    expect(status.clean).toBe(false);
    expect(status.modified).toContain('file-0.txt');
    expect(status.staged).not.toContain('file-0.txt');
  });

  it('staged file shows in staged[]', async () => {
    const repoDir = join(tempRoot, 'repo');
    await seedRepo(repoDir);
    await writeFile(join(repoDir, 'staged.txt'), 'staged content\n', 'utf8');
    await execFileAsync('git', ['add', 'staged.txt'], { cwd: repoDir });
    const ws = makeWorkspace(repoDir);
    const engine = new NativeGitEngine();

    const status = await engine.status(ws);
    expect(status.clean).toBe(false);
    expect(status.staged).toContain('staged.txt');
  });
});

describe('v1.1.0 W1 slice (i) — NativeGitEngine.log', () => {
  it('returns one entry per commit, newest-first; sha + author + parents populated', async () => {
    const repoDir = join(tempRoot, 'repo');
    await seedRepo(repoDir, 3);                          // 3 commits
    const ws = makeWorkspace(repoDir);
    const engine = new NativeGitEngine();

    const entries = await engine.log(ws);
    expect(entries.length).toBe(3);
    for (const e of entries) {
      expect(e.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(e.author.name).toBe('Seed');
      expect(e.author.email).toBe('seed@x.com');
      expect(e.timestamp).toBeInstanceOf(Date);
      expect(e.message).toMatch(/^commit \d+/);
    }
    // Initial commit has zero parents; subsequent commits have one parent.
    expect(entries[entries.length - 1].parents).toEqual([]);
    expect(entries[0].parents.length).toBe(1);
  });

  it('maxCount limits the result set', async () => {
    const repoDir = join(tempRoot, 'repo');
    await seedRepo(repoDir, 5);
    const ws = makeWorkspace(repoDir);
    const engine = new NativeGitEngine();

    const entries = await engine.log(ws, { maxCount: 2 });
    expect(entries.length).toBe(2);
  });

  it('ref scopes to a specific branch', async () => {
    const repoDir = join(tempRoot, 'repo');
    await seedRepo(repoDir, 1);
    const ws = makeWorkspace(repoDir);
    const engine = new NativeGitEngine();
    await engine.branch(ws, 'feature-y');
    await engine.checkout(ws, 'feature-y');

    // Commit one more on feature-y so main + feature-y diverge by 1 commit
    await writeFile(join(repoDir, 'feature.txt'), 'feature\n', 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: repoDir });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'feature commit'], { cwd: repoDir });

    const mainEntries = await engine.log(ws, { ref: 'main' });
    const featureEntries = await engine.log(ws, { ref: 'feature-y' });
    expect(featureEntries.length).toBe(mainEntries.length + 1);
    expect(featureEntries[0].message).toMatch(/^feature commit/);
  });
});

// NOTE: slice-progression contract retired at slice (iii) ship — all GitEngine contract
// methods (init/commit/merge/squashCommit/createBundle/restoreBundle/etc.) are now implemented
// in NativeGitEngine. Slice (iv) wave-close adds PROVIDER_REGISTRY 'native-git' entry +
// full-contract integration test suite.

describe('v1.1.0 W1 slice (i) — providerName contract', () => {
  it('providerName is the canonical "native-git" string (PROVIDER_REGISTRY key for slice iv)', () => {
    expect(NativeGitEngine.providerName).toBe('native-git');
  });
});

describe('v1.1.0 W1 slice (i) — integration: clone via HTTP fixture', () => {
  let fixture: GitHttpFixture | undefined;

  afterEach(async () => {
    if (fixture) {
      await fixture.close();
      fixture = undefined;
    }
  });

  it('clones from a node-git-server HTTP fixture; status/log work on the cloned repo', async () => {
    const repoBase = join(tempRoot, 'origin-repos');
    const bareDir = join(repoBase, 'upstream.git');
    const seedDir = join(tempRoot, 'seed');
    await seedBareUpstream(bareDir, seedDir);

    fixture = await createGitHttpFixture(repoBase, { autoCreate: false });
    const cloneUrl = `${fixture.url}/upstream.git`;

    const targetDir = join(tempRoot, 'cloned');
    const ws = makeWorkspace(targetDir, 'm-http-clone', cloneUrl);
    const engine = new NativeGitEngine();
    await engine.clone(ws, cloneUrl, { fs: undefined, identity: IDENTITY });

    expect(existsSync(join(targetDir, '.git'))).toBe(true);
    expect(existsSync(join(targetDir, 'README.md'))).toBe(true);

    const status = await engine.status(ws);
    expect(status.clean).toBe(true);
    expect(status.branch).toBe('main');

    const entries = await engine.log(ws);
    expect(entries.length).toBe(1);
    expect(entries[0].message).toMatch(/^initial/);
  }, 30_000);
});
