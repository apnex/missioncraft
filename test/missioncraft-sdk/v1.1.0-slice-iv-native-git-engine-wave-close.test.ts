// v1.1.0 W1 slice (iv) WAVE-CLOSE — NativeGitEngine canonical build.
//
// Two coverage targets (§3 IsoEng-parity removed in W7-new alongside IsomorphicGitEngine deletion):
//
// §1 PROVIDER_REGISTRY 'native-git' entry — instantiateProvider('gitEngine', 'native-git')
//    returns a working NativeGitEngine instance; listProviderNames includes 'native-git';
//    closed-registry rejection still applies for unknown names.
//
// §2 Full-contract integration test suite — all 17 GitEngine contract methods exercised
//    end-to-end through PROVIDER_REGISTRY-instantiated NativeGitEngine, against an HTTP
//    fixture upstream. Validates wire-up + happy-path correctness.

import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  NativeGitEngine,
  instantiateProvider,
  listProviderNames,
  gitExec,
} from '@apnex/missioncraft';
import type { GitEngine } from '../../src/missioncraft-sdk/pluggables/git-engine.js';
import type { WorkspaceHandle } from '../../src/missioncraft-sdk/pluggables/storage.js';
import type { AgentIdentity } from '../../src/missioncraft-sdk/pluggables/identity.js';
import { ConfigValidationError } from '../../src/missioncraft-sdk/errors.js';
import { createGitHttpFixture, type GitHttpFixture } from '../fixtures/git-http-fixture.js';

const execFileAsync = promisify(execFile);

const IDENTITY: AgentIdentity = { name: 'Slice IV Test', email: 'slice-iv@native-engine.test' };

function makeWorkspace(path: string, missionId = 'm-test', repoUrl = 'test://local'): WorkspaceHandle {
  return { missionId, repoUrl, path };
}

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
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w1-iv-native-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════════════════════════
// §1 PROVIDER_REGISTRY entry — 'native-git' wire-up
// ════════════════════════════════════════════════════════════════════════════════════════

