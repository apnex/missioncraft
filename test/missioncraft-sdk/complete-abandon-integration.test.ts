// W4.3 slice (iv) — real-engine integration tests for complete() + abandon() flows.
//
// All tests use REAL LocalFilesystemStorage + REAL NativeGitEngine defaults (no mocks). The
// complete-flow tests use file:// URLs pointing at non-existent bare repos; push fails on those,
// and we verify partial-failure publishStatus persistence. Real-engine clone via HTTP-fixture is
// exercised by w6-real-engine-start.test.ts.

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Missioncraft } from '@apnex/missioncraft';

const execFileAsync = promisify(execFile);

// mission-81 slice (v.a): every test in this file is a REAL-engine integration test (git
// init/commit/squash + storage allocate/cleanup) — genuine I/O that normally runs in <5s but
// can exceed vitest's 5s default on a loaded CI runner. The `publishMessage immutability` test
// (2× real `mc.complete`) flaked with a 5s timeout on the macos-node-24 runner. Per the
// enumerate-the-set discipline, lift the timeout for the WHOLE file rather than the one test
// that lost the dice roll — they are all the same risk class.
vi.setConfig({ testTimeout: 30_000 });

let tempRoot: string;
let bareRepoPath: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w4.3-iv-'));
  bareRepoPath = join(tempRoot, 'bare-repo.git');
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

/**
 * Helper: manually advance mission lifecycle by direct YAML edit (substrate-bypass for slice iv).
 * Justified: start() requires HTTP-clone which substrate doesn't support over file://; this helper
 * seeds the post-start state so we can exercise complete()/abandon() wire-flow paths end-to-end.
 */
async function advanceLifecycle(workspaceRoot: string, missionId: string, lifecycleState: string): Promise<void> {
  const path = join(workspaceRoot, 'config', 'missions', `${missionId}.yaml`);
  const content = await readFile(path, 'utf8');
  const updated = content.replace(/lifecycle-state: [\w-]+/, `lifecycle-state: ${lifecycleState}`);
  await writeFile(path, updated, 'utf8');
}

/**
 * Helper: seed the mission-lockfile to mimic start()'s post-Step-6 state (v1.0.2 slice i.5
 * substrate-discipline). complete()/abandon() now INHERIT the lockfile from start() rather than
 * acquire-fresh — substrate-bypass tests must also seed the lockfile or the inherit-check throws.
 */
async function seedMissionLockfile(workspaceRoot: string, missionId: string): Promise<void> {
  const lockfileDir = join(workspaceRoot, 'locks', 'missions');
  await mkdir(lockfileDir, { recursive: true });
  const lockfilePath = join(lockfileDir, `${missionId}.lock`);
  const now = new Date();
  const expires = new Date(now.getTime() + 86_400_000);  // 24h TTL per DEFAULT_VALIDITY_MS
  const contents = {
    id: `seed-${missionId}`,
    missionId,
    acquiredAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    // No daemon-IPC fields — daemon never spawned (substrate-bypass). complete/abandon's
    // terminateDaemon will no-op when pid absent; this is the expected substrate-bypass behavior.
  };
  await writeFile(lockfilePath, JSON.stringify(contents, null, 2), 'utf8');
}

/**
 * Helper: pre-allocate workspace + initialize git repo for a mission's repo (substrate-bypass for clone).
 * Mirrors what start() Step 3-4 would do via storage.allocate + gitEngine.clone.
 */
async function preAllocateWorkspace(
  mc: Missioncraft,
  missionId: string,
  repoUrl: string,
  withCommit = true,
): Promise<string> {
  const handle = await mc.storage.allocate(missionId, repoUrl);
  await mc.gitEngine.init(handle, {
    fs: undefined,
    identity: { name: 'Test User', email: 't@x.com' },
  });
  if (withCommit) {
    await writeFile(join(handle.path, 'README.md'), 'initial', 'utf8');
    await mc.gitEngine.commitToRef(handle, 'refs/heads/main', {
      message: 'initial',
      author: { name: 'Test User', email: 't@x.com' },
    });
    // v1.0.7 bug-73 fix companion: pre-allocate the mission branch (matches real start() flow).
    // abandon Step 5 + complete Step 6 call deleteBranch on `mission/<id>`; pre-fix the URL-empty
    // find-handle silently no-op'd; post-fix the find succeeds and deleteBranch actually fires.
    await mc.gitEngine.commitToRef(handle, `refs/heads/mission/${missionId}`, {
      message: 'mission-branch seed',
      author: { name: 'Test User', email: 't@x.com' },
    });
  }
  return handle.path;
}

