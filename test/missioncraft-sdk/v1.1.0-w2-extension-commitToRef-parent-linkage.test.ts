// v1.1.0 W2-extension Fix #3 — mission-78 commitToRef parent-linkage anchored to HEAD.
//
// Architect-side scenario-02 dogfood (thread-543) surfaced a SHARED-engine substrate-defect:
// `commitToRef` produced ORPHAN wip-commits when the target ref didn't exist on first invocation.
// Subsequent `git merge --squash` against the wip-branch failed with "refusing to merge unrelated
// histories" — so `msn complete` couldn't ship the PR.
//
// Defect was SYMMETRIC in both NativeGitEngine + IsomorphicGitEngine commitToRef (both engines
// fell through to "no parents" on initial-ref-miss). Fix #3 anchors the wip-branch to HEAD
// (mission/<id>) so the resulting commit chain is FF-equivalent to base-branch.
//
// Coverage:
//   §1 NativeGitEngine.commitToRef — parent linkage to HEAD on initial wip-ref creation
//   §2 IsomorphicGitEngine.commitToRef — same behavior (parity verification)
//   §3 End-to-end through squashCommit — wip-branch built via commitToRef can be squash-merged
//      back to base-branch (the bug-reproduction path; load-bearing for `msn complete` flow)
//   §4 Truly-empty-repo edge case — no HEAD; orphan-root acceptable (post-init pre-first-commit)

import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NativeGitEngine, IsomorphicGitEngine } from '@apnex/missioncraft';
import type { GitEngine } from '../../src/missioncraft-sdk/pluggables/git-engine.js';
import type { WorkspaceHandle } from '../../src/missioncraft-sdk/pluggables/storage.js';
import type { AgentIdentity } from '../../src/missioncraft-sdk/pluggables/identity.js';

const execFileAsync = promisify(execFile);

const IDENTITY: AgentIdentity = { name: 'W2-Extension Test', email: 'w2-ext@native-engine.test' };

function makeWorkspace(path: string, missionId = 'm-test', repoUrl = 'test://local'): WorkspaceHandle {
  return { missionId, repoUrl, path };
}

/** Seed a real repo with N commits on `main`, with git config user.name/email set so identity-fallback works. */
async function seedRepo(dir: string, commitCount = 1): Promise<void> {
  await mkdir(dir, { recursive: true });
  await execFileAsync('git', ['init', '--quiet'], { cwd: dir });
  await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', IDENTITY.email], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', IDENTITY.name], { cwd: dir });
  for (let i = 0; i < commitCount; i++) {
    await writeFile(join(dir, `base-${i}.txt`), `base ${i}\n`, 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: dir });
    await execFileAsync('git', ['commit', '--quiet', '-m', `base commit ${i}`], { cwd: dir });
  }
}

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w2-ext-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════════════════════════
// §1 NativeGitEngine.commitToRef — parent-linkage to HEAD
// ════════════════════════════════════════════════════════════════════════════════════════

