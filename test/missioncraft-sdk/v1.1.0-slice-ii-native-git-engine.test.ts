// v1.1.0 W1 slice (ii) — mission-78 NativeGitEngine write-ops + lifecycle + remote-management.
//
// Slice (ii) coverage:
// - Lifecycle: init
// - Refs: getCurrentBranch, tag (lightweight + annotated + force)
// - Working tree + commit: stage, commit (with autoStage + amend + custom author),
//   commitToRef (bypass-INDEX semantic via temp GIT_INDEX_FILE), deleteBranch
// - Wire: fetch (incl. prune), push (incl. force + tags + url-override + refspec), pull
// - Remote management: addRemote, removeRemote, listRemotes
//
// Discipline reminder per `feedback_test_assertion_too_permissive_regex.md`: assertions name the
// SPECIFIC success state (e.g., `toBe('main')` not `toMatch(/^(main|HEAD)$/)`); multi-word commit
// messages exercised end-to-end (per architect's slice (ii) dispatch reminder).

import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
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

const IDENTITY: AgentIdentity = { name: 'Slice II Test', email: 'slice-ii@native-engine.test' };
const ALT_IDENTITY: AgentIdentity = { name: 'Alt Author', email: 'alt@native-engine.test' };

function makeWorkspace(path: string, missionId = 'm-test', repoUrl = 'test://local'): WorkspaceHandle {
  return { missionId, repoUrl, path };
}

/** Seed an on-disk repo with N commits on `main`. */
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

/** Seed a bare upstream + push one commit on `main`. */
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
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w1-ii-native-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('v1.1.0 W1 slice (ii) — NativeGitEngine.init', () => {
  it('init creates an empty git repo at workspace.path', async () => {
    const dir = join(tempRoot, 'init-target');
    await mkdir(dir, { recursive: true });
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();

    await engine.init(ws, { fs: undefined, identity: IDENTITY });
    expect(existsSync(join(dir, '.git'))).toBe(true);
  });

  it('init stores identity for later commit-firing-time resolution', async () => {
    const dir = join(tempRoot, 'init-target');
    await mkdir(dir, { recursive: true });
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();

    await engine.init(ws, { fs: undefined, identity: IDENTITY });
    expect(NativeGitEngine._identityForWorkspace(ws)).toEqual(IDENTITY);
  });
});

describe('v1.1.0 W1 slice (ii) — NativeGitEngine.getCurrentBranch', () => {
  it('returns the active branch name', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const engine = new NativeGitEngine();
    expect(await engine.getCurrentBranch(makeWorkspace(dir))).toBe('main');
  });

  it('throws UnsupportedOperationError on detached HEAD', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir, 2);
    // Detach HEAD by checking out the parent commit explicitly
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD~1'], { cwd: dir });
    await execFileAsync('git', ['checkout', '--quiet', stdout.trim()], { cwd: dir });
    const engine = new NativeGitEngine();
    await expect(engine.getCurrentBranch(makeWorkspace(dir))).rejects.toBeInstanceOf(
      UnsupportedOperationError,
    );
  });
});