describe('W4.3 slice (iv) — abandon() real-engine integration', () => {
  it('abandon() happy-path: lifecycle → abandoned + abandonRepoStatus all cleaned + workspace destroyed', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/test-repo-1';                     // synthetic URL; real workspace pre-allocated below
    const handle = await mc.create('mission', { name: 'abandon-happy', repo: repoUrl });
    const wsPath = await preAllocateWorkspace(mc, handle.id, repoUrl);
    expect(existsSync(wsPath)).toBe(true);

    // Substrate-bypass: seed lifecycle 'in-progress' (start() can't clone over file://)
    await advanceLifecycle(tempRoot, handle.id, 'in-progress');
    await seedMissionLockfile(tempRoot, handle.id);

    // Real-engine wire-flow: abandon executes 7-step + actual gitEngine.deleteBranch + storage.cleanup
    const result = await mc.abandon(handle.id, 'Abandoning mission for test reasons');

    expect(result.lifecycleState).toBe('abandoned');
    expect(result.abandonMessage).toBe('Abandoning mission for test reasons');
    expect(result.abandonProgress).toBe('workspace-handled');
    expect(result.abandonRepoStatus).toEqual({ 'test-repo-1': 'cleaned' });
    expect(existsSync(wsPath)).toBe(false);                         // workspace destroyed (no --retain)

    // Config persists (no --purge-config)
    const reread = await mc.get('mission', handle.id);
    expect(reread.lifecycleState).toBe('abandoned');
    expect(reread.abandonMessage).toBe('Abandoning mission for test reasons');
  });

  it('abandon() with --retain preserves workspace', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/test-repo-2';
    const handle = await mc.create('mission', { repo: repoUrl });
    const wsPath = await preAllocateWorkspace(mc, handle.id, repoUrl);
    await advanceLifecycle(tempRoot, handle.id, 'in-progress');
    await seedMissionLockfile(tempRoot, handle.id);

    const result = await mc.abandon(handle.id, 'msg', { retain: true });

    expect(result.lifecycleState).toBe('abandoned');
    expect(existsSync(wsPath)).toBe(true);                          // preserved per --retain
  });

  it('abandon() with --purge-config deletes config + name-symlink atomically', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/test-repo-3';
    const handle = await mc.create('mission', { name: 'purge-test', repo: repoUrl });
    const configPath = join(tempRoot, 'config', 'missions', `${handle.id}.yaml`);
    const symlinkPath = join(tempRoot, 'config', 'missions', '.names', 'purge-test.yaml');
    expect(existsSync(configPath)).toBe(true);
    expect(existsSync(symlinkPath)).toBe(true);

    await preAllocateWorkspace(mc, handle.id, repoUrl);
    await advanceLifecycle(tempRoot, handle.id, 'in-progress');
    await seedMissionLockfile(tempRoot, handle.id);

    await mc.abandon(handle.id, 'msg', { purgeConfig: true });

    expect(existsSync(configPath)).toBe(false);                     // config deleted
    expect(existsSync(symlinkPath)).toBe(false);                    // symlink deleted
  });

  it('abandonMessage immutability: retry with different message uses original', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/test-repo-4';
    const handle = await mc.create('mission', { repo: repoUrl });
    await preAllocateWorkspace(mc, handle.id, repoUrl);
    await advanceLifecycle(tempRoot, handle.id, 'in-progress');
    await seedMissionLockfile(tempRoot, handle.id);

    // First abandon — persists 'first-msg'
    await mc.abandon(handle.id, 'first-msg');
    const after1 = await mc.get('mission', handle.id);
    expect(after1.abandonMessage).toBe('first-msg');

    // Mission is now terminal 'abandoned'; retry abandon should be rejected
    await expect(mc.abandon(handle.id, 'second-msg')).rejects.toMatchObject({
      message: expect.stringMatching(/requires lifecycle 'created', 'configured', 'joined', 'in-progress', 'started', or 'reading'/),
    });
  });

  it('abandon() per-repo state-tracking: 2-repo mission with one repo workspace missing', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl1 = 'file:///tmp/test-repo-multi-1';
    const repoUrl2 = 'file:///tmp/test-repo-multi-2';
    const handle = await mc.create('mission', { repo: [repoUrl1, repoUrl2] });
    await preAllocateWorkspace(mc, handle.id, repoUrl1);
    // Intentionally NOT pre-allocating workspace for repoUrl2; abandon should mark it 'cleaned' (no workspace = nothing to clean)
    await advanceLifecycle(tempRoot, handle.id, 'in-progress');
    await seedMissionLockfile(tempRoot, handle.id);

    const result = await mc.abandon(handle.id, 'msg');

    expect(result.lifecycleState).toBe('abandoned');
    expect(result.abandonRepoStatus).toEqual({
      'test-repo-multi-1': 'cleaned',
      'test-repo-multi-2': 'cleaned',
    });
    expect(result.abandonProgress).toBe('workspace-handled');
  });
});

