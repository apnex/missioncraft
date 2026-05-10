// W5b slice (ii) item #2 — writer-side push-on-cadence-conditional unit tests.
//
// Tests the SDK's `pushWipToCoordRemote(missionId)` helper:
//   - Conditional gating: no-op IF coordinationRemote unset OR no reader participants
//   - Per-repo refspec push: source `refs/heads/wip/<id>` → destination `refs/heads/<repoName>/wip/<id>`
//   - .daemon-state.yaml `lastPushSuccessAt` + `perRepoLastPushAt[repoName]` recorded on success
//   - Best-effort: per-repo failure is non-aborting (pushes other repos; logs in successCount)
//
// Mocks `gitEngine.push` to capture call-args (real-engine push requires HTTP-server fixture per
// W4.3 slice (iv) discipline; defers to W5c).

import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Missioncraft } from '@apnex/missioncraft';
import { readDaemonState } from '../../src/missioncraft-sdk/core/daemon/daemon-state.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w5b-ii-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

/** Helper: seed mission to 'in-progress' + add reader participant + coordinationRemote.
 * Inserts participants[] + coordinationRemote into the `mission:` block at proper 2-space indent. */
async function seedMissionWithReader(
  workspaceRoot: string,
  missionId: string,
  coordRemote: string,
  options: { withReader?: boolean } = { withReader: true },
): Promise<void> {
  const path = join(workspaceRoot, 'config', `${missionId}.yaml`);
  const content = await readFile(path, 'utf8');
  const ts = new Date().toISOString();
  const participantsBlock = options.withReader
    ? `  participants:\n    - principal: writer@host\n      role: writer\n      added-at: ${ts}\n    - principal: reader@host\n      role: reader\n      added-at: ${ts}\n  coordination-remote: ${coordRemote}\n`
    : `  participants:\n    - principal: writer@host\n      role: writer\n      added-at: ${ts}\n  coordination-remote: ${coordRemote}\n`;
  // Insert before `repos:` line; preserves YAML structure
  const updated = content
    .replace(/lifecycle-state: \w+/, 'lifecycle-state: in-progress')
    .replace(/^repos:/m, `${participantsBlock}repos:`);
  await writeFile(path, updated, 'utf8');
}