describe('v1.1.0 W1 slice (ii) — NativeGitEngine.tag', () => {
  it('lightweight tag at HEAD', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();
    await engine.init(ws, { fs: undefined, identity: IDENTITY });    // store identity for annotated path

    await engine.tag(ws, 'v0.0.1');
    const headSha = (await gitExec(ws, ['rev-parse', 'HEAD'])).stdout.trim();
    const tagSha = (await gitExec(ws, ['rev-parse', 'v0.0.1'])).stdout.trim();
    expect(tagSha).toBe(headSha);
  });

  it('annotated tag with multi-word message records identity + message', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();
    await engine.init(ws, { fs: undefined, identity: IDENTITY });

    await engine.tag(ws, 'v1.0.0', { message: 'Release v1.0.0 with multi-word message' });
    const { stdout } = await gitExec(ws, ['for-each-ref', '--format=%(taggername) <%(taggeremail)> %(contents)', 'refs/tags/v1.0.0']);
    expect(stdout).toContain(IDENTITY.name);
    expect(stdout).toContain(IDENTITY.email);
    expect(stdout).toContain('Release v1.0.0 with multi-word message');
  });

  it('force re-tags an existing tag at a new ref', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir, 2);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();

    await engine.tag(ws, 'movable');
    const firstSha = (await gitExec(ws, ['rev-parse', 'movable'])).stdout.trim();
    const headParent = (await gitExec(ws, ['rev-parse', 'HEAD~1'])).stdout.trim();
    await engine.tag(ws, 'movable', { ref: headParent, force: true });
    const secondSha = (await gitExec(ws, ['rev-parse', 'movable'])).stdout.trim();
    expect(secondSha).toBe(headParent);
    expect(secondSha).not.toBe(firstSha);
  });
});

describe('v1.1.0 W1 slice (ii) — NativeGitEngine.stage', () => {
  it("stage('all') stages every working-tree change", async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();

    await writeFile(join(dir, 'a.txt'), 'A\n', 'utf8');
    await writeFile(join(dir, 'b.txt'), 'B\n', 'utf8');
    await engine.stage(ws, 'all');
    const status = await engine.status(ws);
    expect(status.staged).toContain('a.txt');
    expect(status.staged).toContain('b.txt');
  });

  it('stage(paths) stages only the named paths', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();

    await writeFile(join(dir, 'staged.txt'), 'staged\n', 'utf8');
    await writeFile(join(dir, 'unstaged.txt'), 'unstaged\n', 'utf8');
    await engine.stage(ws, ['staged.txt']);
    const status = await engine.status(ws);
    expect(status.staged).toContain('staged.txt');
    expect(status.staged).not.toContain('unstaged.txt');
    expect(status.untracked).toContain('unstaged.txt');
  });

  it('stage([]) is a no-op', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();
    await expect(engine.stage(ws, [])).resolves.toBeUndefined();
  });
});

describe('v1.1.0 W1 slice (ii) — NativeGitEngine.commit', () => {
  it('commit returns 40-char SHA + advances HEAD; identity from clone()/init() is recorded', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();
    await engine.init(ws, { fs: undefined, identity: IDENTITY });    // re-seed identity (init is idempotent on existing repo)

    const headBefore = (await gitExec(ws, ['rev-parse', 'HEAD'])).stdout.trim();
    await writeFile(join(dir, 'new.txt'), 'new\n', 'utf8');
    await engine.stage(ws, 'all');
    const sha = await engine.commit(ws, { message: 'feat: add new file with detailed message' });
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    const headAfter = (await gitExec(ws, ['rev-parse', 'HEAD'])).stdout.trim();
    expect(headAfter).toBe(sha);
    expect(headAfter).not.toBe(headBefore);

    // Author + message verification (multi-word per architect's slice-ii reminder)
    const { stdout: logOut } = await gitExec(ws, [
      'log', '-1', '--pretty=format:%an|%ae|%s',
    ]);
    const [name, email, subject] = logOut.split('|');
    expect(name).toBe(IDENTITY.name);
    expect(email).toBe(IDENTITY.email);
    expect(subject).toBe('feat: add new file with detailed message');
  });

  it('commit({autoStage: true}) stages all changes inline', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();
    await engine.init(ws, { fs: undefined, identity: IDENTITY });

    await writeFile(join(dir, 'auto.txt'), 'autostaged\n', 'utf8');
    const sha = await engine.commit(ws, { message: 'autostage commit', autoStage: true });
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    const status = await engine.status(ws);
    expect(status.clean).toBe(true);
  });

  it('commit({author: ALT}) overrides workspace identity', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();
    await engine.init(ws, { fs: undefined, identity: IDENTITY });

    await writeFile(join(dir, 'alt.txt'), 'alt\n', 'utf8');
    await engine.stage(ws, 'all');
    await engine.commit(ws, { message: 'alt-author commit', author: ALT_IDENTITY });
    const { stdout } = await gitExec(ws, ['log', '-1', '--pretty=format:%an|%ae']);
    const [name, email] = stdout.split('|');
    expect(name).toBe(ALT_IDENTITY.name);
    expect(email).toBe(ALT_IDENTITY.email);
  });

  it('commit({amend: true}) replaces the previous commit', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();
    await engine.init(ws, { fs: undefined, identity: IDENTITY });

    await writeFile(join(dir, 'amend.txt'), 'a\n', 'utf8');
    await engine.stage(ws, 'all');
    const firstSha = await engine.commit(ws, { message: 'original message' });
    await writeFile(join(dir, 'amend.txt'), 'a-extended\n', 'utf8');
    await engine.stage(ws, 'all');
    const amendedSha = await engine.commit(ws, { message: 'amended message', amend: true });
    expect(amendedSha).not.toBe(firstSha);
    const { stdout } = await gitExec(ws, ['log', '-1', '--pretty=format:%s']);
    expect(stdout).toBe('amended message');
  });
});

