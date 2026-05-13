// v1.1.0 W1 slice (iii) — NativeGitEngine advanced ops:
//   merge (ff / no-ff strategy) / squashCommit / createBundle / restoreBundle
//
// squashCommit + createBundle + restoreBundle are Native-canonical (NOT capability-gated).
// Tests verify squashed-commit produces a single new commit on baseRef with the caller-supplied
// message, no merge-commit, parent linkage = baseRef tip pre-squash.
//
// Multi-word commit messages exercised per `feedback_test_assertion_too_permissive_regex.md`.

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

const execFileAsync = promisify(execFile);

const IDENTITY: AgentIdentity = { name: 'Slice III Test', email: 'slice-iii@native-engine.test' };

function makeWorkspace(path: string, missionId = 'm-test', repoUrl = 'test://local'): WorkspaceHandle {
  return { missionId, repoUrl, path };
}

async function seedRepo(dir: string, commitCount = 1): Promise<void> {
  await mkdir(dir, { recursive: true });
  await execFileAsync('git', ['init', '--quiet'], { cwd: dir });
  await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'seed@x.com'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'Seed'], { cwd: dir });
  for (let i = 0; i < commitCount; i++) {
    await writeFile(join(dir, `file-${i}.txt`), `content ${i}\n`, 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: dir });
    await execFileAsync('git', ['commit', '--quiet', '-m', `commit ${i}`], { cwd: dir });
  }
}

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w1-iii-native-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('v1.1.0 W1 slice (iii) — NativeGitEngine.merge', () => {
  it("default 'no-ff' strategy creates a merge-commit even when fast-forward is possible", async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();
    await engine.init(ws, { fs: undefined, identity: IDENTITY });

    // Branch off main, add 1 commit on feature, then merge feature back into main
    await engine.branch(ws, 'feature');
    await engine.checkout(ws, 'feature');
    await writeFile(join(dir, 'feature.txt'), 'f\n', 'utf8');
    await engine.stage(ws, 'all');
    await engine.commit(ws, { message: 'feature commit with multi-word message' });

    await engine.checkout(ws, 'main');
    const mainBefore = (await gitExec(ws, ['rev-parse', 'main'])).stdout.trim();
    await engine.merge(ws, 'feature');                    // default = 'no-ff'

    // Post-merge HEAD should be a merge-commit with TWO parents (mainBefore + feature-tip)
    const { stdout: parentList } = await gitExec(ws, ['rev-list', '--parents', '-n1', 'HEAD']);
    const parents = parentList.trim().split(/\s+/).slice(1);
    expect(parents.length).toBe(2);
    expect(parents).toContain(mainBefore);
  });

  it("'ff' strategy fast-forwards when possible (no merge-commit; HEAD = feature-tip)", async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();
    await engine.init(ws, { fs: undefined, identity: IDENTITY });

    await engine.branch(ws, 'feature');
    await engine.checkout(ws, 'feature');
    await writeFile(join(dir, 'ff.txt'), 'ff\n', 'utf8');
    await engine.stage(ws, 'all');
    await engine.commit(ws, { message: 'ff feature commit' });
    const featureTip = (await gitExec(ws, ['rev-parse', 'feature'])).stdout.trim();

    await engine.checkout(ws, 'main');
    await engine.merge(ws, 'feature', { strategy: 'ff' });

    const headAfter = (await gitExec(ws, ['rev-parse', 'HEAD'])).stdout.trim();
    expect(headAfter).toBe(featureTip);
    // Single-parent (FF didn't create a new merge-commit)
    const { stdout: parentList } = await gitExec(ws, ['rev-list', '--parents', '-n1', 'HEAD']);
    const parents = parentList.trim().split(/\s+/).slice(1);
    expect(parents.length).toBe(1);
  });

  it("'ff' strategy fails when fast-forward is not possible (diverged branches)", async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();
    await engine.init(ws, { fs: undefined, identity: IDENTITY });

    // Diverge: commit on main + commit on feature (both since the branch-point)
    await engine.branch(ws, 'feature');
    await writeFile(join(dir, 'main-only.txt'), 'm\n', 'utf8');
    await engine.stage(ws, 'all');
    await engine.commit(ws, { message: 'main divergent commit' });

    await engine.checkout(ws, 'feature');
    await writeFile(join(dir, 'feature-only.txt'), 'f\n', 'utf8');
    await engine.stage(ws, 'all');
    await engine.commit(ws, { message: 'feature divergent commit' });

    await engine.checkout(ws, 'main');
    await expect(engine.merge(ws, 'feature', { strategy: 'ff' })).rejects.toThrow(
      /Not possible to fast-forward|fatal/,
    );
  });
});