describe('W5b slice (ii) item #2 — pushWipToCoordRemote', () => {
  it('no-op when coordinationRemote is unset (returns 0)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/w5b-ii-1' });
    // No coordinationRemote; no reader participants
    const count = await mc.pushWipToCoordRemote(handle.id);
    expect(count).toBe(0);
  });

  it('no-op when coordinationRemote set but no reader participants (solo writer mission)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/w5b-ii-2' });
    await seedMissionWithReader(tempRoot, handle.id, 'https://github.com/example/coord.git', { withReader: false });

    const count = await mc.pushWipToCoordRemote(handle.id);
    expect(count).toBe(0);
  });

  it('pushes per-repo refspec to coord-remote when reader present + records .daemon-state.yaml', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/w5b-ii-3';
    const handle = await mc.create('mission', { repo: repoUrl });
    await mc.storage.allocate(handle.id, repoUrl);
    await seedMissionWithReader(tempRoot, handle.id, 'https://github.com/example/coord.git');

    // Mock gitEngine.push to capture refspec args (real push requires HTTP fixture per W4.3 (iv))
    const pushSpy = vi.fn().mockResolvedValue(undefined);
    (mc.gitEngine as unknown as { push: typeof pushSpy }).push = pushSpy;

    const count = await mc.pushWipToCoordRemote(handle.id);
    expect(count).toBe(1);
    expect(pushSpy).toHaveBeenCalledWith(
      expect.objectContaining({ missionId: handle.id, repoUrl }),
      expect.objectContaining({
        branch: `refs/heads/wip/${handle.id}`,
        url: 'https://github.com/example/coord.git',
        remoteRef: `refs/heads/w5b-ii-3/wip/${handle.id}`,
      }),
    );

    // .daemon-state.yaml records the push timestamps
    const daemonState = await readDaemonState(tempRoot, handle.id);
    expect(daemonState).not.toBeNull();
    expect(daemonState?.daemonStateSchemaVersion).toBe(1);
    expect(daemonState?.lastPushSuccessAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(daemonState?.perRepoLastPushAt).toEqual({
      'w5b-ii-3': expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it('per-repo failure is non-aborting: continues to next repo + records partial success', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl1 = 'file:///tmp/w5b-ii-4a';
    const repoUrl2 = 'file:///tmp/w5b-ii-4b';
    const handle = await mc.create('mission', { repo: [repoUrl1, repoUrl2] });
    await mc.storage.allocate(handle.id, repoUrl1);
    await mc.storage.allocate(handle.id, repoUrl2);
    await seedMissionWithReader(tempRoot, handle.id, 'https://github.com/example/coord.git');

    const pushSpy = vi.fn()
      .mockRejectedValueOnce(new Error('network-partition repo 1'))    // attempt 1 fails (3 attempts via pushWithRetry exponential backoff)
      .mockRejectedValueOnce(new Error('network-partition repo 1'))
      .mockRejectedValueOnce(new Error('network-partition repo 1'))
      .mockRejectedValueOnce(new Error('network-partition repo 1'))
      .mockResolvedValueOnce(undefined);                                // repo 2 succeeds
    (mc.gitEngine as unknown as { push: typeof pushSpy }).push = pushSpy;

    const count = await mc.pushWipToCoordRemote(handle.id);
    expect(count).toBe(1);             // 1 of 2 repos succeeded; per-repo failure non-aborting

    const daemonState = await readDaemonState(tempRoot, handle.id);
    expect(daemonState?.perRepoLastPushAt).toEqual({
      'w5b-ii-4b': expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(daemonState?.perRepoLastPushAt?.['w5b-ii-4a']).toBeUndefined();
  });

  it('returns 0 when mission config does not exist (graceful no-op)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const count = await mc.pushWipToCoordRemote('msn-deadbeef');
    expect(count).toBe(0);
  });
});

describe('W5b slice (ii) item #3 — emitTerminatedTag', () => {
  it('no-op when coordinationRemote unset (returns 0)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/w5b-ii-tag-1' });
    const count = await mc.emitTerminatedTag(handle.id);
    expect(count).toBe(0);
  });

  it('no-op when no reader participants (solo writer mission)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/w5b-ii-tag-2' });
    await seedMissionWithReader(tempRoot, handle.id, 'https://github.com/example/coord.git', { withReader: false });
    const count = await mc.emitTerminatedTag(handle.id);
    expect(count).toBe(0);
  });

  it('emits refs/tags/missioncraft/<id>/terminated to coord-remote per repo', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/w5b-ii-tag-3';
    const handle = await mc.create('mission', { repo: repoUrl });
    await mc.storage.allocate(handle.id, repoUrl);
    await seedMissionWithReader(tempRoot, handle.id, 'https://github.com/example/coord.git');

    const tagSpy = vi.fn().mockResolvedValue(undefined);
    const pushSpy = vi.fn().mockResolvedValue(undefined);
    (mc.gitEngine as unknown as { tag: typeof tagSpy }).tag = tagSpy;
    (mc.gitEngine as unknown as { push: typeof pushSpy }).push = pushSpy;

    const count = await mc.emitTerminatedTag(handle.id);
    expect(count).toBe(1);

    expect(tagSpy).toHaveBeenCalledWith(
      expect.objectContaining({ missionId: handle.id }),
      `missioncraft/${handle.id}/terminated`,
      expect.objectContaining({ force: true }),
    );
    expect(pushSpy).toHaveBeenCalledWith(
      expect.objectContaining({ missionId: handle.id }),
      expect.objectContaining({
        branch: `refs/tags/missioncraft/${handle.id}/terminated`,
        url: 'https://github.com/example/coord.git',
        remoteRef: `refs/tags/missioncraft/${handle.id}/terminated`,
      }),
    );
  });

  it('returns 0 when mission config does not exist (graceful)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const count = await mc.emitTerminatedTag('msn-deadbeef');
    expect(count).toBe(0);
  });
});

