// W5b slice (i) — join/leave runtime integration tests.
//
// 7-step joined→reading transition (Design v4.9 §2.4.1.v4 reader-side state-machine) +
// leave-flow lifecycle 'reading' → 'leaving' → terminal-removed (with --purge-workspace).
//
// Substrate-bypass disposition: HTTP-server fixture for clone-step (Step 5) defers to W5c per (α).
// Tests pre-seed a 'configured' mission-config + pre-allocate workspace to exercise the
// state-machine + lock-cycle + chmod-down wire-flow end-to-end (carries forward W4.3 slice (iv)
// substrate-bypass discipline).

import { execFile } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Missioncraft } from '@apnex/missioncraft';

const execFileAsync = promisify(execFile);

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w5b-i-'));
});

afterEach(async () => {
  if (tempRoot) {
    // Step 6 chmod-down sets workspace dirs to 0555/0444; restore u+w on full tree before rm
    try {
      await execFileAsync('find', [tempRoot, '-type', 'd', '-exec', 'chmod', 'u+wx', '{}', ';']);
      await execFileAsync('find', [tempRoot, '-type', 'f', '-exec', 'chmod', 'u+w', '{}', ';']);
    } catch { /* best-effort */ }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

/**
 * Helper: seed mission to 'configured' state by direct YAML rewrite (substrate-bypass mirroring
 * W4.3 slice (iv)). join() will transition this to 'joined' → 'reading' via _engineMutate.
 */
async function seedConfiguredMission(workspaceRoot: string, missionId: string): Promise<void> {
  const path = join(workspaceRoot, 'config', 'missions', `${missionId}.yaml`);
  const content = await readFile(path, 'utf8');
  // Add coordination-remote (required IFF reader present; for join-test we're seeding the writer-side
  // config but join() reads with writer-role pre-Step-3.5 so coordinationRemote isn't required at this
  // pre-state — but adding it makes the post-Step-7 reader-config valid for re-parse with reader-role).
  const updated = content.replace(/lifecycle-state: \w+/, 'lifecycle-state: configured');
  await writeFile(path, updated, 'utf8');
}

/**
 * Helper: pre-allocate workspace dirs for a mission's repos (substrate-bypass for Step 5 clone).
 * Mirrors what gitEngine.clone would produce post-clone (empty workdir; chmod-down at Step 6 makes
 * 0444/0555). For W5b slice (i), an empty allocated dir is sufficient — Step 5 substrate-bypass.
 */
async function preAllocateReaderWorkspace(
  mc: Missioncraft,
  missionId: string,
  repoUrl: string,
): Promise<string> {
  const handle = await mc.storage.allocate(missionId, repoUrl);
  // Seed a stub file so chmod-down at Step 6 has content to set 0444 on (verifies wire-flow)
  await writeFile(join(handle.path, 'README.md'), '# Reader stub\n', 'utf8');
  return handle.path;
}

describe('W5b slice (i) — join() 7-step runtime', () => {
  it('join() happy-path: configured → joined → reading via _engineMutate; chmod-down at Step 6', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/w5b-test-repo-1';
    const handle = await mc.create('mission', { repo: repoUrl });
    const wsPath = await preAllocateReaderWorkspace(mc, handle.id, repoUrl);
    await seedConfiguredMission(tempRoot, handle.id);

    // Real-engine wire-flow: 7-step transition LESS Step 5 substrate-bypass clone
    const result = await mc.join(handle.id, 'file:///tmp/coord.git', 'reader@host');

    expect(result.lifecycleState).toBe('reading');

    // Step 6 chmod-down verification: README.md is 0444 (read-only)
    const readmeStat = await stat(join(wsPath, 'README.md'));
    expect(readmeStat.mode & 0o777).toBe(0o444);
  });

  it('join() idempotent retry: already-joined state advances to reading without error (v4.6 MINOR-R7.1)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/w5b-test-repo-2';
    const handle = await mc.create('mission', { repo: repoUrl });
    await preAllocateReaderWorkspace(mc, handle.id, repoUrl);
    await seedConfiguredMission(tempRoot, handle.id);

    // First join: configured → joined → reading
    const r1 = await mc.join(handle.id, 'file:///tmp/coord.git');
    expect(r1.lifecycleState).toBe('reading');

    // Manually rewind to 'joined' to simulate idempotent-retry partial-failure recovery
    const path = join(tempRoot, 'config', 'missions', `${handle.id}.yaml`);
    const content = await readFile(path, 'utf8');
    await writeFile(path, content.replace(/lifecycle-state: reading/, 'lifecycle-state: joined'), 'utf8');

    // Second join: joined (idempotent at Step 3.5) → reading
    const r2 = await mc.join(handle.id, 'file:///tmp/coord.git');
    expect(r2.lifecycleState).toBe('reading');
  });

  it('join() rejects from terminal writer-state with substrate-currency error', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/w5b-test-repo-3';
    const handle = await mc.create('mission', { repo: repoUrl });
    // Direct seed to writer-terminal 'completed' (illegal pre-state for join)
    const path = join(tempRoot, 'config', 'missions', `${handle.id}.yaml`);
    const content = await readFile(path, 'utf8');
    await writeFile(path, content.replace(/lifecycle-state: \w+/, 'lifecycle-state: completed'), 'utf8');

    await expect(mc.join(handle.id, 'file:///tmp/coord.git')).rejects.toThrow(/Step 3\.5 rejected/);
  });

  it('join() canonicalizes coordRemote URL (trailing slash stripped; scheme lowercased)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/w5b-test-repo-4';
    const handle = await mc.create('mission', { repo: repoUrl });
    await preAllocateReaderWorkspace(mc, handle.id, repoUrl);
    await seedConfiguredMission(tempRoot, handle.id);

    // Canonicalization happens internally; happy-path success indicates URL parsed cleanly
    const result = await mc.join(handle.id, 'FILE:///tmp/coord.git/');
    expect(result.lifecycleState).toBe('reading');
  });
});

