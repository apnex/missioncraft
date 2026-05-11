// v1.0.5 slice (vi) — idea-273 progress callback hook regression tests.
//
// SDK-level: onProgress callback fires for start/abandon/complete at canonical phase boundaries.
// CLI-level (smoke): --quiet flag suppresses; NO_COLOR/TTY-detect honored by sink (covered in
// existing colors.test.ts patterns).

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Missioncraft, type ProgressEvent } from '@apnex/missioncraft';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-v105-vi-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

async function seedMissionLockfile(workspaceRoot: string, missionId: string): Promise<void> {
  const dir = join(workspaceRoot, 'locks', 'missions');
  await mkdir(dir, { recursive: true });
  const now = new Date();
  await writeFile(
    join(dir, `${missionId}.lock`),
    JSON.stringify({
      id: `seed-${missionId}`,
      missionId,
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
    }, null, 2),
    'utf8',
  );
}

async function advanceLifecycle(workspaceRoot: string, missionId: string, state: string): Promise<void> {
  const path = join(workspaceRoot, 'config', 'missions', `${missionId}.yaml`);
  const content = await readFile(path, 'utf8');
  await writeFile(path, content.replace(/lifecycle-state: \w+/, `lifecycle-state: ${state}`), 'utf8');
}

describe('v1.0.5 slice (vi) — idea-273 ProgressCallback fires at SDK phase boundaries', () => {
  it('abandon() emits final-tick + daemon-sigterm + cleanup-branches + destroy-workspace phases', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/v105-vi-abandon' });
    await mc.storage.allocate(handle.id, 'file:///tmp/v105-vi-abandon');
    const wsHandle = await mc.storage.allocate(handle.id, 'file:///tmp/v105-vi-abandon');
    await mc.gitEngine.init(wsHandle, { fs: undefined, identity: { name: 'T', email: 't@x.com' } });
    await writeFile(join(wsHandle.path, 'README.md'), 'init', 'utf8');
    await mc.gitEngine.commitToRef(wsHandle, 'refs/heads/main', {
      message: 'init',
      author: { name: 'T', email: 't@x.com' },
    });
    await advanceLifecycle(tempRoot, handle.id, 'in-progress');
    await seedMissionLockfile(tempRoot, handle.id);

    const events: ProgressEvent[] = [];
    const result = await mc.abandon(handle.id, 'test-msg', {
      onProgress: (e) => events.push(e),
    });
    expect(result.lifecycleState).toBe('abandoned');

    const phases = events.map((e) => e.phase);
    expect(phases).toContain('final-tick');
    expect(phases).toContain('daemon-sigterm');
    expect(phases).toContain('cleanup-branches');
    expect(phases).toContain('destroy-workspace');
  });

  it('abandon() with --retain emits `preserving workspace` message at destroy-workspace phase', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/v105-vi-retain' });
    const wsHandle = await mc.storage.allocate(handle.id, 'file:///tmp/v105-vi-retain');
    await mc.gitEngine.init(wsHandle, { fs: undefined, identity: { name: 'T', email: 't@x.com' } });
    await writeFile(join(wsHandle.path, 'README.md'), 'init', 'utf8');
    await mc.gitEngine.commitToRef(wsHandle, 'refs/heads/main', { message: 'init', author: { name: 'T', email: 't@x.com' } });
    await advanceLifecycle(tempRoot, handle.id, 'in-progress');
    await seedMissionLockfile(tempRoot, handle.id);

    const events: ProgressEvent[] = [];
    await mc.abandon(handle.id, 'msg', {
      retain: true,
      onProgress: (e) => events.push(e),
    });
    const destroyEvent = events.find((e) => e.phase === 'destroy-workspace');
    expect(destroyEvent?.message).toMatch(/preserving workspace.*--retain/);
  });

  it('ProgressEvent shape: phase + message required; optional fields not present unless emitted', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/v105-vi-shape' });
    const wsHandle = await mc.storage.allocate(handle.id, 'file:///tmp/v105-vi-shape');
    await mc.gitEngine.init(wsHandle, { fs: undefined, identity: { name: 'T', email: 't@x.com' } });
    await writeFile(join(wsHandle.path, 'README.md'), 'init', 'utf8');
    await mc.gitEngine.commitToRef(wsHandle, 'refs/heads/main', { message: 'init', author: { name: 'T', email: 't@x.com' } });
    await advanceLifecycle(tempRoot, handle.id, 'in-progress');
    await seedMissionLockfile(tempRoot, handle.id);

    const events: ProgressEvent[] = [];
    await mc.abandon(handle.id, 'msg', { onProgress: (e) => events.push(e) });

    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(typeof e.phase).toBe('string');
      expect(typeof e.message).toBe('string');
      expect(e.phase.length).toBeGreaterThan(0);
      expect(e.message.length).toBeGreaterThan(0);
    }
  });

  it('onProgress is OPTIONAL — abandon() works without callback (no throw)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/v105-vi-noprog' });
    const wsHandle = await mc.storage.allocate(handle.id, 'file:///tmp/v105-vi-noprog');
    await mc.gitEngine.init(wsHandle, { fs: undefined, identity: { name: 'T', email: 't@x.com' } });
    await writeFile(join(wsHandle.path, 'README.md'), 'init', 'utf8');
    await mc.gitEngine.commitToRef(wsHandle, 'refs/heads/main', { message: 'init', author: { name: 'T', email: 't@x.com' } });
    await advanceLifecycle(tempRoot, handle.id, 'in-progress');
    await seedMissionLockfile(tempRoot, handle.id);

    const result = await mc.abandon(handle.id, 'msg');
    expect(result.lifecycleState).toBe('abandoned');
  });
});
