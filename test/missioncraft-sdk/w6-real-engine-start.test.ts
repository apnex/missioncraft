// W6 slice (i) — real-engine start() happy-path integration test (W4.4-deferred carry-over #1).
//
// Replaces the NOTE-marker `start-daemon-integration.test.ts:76` with end-to-end real-engine
// start() exercising the full 9-step configured→started→in-progress flow against a
// node-git-server@1.0.0 HTTP-server fixture.
//
// Per task-401 deliverable: "real-engine start() HTTP-server fixture" — covers Step 4
// gitEngine.clone path that was substrate-bypassed in W4.3 slice (iv) + W4.4 slice (iv) tests
// (isomorphic-git supports HTTP transport but not file:// URLs).

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Missioncraft } from '@apnex/missioncraft';
import { createGitHttpFixture, type GitHttpFixture } from '../fixtures/git-http-fixture.js';

const execFileAsync = promisify(execFile);

let tempRoot: string;
let fixture: GitHttpFixture | undefined;
let bareRepoUrl: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w6-i-start-'));
  // Pre-create a bare repo with one commit (the upstream "default branch") at the fixture
  const repoBase = join(tempRoot, 'origin-repos');
  const bareDir = join(repoBase, 'upstream.git');
  await mkdir(bareDir, { recursive: true });
  await execFileAsync('git', ['init', '--quiet', '--bare'], { cwd: bareDir });
  await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: bareDir });

  // Push initial commit from a scratch dir so the bare repo has a HEAD ref
  const seedDir = join(tempRoot, 'seed');
  await mkdir(seedDir, { recursive: true });
  await execFileAsync('git', ['init', '--quiet'], { cwd: seedDir });
  await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: seedDir });
  await execFileAsync('git', ['config', 'user.email', 'seed@x.com'], { cwd: seedDir });
  await execFileAsync('git', ['config', 'user.name', 'Seed'], { cwd: seedDir });
  await writeFile(join(seedDir, 'README.md'), '# upstream-content\n', 'utf8');
  await execFileAsync('git', ['add', '.'], { cwd: seedDir });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: seedDir });

  fixture = await createGitHttpFixture(repoBase, { autoCreate: false });
  bareRepoUrl = `${fixture.url}/upstream.git`;

  // Push seed → bare via fixture
  await execFileAsync('git', ['remote', 'add', 'origin', bareRepoUrl], { cwd: seedDir });
  await execFileAsync('git', ['push', 'origin', 'main'], { cwd: seedDir });
});

