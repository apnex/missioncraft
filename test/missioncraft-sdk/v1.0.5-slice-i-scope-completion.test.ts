// v1.0.5 slice (i) — bug-65 scope-namespace SDK-impl audit + completion.
//
// Pre-fix: scope show/list/create WORKED; scope update + scope delete were STUBS throwing
// "not yet implemented (W4)". Architect spec: implement both with cascade-protection for delete.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Missioncraft, MissionStateError } from '@apnex/missioncraft';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-v105-i-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('v1.0.5 slice (i) — scope-update runtime (bug-65)', () => {
  it('add-repo mutation appends a new repo with auto-derived name', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('scope', { name: 'auth', repo: 'file:///tmp/test-repo-1' });

    const updated = await mc.update('scope', handle.id, {
      kind: 'add-repo',
      repo: { url: 'file:///tmp/test-repo-2' },
    });
    expect(updated.repos.length).toBe(2);
    expect(updated.repos[1].name).toBe('test-repo-2');
  });

  it('add-repo rejects duplicate repo-name', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('scope', { repo: 'file:///tmp/dup' });
    await expect(
      mc.update('scope', handle.id, { kind: 'add-repo', repo: { url: 'file:///tmp/other/dup' } }),
    ).rejects.toThrow(/already has repo with name 'dup'/);
  });

  it('remove-repo strips the named repo', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('scope', { repo: ['file:///tmp/repo-a', 'file:///tmp/repo-b'] });

    const updated = await mc.update('scope', handle.id, { kind: 'remove-repo', repoName: 'repo-a' });
    expect(updated.repos.length).toBe(1);
    expect(updated.repos[0].name).toBe('repo-b');
  });

  it('rename updates scope.name + manages name-symlink', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('scope', { name: 'old-name', repo: 'file:///tmp/test-repo' });

    await mc.update('scope', 'old-name', { kind: 'rename', newName: 'new-name' });

    // Resolve via the new name should work
    const renamed = await mc.get('scope', 'new-name');
    expect(renamed.id).toBe(handle.id);
    expect(renamed.name).toBe('new-name');
    // Old symlink should be gone
    expect(existsSync(join(tempRoot, 'scopes', '.names', 'old-name.yaml'))).toBe(false);
  });

  it('rename rejects name collision', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await mc.create('scope', { name: 'occupied', repo: 'file:///tmp/test-repo-1' });
    const second = await mc.create('scope', { name: 'free', repo: 'file:///tmp/test-repo-2' });

    await expect(
      mc.update('scope', second.id, { kind: 'rename', newName: 'occupied' }),
    ).rejects.toThrow(/'occupied' already taken/);
  });

  it('set-description + remove-tag round-trip via fresh get', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('scope', { repo: 'file:///tmp/test-repo' });

    await mc.update('scope', handle.id, { kind: 'set-description', description: 'auth subsystem' });
    await mc.update('scope', handle.id, { kind: 'set-tag', key: 'owner', value: 'team-a' });
    await mc.update('scope', handle.id, { kind: 'set-tag', key: 'env', value: 'prod' });
    await mc.update('scope', handle.id, { kind: 'remove-tag', key: 'env' });

    const final = await mc.get('scope', handle.id);
    expect(final.description).toBe('auth subsystem');
    expect(final.tags).toEqual({ owner: 'team-a' });
  });
});

describe('v1.0.5 slice (i) — scope-delete with cascade-protection (bug-65)', () => {
  it('deletes a scope with no referencing missions', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('scope', { name: 'transient', repo: 'file:///tmp/test-repo' });
    const scopePath = join(tempRoot, 'scopes', `${handle.id}.yaml`);
    expect(existsSync(scopePath)).toBe(true);

    await mc.delete('scope', handle.id);
    expect(existsSync(scopePath)).toBe(false);
    expect(existsSync(join(tempRoot, 'scopes', '.names', 'transient.yaml'))).toBe(false);
  });

  it('cascade-protection: rejects delete when missions reference the scope', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const scopeHandle = await mc.create('scope', { name: 'auth', repo: 'file:///tmp/test-repo' });
    const missionHandle = await mc.create('mission', { repo: 'file:///tmp/test-mission-repo' });

    // Manually edit mission YAML to reference the scope-id (parser-bypass test)
    const missionPath = join(tempRoot, 'config', `${missionHandle.id}.yaml`);
    const content = await readFile(missionPath, 'utf8');
    await writeFile(missionPath, content.replace(/^repos:/m, `  scope-id: ${scopeHandle.id}\nrepos:`), 'utf8');

    await expect(mc.delete('scope', scopeHandle.id)).rejects.toThrow(
      /scope '.+' has 1 referencing mission/,
    );
    // Scope still exists after rejected delete
    expect(existsSync(join(tempRoot, 'scopes', `${scopeHandle.id}.yaml`))).toBe(true);
  });

  it('resolves scope by name for delete', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('scope', { name: 'by-name-delete', repo: 'file:///tmp/test-repo' });

    await mc.delete('scope', 'by-name-delete');
    expect(existsSync(join(tempRoot, 'scopes', `${handle.id}.yaml`))).toBe(false);
  });
});