describe('W4.3 slice (iv) — complete() real-engine integration (push-failure path)', () => {
  it('complete() squashes locally; push fails over file://; publishStatus tracks partial state', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/test-repo-pub-1';
    const handle = await mc.create('mission', { repo: repoUrl });
    await preAllocateWorkspace(mc, handle.id, repoUrl);
    await advanceLifecycle(tempRoot, handle.id, 'in-progress');
    await seedMissionLockfile(tempRoot, handle.id);

    // complete() will: persist publishMessage → squash succeeds (local) → push fails (no bare repo
    // at the file:// URL). publishLoop's catch records 'failed' and rethrows.
    // v1.0.7 bug-73 calibration: pre-fix assertion was `toMatch(/^(failed|squashed|pushed)$/)`,
    // which was green for BOTH the (then-silent) handle-find-failure 'failed' AND the push-failure
    // 'failed'. Tightened to specific `toBe('failed')` so the test no longer accepts the
    // missing-handle path (which post-fix should never fire for this setup).
    await expect(mc.complete(handle.id, 'first-publish-msg')).rejects.toThrow();

    const after = await mc.get('mission', handle.id);
    expect(after.publishMessage).toBe('first-publish-msg');
    expect(after.lifecycleState).toBe('in-progress');                // did NOT advance to 'completed' (push-failure)
    expect(after.publishStatus?.['test-repo-pub-1']).toBe('failed');
  });

  it('publishMessage immutability: retry with different message uses persisted', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/test-repo-pub-2';
    const handle = await mc.create('mission', { repo: repoUrl });
    await preAllocateWorkspace(mc, handle.id, repoUrl);
    await advanceLifecycle(tempRoot, handle.id, 'in-progress');
    await seedMissionLockfile(tempRoot, handle.id);

    // First complete — persists publishMessage; push fails
    await expect(mc.complete(handle.id, 'first-publish-msg')).rejects.toThrow();
    const after1 = await mc.get('mission', handle.id);
    expect(after1.publishMessage).toBe('first-publish-msg');

    // v1.0.2 slice (i.5) substrate-discipline: complete()'s finally-release unlinked the
    // inherited lockfile post-throw. Reseed for retry per substrate-bypass pattern (matches
    // operator-flow where retry typically follows a fresh `msn start` re-spawn).
    await seedMissionLockfile(tempRoot, handle.id);

    // Retry with different message — should use persisted; ignores new arg with stderr warning
    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
    try {
      await expect(mc.complete(handle.id, 'second-msg')).rejects.toThrow();
    } finally {
      process.stderr.write = origWrite;
    }

    const after2 = await mc.get('mission', handle.id);
    expect(after2.publishMessage).toBe('first-publish-msg');         // immutable
    expect(stderrChunks.join('')).toMatch(/complete already initiated.*retry uses original message/);
  });

  it('complete() with --retain + --purge-config rejected (mutual exclusion)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(
      mc.complete('msn-test1234', 'msg', { retain: true, purgeConfig: true }),
    ).rejects.toThrow(/mutually exclusive/);
  });
});

describe('W4.3 slice (iv) — historical substrate marker', () => {
  it('NOTE: real-engine clone integration via HTTP-server fixture lives in w6-real-engine-start.test.ts', () => {
    // Tests above use pre-allocated workspaces (substrate-bypass for clone-step only) to exercise
    // the COMPLETE downstream wire-flow (publish + abandon) with real LocalFilesystemStorage +
    // NativeGitEngine.
    //
    // Full real-engine clone integration test deferred to W6 with HTTP-server fixture
    // (e.g., spawn local `git http-backend` daemon OR `node-git-server` package OR
    // proper test-fixture using HTTP transport).
    expect(true).toBe(true);
  });
});
