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
});