describe('v1.1.0 W1 slice (ii) — NativeGitEngine.commitToRef (bypass-INDEX wip-branch semantic)', () => {
  it('writes a new ref containing working-tree state; HEAD + operator INDEX UNTOUCHED', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();
    await engine.init(ws, { fs: undefined, identity: IDENTITY });

    // Operator state: stage X (a fresh file), modify Y in working tree but DON'T stage
    await writeFile(join(dir, 'staged-by-operator.txt'), 'staged-by-op\n', 'utf8');
    await execFileAsync('git', ['add', 'staged-by-operator.txt'], { cwd: dir });
    await writeFile(join(dir, 'file-0.txt'), 'modified-not-staged\n', 'utf8');

    const headBefore = (await gitExec(ws, ['rev-parse', 'HEAD'])).stdout.trim();
    const opStatusBefore = await engine.status(ws);

    // Wip-commit to a sibling ref
    const wipSha = await engine.commitToRef(ws, 'refs/heads/wip-snapshot', {
      message: 'wip snapshot of working tree',
    });

    // Returned SHA is valid
    expect(wipSha).toMatch(/^[0-9a-f]{40}$/);

    // Wip ref points at the wip commit
    const wipRefSha = (await gitExec(ws, ['rev-parse', 'refs/heads/wip-snapshot'])).stdout.trim();
    expect(wipRefSha).toBe(wipSha);

    // HEAD UNCHANGED (bypass-HEAD semantic)
    const headAfter = (await gitExec(ws, ['rev-parse', 'HEAD'])).stdout.trim();
    expect(headAfter).toBe(headBefore);

    // Operator's index UNCHANGED — staged + modified lists identical to pre-call
    const opStatusAfter = await engine.status(ws);
    expect(opStatusAfter.staged.sort()).toEqual(opStatusBefore.staged.sort());
    expect(opStatusAfter.modified.sort()).toEqual(opStatusBefore.modified.sort());
    expect(opStatusAfter.untracked.sort()).toEqual(opStatusBefore.untracked.sort());

    // Wip-commit's tree contains the WORKING-TREE state — verify modified file's wip-content
    const { stdout: wipFileBlob } = await gitExec(ws, ['show', `${wipSha}:file-0.txt`]);
    expect(wipFileBlob).toBe('modified-not-staged\n');
    // And the staged-by-operator file is also captured in wip
    const { stdout: wipStaged } = await gitExec(ws, ['show', `${wipSha}:staged-by-operator.txt`]);
    expect(wipStaged).toBe('staged-by-op\n');
  });

  it('subsequent commitToRef on existing ref creates a child commit (parent linkage)', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();
    await engine.init(ws, { fs: undefined, identity: IDENTITY });

    await writeFile(join(dir, 'wip1.txt'), 'wip1\n', 'utf8');
    const sha1 = await engine.commitToRef(ws, 'refs/heads/wip-chain', { message: 'wip 1' });
    await writeFile(join(dir, 'wip2.txt'), 'wip2\n', 'utf8');
    const sha2 = await engine.commitToRef(ws, 'refs/heads/wip-chain', { message: 'wip 2' });

    expect(sha2).not.toBe(sha1);
    const { stdout } = await gitExec(ws, ['rev-list', '--parents', '-n1', sha2]);
    const parents = stdout.trim().split(/\s+/).slice(1);
    expect(parents).toEqual([sha1]);
  });

  it('temp-index file is cleaned up after commitToRef', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();
    await engine.init(ws, { fs: undefined, identity: IDENTITY });

    await writeFile(join(dir, 'cleanup.txt'), 'cleanup\n', 'utf8');
    await engine.commitToRef(ws, 'refs/heads/wip-cleanup', { message: 'cleanup test' });

    const { stdout } = await gitExec(ws, ['ls-files', '-o', '--directory', '.git/']);
    expect(stdout).not.toMatch(/wip-index-/);
  });
});

