// v1.0.6 slice (v) — bug-71 cwd-rug-pull guard on `msn abandon`.
//
// Fix: in Missioncraft.abandon() Step 6, BEFORE workspace destroy: if process.cwd() is inside
// the workspace about to be destroyed, chdir to parent (workspaceRoot/missions/). --retain branch
// is exempt: workspace preserved → no rug-pull risk.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Missioncraft } from '@apnex/missioncraft';

let tempRoot: string;
let savedCwd: string;

beforeEach(async () => {
  savedCwd = process.cwd();
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-v106-v-'));
});

afterEach(async () => {
  try { process.chdir(savedCwd); } catch { /* idempotent */ }
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

async function advanceLifecycle(workspaceRoot: string, missionId: string, lifecycleState: string): Promise<void> {
  const path = join(workspaceRoot, 'config', 'missions', `${missionId}.yaml`);
  const content = await readFile(path, 'utf8');
  const updated = content.replace(/lifecycle-state: [\w-]+/, `lifecycle-state: ${lifecycleState}`);
  await writeFile(path, updated, 'utf8');
}

async function seedMissionLockfile(workspaceRoot: string, missionId: string): Promise<void> {
  const lockfileDir = join(workspaceRoot, 'locks', 'missions');
  await mkdir(lockfileDir, { recursive: true });
  const lockfilePath = join(lockfileDir, `${missionId}.lock`);
  const now = new Date();
  const expires = new Date(now.getTime() + 86_400_000);
  await writeFile(
    lockfilePath,
    JSON.stringify({
      id: `seed-${missionId}`,
      missionId,
      acquiredAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    }, null, 2),
    'utf8',
  );
}

async function preAllocateWorkspace(mc: Missioncraft, missionId: string, repoUrl: string): Promise<string> {
  const handle = await mc.storage.allocate(missionId, repoUrl);
  await mc.gitEngine.init(handle, {
    fs: undefined,
    identity: { name: 'Test User', email: 't@x.com' },
  });
  await writeFile(join(handle.path, 'README.md'), 'initial', 'utf8');
  await mc.gitEngine.commitToRef(handle, 'refs/heads/main', {
    message: 'initial',
    author: { name: 'Test User', email: 't@x.com' },
  });
  return handle.path;
}

describe('v1.0.6 slice (v) — bug-71 cwd-rug-pull guard in abandon', () => {
  it('abandon shifts cwd to parent when cwd is inside the workspace about to be destroyed', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/v106-v-repo-a';
    const handle = await mc.create('mission', { repo: repoUrl });
    const wsPath = await preAllocateWorkspace(mc, handle.id, repoUrl);
    await advanceLifecycle(tempRoot, handle.id, 'in-progress');
    await seedMissionLockfile(tempRoot, handle.id);

    // Operator stands inside the workspace (e.g., after `msn cd <id>`)
    process.chdir(wsPath);
    expect(process.cwd().startsWith(resolve(tempRoot, 'missions', handle.id))).toBe(true);

    await mc.abandon(handle.id, 'tidy up');

    // cwd shifted to <workspaceRoot>/missions parent — NOT inside the destroyed workspace
    expect(existsSync(wsPath)).toBe(false);
    expect(process.cwd().startsWith(resolve(tempRoot, 'missions', handle.id))).toBe(false);
    expect(process.cwd()).toBe(resolve(tempRoot, 'missions'));
  });

  it('abandon does NOT chdir when cwd is outside the workspace', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/v106-v-repo-b';
    const handle = await mc.create('mission', { repo: repoUrl });
    await preAllocateWorkspace(mc, handle.id, repoUrl);
    await advanceLifecycle(tempRoot, handle.id, 'in-progress');
    await seedMissionLockfile(tempRoot, handle.id);

    const outsideDir = await mkdtemp(join(tmpdir(), 'mc-outside-'));
    try {
      process.chdir(outsideDir);
      const cwdBefore = process.cwd();

      await mc.abandon(handle.id, 'tidy up');

      expect(process.cwd()).toBe(cwdBefore);                          // unchanged — guard not triggered
    } finally {
      try { process.chdir(savedCwd); } catch { /* idempotent */ }
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('abandon with --retain does NOT chdir (workspace preserved → no rug-pull risk)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/v106-v-repo-c';
    const handle = await mc.create('mission', { repo: repoUrl });
    const wsPath = await preAllocateWorkspace(mc, handle.id, repoUrl);
    await advanceLifecycle(tempRoot, handle.id, 'in-progress');
    await seedMissionLockfile(tempRoot, handle.id);

    process.chdir(wsPath);
    const cwdBefore = process.cwd();

    await mc.abandon(handle.id, 'tidy up', { retain: true });

    // Workspace preserved per --retain; cwd should NOT be shifted (no rug-pull risk)
    expect(existsSync(wsPath)).toBe(true);
    expect(process.cwd()).toBe(cwdBefore);
  });

  it('abandon shifts cwd from deep subdirectory inside workspace', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/v106-v-repo-d';
    const handle = await mc.create('mission', { repo: repoUrl });
    const wsPath = await preAllocateWorkspace(mc, handle.id, repoUrl);
    await advanceLifecycle(tempRoot, handle.id, 'in-progress');
    await seedMissionLockfile(tempRoot, handle.id);

    const deepDir = join(wsPath, 'deep-subdir');
    await mkdir(deepDir, { recursive: true });
    process.chdir(deepDir);
    expect(process.cwd().startsWith(resolve(tempRoot, 'missions', handle.id))).toBe(true);

    await mc.abandon(handle.id, 'tidy up');

    expect(existsSync(wsPath)).toBe(false);
    expect(process.cwd().startsWith(resolve(tempRoot, 'missions', handle.id))).toBe(false);
  });
});