describe('v1.1.0 W2-ext §1 — NativeGitEngine.commitToRef parent-linkage to HEAD', () => {
  it('first commitToRef on non-existent ref produces commit whose parent IS the current HEAD', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir, 2);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();
    await engine.init(ws, { fs: undefined, identity: IDENTITY });

    const headBefore = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();

    await writeFile(join(dir, 'wip-content.txt'), 'wip\n', 'utf8');
    const wipSha = await engine.commitToRef(ws, 'refs/heads/wip/m-test', { message: 'initial wip-snapshot' });

    expect(wipSha).toMatch(/^[0-9a-f]{40}$/);
    // Parent linkage: rev-list --parents -n1 <sha> emits "<sha> <parent1> <parent2> ..."
    const { stdout: parentList } = await execFileAsync('git', ['rev-list', '--parents', '-n1', wipSha], { cwd: dir });
    const parents = parentList.trim().split(/\s+/).slice(1);
    expect(parents).toEqual([headBefore]);
  });

  it('subsequent commitToRef on existing ref still chains to ref-tip (regression net for primary path)', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();
    await engine.init(ws, { fs: undefined, identity: IDENTITY });

    await writeFile(join(dir, 'wip1.txt'), 'wip1\n', 'utf8');
    const sha1 = await engine.commitToRef(ws, 'refs/heads/wip/m-test', { message: 'wip 1' });
    await writeFile(join(dir, 'wip2.txt'), 'wip2\n', 'utf8');
    const sha2 = await engine.commitToRef(ws, 'refs/heads/wip/m-test', { message: 'wip 2' });

    const { stdout: parentList } = await execFileAsync('git', ['rev-list', '--parents', '-n1', sha2], { cwd: dir });
    const parents = parentList.trim().split(/\s+/).slice(1);
    expect(parents).toEqual([sha1]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
// §2 IsomorphicGitEngine.commitToRef — parent-linkage parity
// ════════════════════════════════════════════════════════════════════════════════════════

describe('v1.1.0 W2-ext §2 — IsomorphicGitEngine.commitToRef parent-linkage parity', () => {
  it('first commitToRef on non-existent ref produces commit whose parent IS the current HEAD (IsoEng parity)', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir, 2);
    const ws = makeWorkspace(dir);
    const engine = new IsomorphicGitEngine();
    await engine.init(ws, { fs: undefined, identity: IDENTITY });

    const headBefore = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();

    await writeFile(join(dir, 'wip-content.txt'), 'wip\n', 'utf8');
    const wipSha = await engine.commitToRef(ws, 'refs/heads/wip/m-test', { message: 'initial wip-snapshot' });

    expect(wipSha).toMatch(/^[0-9a-f]{40}$/);
    const { stdout: parentList } = await execFileAsync('git', ['rev-list', '--parents', '-n1', wipSha], { cwd: dir });
    const parents = parentList.trim().split(/\s+/).slice(1);
    expect(parents).toEqual([headBefore]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
// §3 End-to-end via squashCommit — daemon-style commitToRef chain on mission-branch can be
//    squash-published into a single commit on mission-branch (W3-new single-branch semantic;
//    Fix #4 bypass-INDEX + Fix #8 update-ref headRef target both load-bearing)
// ════════════════════════════════════════════════════════════════════════════════════════

describe('v1.1.0 W2-ext §3 — squashCommit against commitToRef-built mission-branch succeeds (W3-new single-branch + Fix #4 + Fix #8 combined)', () => {
  for (const [engineName, engineFactory] of [
    ['NativeGitEngine', () => new NativeGitEngine()],
    ['IsomorphicGitEngine', () => new IsomorphicGitEngine()],
  ] as const) {
    it(`${engineName}: daemon commitToRef-chain on mission-branch + squashCommit publishes single commit on mission-branch with UNTRACKED FILES IN WORKING TREE (architecturally correct under v5.0 single-branch)`, async () => {
      const dir = join(tempRoot, `repo-${engineName}`);
      await seedRepo(dir);
      const ws = makeWorkspace(dir);
      const engine: GitEngine = engineFactory();
      await engine.init(ws, { fs: undefined, identity: IDENTITY });

      // v5.0 single-branch flow: branch off main → checkout mission/<id> → daemon commits to
      // mission/<id> directly via commitToRef (no wip/<id> sidecar per W3-new)
      await engine.branch(ws, 'mission/m-test');
      await engine.checkout(ws, 'mission/m-test');

      const mainTipBefore = (await execFileAsync('git', ['rev-parse', 'main'], { cwd: dir })).stdout.trim();

      // First daemon-commit on mission-branch — Fix #3 anchors to HEAD (no orphan-root)
      await writeFile(join(dir, 'work-1.txt'), 'work 1\n', 'utf8');
      await engine.commitToRef(ws, 'refs/heads/mission/m-test', { message: '[auto] daemon-commit 1' });
      // Subsequent daemon-commit chains through (parent = previous daemon-commit on mission-branch)
      await writeFile(join(dir, 'work-2.txt'), 'work 2\n', 'utf8');
      await engine.commitToRef(ws, 'refs/heads/mission/m-test', { message: '[auto] daemon-commit 2' });

      // CRITICAL: leave untracked work-*.txt files in working tree — this is the EXACT dogfood
      // failure-mode that exposed Fix #4. Pre-Fix-#4 squashCommit's `git merge --squash` would
      // abort with "untracked files would be overwritten by merge". Bypass-INDEX impl (Fix #4)
      // never touches the working tree, so the squash succeeds regardless of working-tree state.

      // Squash mission-branch's daemon-chain into a single commit on mission-branch.
      // baseRef='main' is the eventual PR target (parent of squashed commit);
      // headRef='mission/m-test' is the publish artifact (update-ref target per Fix #8).
      const squashedSha = await engine.squashCommit(
        ws,
        'main',
        'refs/heads/mission/m-test',
        `${engineName}: v5.0 single-branch squash-publish — collapse daemon-chain into 1 commit on mission-branch`,
      );
      expect(squashedSha).toMatch(/^[0-9a-f]{40}$/);

      // Squashed-commit's tree contains both work-* files
      const { stdout: lsTree } = await execFileAsync('git', ['ls-tree', '-r', '--name-only', squashedSha], { cwd: dir });
      expect(lsTree).toContain('work-1.txt');
      expect(lsTree).toContain('work-2.txt');

      // W3-new extension Fix #8: HEADREF (mission-branch) ref now points at squashed commit
      const { stdout: missionTip } = await execFileAsync('git', ['rev-parse', 'mission/m-test'], { cwd: dir });
      expect(missionTip.trim()).toBe(squashedSha);

      // baseRef (main) UNCHANGED post-squash (Fix #8 correction: base is parent-source, not target)
      const mainTipAfter = (await execFileAsync('git', ['rev-parse', 'main'], { cwd: dir })).stdout.trim();
      expect(mainTipAfter).toBe(mainTipBefore);

      // Squashed commit has single parent === pre-squash main tip (squash is FF-style atop main)
      const { stdout: parentList } = await execFileAsync('git', ['rev-list', '--parents', '-n1', squashedSha], { cwd: dir });
      const parents = parentList.trim().split(/\s+/).slice(1);
      expect(parents).toEqual([mainTipBefore]);

      // Working tree state UNTOUCHED — work-*.txt files still present as untracked
      // (proves Fix #4 bypass-INDEX semantic: operator's working-tree state never affects squash)
      expect(existsSync(join(dir, 'work-1.txt'))).toBe(true);
      expect(existsSync(join(dir, 'work-2.txt'))).toBe(true);
    }, 30_000);
  }
});

// ════════════════════════════════════════════════════════════════════════════════════════
// §4 Truly-empty-repo edge case — no HEAD yet; orphan-root commit is acceptable
// ════════════════════════════════════════════════════════════════════════════════════════

describe('v1.1.0 W2-ext §4 — truly-empty-repo (no HEAD): commitToRef produces orphan-root', () => {
  it('NativeGitEngine.commitToRef on init-only repo (no HEAD) produces a parent-less commit', async () => {
    const dir = join(tempRoot, 'empty-repo');
    await mkdir(dir, { recursive: true });
    await execFileAsync('git', ['init', '--quiet'], { cwd: dir });
    await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.email', IDENTITY.email], { cwd: dir });
    await execFileAsync('git', ['config', 'user.name', IDENTITY.name], { cwd: dir });
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();
    await engine.init(ws, { fs: undefined, identity: IDENTITY });

    await writeFile(join(dir, 'first.txt'), 'first\n', 'utf8');
    const sha = await engine.commitToRef(ws, 'refs/heads/wip/empty', { message: 'first commit on empty repo' });
    expect(sha).toMatch(/^[0-9a-f]{40}$/);

    // Truly-empty case: orphan-root is correct (parent count = 0)
    const { stdout: parentList } = await execFileAsync('git', ['rev-list', '--parents', '-n1', sha], { cwd: dir });
    const parents = parentList.trim().split(/\s+/).slice(1);
    expect(parents).toEqual([]);
  });
});