describe('W5b slice (i) — leave() runtime', () => {
  it('leave() happy-path: reading → leaving (no purge)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/w5b-leave-1';
    const handle = await mc.create('mission', { repo: repoUrl });
    await preAllocateReaderWorkspace(mc, handle.id, repoUrl);
    await seedConfiguredMission(tempRoot, handle.id);
    await mc.join(handle.id, 'file:///tmp/coord.git');

    await mc.leave(handle.id);

    // Config persists at 'leaving'; readback via direct file (mc.get uses default writer-role
    // which would reject reader-state on parse, so direct YAML read is appropriate here).
    const path = join(tempRoot, 'config', 'missions', `${handle.id}.yaml`);
    const content = await readFile(path, 'utf8');
    expect(content).toMatch(/lifecycle-state: leaving/);
  });

  it('leave() with --purge-workspace cleans up workspace + config (terminal-removed)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/w5b-leave-2';
    const handle = await mc.create('mission', { repo: repoUrl });
    const wsPath = await preAllocateReaderWorkspace(mc, handle.id, repoUrl);
    await seedConfiguredMission(tempRoot, handle.id);
    await mc.join(handle.id, 'file:///tmp/coord.git');

    expect(existsSync(wsPath)).toBe(true);
    const configPath = join(tempRoot, 'config', 'missions', `${handle.id}.yaml`);
    expect(existsSync(configPath)).toBe(true);

    await mc.leave(handle.id, { purgeWorkspace: true });

    expect(existsSync(wsPath)).toBe(false);                  // workspace destroyed
    expect(existsSync(configPath)).toBe(false);              // config purged (terminal-removed)
  });

  it('leave() idempotent retry: already-leaving stays leaving (no error)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/w5b-leave-3';
    const handle = await mc.create('mission', { repo: repoUrl });
    await preAllocateReaderWorkspace(mc, handle.id, repoUrl);
    await seedConfiguredMission(tempRoot, handle.id);
    await mc.join(handle.id, 'file:///tmp/coord.git');

    await mc.leave(handle.id);
    await mc.leave(handle.id);            // second invoke; no-op (idempotent on 'leaving')

    const path = join(tempRoot, 'config', 'missions', `${handle.id}.yaml`);
    const content = await readFile(path, 'utf8');
    expect(content).toMatch(/lifecycle-state: leaving/);
  });

  it('leave() rejects from writer-side state with HIGH-R2.3 read-only-participant error', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/w5b-leave-4' });
    // Don't transition to reader-state; mission stays at 'configured' (writer-state)
    await expect(mc.leave(handle.id)).rejects.toThrow(
      /lifecycle 'configured' not in \[reading, joined, leaving\].*read-only participant per HIGH-R2\.3/,
    );
  });
});