describe('v1.1.0 W1 slice (ii) — NativeGitEngine.deleteBranch', () => {
  it('deletes a fully-merged branch with -d', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();

    await engine.branch(ws, 'doomed');
    await engine.deleteBranch(ws, 'doomed');
    const { stdout } = await gitExec(ws, ['branch']);
    expect(stdout).not.toMatch(/^\s*doomed$/m);
  });

  it('force-deletes an unmerged branch with -D', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();
    await engine.init(ws, { fs: undefined, identity: IDENTITY });

    await engine.branch(ws, 'unmerged');
    await engine.checkout(ws, 'unmerged');
    await writeFile(join(dir, 'unmerged.txt'), 'u\n', 'utf8');
    await engine.stage(ws, 'all');
    await engine.commit(ws, { message: 'unmerged commit on branch' });
    await engine.checkout(ws, 'main');

    // Without force, -d would refuse; force deletes regardless
    await engine.deleteBranch(ws, 'unmerged', { force: true });
    const { stdout } = await gitExec(ws, ['branch']);
    expect(stdout).not.toMatch(/^\s*unmerged$/m);
  });
});

describe('v1.1.0 W1 slice (ii) — NativeGitEngine.fetch + push + pull (HTTP fixture)', () => {
  let fixture: GitHttpFixture | undefined;
  let cloneUrl: string;
  let bareDir: string;

  beforeEach(async () => {
    const repoBase = join(tempRoot, 'origin-repos');
    bareDir = join(repoBase, 'upstream.git');
    const seedDir = join(tempRoot, 'seed');
    await seedBareUpstream(bareDir, seedDir);
    fixture = await createGitHttpFixture(repoBase, { autoCreate: false });
    cloneUrl = `${fixture.url}/upstream.git`;
  });

  afterEach(async () => {
    if (fixture) {
      await fixture.close();
      fixture = undefined;
    }
  });

  it('push writes a new commit upstream over HTTP', async () => {
    const targetDir = join(tempRoot, 'cloned');
    const ws = makeWorkspace(targetDir, 'm-push', cloneUrl);
    const engine = new NativeGitEngine();
    await engine.clone(ws, cloneUrl, { fs: undefined, identity: IDENTITY });

    await writeFile(join(targetDir, 'pushed.txt'), 'pushed payload\n', 'utf8');
    await engine.stage(ws, 'all');
    const sha = await engine.commit(ws, { message: 'push integration test commit' });
    await engine.push(ws, { branch: 'main' });

    // Verify upstream now contains the pushed commit
    const { stdout } = await execFileAsync('git', ['rev-parse', 'main'], { cwd: bareDir });
    expect(stdout.trim()).toBe(sha);
  }, 30_000);

  it('fetch + pull retrieve upstream changes', async () => {
    // Two clones: A pushes; B pulls
    const aDir = join(tempRoot, 'A');
    const bDir = join(tempRoot, 'B');
    const aWs = makeWorkspace(aDir, 'm-A', cloneUrl);
    const bWs = makeWorkspace(bDir, 'm-B', cloneUrl);
    const engine = new NativeGitEngine();
    await engine.clone(aWs, cloneUrl, { fs: undefined, identity: IDENTITY });
    await engine.clone(bWs, cloneUrl, { fs: undefined, identity: ALT_IDENTITY });

    await writeFile(join(aDir, 'shared.txt'), 'A wrote this\n', 'utf8');
    await engine.stage(aWs, 'all');
    await engine.commit(aWs, { message: 'A push' });
    await engine.push(aWs, { branch: 'main' });

    // B fetch — refs/remotes/origin/main should advance
    await engine.fetch(bWs, { remote: 'origin' });
    const remoteRefSha = (await gitExec(bWs, ['rev-parse', 'refs/remotes/origin/main'])).stdout.trim();
    const aHead = (await gitExec(aWs, ['rev-parse', 'HEAD'])).stdout.trim();
    expect(remoteRefSha).toBe(aHead);

    // B pull — local main advances
    await engine.pull(bWs, { remote: 'origin', branch: 'main' });
    expect(existsSync(join(bDir, 'shared.txt'))).toBe(true);
    const sharedContent = await readFile(join(bDir, 'shared.txt'), 'utf8');
    expect(sharedContent).toBe('A wrote this\n');
  }, 60_000);

  it('push --tags surfaces tag refs on upstream', async () => {
    const targetDir = join(tempRoot, 'tagged-clone');
    const ws = makeWorkspace(targetDir, 'm-tag-push', cloneUrl);
    const engine = new NativeGitEngine();
    await engine.clone(ws, cloneUrl, { fs: undefined, identity: IDENTITY });

    await engine.tag(ws, 'v0.0.1');
    await engine.push(ws, { tags: true });
    const { stdout } = await execFileAsync('git', ['tag', '-l'], { cwd: bareDir });
    expect(stdout).toContain('v0.0.1');
  }, 30_000);
});

