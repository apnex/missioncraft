import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  LocalFilesystemStorage,
  IsomorphicGitEngine,
  instantiateProvider,
  listProviderNames,
  ConfigValidationError,
  type WorkspaceHandle,
} from '@apnex/missioncraft';

let tempRoot: string;

beforeAll(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w2-test-'));
});

afterAll(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe('LocalFilesystemStorage — W2 smoke-tests', () => {
  it('exposes static providerName per v1.5 fold MEDIUM-R4.2', () => {
    expect(LocalFilesystemStorage.providerName).toBe('local-filesystem');
  });

  it('allocate + release roundtrip', async () => {
    const storage = new LocalFilesystemStorage({ workspaceRoot: tempRoot });
    const handle = await storage.allocate('msn-aaaaaaaa', 'https://github.com/example/repo.git');
    expect(handle.missionId).toBe('msn-aaaaaaaa');
    expect(handle.path).toContain('repo');
    await storage.release(handle);
  });

  it('acquireMissionLock + releaseLock; no contention', async () => {
    const storage = new LocalFilesystemStorage({ workspaceRoot: tempRoot });
    const lock = await storage.acquireMissionLock('msn-bbbbbbbb', { validityMs: 60_000 });
    expect(lock.missionId).toBe('msn-bbbbbbbb');
    expect(lock.expiresAt.getTime()).toBeGreaterThan(Date.now());
    await storage.releaseLock(lock);
  });

  it('acquireMissionLock contention throws LockTimeoutError when waitMs=0 + held by other', async () => {
    const storage = new LocalFilesystemStorage({ workspaceRoot: tempRoot });
    const first = await storage.acquireMissionLock('msn-cccccccc', { validityMs: 60_000 });
    await expect(
      storage.acquireMissionLock('msn-cccccccc', { waitMs: 0, validityMs: 60_000 }),
    ).rejects.toMatchObject({ name: 'LockTimeoutError' });
    await storage.releaseLock(first);
  });

  it('inspectLocks(missionId) returns held mission-lock', async () => {
    const storage = new LocalFilesystemStorage({ workspaceRoot: tempRoot });
    const lock = await storage.acquireMissionLock('msn-dddddddd', { validityMs: 60_000 });
    const inspected = await storage.inspectLocks({ missionId: 'msn-dddddddd' });
    expect(inspected.length).toBeGreaterThanOrEqual(1);
    expect(inspected.some((l) => l.id === lock.id)).toBe(true);
    await storage.releaseLock(lock);
  });
});

describe('IsomorphicGitEngine — W2 smoke-tests', () => {
  it('exposes static providerName per v1.5 fold MEDIUM-R4.2', () => {
    expect(IsomorphicGitEngine.providerName).toBe('isomorphic-git');
  });

  it('init + commit + log roundtrip via commitToRef bypass-INDEX (§AA)', async () => {
    const engine = new IsomorphicGitEngine();
    const repoDir = await mkdtemp(join(tmpdir(), 'mc-iso-test-'));
    try {
      const workspace: WorkspaceHandle = {
        missionId: 'msn-test',
        repoUrl: 'file://local',
        path: repoDir,
      };
      const identity = { name: 'CI Runner', email: 'ci@apnex.example' };
      await engine.init(workspace, { fs: undefined, identity });
      await writeFile(join(repoDir, 'hello.txt'), 'world');
      // commitToRef bypass-INDEX semantic (v0.3 §AA)
      const sha = await engine.commitToRef(workspace, 'refs/heads/wip/test', {
        message: 'initial wip',
        author: identity,
      });
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
      // Log against the wip ref
      const log = await engine.log(workspace, { ref: 'refs/heads/wip/test', maxCount: 1 });
      expect(log).toHaveLength(1);
      expect(log[0].sha).toBe(sha);
      expect(log[0].author.email).toBe('ci@apnex.example');
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });
});

describe('PROVIDER_REGISTRY — W2 smoke-tests', () => {
  it('listProviderNames returns canonical string-names per category', () => {
    expect(listProviderNames('identity')).toContain('local-git-config');
    expect(listProviderNames('approval')).toContain('trust-all');
    expect(listProviderNames('storage')).toContain('local-filesystem');
    expect(listProviderNames('gitEngine')).toContain('isomorphic-git');
    expect(listProviderNames('remote')).toEqual(expect.arrayContaining(['pure-git', 'gh-cli']));
  });

  it('instantiateProvider returns concrete instance for known string-name', () => {
    const identity = instantiateProvider('identity', 'local-git-config');
    expect(typeof identity.resolve).toBe('function');

    const approval = instantiateProvider('approval', 'trust-all');
    expect(typeof approval.decide).toBe('function');

    const storage = instantiateProvider('storage', 'local-filesystem', { workspaceRoot: tempRoot });
    expect(typeof storage.allocate).toBe('function');
  });

  it('instantiateProvider throws ConfigValidationError for unknown string-name', () => {
    expect(() => instantiateProvider('identity', 'nonexistent')).toThrow(ConfigValidationError);
  });

  it('instantiateProvider throws ConfigValidationError for unknown category-string-name pair', () => {
    expect(() => instantiateProvider('approval', 'gh-cli')).toThrow(ConfigValidationError);
  });
});
