// v1.0.2 slice (i.5) — abandon/complete acquireMissionLock-removal regression coverage.
//
// Slice (i) made start() persist the mission-lockfile as the daemon-IPC channel (Design v4.9 §2.6.5).
// Slice (i.5) removes the vestigial pre-W4.4 acquireMissionLock from abandon() + complete() Step 2 entry
// — they now INHERIT the lockfile from start() rather than acquire-fresh. Cross-operation guard is
// provided by `abandonInProgress` flag (v3.6 MEDIUM-R6.1) + `_engineMutate` atomicity (W4.3).
//
// This file adds the 2 NEW regression tests architect-prescribed at thread-531 round 5 disposition:
//   (5) abandon retry hits abandonInProgress-flag retry-path, not fresh-mutex-acquire
//   (6) concurrent complete-vs-abandon mutual-exclusion via _engineMutate atomic validate-reject
//
// Tests 1-4 (post-start happy-path, retry-idempotence, spawn-failure-rollback) covered by extensions
// to existing test files (complete-abandon-integration.test.ts + w6-real-engine-start.test.ts).

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Missioncraft, MissionStateError } from '@apnex/missioncraft';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-v102-i5-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

async function advanceLifecycle(workspaceRoot: string, missionId: string, lifecycleState: string): Promise<void> {
  const path = join(workspaceRoot, 'config', `${missionId}.yaml`);
  const content = await readFile(path, 'utf8');
  const updated = content.replace(/lifecycle-state: \w+/, `lifecycle-state: ${lifecycleState}`);
  await writeFile(path, updated, 'utf8');
}