describe('v1.1.0 W1 slice (iii) — NativeGitEngine.squashCommit (W2 canonical-switch verification target; W3-new extension Fix #8 corrected semantic)', () => {
  it('produces a single squashed commit on HEADREF with caller-supplied message; parent = baseRef tip pre-squash; baseRef unchanged', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();
    await engine.init(ws, { fs: undefined, identity: IDENTITY });

    // Create feature with 3 commits to squash-collapse
    await engine.branch(ws, 'feature');
    await engine.checkout(ws, 'feature');
    for (let i = 0; i < 3; i++) {
      await writeFile(join(dir, `f${i}.txt`), `f${i}\n`, 'utf8');
      await engine.stage(ws, 'all');
      await engine.commit(ws, { message: `feature ${i} of 3 multi-commit changeset` });
    }

    const mainTipBefore = (await gitExec(ws, ['rev-parse', 'main'])).stdout.trim();
    const squashedSha = await engine.squashCommit(
      ws,
      'main',
      'feature',
      'squash: collapse 3-commit feature into single commit',
    );

    // squashedSha is a 40-char SHA
    expect(squashedSha).toMatch(/^[0-9a-f]{40}$/);

    // W3-new extension Fix #8: HEADREF (feature) gets updated to squashed commit; baseRef (main) unchanged
    const featureTipAfter = (await gitExec(ws, ['rev-parse', 'feature'])).stdout.trim();
    expect(featureTipAfter).toBe(squashedSha);
    const mainTipAfter = (await gitExec(ws, ['rev-parse', 'main'])).stdout.trim();
    expect(mainTipAfter).toBe(mainTipBefore);                  // baseRef UNCHANGED

    // Single-parent commit (squash collapsed feature's 3 commits into 1) — parent = main pre-squash (baseRef)
    const { stdout: parentList } = await gitExec(ws, ['rev-list', '--parents', '-n1', squashedSha]);
    const parents = parentList.trim().split(/\s+/).slice(1);
    expect(parents).toEqual([mainTipBefore]);

    // Subject is the caller-supplied message (multi-word per discipline)
    const { stdout: subject } = await gitExec(ws, ['log', '-1', '--pretty=format:%s', squashedSha]);
    expect(subject).toBe('squash: collapse 3-commit feature into single commit');

    // All 3 feature files present in the squashed tree (working tree preserved since we're on feature)
    expect(existsSync(join(dir, 'f0.txt'))).toBe(true);
    expect(existsSync(join(dir, 'f1.txt'))).toBe(true);
    expect(existsSync(join(dir, 'f2.txt'))).toBe(true);
  });

  it('records caller identity (via env vars) on the squashed commit', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();
    await engine.init(ws, { fs: undefined, identity: IDENTITY });

    await engine.branch(ws, 'feature');
    await engine.checkout(ws, 'feature');
    await writeFile(join(dir, 'sq.txt'), 'sq\n', 'utf8');
    await engine.stage(ws, 'all');
    await engine.commit(ws, { message: 'feature single' });

    const sha = await engine.squashCommit(ws, 'main', 'feature', 'squash msg');
    const { stdout } = await gitExec(ws, ['log', '-1', '--pretty=format:%an|%ae', sha]);
    const [name, email] = stdout.split('|');
    expect(name).toBe(IDENTITY.name);
    expect(email).toBe(IDENTITY.email);
  });
});