describe('v1.1.0 W1 slice (iv) §1 — PROVIDER_REGISTRY native-git entry', () => {
  it("instantiateProvider('gitEngine', 'native-git') returns a NativeGitEngine instance", () => {
    const engine = instantiateProvider('gitEngine', 'native-git');
    expect(engine).toBeInstanceOf(NativeGitEngine);
    expect((engine.constructor as typeof NativeGitEngine).providerName).toBe('native-git');
  });

  it("listProviderNames('gitEngine') returns ['native-git'] (sole canonical provider post-W7-new)", () => {
    const names = listProviderNames('gitEngine');
    expect(names).toContain('native-git');
    expect(names).not.toContain('isomorphic-git');
  });

  it("instantiateProvider rejects unknown gitEngine names with ConfigValidationError naming registered providers", () => {
    expect(() => instantiateProvider('gitEngine', 'unknown-engine')).toThrow(ConfigValidationError);
    try {
      instantiateProvider('gitEngine', 'unknown-engine');
    } catch (err) {
      expect((err as Error).message).toMatch(/native-git/);
    }
  });

  it('public exports include NativeGitEngine + gitExec helper from @apnex/missioncraft', () => {
    expect(NativeGitEngine).toBeDefined();
    expect(typeof gitExec).toBe('function');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
// §2 Full-contract integration test suite (PROVIDER_REGISTRY-instantiated; HTTP fixture)
// ════════════════════════════════════════════════════════════════════════════════════════

describe('v1.1.0 W1 slice (iv) §2 — full-contract integration via PROVIDER_REGISTRY', () => {
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

  it('full contract round-trip: clone → branch → checkout → stage → commit → push → tag → bundle → restore', async () => {
    // Instantiate via PROVIDER_REGISTRY (the W2-canonical-switch path)
    const engine: GitEngine = instantiateProvider('gitEngine', 'native-git');

    const targetDir = join(tempRoot, 'cloned');
    const ws = makeWorkspace(targetDir, 'm-fullcontract', cloneUrl);

    // Lifecycle
    await engine.clone(ws, cloneUrl, { fs: undefined, identity: IDENTITY });
    expect(existsSync(join(targetDir, '.git'))).toBe(true);

    // Refs
    await engine.branch(ws, 'feature/full-contract');
    await engine.checkout(ws, 'feature/full-contract');
    expect(await engine.getCurrentBranch(ws)).toBe('feature/full-contract');

    // Working tree + commit
    await writeFile(join(targetDir, 'fc-1.txt'), 'fc-1\n', 'utf8');
    await writeFile(join(targetDir, 'fc-2.txt'), 'fc-2\n', 'utf8');
    await engine.stage(ws, ['fc-1.txt', 'fc-2.txt']);
    const commit1Sha = await engine.commit(ws, {
      message: 'feature: full-contract integration test commit with multi-word message',
    });
    expect(commit1Sha).toMatch(/^[0-9a-f]{40}$/);

    // Read
    const status1 = await engine.status(ws);
    expect(status1.clean).toBe(true);
    expect(status1.branch).toBe('feature/full-contract');
    expect(status1.head).toBe(commit1Sha);
    const logEntries = await engine.log(ws, { maxCount: 3 });
    expect(logEntries.length).toBeGreaterThan(0);
    expect(logEntries[0].sha).toBe(commit1Sha);
    expect(logEntries[0].author.name).toBe(IDENTITY.name);

    // commitToRef bypass-INDEX (wip-snapshot semantic)
    await writeFile(join(targetDir, 'wip.txt'), 'wip\n', 'utf8');
    const wipSha = await engine.commitToRef(ws, 'refs/heads/wip-fc', { message: 'wip snapshot' });
    expect(wipSha).toMatch(/^[0-9a-f]{40}$/);
    const wipRef = await engine.revparse(ws, 'refs/heads/wip-fc');
    expect(wipRef).toBe(wipSha);
    // Operator's working tree still has wip.txt as untracked (commitToRef didn't move HEAD or stage)
    const status2 = await engine.status(ws);
    expect(status2.untracked).toContain('wip.txt');

    // Tag (annotated multi-word)
    await engine.tag(ws, 'v0.0.1-fc', { message: 'full-contract release tag' });

    // Wire — push the feature branch + tags
    await engine.push(ws, { branch: 'feature/full-contract' });
    await engine.push(ws, { tags: true });
    const { stdout: upstreamFeatureSha } = await execFileAsync(
      'git', ['rev-parse', 'feature/full-contract'], { cwd: bareDir },
    );
    expect(upstreamFeatureSha.trim()).toBe(commit1Sha);
    const { stdout: upstreamTags } = await execFileAsync('git', ['tag', '-l'], { cwd: bareDir });
    expect(upstreamTags).toContain('v0.0.1-fc');

    // Bundle round-trip (createBundle from this workspace; restoreBundle into a fresh dst)
    const bundlePath = join(tempRoot, 'snapshot.bundle');
    await engine.createBundle(ws, bundlePath, 'feature/full-contract');
    expect(existsSync(bundlePath)).toBe(true);

    const dstDir = join(tempRoot, 'restored');
    await mkdir(dstDir, { recursive: true });
    await execFileAsync('git', ['init', '--quiet'], { cwd: dstDir });
    await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: dstDir });
    const dstWs = makeWorkspace(dstDir);
    await engine.restoreBundle(dstWs, bundlePath, 'refs/heads/feature/full-contract');
    const restoredSha = await engine.revparse(dstWs, 'refs/heads/feature/full-contract');
    expect(restoredSha).toBe(commit1Sha);

    // squashCommit — squash feature into a fresh side-branch
    await engine.branch(ws, 'squash-target', { from: 'main' });
    await writeFile(join(targetDir, 'sq-extra.txt'), 'sq\n', 'utf8');
    await engine.stage(ws, 'all');
    await engine.commit(ws, { message: 'extra commit for squash test' });
    const squashSha = await engine.squashCommit(
      ws, 'squash-target', 'feature/full-contract',
      'squash: collapse feature into single squash-target commit',
    );
    expect(squashSha).toMatch(/^[0-9a-f]{40}$/);

    // Remote management
    await engine.addRemote(ws, 'mirror', 'https://example.com/mirror.git');
    const remotes = await engine.listRemotes(ws);
    expect(remotes.find((r) => r.name === 'mirror')?.url).toBe('https://example.com/mirror.git');
    await engine.removeRemote(ws, 'mirror');
    expect((await engine.listRemotes(ws)).find((r) => r.name === 'mirror')).toBeUndefined();

    // deleteBranch (force; squash-target is unmerged from main's perspective)
    await engine.checkout(ws, 'main');
    await engine.deleteBranch(ws, 'squash-target', { force: true });
  }, 60_000);

  it('fetch + pull round-trip via PROVIDER_REGISTRY-instantiated engine', async () => {
    const engine: GitEngine = instantiateProvider('gitEngine', 'native-git');

    // Construct each workspace handle ONCE and reuse — identity is stored against the object
    // identity in a WeakMap, so re-constructing produces a different key.
    const aWs = makeWorkspace(join(tempRoot, 'A'), 'm-A', cloneUrl);
    const bWs = makeWorkspace(join(tempRoot, 'B'), 'm-B', cloneUrl);
    await engine.clone(aWs, cloneUrl, { fs: undefined, identity: IDENTITY });
    await engine.clone(bWs, cloneUrl, { fs: undefined, identity: IDENTITY });

    await writeFile(join(aWs.path, 'shared.txt'), 'A wrote\n', 'utf8');
    await engine.stage(aWs, 'all');
    await engine.commit(aWs, { message: 'A commit for fetch+pull integration' });
    await engine.push(aWs, { branch: 'main' });

    await engine.fetch(bWs, { remote: 'origin' });
    await engine.pull(bWs, { remote: 'origin', branch: 'main' });

    expect(await readFile(join(bWs.path, 'shared.txt'), 'utf8')).toBe('A wrote\n');
  }, 60_000);
});

// §3 IsoEng vs NativeEng merge-parity DELETED in W7-new — IsomorphicGitEngine removed; NativeGitEngine
// is the sole canonical implementation. No second-engine to compare against.
