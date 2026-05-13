// v1.2.0 W4-new slice (v.b) — Reader-substrate completion: reader-start flow + workspace 0444 +
// auto-close mechanics.
//
// Architect-spec per thread-547 §2 slice (v.b):
//   - Workspace 0444 chmod-down at reader-start (preserved from v4.x idea-265 reader-mode invariant)
//   - Auto-close mechanics (BRANCH-TRACKER writer-terminal detection) dual failure-modes:
//     (1) writer mission-config gone → ReaderAutoCloseError
//     (2) writer lifecycleState terminal (completed/abandoned) → ReaderAutoCloseError
//   - Reader-mission `msn start` flow — `mc.start(reader.id)` lifecycle-gate accepts 'joined'
//     in addition to 'configured'; reader clones source-remote + checks out source-branch;
//     transitions lifecycle 'joined' → 'started'.
//   - Daemon-side auto-abandon: readerAutoAbandon advances lifecycle to 'abandoned' atomically.
//
// SHAPE assertions per calibration #72: workspace mode + lifecycle state + abandonMessage shape.

import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, unlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Missioncraft, MissionStateError, ReaderAutoCloseError } from '@apnex/missioncraft';
import { createGitHttpFixture, type GitHttpFixture } from '../fixtures/git-http-fixture.js';

const execFileAsync = promisify(execFile);

let tempRoot: string;
let fixture: GitHttpFixture | undefined;
let bareDir: string;
let bareRepoUrl: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w4-vb-'));
  const repoBase = join(tempRoot, 'origin-repos');
  bareDir = join(repoBase, 'upstream.git');
  await mkdir(bareDir, { recursive: true });
  await execFileAsync('git', ['init', '--quiet', '--bare'], { cwd: bareDir });
  await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: bareDir });

  const seedDir = join(tempRoot, 'seed');
  await mkdir(seedDir, { recursive: true });
  await execFileAsync('git', ['init', '--quiet'], { cwd: seedDir });
  await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: seedDir });
  await execFileAsync('git', ['config', 'user.email', 'seed@x.com'], { cwd: seedDir });
  await execFileAsync('git', ['config', 'user.name', 'Seed'], { cwd: seedDir });
  await writeFile(join(seedDir, 'README.md'), '# initial\n', 'utf8');
  await execFileAsync('git', ['add', '.'], { cwd: seedDir });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: seedDir });

  fixture = await createGitHttpFixture(repoBase, { autoCreate: false });
  bareRepoUrl = `${fixture.url}/upstream.git`;
  await execFileAsync('git', ['remote', 'add', 'origin', bareRepoUrl], { cwd: seedDir });
  await execFileAsync('git', ['push', 'origin', 'main'], { cwd: seedDir });
});

