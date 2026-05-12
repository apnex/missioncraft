// v1.2.0 W4-new slice (iii) — msn join REPURPOSED: BRANCH-TRACKER reader-mission.
//
// Architect-spec per thread-546 slice-(iii) green-light + task-408 component-change 1:
// `msn join <writer-mission-id>` creates a reader-mission with readOnly: true +
// sourceMissionId. Inherits writer-mission's repos[] (scope-inheritance per §6 component-change
// 6; multi-repo at slice vi). Auto-close on writer-terminal deferred ENTIRELY to slice (v) Loop B
// per architect-disposition (a) — no auto-close logic this slice.
//
// SHAPE assertions per calibration #72:
// - reader-mission config has readOnly: true + sourceMissionId resolved to canonical msn-<8hex>
// - reader-mission inherits writer's repos[] verbatim (slice-iii single-repo; slice-vi multi-repo)
// - writer-mission-not-found surfaces a clear error
// - name-resolution: name OR id accepted on CLI; SDK normalizes to canonical id

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Missioncraft, MissionStateError } from '@apnex/missioncraft';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w4-join-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('v1.2.0 W4-new slice (iii) — msn join creates BRANCH-TRACKER reader-mission', () => {
  it('mc.create({readOnly, sourceMissionId}) yields reader-mission with sourceMissionId + inherited repos', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    // Writer-mission with a specific repo
    const writerRepo = 'https://github.com/example/branch-tracker-source.git';
    const writer = await mc.create('mission', { repo: writerRepo });

    // Reader-mission via BRANCH-TRACKER (mimics `msn join <writer-mission-id>`)
    const reader = await mc.create('mission', {
      readOnly: true,
      sourceMissionId: writer.id,
    });

    const readerState = await mc.get('mission', reader.id);

    // SHAPE-1: reader is in 'joined' (reader-state) not 'configured' (writer-state)
    expect(readerState.lifecycleState).toBe('joined');

    // SHAPE-2: readOnly: true + sourceMissionId set to writer's canonical id
    expect(readerState.readOnly).toBe(true);
    expect(readerState.sourceMissionId).toBe(writer.id);

    // SHAPE-3: sourceRemote + sourceBranch NOT populated (this is BRANCH-TRACKER, not PERSISTENT)
    expect(readerState.sourceRemote).toBeUndefined();
    expect(readerState.sourceBranch).toBeUndefined();

    // SHAPE-4: reader inherits writer's repos[] verbatim (scope-inheritance per §6-6)
    expect(readerState.repos).toHaveLength(1);
    expect(readerState.repos[0].url).toBe(writerRepo);
  });

  it('resolves writer-mission by NAME (not just id) via resolveMissionRef', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writer = await mc.create('mission', {
      name: 'writer-alpha',
      repo: 'https://github.com/example/repo.git',
    });

    // BRANCH-TRACKER via writer's NAME (not id)
    const reader = await mc.create('mission', {
      readOnly: true,
      sourceMissionId: 'writer-alpha',                // by name
    });

    const readerState = await mc.get('mission', reader.id);
    // Persisted sourceMissionId is the resolved canonical msn-<8hex>, not the name
    expect(readerState.sourceMissionId).toBe(writer.id);
    expect(readerState.sourceMissionId).toMatch(/^msn-[a-f0-9]{8}$/);
  });

  it('rejects when writer-mission does not exist (clear error surface)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(
      mc.create('mission', {
        readOnly: true,
        sourceMissionId: 'msn-deadbeef',              // doesn't exist
      }),
    ).rejects.toThrow(MissionStateError);
    await expect(
      mc.create('mission', {
        readOnly: true,
        sourceMissionId: 'msn-deadbeef',
      }),
    ).rejects.toThrow(/writer-mission 'msn-deadbeef' not found/);
  });

  it('reader-mission with --name flag sets the reader-mission name (not writer-mission name)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writer = await mc.create('mission', {
      name: 'writer-beta',
      repo: 'https://github.com/example/repo.git',
    });
    const reader = await mc.create('mission', {
      name: 'reader-beta',
      readOnly: true,
      sourceMissionId: writer.id,
    });
    expect(reader.name).toBe('reader-beta');
    const readerState = await mc.get('mission', reader.id);
    expect(readerState.name).toBe('reader-beta');
    expect(readerState.sourceMissionId).toBe(writer.id);
  });

  it('reader-mission inherits writer-mission with NO repos (empty repos[]; lifecycle stays joined)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    // Writer-mission with NO repos (lifecycleState 'created' since no repos)
    const writer = await mc.create('mission', {});
    const reader = await mc.create('mission', {
      readOnly: true,
      sourceMissionId: writer.id,
    });
    const readerState = await mc.get('mission', reader.id);
    expect(readerState.repos).toEqual([]);
    // Reader lifecycle is 'joined' regardless (reader-state; not influenced by repos.length)
    expect(readerState.lifecycleState).toBe('joined');
  });
});
