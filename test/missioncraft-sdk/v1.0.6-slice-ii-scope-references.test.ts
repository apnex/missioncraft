// v1.0.6 slice (ii) — bug-70 `scope show/list --include-references` compute-on-demand scan.
//
// Architect-pre-disposed: simpler than a maintained ledger; missions are O(10-100s) so scan is fast.
// Cascade-protection (v1.0.5 bug-65) shipped + verified in slice (i); slice (ii) is the
// operator-visibility surface for the same scope-id → missions[] mapping.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Missioncraft } from '@apnex/missioncraft';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-v106-ii-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('v1.0.6 slice (ii) — bug-70 scope show/list --include-references', () => {
  it('get scope WITHOUT includeReferences returns empty referencedByMissions (lazy default)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const scope = await mc.create('scope', { name: 'lazy', repo: 'file:///tmp/svc' });
    // Create a referencing mission
    await mc.create('mission', { scope: scope.id });

    const state = await mc.get('scope', scope.id);
    expect(state.referencedByMissions).toEqual([]);
  });

  it('get scope WITH includeReferences returns mission-ids referencing the scope', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const scope = await mc.create('scope', { name: 'pinned', repo: 'file:///tmp/svc' });
    const m1 = await mc.create('mission', { scope: scope.id });
    const m2 = await mc.create('mission', { scope: scope.id });

    const state = await mc.get('scope', scope.id, { includeReferences: true });
    expect([...state.referencedByMissions].sort()).toEqual([m1.id, m2.id].sort());
  });

  it('referencedByMissions excludes missions that detached via set-scope null', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const scope = await mc.create('scope', { name: 'transient', repo: 'file:///tmp/svc' });
    const stay = await mc.create('mission', { scope: scope.id });
    const detach = await mc.create('mission', { scope: scope.id });

    // Detach one
    await mc.update('mission', detach.id, { kind: 'set-scope', scopeId: null });

    const state = await mc.get('scope', scope.id, { includeReferences: true });
    expect(state.referencedByMissions).toEqual([stay.id]);
  });

  it('list scopes WITH includeReferences populates per-scope mission-id list', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const scopeA = await mc.create('scope', { name: 'aa', repo: 'file:///tmp/r1' });
    const scopeB = await mc.create('scope', { name: 'bb', repo: 'file:///tmp/r2' });
    const ma = await mc.create('mission', { scope: scopeA.id });
    const mb = await mc.create('mission', { scope: scopeB.id });

    const scopes = await mc.list('scope', undefined, { includeReferences: true });
    expect(scopes.length).toBe(2);
    const byId = new Map(scopes.map((s) => [s.id, s] as const));
    expect(byId.get(scopeA.id)?.referencedByMissions).toEqual([ma.id]);
    expect(byId.get(scopeB.id)?.referencedByMissions).toEqual([mb.id]);
  });

  it('list scopes WITHOUT includeReferences leaves referencedByMissions empty (lazy default)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const scope = await mc.create('scope', { name: 'lazy', repo: 'file:///tmp/svc' });
    await mc.create('mission', { scope: scope.id });

    const scopes = await mc.list('scope');
    expect(scopes.length).toBe(1);
    expect(scopes[0].referencedByMissions).toEqual([]);
  });

  it('scope with zero referencing missions returns empty list under --include-references', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const scope = await mc.create('scope', { name: 'orphan', repo: 'file:///tmp/svc' });

    const state = await mc.get('scope', scope.id, { includeReferences: true });
    expect(state.referencedByMissions).toEqual([]);
  });
});