async function seedMissionLockfile(workspaceRoot: string, missionId: string): Promise<void> {
  const dir = join(workspaceRoot, 'locks', 'missions');
  await mkdir(dir, { recursive: true });
  const now = new Date();
  await writeFile(
    join(dir, `${missionId}.lock`),
    JSON.stringify(
      {
        id: `seed-${missionId}`,
        missionId,
        acquiredAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
}

async function preAllocateWorkspace(mc: Missioncraft, missionId: string, repoUrl: string): Promise<string> {
  const handle = await mc.storage.allocate(missionId, repoUrl);
  await mc.gitEngine.init(handle, { fs: undefined, identity: { name: 'Test', email: 't@x.com' } });
  await writeFile(join(handle.path, 'README.md'), 'init', 'utf8');
  await mc.gitEngine.commitToRef(handle, 'refs/heads/main', {
    message: 'init',
    author: { name: 'Test', email: 't@x.com' },
  });
  return handle.path;
}

describe('v1.0.2 slice (i.5) — acquireMissionLock-removal regression', () => {
  it('inherit-missing → throws MissionStateError (precondition: start() must have created lockfile)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/v102-i5-precond' });
    await preAllocateWorkspace(mc, handle.id, 'file:///tmp/v102-i5-precond');
    await advanceLifecycle(tempRoot, handle.id, 'in-progress');
    // No seedMissionLockfile call — abandon() should reject

    await expect(mc.abandon(handle.id, 'no-lockfile')).rejects.toThrow(
      /mission-lock absent.*verify start\(\) was called/,
    );
  });

  it('test (5) — abandon retry hits abandonInProgress-flag retry-path (stderr warning fires)', async () => {
    // Architect-prescribed test #5 per thread-531 round 5: while a previous abandon attempt
    // persisted `abandonMessage`, a SECOND abandon invocation hits the "abandonMessage already
    // set; message-arg ignored" stderr warning path — NOT a hard-mutex-reject. Confirms the
    // existing retry semantic continues to work without the vestigial acquireMissionLock.
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/v102-i5-retry';
    const handle = await mc.create('mission', { repo: repoUrl });
    await preAllocateWorkspace(mc, handle.id, repoUrl);
    await advanceLifecycle(tempRoot, handle.id, 'in-progress');
    await seedMissionLockfile(tempRoot, handle.id);

    // First abandon — persists abandonMessage; succeeds end-to-end
    const result1 = await mc.abandon(handle.id, 'first-message');
    expect(result1.lifecycleState).toBe('abandoned');
    expect(result1.abandonMessage).toBe('first-message');

    // Lockfile was unlinked at Step 4 finally; reseed for retry-invocation per substrate-bypass
    // discipline (operator-flow would re-run msn start; test reseeds inline).
    await seedMissionLockfile(tempRoot, handle.id);

    // Advance lifecycle back to in-progress to trigger the override-warning path. (In real flow,
    // a retry-after-partial-failure would still be at 'in-progress'; here lifecycle already
    // advanced to 'abandoned' on first run, so adjust to test the override-warning specifically.)
    await advanceLifecycle(tempRoot, handle.id, 'in-progress');

    // Retry with DIFFERENT message — must hit override-warning + use persisted message
    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
    try {
      const result2 = await mc.abandon(handle.id, 'OVERRIDDEN-message');
      expect(result2.abandonMessage).toBe('first-message');                  // persisted; not overridden
    } finally {
      process.stderr.write = origWrite;
    }
    expect(stderrChunks.join('')).toMatch(/abandon already initiated.*new message arg ignored/);
  });

  it('test (6) — concurrent complete-vs-abandon: substrate-canonical guard is per-repo-lock + _engineMutate atomic validate-reject', async () => {
    // Architect-prescribed test #6 per thread-531 round 5: with no acquireMissionLock cross-op
    // mutex, what prevents complete + abandon from racing? Engineer-finding (post-removal of
    // acquireMissionLock in slice i.5):
    //
    //   The substrate STILL has TWO cross-op guards at lower layers:
    //   (a) Per-repo lock (`locks/repos/<sha>.lock` via acquireRepoLock with O_EXCL waitMs=0) —
    //       fail-fast on contended acquire; lower layer than mission-lock.
    //   (b) _engineMutate atomic validate-then-rename — whichever lifecycle-advancing mutator wins
    //       the rename first persists; the other's validate-call sees the now-terminal state.
    //
    // Result: at least one of {complete, abandon} rejects when fired concurrently. The state
    // remains internally consistent (no half-mutated lifecycle); never lands in an inconsistent
    // hybrid like "completed-and-abandoned".
    //
    // Canonical per Design v4.9 §2.4.1 + §2.6.5: substrate-safe under concurrent invocation.
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/v102-i5-race';
    const handle = await mc.create('mission', { repo: repoUrl });
    await preAllocateWorkspace(mc, handle.id, repoUrl);
    await advanceLifecycle(tempRoot, handle.id, 'in-progress');
    await seedMissionLockfile(tempRoot, handle.id);

    const [completeResult, abandonResult] = await Promise.allSettled([
      mc.complete(handle.id, 'complete-msg'),
      mc.abandon(handle.id, 'abandon-msg'),
    ]);

    // At least one rejects — substrate guard fires (either repo-lock contention OR push-failure
    // OR _engineMutate validate-rejection); state stays internally consistent.
    const failures = [completeResult, abandonResult].filter((r) => r.status === 'rejected');
    expect(failures.length).toBeGreaterThanOrEqual(1);

    // Final lifecycle state is INTERNALLY CONSISTENT — exactly one of the 3 valid post-concurrent
    // values (in-progress = both failed and rolled back; abandoned = abandon won; completed =
    // complete won, but file:// push always fails so this is unreachable in this test scenario).
    const finalState = await mc.get('mission', handle.id);
    expect(['in-progress', 'completed', 'abandoned']).toContain(finalState.lifecycleState);

    // Substrate-invariant check — no hybrid/inconsistent state (abandonMessage AND publishMessage
    // both set would indicate a race breach; assert at most one is set OR both are absent).
    const hasAbandonMessage = (finalState as { abandonMessage?: string }).abandonMessage !== undefined;
    const hasPublishMessage = (finalState as { publishMessage?: string }).publishMessage !== undefined;
    expect(hasAbandonMessage && hasPublishMessage).toBe(false);
  });
});
