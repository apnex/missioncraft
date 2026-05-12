// v1.2.0 W4-new slice (ii) — msn watch new verb: PERSISTENT-TRACKER reader-mission.
//
// Architect-spec per thread-546 slice-(ii) green-light + task-408 component-change 2:
// `msn watch --repo <url> --branch <ref>` creates a reader-mission with
// readOnly: true + sourceRemote: <url> + sourceBranch: <ref>. Long-lived; operator-
// explicit-abandon terminal only (no auto-close logic this slice; Loop B daemon plumbing
// lands at slice v).
//
// SHAPE assertions per calibration #72 (transparency-gate-test discipline): verify exact
// mission-config-shape (readOnly + sourceRemote + sourceBranch + initial reader-state) not
// just generic "creates a mission".

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Missioncraft } from '@apnex/missioncraft';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w4-watch-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('v1.2.0 W4-new slice (ii) — msn watch creates PERSISTENT-TRACKER reader-mission', () => {
  it('mc.create({readOnly+sourceRemote+sourceBranch+repo}) yields reader-mission in joined state', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'https://github.com/example/persistent-target.git';
    const handle = await mc.create('mission', {
      repo: repoUrl,
      readOnly: true,
      sourceRemote: repoUrl,
      sourceBranch: 'main',
    });
    expect(handle.id).toMatch(/^msn-[a-f0-9]{8}$/);

    // SHAPE-1: lifecycle-state is reader-side 'joined' (not writer-side 'configured')
    const state = await mc.get('mission', handle.id);
    expect(state.lifecycleState).toBe('joined');

    // SHAPE-2: readOnly: true (reader-mission identification)
    expect(state.readOnly).toBe(true);

    // SHAPE-3: sourceRemote + sourceBranch populated (PERSISTENT-TRACKER fields)
    expect(state.sourceRemote).toBe(repoUrl);
    expect(state.sourceBranch).toBe('main');

    // SHAPE-4: sourceMissionId NOT populated (this is PERSISTENT-TRACKER not BRANCH-TRACKER)
    expect(state.sourceMissionId).toBeUndefined();

    // SHAPE-5: repos[0] points at the same URL so `msn start` can clone
    expect(state.repos).toHaveLength(1);
    expect(state.repos[0].url).toBe(repoUrl);
  });

  it('persists reader-mission YAML with readOnly + source* fields (round-trip via mc.get)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', {
      name: 'watch-test',
      repo: 'https://github.com/example/repo.git',
      readOnly: true,
      sourceRemote: 'https://github.com/example/repo.git',
      sourceBranch: 'develop',
    });

    const state = await mc.get('mission', handle.id);
    expect(state.name).toBe('watch-test');
    expect(state.readOnly).toBe(true);
    expect(state.sourceRemote).toBe('https://github.com/example/repo.git');
    expect(state.sourceBranch).toBe('develop');
  });

  it('writer-mission (no readOnly opts) creates as writer with no source* fields (regression net)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', {
      repo: 'https://github.com/example/writer.git',
    });
    const state = await mc.get('mission', handle.id);
    expect(state.lifecycleState).toBe('configured');           // writer-side state
    expect(state.readOnly).toBeUndefined();                    // not a reader
    expect(state.sourceRemote).toBeUndefined();
    expect(state.sourceBranch).toBeUndefined();
  });
});
