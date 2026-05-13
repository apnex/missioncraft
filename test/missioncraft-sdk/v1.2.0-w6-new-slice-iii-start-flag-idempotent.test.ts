// v1.2.0 W6-new slice (iii) — `--start` flag on creation-verbs + idempotent mc.start semantic.
//
// Per architect-disposition (a) sequential composition + idempotent-flag thread-550 round 4:
// - `msn create/join/watch --start` flag opts into immediate daemon-spawn post-creation
//   (Hub-integration-friendly; sequential mc.create + mc.start composition at CLI layer)
// - `msn <id> start` always passes `idempotent: true` to mc.start (graceful no-op when daemon
//   already running; replaces dropped `msn <id> resume` verb from v1.x)
// - mc.start gains `idempotent?: boolean` opt-param (SDK-level); when true + lifecycle in
//   {'started', 'in-progress'}, returns existing handle without throw (lifecycle-gate skipped)
//
// SHAPE assertions per calibration #72: assert idempotent behavior + post-`--start` lifecycle
// state + handle return-shape.

import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Missioncraft, MissionStateError } from '@apnex/missioncraft';
import { createGitHttpFixture, type GitHttpFixture } from '../fixtures/git-http-fixture.js';

const execFileAsync = promisify(execFile);
let tempRoot: string;
let fixture: GitHttpFixture | undefined;
let bareDir: string;
let bareRepoUrl: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w6-iii-'));
  const repoBase = join(tempRoot, 'origin-repos');
  bareDir = join(repoBase, 'sandbox.git');
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
  bareRepoUrl = `${fixture.url}/sandbox.git`;
  await execFileAsync('git', ['remote', 'add', 'origin', bareRepoUrl], { cwd: seedDir });
  await execFileAsync('git', ['push', 'origin', 'main'], { cwd: seedDir });
});

afterEach(async () => {
  if (fixture) { await fixture.close(); fixture = undefined; }
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('v1.2.0 W6-new slice (iii) — idempotent mc.start', () => {
  it('mc.start with idempotent: true on already-started mission returns handle without throw', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writer = await mc.create('mission', { repo: bareRepoUrl });
    await mc.start(writer.id);                                                          // first start

    // Second mc.start call with idempotent: true on already-started → graceful no-op
    const handle = await mc.start(writer.id, { idempotent: true });
    expect(handle.id).toBe(writer.id);
  }, 30_000);

  it('mc.start WITHOUT idempotent on already-started mission throws MissionStateError (default behavior preserved)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writer = await mc.create('mission', { repo: bareRepoUrl });
    await mc.start(writer.id);

    // Second mc.start without idempotent flag → throws
    await expect(mc.start(writer.id)).rejects.toBeInstanceOf(MissionStateError);
    await expect(mc.start(writer.id)).rejects.toThrow(/requires lifecycle 'configured'/);
  }, 30_000);

  it('mc.start with idempotent: true on never-started mission still spawns daemon (idempotent semantic only no-ops on already-running)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writer = await mc.create('mission', { repo: bareRepoUrl });

    // First mc.start with idempotent: true on lifecycle 'configured' → normal start path; lifecycle advances
    const handle = await mc.start(writer.id, { idempotent: true });
    expect(handle.id).toBe(writer.id);

    const state = await mc.get('mission', writer.id);
    expect(state.lifecycleState).toMatch(/^(started|in-progress)$/);
  }, 30_000);

  it('mc.start with idempotent: true on terminal mission (completed) STILL throws (terminal-state preserves error)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writer = await mc.create('mission', { repo: bareRepoUrl });
    // Manually advance to 'completed' (test-shortcut)
    const configPath = join(tempRoot, 'config', 'missions', `${writer.id}.yaml`);
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(configPath, 'utf8');
    await writeFile(configPath, content.replace(/lifecycle-state: [\w-]+/, 'lifecycle-state: completed'), 'utf8');

    // mc.start with idempotent: true on 'completed' → still throws (idempotent only covers
    // 'started'/'in-progress'; terminal states are operator-DX-explicit-error)
    await expect(mc.start(writer.id, { idempotent: true })).rejects.toBeInstanceOf(MissionStateError);
  });

  it('mc.start returns handle.name when mission has name (idempotent path preserves name)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writer = await mc.create('mission', { name: 'alpha-mission', repo: bareRepoUrl });
    await mc.start(writer.id);

    const handle = await mc.start(writer.id, { idempotent: true });
    expect(handle.id).toBe(writer.id);
    expect(handle.name).toBe('alpha-mission');
  }, 30_000);
});
