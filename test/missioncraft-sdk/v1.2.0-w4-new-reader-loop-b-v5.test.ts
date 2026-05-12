// v1.2.0 W4-new slice (v) — Reader-daemon Loop B v5.0 (core: fetch + reset for v5.0 reader-mission).
//
// Architect-spec per task-408 §6 component-change 5: `git fetch source-remote source-branch:
// refs/remotes/source/source-branch` + `git reset --hard refs/remotes/source/source-branch` at
// pullCadence. v5.0 reader-mission (BRANCH-TRACKER OR PERSISTENT-TRACKER) detection via
// `config.mission.readOnly === true`.
//
// SHAPE assertions per calibration #72:
// - readerLoopBV5Tick no-op for writer-missions (readOnly false/undefined)
// - PERSISTENT-TRACKER: fetch+reset against sourceRemote+sourceBranch directly
// - BRANCH-TRACKER: resolve writer-mission's repos[0].url + refs/heads/mission/<writer-id>
// - successCount reflects per-repo fetch-and-reset outcomes
// - Writer-mission deletion: BRANCH-TRACKER reader Loop B returns 0 (auto-close polish deferred)
//
// Slice (v) core scope: detection + new Loop B method. Workspace 0444 chmod + full auto-close
// (with daemon SIGTERM-self on writer-terminal) deferred to slice-(v) extension.

import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Missioncraft } from '@apnex/missioncraft';
import { createGitHttpFixture, type GitHttpFixture } from '../fixtures/git-http-fixture.js';

const execFileAsync = promisify(execFile);

let tempRoot: string;
let fixture: GitHttpFixture | undefined;
let bareDir: string;
let bareRepoUrl: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w4-loop-b-v5-'));
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
    // mission-78 W4-new slice (v.b): Loop B chmod-down may leave reader-workspaces at 0444/0555.
    // chmod-up before rm so cleanup doesn't EACCES on read-only directories.
    try { await execFileAsync('chmod', ['-R', 'u+rwX', tempRoot]); } catch { /* best-effort */ }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe('v1.2.0 W4-new slice (v) — readerLoopBV5Tick: no-op + dispatch coverage', () => {
  it('returns 0 for writer-mission (readOnly undefined; no-op gate)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: bareRepoUrl });
    const count = await mc.readerLoopBV5Tick(handle.id);
    expect(count).toBe(0);
  });

  it('returns 0 for non-existent mission (graceful early-exit)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const count = await mc.readerLoopBV5Tick('msn-deadbeef');
    expect(count).toBe(0);
  });

  it('PERSISTENT-TRACKER reader: fetch+reset against sourceRemote+sourceBranch updates workspace', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });

    // Create reader-mission (PERSISTENT-TRACKER). NOTE: mc.start(reader.id) flow is writer-only at
    // v5.0 slice (v); reader-start substrate (clone source-remote + checkout source-branch +
    // spawn reader-daemon) is sub-slice (v.b) or slice (vi) territory. For Loop B unit testing,
    // manually allocate + clone the workspace to exercise the fetch+reset semantic directly.
    const reader = await mc.create('mission', {
      repo: bareRepoUrl,
      readOnly: true,
      sourceRemote: bareRepoUrl,
      sourceBranch: 'main',
    });
    const ws = await mc.storage.allocate(reader.id, bareRepoUrl);
    await execFileAsync('git', ['clone', '--quiet', bareRepoUrl, ws.path]);

    // Upstream advances with a new file
    const seedDir = join(tempRoot, 'seed');
    await writeFile(join(seedDir, 'after-tick.md'), 'post-tick content\n', 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: seedDir });
    await execFileAsync('git', ['commit', '-m', 'after-tick'], { cwd: seedDir });
    await execFileAsync('git', ['push', 'origin', 'main'], { cwd: seedDir });

    // Tick — Loop B fetches new ref + resets workspace tree
    const count = await mc.readerLoopBV5Tick(reader.id);
    expect(count).toBe(1);

    // SHAPE: reader workspace now contains the upstream-added file (reset --hard sync'd tree)
    const { stdout: lsOut } = await execFileAsync('git', ['ls-files'], { cwd: ws.path });
    expect(lsOut).toContain('after-tick.md');
  }, 30_000);

  it('BRANCH-TRACKER reader with deleted writer-mission throws ReaderAutoCloseError (slice-v.b auto-close)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });

    // mission-78 W4-new slice (v.b): writer-mission config-missing is auto-close failure-mode 1.
    // Loop B throws ReaderAutoCloseError → watcher-entry catches → atomic lifecycle advance to
    // 'abandoned' via readerAutoAbandon + SIGTERM-self (test coverage for the daemon-side cascade
    // is in v1.2.0-w4-new-reader-auto-close.test.ts; here we verify the throw-from-Loop B path).
    const writer = await mc.create('mission', { repo: bareRepoUrl });
    const reader = await mc.create('mission', { readOnly: true, sourceMissionId: writer.id });
    await unlink(join(tempRoot, 'config', 'missions', `${writer.id}.yaml`));
    await expect(mc.readerLoopBV5Tick(reader.id)).rejects.toThrow(/auto-close.*config-file missing/);
  });
});
