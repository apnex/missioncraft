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

  it('mc.abandon(<name>) resolves name → id (substrate-bypass via lifecycle requirement)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await mc.create('mission', { name: 'test-abandon', repo: 'file:///tmp/test-repo' });

    await expect(mc.abandon('test-abandon', 'msg')).rejects.toThrow(
      /requires lifecycle 'in-progress' or 'started'/,
    );
  });

  it('mc.workspace(<name>) resolves name → id (substrate-bypass via lifecycle requirement)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await mc.create('mission', { name: 'test-workspace', repo: 'file:///tmp/test-repo' });

    // workspace pre-flights mission existence; if name not resolved, fails with "mission not found".
    // If resolved, reaches the repo-resolution path (single-repo mission → just returns path).
    const path = await mc.workspace('test-workspace');
    expect(path).toContain(tempRoot);
    expect(path).toContain('missions');
  });

  it('mc.workspace(<name>:<repo>) coordinate-form also resolves the mission ref', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await mc.create('mission', { name: 'test-coord', repo: 'file:///tmp/coord-repo' });

    // coordinate form: `<id|name>:<repo>` — the mission part may be name; resolveMissionRef applies
    // post-coord-parse.
    const path = await mc.workspace('test-coord:coord-repo');
    expect(path).toContain(tempRoot);
  });

  it('mc.join(<name>) resolves name → id (returns reading-state via name)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { name: 'test-join', repo: 'file:///tmp/test-repo' });

    // join() resolves the name + executes the reader-side 7-step. Returns state at 'reading'.
    const state = await mc.join('test-join', 'https://github.com/x/y.git', 'p1@x.com');
    expect(state.id).toBe(handle.id);
  });

  it('mc.leave(<name>) resolves name → id (substrate-bypass via lifecycle requirement)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await mc.create('mission', { name: 'test-leave', repo: 'file:///tmp/test-repo' });

    // leave() Step 1 requires lifecycle in [reading, joined, leaving]; configured fails — but
    // the precondition-check is REACHED, proving name was resolved.
    await expect(mc.leave('test-leave')).rejects.toThrow(
      /lifecycle 'configured' not in \[reading, joined, leaving\]/,
    );
  });

  it('non-existent name throws MissionStateError with both paths in diagnostic', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(mc.get('mission', 'no-such-name')).rejects.toMatchObject({
      message: expect.stringMatching(/mission 'no-such-name' not found.*name-symlink at/),
    });
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