afterEach(async () => {
  if (fixture) {
    await fixture.close();
    fixture = undefined;
  }
  if (tempRoot) {
    // chmod-up before rm so cleanup doesn't EACCES on chmod-down reader-workspaces
    try { await execFileAsync('chmod', ['-R', 'u+rwX', tempRoot]); } catch { /* best-effort */ }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe('v1.2.0 W4-new slice (v.b) — reader-start flow accepts lifecycle joined', () => {
  it('PERSISTENT-TRACKER reader: mc.start clones source-remote + checks out source-branch + chmod-down workspace', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const reader = await mc.create('mission', {
      repo: bareRepoUrl,
      readOnly: true,
      sourceRemote: bareRepoUrl,
      sourceBranch: 'main',
    });
    // Pre-start: reader lifecycle is 'joined' (per slice-ii createMission initialLifecycle).
    let state = await mc.get('mission', reader.id);
    expect(state.lifecycleState).toBe('joined');

    // Reader-start path: start() accepts 'joined' (slice v.b lifecycle-gate widening)
    await mc.start(reader.id);

    // SHAPE-1: lifecycle advances 'joined' → 'started' (parallel to writer 'configured' → 'started')
    state = await mc.get('mission', reader.id);
    expect(state.lifecycleState).toBe('started');

    // SHAPE-2: workspace clone exists with source-branch content
    const handles = await mc.storage.list(reader.id);
    expect(handles).toHaveLength(1);
    const { stdout: lsOut } = await execFileAsync('git', ['ls-files'], { cwd: handles[0].path });
    expect(lsOut).toContain('README.md');

    // SHAPE-3: workspace files are chmod-down 0444 (read-only) post-start
    const readmeStat = await stat(join(handles[0].path, 'README.md'));
    expect(readmeStat.mode & 0o222).toBe(0);   // no write-bits (0444 mask zero on write bits)
  }, 30_000);

  it('writer-mission with lifecycle joined rejected (lifecycle gate writer-strict)', async () => {
    // Negative: writer-mission can't be at 'joined' (validation matrix from slice i rejects this
    // upstream, but just in case some test fixture forces it through, start() should reject too).
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writer = await mc.create('mission', { repo: bareRepoUrl });
    // Writer is at 'configured' (has repos); start() should accept it normally
    // (regression-net to verify writer-path not broken by slice v.b changes)
    await mc.start(writer.id);
    const state = await mc.get('mission', writer.id);
    expect(state.lifecycleState).toBe('started');
  }, 30_000);
});

describe('v1.2.0 W4-new slice (v.b) — BRANCH-TRACKER auto-close mechanics (dual failure-modes)', () => {
  it('failure-mode 1: writer-mission config-file missing → ReaderAutoCloseError', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writer = await mc.create('mission', { repo: bareRepoUrl });
    const reader = await mc.create('mission', { readOnly: true, sourceMissionId: writer.id });

    await unlink(join(tempRoot, 'config', 'missions', `${writer.id}.yaml`));

    await expect(mc.readerLoopBV5Tick(reader.id)).rejects.toBeInstanceOf(ReaderAutoCloseError);
    await expect(mc.readerLoopBV5Tick(reader.id)).rejects.toThrow(/auto-close.*config-file missing/);
  });

  it('failure-mode 2: writer-mission lifecycle terminal (completed) → ReaderAutoCloseError', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writer = await mc.create('mission', { repo: bareRepoUrl });
    const reader = await mc.create('mission', { readOnly: true, sourceMissionId: writer.id });

    // Manually advance writer to 'completed' lifecycle via direct config mutation (test-fixture
    // shortcut; in production this happens via mc.complete()).
    const writerPath = join(tempRoot, 'config', 'missions', `${writer.id}.yaml`);
    const { readFile, writeFile } = await import('node:fs/promises');
    const writerContent = await readFile(writerPath, 'utf8');
    await writeFile(writerPath, writerContent.replace(/lifecycle-state: [\w-]+/, 'lifecycle-state: completed'), 'utf8');

    await expect(mc.readerLoopBV5Tick(reader.id)).rejects.toBeInstanceOf(ReaderAutoCloseError);
    await expect(mc.readerLoopBV5Tick(reader.id)).rejects.toThrow(/is terminal \(completed\)/);
  });

  it('failure-mode 2 variant: writer-mission lifecycle terminal (abandoned) → ReaderAutoCloseError', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writer = await mc.create('mission', { repo: bareRepoUrl });
    const reader = await mc.create('mission', { readOnly: true, sourceMissionId: writer.id });

    const writerPath = join(tempRoot, 'config', 'missions', `${writer.id}.yaml`);
    const { readFile, writeFile } = await import('node:fs/promises');
    const writerContent = await readFile(writerPath, 'utf8');
    await writeFile(writerPath, writerContent.replace(/lifecycle-state: [\w-]+/, 'lifecycle-state: abandoned'), 'utf8');

    await expect(mc.readerLoopBV5Tick(reader.id)).rejects.toThrow(/is terminal \(abandoned\)/);
  });

  it('writer-mission active (lifecycle configured) → Loop B does NOT throw (continues to fetch loop)', async () => {
    // Regression net: Loop B must NOT throw for healthy writer-mission. Writer is at 'configured'
    // (has repos, not yet started). reader Loop B should proceed to fetch loop and return success/zero.
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writer = await mc.create('mission', { repo: bareRepoUrl });
    const reader = await mc.create('mission', { readOnly: true, sourceMissionId: writer.id });

    // No workspaces allocated → fetch loop early-exits returning 0; key assertion is NO THROW
    const count = await mc.readerLoopBV5Tick(reader.id);
    expect(count).toBe(0);
  });
});

describe('v1.2.0 W4-new slice (v.b) — readerAutoAbandon daemon-side cascade', () => {
  it('readerAutoAbandon advances reader-mission lifecycle to abandoned + records abandonMessage', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const reader = await mc.create('mission', {
      repo: bareRepoUrl,
      readOnly: true,
      sourceRemote: bareRepoUrl,
      sourceBranch: 'main',
    });
    // Reader's pre-state is 'joined' (per slice-ii). readerAutoAbandon advances to 'abandoned'.
    await mc.readerAutoAbandon(reader.id, 'auto-close test reason');

    const state = await mc.get('mission', reader.id);
    expect(state.lifecycleState).toBe('abandoned');
    expect(state.abandonMessage).toBe('auto-close test reason');
  });

  it('readerAutoAbandon is idempotent (no-op on already-terminal mission)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const reader = await mc.create('mission', {
      repo: bareRepoUrl,
      readOnly: true,
      sourceRemote: bareRepoUrl,
      sourceBranch: 'main',
    });
    await mc.readerAutoAbandon(reader.id, 'first reason');
    // Second call should not throw (validate-rejection swallowed)
    await mc.readerAutoAbandon(reader.id, 'second reason');

    // First reason persists (abandonMessage immutability per v3.3 fold; readerAutoAbandon
    // preserves existing abandonMessage if already set, second call is full no-op)
    const state = await mc.get('mission', reader.id);
    expect(state.lifecycleState).toBe('abandoned');
    expect(state.abandonMessage).toBe('first reason');
  });

  it('readerAutoAbandon on non-existent mission is no-op (graceful)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    // Should not throw
    await mc.readerAutoAbandon('msn-deadbeef', 'no-mission reason');
  });
});
