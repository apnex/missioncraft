// v1.0.3 slice (iii) — bug-64 item 5: <id|name> resolution audit.
//
// Pre-fix: `msn show <name>` failed with "mission not found at /path/<name>.yaml" despite the
// `.names/<name>.yaml` symlink existing (createMission wrote it but no SDK method ever READ it).
//
// Slice (iii) fix: introduced `resolveMissionRef(idOrName) → canonical id` helper in
// Missioncraft class; invoked at entry of every public SDK method taking a mission ref
// (get/update/start/complete/abandon/workspace/join/leave). This regression test enumerates
// each method by name + verifies name-resolution works uniformly.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Missioncraft, MissionStateError } from '@apnex/missioncraft';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-v103-iii-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('v1.0.3 slice (iii) — name-alias resolution audit per bug-64 item 5', () => {
  it('mc.get("mission", <name>) resolves to canonical id (substitute for `msn show`)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { name: 'test-readonly', repo: 'file:///tmp/test-repo' });

    const byId = await mc.get('mission', handle.id);
    const byName = await mc.get('mission', 'test-readonly');
    expect(byName.id).toBe(byId.id);
    expect(byName.name).toBe('test-readonly');
  });

  it('mc.update("mission", <name>, mutation) resolves name (substitute for `msn update <name>`)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { name: 'test-update', repo: 'file:///tmp/test-repo' });

    const updated = await mc.update('mission', 'test-update', {
      kind: 'set-description',
      description: 'updated-via-name',
    });
    expect(updated.id).toBe(handle.id);
    expect(updated.description).toBe('updated-via-name');
  });

  it('mc.start(<name>) resolves name → id; throws on lifecycle precondition (substrate-bypass; full start needs HTTP fixture)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await mc.create('mission', { name: 'test-start', repo: 'file:///tmp/test-repo' });

    // start fails at gitEngine.clone over file:// (substrate-reality per W4.3 slice iv discipline);
    // we only verify that resolveMissionRef passes through (no "mission not found" error).
    await expect(mc.start('test-start')).rejects.not.toThrow(/mission 'test-start' not found/);
  });

  it('mc.complete(<name>) resolves name → id (substrate-bypass via lifecycle requirement)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await mc.create('mission', { name: 'test-complete', repo: 'file:///tmp/test-repo' });

    // complete fails at lifecycle precondition (mission is in 'configured', not 'in-progress'/'started')
    // — but the precondition-check is REACHED, proving name was resolved (not "mission not found").
    await expect(mc.complete('test-complete', 'msg')).rejects.toThrow(
      /requires lifecycle 'in-progress' or 'started'/,
    );
  });

  it('mc.abandon(<name>) resolves name → id (abandon succeeds on the configured pre-start state)', async () => {
    // mission-81 slice (v.a): a 'configured' mission (created with a repo, not started) is a
    // pre-start state that abandon now accepts (minimal-teardown branch). This test proves
    // NAME-RESOLUTION: if 'test-abandon' didn't resolve, abandon would throw "mission ... not
    // found" — instead it resolves to the canonical id and abandons cleanly.
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { name: 'test-abandon', repo: 'file:///tmp/test-repo' });

    const result = await mc.abandon('test-abandon', 'msg');
    expect(result.id).toBe(handle.id);                        // name resolved → canonical id
    expect(result.lifecycleState).toBe('abandoned');
  });

  it('mc.workspace(<name>) resolves name → id (substrate-bypass via lifecycle requirement)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { name: 'test-workspace', repo: 'file:///tmp/test-repo' });
    await mc.storage.allocate(handle.id, 'file:///tmp/test-repo');  // v1.0.3 slice (vi) substrate-bypass

    // workspace pre-flights mission existence; if name not resolved, fails with "mission not found".
    // If resolved, reaches the repo-resolution path (single-repo mission → just returns path).
    const path = await mc.workspace('test-workspace');
    expect(path).toContain(tempRoot);
    expect(path).toContain('missions');
  });

  it('mc.workspace(<name>:<repo>) coordinate-form also resolves the mission ref', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { name: 'test-coord', repo: 'file:///tmp/coord-repo' });
    await mc.storage.allocate(handle.id, 'file:///tmp/coord-repo');  // v1.0.3 slice (vi) substrate-bypass

    // coordinate form: `<id|name>:<repo>` — the mission part may be name; resolveMissionRef applies
    // post-coord-parse.
    const path = await mc.workspace('test-coord:coord-repo');
    expect(path).toContain(tempRoot);
  });

  // mc.join + mc.leave SDK methods were DELETED at W7-new slices (ii) + (iii). Name-resolution
  // coverage for v5.0 reader-mission creation is via mc.create('mission', {readOnly: true,
  // sourceMissionId}) per W4-new slice (iii) `v1.2.0-w4-new-msn-join.test.ts` (specifically
  // `resolves writer-mission by NAME (not just id)` test case).

  it('non-existent name throws MissionStateError (v1.0.4 bug-66 item 8: concise; full diag via MSN_DEBUG)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    // Default: concise error
    await expect(mc.get('mission', 'no-such-name')).rejects.toMatchObject({
      message: expect.stringMatching(/^mission 'no-such-name' not found$/),
    });
    // MSN_DEBUG=1: full filesystem-path diagnostic
    const origDebug = process.env.MSN_DEBUG;
    process.env.MSN_DEBUG = '1';
    try {
      await expect(mc.get('mission', 'no-such-name')).rejects.toMatchObject({
        message: expect.stringMatching(/mission 'no-such-name' not found.*name-symlink at/),
      });
    } finally {
      if (origDebug === undefined) delete process.env.MSN_DEBUG;
      else process.env.MSN_DEBUG = origDebug;
    }
  });

  it('scope name-resolution: mc.get("scope", <name>) (sibling for completeness)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('scope', { name: 'test-scope', repo: 'file:///tmp/test-repo' });

    const byId = await mc.get('scope', handle.id);
    const byName = await mc.get('scope', 'test-scope');
    expect(byName.id).toBe(byId.id);
    expect(byName.name).toBe('test-scope');
  });
});