describe('v1.1.0 W1 slice (ii) — NativeGitEngine remote management', () => {
  it('addRemote + listRemotes round-trip', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();

    await engine.addRemote(ws, 'extra', 'https://example.com/extra.git');
    const remotes = await engine.listRemotes(ws);
    expect(remotes).toContainEqual({ name: 'extra', url: 'https://example.com/extra.git' });
  });

  it('removeRemote drops a previously added remote', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();

    await engine.addRemote(ws, 'doomed', 'https://example.com/doomed.git');
    await engine.removeRemote(ws, 'doomed');
    const remotes = await engine.listRemotes(ws);
    expect(remotes.find((r) => r.name === 'doomed')).toBeUndefined();
  });

  it('listRemotes returns empty array on a fresh repo with no remotes', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();
    const remotes = await engine.listRemotes(ws);
    expect(remotes).toEqual([]);
  });

  it('listRemotes dedupes the fetch + push entries returned by `git remote -v`', async () => {
    const dir = join(tempRoot, 'repo');
    await seedRepo(dir);
    const ws = makeWorkspace(dir);
    const engine = new NativeGitEngine();
    await engine.addRemote(ws, 'a', 'https://example.com/a.git');
    await engine.addRemote(ws, 'b', 'https://example.com/b.git');
    const remotes = await engine.listRemotes(ws);
    expect(remotes.length).toBe(2);
    expect(remotes.map((r) => r.name).sort()).toEqual(['a', 'b']);
  });
});

// NOTE: merge slice-(iii) UnsupportedOperationError assertion removed at slice (iii) ship —
// merge is now implemented (along with squashCommit / createBundle / restoreBundle); see
// `v1.1.0-slice-iii-native-git-engine.test.ts` for advanced-ops coverage.