afterEach(async () => {
  if (fixture) {
    await fixture.close();
    fixture = undefined;
  }
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('W6 slice (i) — real-engine start() happy-path (W4.4-deferred carry-over)', () => {
  it('start() clones from HTTP fixture + advances lifecycle to "started" + workspace populated', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: bareRepoUrl });

    // Pre-state: 'configured' (single repo via mc.create)
    const before = await mc.get('mission', handle.id);
    expect(before.lifecycleState).toBe('configured');

    // start() runs: validate → lock → allocate → CLONE (real-engine via HTTP fixture) →
    // _engineMutate 'configured' → 'started' → spawnDaemonWatcher → release locks
    const startedHandle = await mc.start(handle.id);
    expect(startedHandle.id).toBe(handle.id);

    // Lifecycle advanced to 'started' (transient; daemon-tick would advance to 'in-progress')
    const after = await mc.get('mission', handle.id);
    expect(after.lifecycleState).toBe('started');

    // Workspace populated via real clone from fixture (README.md from upstream seed)
    const handles = await mc.storage.list(handle.id);
    expect(handles.length).toBe(1);
    expect(existsSync(join(handles[0].path, 'README.md'))).toBe(true);
    const content = await readFile(join(handles[0].path, 'README.md'), 'utf8');
    expect(content).toBe('# upstream-content\n');
  }, 30_000);  // 30s timeout for clone + spawn + unwind

  it('start() rejects pre-state validation if mission is not "configured"', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission');                   // no repo → 'created' state
    await expect(mc.start(handle.id)).rejects.toThrow(/requires lifecycle 'configured'/);
  });

  // SD3 regression (v1.0.2): mission-lockfile must PERSIST after start() with daemon-IPC fields
  // (pid/startTime/daemonExpiresAt) populated. Pre-fix, start() Step 8 unconditionally released
  // the missionLock — unlinking the lockfile + losing daemon-IPC state. Per Design v4.9 §2.6.5,
  // the lockfile is dual-purposed: start()-mutex AND daemon-watcher IPC channel; lifecycle =
  // mission-active duration, cleaned by complete()/abandon().
  it('SD3 regression — mission-lockfile persists post-start() with daemon-IPC fields populated', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: bareRepoUrl });

    await mc.start(handle.id);

    // Lockfile must exist at locks/missions/<id>.lock
    const lockfilePath = join(tempRoot, 'locks', 'missions', `${handle.id}.lock`);
    expect(existsSync(lockfilePath)).toBe(true);

    // Lockfile content must include daemon-IPC fields written by spawnDaemonWatcher
    const lockfileContent = JSON.parse(await readFile(lockfilePath, 'utf8'));
    expect(lockfileContent.missionId).toBe(handle.id);
    expect(typeof lockfileContent.pid).toBe('number');
    expect(lockfileContent.pid).toBeGreaterThan(0);
    expect(typeof lockfileContent.startTime).toBe('number');
    expect(lockfileContent.startTime).toBeGreaterThan(0);
    expect(typeof lockfileContent.daemonExpiresAt).toBe('number');

    // Cleanup: kill daemon to prevent test-leak (afterEach rm'd tempRoot would orphan otherwise)
    try { process.kill(lockfileContent.pid, 'SIGKILL'); } catch { /* daemon may already be gone */ }
  }, 30_000);

  // SD2 regression (v1.0.2 slice (ii)): `msn abandon` must SIGTERM the daemon spawned by start().
  // Pre-fix: lockfile was empty during mission-active (SD3) → abandon's terminateDaemon no-op'd →
  // daemon orphaned (operator manual `kill` required). Post-slice-(i)+(i.5) fix: lockfile persists
  // with daemon-pid via slice (i); abandon inherits the lockfile via slice (i.5) → SIGTERM fires
  // via inherited-pid → daemon shuts down cleanly + lockfile cleaned up.
  //
  // Test timeout: 90s. terminateDaemon's default 60s SIGTERM-poll + SIGKILL fallback ensures
  // daemon dies even if SIGTERM-handler hangs; clone+start setup adds ~5s; abandon completes
  // in <1s when daemon's SIGTERM-handler works (ad-hoc smoke-test verified).
  it('SD2 regression — abandon() SIGTERMs daemon spawned by start() (daemon process exits)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: bareRepoUrl });

    await mc.start(handle.id);
    const lockfilePath = join(tempRoot, 'locks', 'missions', `${handle.id}.lock`);
    const lockfileContent = JSON.parse(await readFile(lockfilePath, 'utf8'));
    const daemonPid = lockfileContent.pid;

    // Pre-abandon: daemon is alive
    expect(() => process.kill(daemonPid, 0)).not.toThrow();

    // abandon() — must SIGTERM daemon via inherited lockfile-pid (slice (i.5) substrate)
    const result = await mc.abandon(handle.id, 'sd2-regression-test');
    expect(result.lifecycleState).toBe('abandoned');

    // Post-abandon: daemon is dead. Poll briefly for async shutdown completion.
    let daemonAlive = true;
    for (let i = 0; i < 50; i++) {
      try {
        process.kill(daemonPid, 0);
        await new Promise((r) => setTimeout(r, 100));
      } catch {
        daemonAlive = false;
        break;
      }
    }
    expect(daemonAlive).toBe(false);

    // Lockfile cleaned up post-abandon
    expect(existsSync(lockfilePath)).toBe(false);
  }, 90_000);
});
