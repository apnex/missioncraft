// W5b slice (iii) — closing-wave integration tests.
//
// Orchestrate slice-(i) join/leave + slice-(ii) push/cascade/propagation helpers across full
// happy-path lifecycle scenarios (writer-side single-process; reader-daemon Loop B simulated by
// direct call into reader-side join()/leave()). Substrate-bypass clone via pre-allocated workspaces
// + seeded mission-config (mirrors W4.3 slice (iv) discipline; HTTP-server fixture defers to W5c).
//
// Real-engine integration (HTTP transport, reader-daemon Loop B fetch, true cross-host topology)
// defers to W5c per (α) disposition.

import { execFile } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Missioncraft } from '@apnex/missioncraft';
import { readDaemonState } from '../../src/missioncraft-sdk/core/daemon/daemon-state.js';

const execFileAsync = promisify(execFile);

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w5b-iii-'));
});

afterEach(async () => {
  if (tempRoot) {
    // Reader-mode chmod-down (Step 6 join) makes workspace 0444/0555; restore u+w before rm
    try {
      await execFileAsync('find', [tempRoot, '-type', 'd', '-exec', 'chmod', 'u+wx', '{}', ';']);
      await execFileAsync('find', [tempRoot, '-type', 'f', '-exec', 'chmod', 'u+w', '{}', ';']);
    } catch { /* best-effort */ }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

/**
 * Seed a mission to a known multi-participant state with reader + coordinationRemote populated.
 * Inserts participants[] + coordinationRemote into the `mission:` block at proper 2-space indent.
 */
async function seedMultiParticipantMission(
  workspaceRoot: string,
  missionId: string,
  lifecycleState: 'configured' | 'in-progress',
  coordRemote: string,
): Promise<void> {
  const path = join(workspaceRoot, 'config', 'missions', `${missionId}.yaml`);
  const content = await readFile(path, 'utf8');
  const ts = new Date().toISOString();
  const block = `  participants:\n    - principal: writer@host\n      role: writer\n      added-at: ${ts}\n    - principal: reader@host\n      role: reader\n      added-at: ${ts}\n  coordination-remote: ${coordRemote}\n`;
  const updated = content
    .replace(/lifecycle-state: \w+/, `lifecycle-state: ${lifecycleState}`)
    .replace(/^repos:/m, `${block}repos:`);
  await writeFile(path, updated, 'utf8');
}

/**
 * Helper: seed the mission-lockfile to mimic start()'s post-Step-6 state (v1.0.2 slice i.5
 * substrate-discipline). abandon()/complete() inherit the lockfile from start() rather than
 * acquire-fresh — substrate-bypass tests must seed the lockfile or the inherit-check throws.
 */
async function seedMissionLockfile(workspaceRoot: string, missionId: string): Promise<void> {
  const lockfileDir = join(workspaceRoot, 'locks', 'missions');
  await mkdir(lockfileDir, { recursive: true });
  const lockfilePath = join(lockfileDir, `${missionId}.lock`);
  const now = new Date();
  const expires = new Date(now.getTime() + 86_400_000);
  await writeFile(
    lockfilePath,
    JSON.stringify(
      {
        id: `seed-${missionId}`,
        missionId,
        acquiredAt: now.toISOString(),
        expiresAt: expires.toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
}

describe('W5b slice (iii) — full join/leave lifecycle integration', () => {
  it('writer creates mission → reader joins → reader leaves with purge — full cycle clean', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/w5b-iii-1';
    const handle = await mc.create('mission', { repo: repoUrl });
    const ws = await mc.storage.allocate(handle.id, repoUrl);
    await writeFile(join(ws.path, 'README.md'), '# stub\n', 'utf8');
    await seedMultiParticipantMission(tempRoot, handle.id, 'configured', 'https://github.com/example/coord.git');

    // Join: configured → joined → reading
    const joined = await mc.join(handle.id, 'https://github.com/example/coord.git', 'reader@host');
    expect(joined.lifecycleState).toBe('reading');

    // Step 6 chmod-down verified (README is now 0444)
    const readmeStat = await stat(join(ws.path, 'README.md'));
    expect(readmeStat.mode & 0o777).toBe(0o444);

    // Leave with --purge-workspace
    await mc.leave(handle.id, { purgeWorkspace: true });

    // Workspace + config destroyed
    expect(existsSync(ws.path)).toBe(false);
    expect(existsSync(join(tempRoot, 'config', 'missions', `${handle.id}.yaml`))).toBe(false);
  });
});

describe('W5b slice (iii) — update<mission> triggers config-propagation', () => {
  it('set-tag mutation on mission with reader fires propagateConfigToCoordRemote', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/w5b-iii-2';
    const handle = await mc.create('mission', { repo: repoUrl });
    await mc.storage.allocate(handle.id, repoUrl);
    await seedMultiParticipantMission(tempRoot, handle.id, 'in-progress', 'https://github.com/example/coord.git');

    // Mock gitEngine.push + .tag to capture the propagation call-args
    const pushSpy = vi.fn().mockResolvedValue(undefined);
    const tagSpy = vi.fn().mockResolvedValue(undefined);
    (mc.gitEngine as unknown as { push: typeof pushSpy }).push = pushSpy;
    (mc.gitEngine as unknown as { tag: typeof tagSpy }).tag = tagSpy;

    // update<mission> with set-tag mutation
    const result = await mc.update('mission', handle.id, { kind: 'set-tag', key: 'priority', value: 'high' });
    expect(result.tags).toEqual({ priority: 'high' });

    // propagateConfigToCoordRemote should have fired:
    // - 1 push for refs/heads/config/<id> branch
    // - 1 tag-create for refs/tags/missioncraft/<id>/config-update
    // - 1 push for refs/tags/missioncraft/<id>/config-update tag
    expect(pushSpy).toHaveBeenCalledTimes(2);
    expect(tagSpy).toHaveBeenCalledTimes(1);

    const pushCalls = pushSpy.mock.calls;
    expect(pushCalls.find((c) => c[1].branch === `refs/heads/config/${handle.id}`)).toBeDefined();
    expect(pushCalls.find((c) => c[1].branch === `refs/tags/missioncraft/${handle.id}/config-update`)).toBeDefined();
  });

  it('set-tag mutation on solo-writer mission (no reader) does NOT fire propagation', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/w5b-iii-3' });

    const pushSpy = vi.fn().mockResolvedValue(undefined);
    const tagSpy = vi.fn().mockResolvedValue(undefined);
    (mc.gitEngine as unknown as { push: typeof pushSpy }).push = pushSpy;
    (mc.gitEngine as unknown as { tag: typeof tagSpy }).tag = tagSpy;

    await mc.update('mission', handle.id, { kind: 'set-tag', key: 'priority', value: 'high' });

    expect(pushSpy).not.toHaveBeenCalled();
    expect(tagSpy).not.toHaveBeenCalled();
  });
});

describe('W5b slice (iii) — abandon() triggers terminated-tag emission', () => {
  it('abandon-flow on mission with reader fires emitTerminatedTag (cascade-signal)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/w5b-iii-4';
    const handle = await mc.create('mission', { repo: repoUrl });
    const ws = await mc.storage.allocate(handle.id, repoUrl);
    await mc.gitEngine.init(ws, { fs: undefined, identity: { name: 'Test', email: 't@x.com' } });
    await writeFile(join(ws.path, 'README.md'), 'init\n', 'utf8');
    await mc.gitEngine.commitToRef(ws, 'refs/heads/main', {
      message: 'init',
      author: { name: 'Test', email: 't@x.com' },
    });
    await seedMultiParticipantMission(tempRoot, handle.id, 'in-progress', 'https://github.com/example/coord.git');
    await seedMissionLockfile(tempRoot, handle.id);

    // Mock push + tag (real-engine push to remote URL not viable per W4.3 slice (iv) discipline)
    const pushSpy = vi.fn().mockResolvedValue(undefined);
    const tagSpy = vi.fn().mockResolvedValue(undefined);
    (mc.gitEngine as unknown as { push: typeof pushSpy }).push = pushSpy;
    (mc.gitEngine as unknown as { tag: typeof tagSpy }).tag = tagSpy;

    const result = await mc.abandon(handle.id, 'integration test cleanup');
    expect(result.lifecycleState).toBe('abandoned');

    // emitTerminatedTag fires on terminal-state. Plus propagateConfigToCoordRemote fires from
    // applyMissionMutation hook (none here since abandon doesn't go through update<mission>).
    // Tag-create call for terminated-tag
    const tagCalls = tagSpy.mock.calls;
    expect(tagCalls.find((c) => c[1] === `missioncraft/${handle.id}/terminated`)).toBeDefined();

    // Push call for terminated-tag refspec
    const pushCalls = pushSpy.mock.calls;
    expect(pushCalls.find((c) =>
      c[1]?.branch === `refs/tags/missioncraft/${handle.id}/terminated`
        && c[1]?.url === 'https://github.com/example/coord.git'
        && c[1]?.remoteRef === `refs/tags/missioncraft/${handle.id}/terminated`,
    )).toBeDefined();
  });
});

describe('W5b slice (iii) — pushWipToCoordRemote daemon-state telemetry roundtrip', () => {
  it('successful push records lastPushSuccessAt + perRepoLastPushAt; readback verifies projection', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/w5b-iii-5';
    const handle = await mc.create('mission', { repo: repoUrl });
    await mc.storage.allocate(handle.id, repoUrl);
    await seedMultiParticipantMission(tempRoot, handle.id, 'in-progress', 'https://github.com/example/coord.git');

    const pushSpy = vi.fn().mockResolvedValue(undefined);
    (mc.gitEngine as unknown as { push: typeof pushSpy }).push = pushSpy;

    const before = Date.now();
    const count = await mc.pushWipToCoordRemote(handle.id);
    expect(count).toBe(1);

    const state = await readDaemonState(tempRoot, handle.id);
    expect(state).not.toBeNull();
    expect(state?.daemonStateSchemaVersion).toBe(1);
    const lastPushTs = new Date(state!.lastPushSuccessAt!).getTime();
    expect(lastPushTs).toBeGreaterThanOrEqual(before);
    expect(state?.perRepoLastPushAt).toEqual({ 'w5b-iii-5': state?.lastPushSuccessAt });
  });
});
