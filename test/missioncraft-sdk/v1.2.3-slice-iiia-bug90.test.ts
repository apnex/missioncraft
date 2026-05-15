// mission-81 slice (iii.a) — bug-90: scope/mission create repo-name validation + list silent-swallow.
//
// (a) `createScope` / `createMission` derived repo-names from URLs without validating — a 1-char
//     name (e.g. `x` from `file:///tmp/x.git`) was written to disk, then failed `RepoSpecSchema`
//     on the READ path → the entity silently vanished from list output.
// (b) `listScopes` / `listMissions` wrapped per-entity reads in `catch { /* skip */ }` — any
//     parse/validation failure was silently swallowed. Now warns to stderr.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Missioncraft, ConfigValidationError } from '@apnex/missioncraft';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-v123-iiia-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('mission-81 slice (iii.a) bug-90(a) — repo-name validated at create-time', () => {
  it('createScope rejects a URL whose derived repo-name is invalid (1-char)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(mc.create('scope', { name: 'sc-bad', repo: 'file:///tmp/x.git' }))
      .rejects.toBeInstanceOf(ConfigValidationError);
    await expect(mc.create('scope', { name: 'sc-bad2', repo: 'file:///tmp/x.git' }))
      .rejects.toThrow(/repo-name 'x' .* is invalid/);
  });

  it('createMission rejects a URL whose derived repo-name is invalid (1-char)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(mc.create('mission', { name: 'mi-bad', repo: 'file:///tmp/q.git' }))
      .rejects.toThrow(/repo-name 'q' .* is invalid/);
  });

  it('createScope accepts a URL with a valid derived repo-name', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('scope', { name: 'sc-ok', repo: 'file:///tmp/widget.git' });
    expect(handle.id).toMatch(/^scp-/);
    // round-trips cleanly through the read path
    const state = await mc.get('scope', handle.id);
    expect(state.repos[0].name).toBe('widget');
  });

  it('createMission accepts a multi-repo set when all derived names are valid', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', {
      name: 'mi-multi',
      repo: ['file:///tmp/alpha.git', 'file:///tmp/beta.git'],
    });
    const state = await mc.get('mission', handle.id);
    expect(state.repos.map((r) => r.name)).toEqual(['alpha', 'beta']);
  });
});

describe('mission-81 slice (iii.a) bug-90(b) — list surfaces parse-failures instead of silent-swallow', () => {
  it('listScopes warns to stderr (does not throw, does not silently drop) on an unreadable scope YAML', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const good = await mc.create('scope', { name: 'sc-good', repo: 'file:///tmp/widget.git' });

    // Plant a corrupt scope config alongside the good one
    const scopesDir = join(tempRoot, 'config', 'scopes');
    await mkdir(scopesDir, { recursive: true });
    await writeFile(join(scopesDir, 'scp-corrupt1.yaml'), 'this: is: not: valid: scope: yaml\n', 'utf8');

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      const scopes = await mc.list('scope');
      // good scope still listed; corrupt one dropped — but NOT silently
      expect(scopes.map((s) => s.id)).toContain(good.id);
      expect(scopes.map((s) => s.id)).not.toContain('scp-corrupt1');
      const warned = stderrSpy.mock.calls.some(
        (c) => typeof c[0] === 'string' && c[0].includes("skipped scope 'scp-corrupt1'"),
      );
      expect(warned).toBe(true);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('listMissions warns to stderr on an unreadable mission YAML', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const good = await mc.create('mission', { name: 'mi-good', repo: 'file:///tmp/widget.git' });

    const missionsDir = join(tempRoot, 'config', 'missions');
    await mkdir(missionsDir, { recursive: true });
    await writeFile(join(missionsDir, 'msn-corrupt1.yaml'), 'totally: [broken yaml\n', 'utf8');

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      const missions = await mc.list('mission');
      expect(missions.map((m) => m.id)).toContain(good.id);
      expect(missions.map((m) => m.id)).not.toContain('msn-corrupt1');
      const warned = stderrSpy.mock.calls.some(
        (c) => typeof c[0] === 'string' && c[0].includes("skipped mission 'msn-corrupt1'"),
      );
      expect(warned).toBe(true);
    } finally {
      stderrSpy.mockRestore();
    }
  });
});