describe('v1.1.0 W1 slice (iii) — NativeGitEngine.createBundle + restoreBundle (round-trip)', () => {
  it('createBundle writes a bundle archive containing the named ref + ancestors', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir, 3);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();

    const bundlePath = join(tempRoot, 'snapshots', 'main.bundle');
    const returned = await engine.createBundle(ws, bundlePath, 'main');
    expect(returned).toBe(bundlePath);
    expect(existsSync(bundlePath)).toBe(true);

    // Bundle is verifiable by `git bundle verify` (sanity check; not enforced by impl)
    const verify = await execFileAsync('git', ['bundle', 'verify', bundlePath], { cwd: dir });
    expect(verify.stdout + verify.stderr).toMatch(/main/);
  });

  it('restoreBundle into a fresh workspace recreates the ref from bundle objects', async () => {
    // Source repo with content
    const srcDir = join(tempRoot, 'src-repo');
    await seedRepo(srcDir, 2);
    const srcWs = makeWorkspace(srcDir);
    const engine = new NativeGitEngine();

    const bundlePath = join(tempRoot, 'snapshots', 'main.bundle');
    await engine.createBundle(srcWs, bundlePath, 'main');
    const srcMainSha = (await gitExec(srcWs, ['rev-parse', 'main'])).stdout.trim();

    // Fresh workspace; init bare-ish; restore
    const dstDir = join(tempRoot, 'dst-repo');
    await mkdir(dstDir, { recursive: true });
    await execFileAsync('git', ['init', '--quiet'], { cwd: dstDir });
    await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: dstDir });
    const dstWs = makeWorkspace(dstDir);

    await engine.restoreBundle(dstWs, bundlePath, 'refs/heads/main');

    // refs/heads/main on dst now points at srcMainSha (bundle ships objects + ref-list; we
    // explicitly update-ref to set the local ref name)
    const restoredSha = (await gitExec(dstWs, ['rev-parse', 'refs/heads/main'])).stdout.trim();
    expect(restoredSha).toBe(srcMainSha);
  });

  it('restoreBundle handles multi-line bundle output (ref-name match wins over first-line fallback)', async () => {
    // Single-ref bundle in practice; this test verifies the parser explicitly matches by ref-name
    // not just first line. Use a bundle containing both refs/heads/main and a tag.
    const srcDir = join(tempRoot, 'src-repo');
    await seedRepo(srcDir);
    const srcWs = makeWorkspace(srcDir);
    const engine = new NativeGitEngine();
    await engine.init(srcWs, { fs: undefined, identity: IDENTITY });
    await engine.tag(srcWs, 'v0.0.1');

    const bundlePath = join(tempRoot, 'snapshots', 'multi.bundle');
    // Bundle includes both main and the tag
    await mkdir(join(tempRoot, 'snapshots'), { recursive: true });
    await execFileAsync(
      'git',
      ['bundle', 'create', bundlePath, 'main', 'refs/tags/v0.0.1'],
      { cwd: srcDir },
    );
    const mainSha = (await gitExec(srcWs, ['rev-parse', 'main'])).stdout.trim();

    const dstDir = join(tempRoot, 'dst-repo');
    await mkdir(dstDir, { recursive: true });
    await execFileAsync('git', ['init', '--quiet'], { cwd: dstDir });
    await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: dstDir });
    const dstWs = makeWorkspace(dstDir);

    await engine.restoreBundle(dstWs, bundlePath, 'refs/heads/main');
    const restored = (await gitExec(dstWs, ['rev-parse', 'refs/heads/main'])).stdout.trim();
    expect(restored).toBe(mainSha);
  });
});

describe('v1.1.0 W1 slice (iii) — squash-semantic correctness', () => {
  it('Native squash-merge produces a single commit with a tree containing the feature changes', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();
    await engine.init(ws, { fs: undefined, identity: IDENTITY });

    await engine.branch(ws, 'feature');
    await engine.checkout(ws, 'feature');
    await writeFile(join(dir, 'parity.txt'), 'parity\n', 'utf8');
    await engine.stage(ws, 'all');
    await engine.commit(ws, { message: 'parity test commit' });

    const sha = await engine.squashCommit(ws, 'main', 'feature', 'parity squash msg');
    const { stdout: tree } = await gitExec(ws, ['rev-parse', `${sha}^{tree}`]);
    expect(tree.trim()).toMatch(/^[0-9a-f]{40}$/);

    // Verify the squashed-tree contains the feature changes (parity.txt blob present)
    const { stdout: lsTree } = await gitExec(ws, ['ls-tree', sha]);
    expect(lsTree).toContain('parity.txt');
  });
});