describe('W5b slice (ii) item #4 — propagateConfigToCoordRemote', () => {
  it('returns false when coordinationRemote unset', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/w5b-ii-prop-1' });
    const ok = await mc.propagateConfigToCoordRemote(handle.id);
    expect(ok).toBe(false);
  });

  it('returns false when no reader participants (solo writer)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/w5b-ii-prop-2' });
    await seedMissionWithReader(tempRoot, handle.id, 'https://github.com/example/coord.git', { withReader: false });
    const ok = await mc.propagateConfigToCoordRemote(handle.id);
    expect(ok).toBe(false);
  });

  it('happy-path: commits to mirror + pushes config-branch + emits config-update tag', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/w5b-ii-prop-3';
    const handle = await mc.create('mission', { repo: repoUrl });
    await mc.storage.allocate(handle.id, repoUrl);
    await seedMissionWithReader(tempRoot, handle.id, 'https://github.com/example/coord.git');

    const pushSpy = vi.fn().mockResolvedValue(undefined);
    const tagSpy = vi.fn().mockResolvedValue(undefined);
    (mc.gitEngine as unknown as { push: typeof pushSpy }).push = pushSpy;
    (mc.gitEngine as unknown as { tag: typeof tagSpy }).tag = tagSpy;

    const ok = await mc.propagateConfigToCoordRemote(handle.id);
    expect(ok).toBe(true);

    // 2 pushes: branch + tag
    expect(pushSpy).toHaveBeenCalledTimes(2);
    const pushCalls = pushSpy.mock.calls;
    expect(pushCalls[0][1]).toEqual(expect.objectContaining({
      branch: `refs/heads/config/${handle.id}`,
      url: 'https://github.com/example/coord.git',
      remoteRef: `refs/heads/config/${handle.id}`,
    }));
    expect(pushCalls[1][1]).toEqual(expect.objectContaining({
      branch: `refs/tags/missioncraft/${handle.id}/config-update`,
      url: 'https://github.com/example/coord.git',
      remoteRef: `refs/tags/missioncraft/${handle.id}/config-update`,
    }));

    expect(tagSpy).toHaveBeenCalledWith(
      expect.anything(),
      `missioncraft/${handle.id}/config-update`,
      expect.objectContaining({ force: true }),
    );

    // Mirror repo + sentinel were created
    expect(existsSync(join(tempRoot, 'missions', handle.id, '.config-mirror', 'mission.yaml'))).toBe(true);
    expect(existsSync(join(tempRoot, 'missions', handle.id, '.config-mirror', '.last-propagated-at'))).toBe(true);
  });

  it('returns false when mission config does not exist (graceful)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const ok = await mc.propagateConfigToCoordRemote('msn-deadbeef');
    expect(ok).toBe(false);
  });
});

describe('W5b slice (ii) — daemon-state.yaml read/write helpers', () => {
  it('readDaemonState returns null for non-existent file', async () => {
    const state = await readDaemonState(tempRoot, 'msn-nope');
    expect(state).toBeNull();
  });

  it('recordPushSuccess writes ISO timestamps + roundtrips via readDaemonState', async () => {
    const { recordPushSuccess } = await import('../../src/missioncraft-sdk/core/daemon/daemon-state.js');
    const fixedDate = new Date('2026-05-10T09:30:00.000Z');
    await recordPushSuccess(tempRoot, 'msn-test1234', 'repo-a', fixedDate);

    const state = await readDaemonState(tempRoot, 'msn-test1234');
    expect(state).toEqual({
      daemonStateSchemaVersion: 1,
      lastPushSuccessAt: '2026-05-10T09:30:00.000Z',
      perRepoLastPushAt: { 'repo-a': '2026-05-10T09:30:00.000Z' },
    });

    // Subsequent recordPushSuccess merges per-repo map
    const laterDate = new Date('2026-05-10T09:31:00.000Z');
    await recordPushSuccess(tempRoot, 'msn-test1234', 'repo-b', laterDate);
    const state2 = await readDaemonState(tempRoot, 'msn-test1234');
    expect(state2?.lastPushSuccessAt).toBe('2026-05-10T09:31:00.000Z');
    expect(state2?.perRepoLastPushAt).toEqual({
      'repo-a': '2026-05-10T09:30:00.000Z',
      'repo-b': '2026-05-10T09:31:00.000Z',
    });
  });
});
