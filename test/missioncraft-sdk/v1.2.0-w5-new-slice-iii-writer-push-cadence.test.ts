// v1.2.0 W5-new slice (iii) — Writer-daemon push-cadence integration.
//
// Architect-disposition (β) thread-548 round 5: independent setInterval timer at
// pushIntervalSeconds firing `git push origin refs/heads/mission/<id>` per repo when
// pushCadence === 'every-Ns' (default). 'on-complete-only' + 'on-demand' gate timer OFF.
// Per Design v5.0 §10.2 + §10.5 (asymmetric push 60s + pull 30s defaults).
//
// Two test layers per calibration #74 daemon-dispatch transparency-gate discipline:
// - SDK-direct: pushMissionBranchToUpstream behavioral tests (push-shape + reader no-op +
//   terminal no-op + per-repo failure non-aborting)
// - Daemon-dispatch: detectWriterPushCadence helper tests (cadence-config-derivation; gate-state
//   derivation; default-fallback behavior) — exercises FROM daemon entry-point semantic, not
//   just SDK calls.

import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Missioncraft } from '@apnex/missioncraft';
import { detectWriterPushCadence } from '../../src/missioncraft-sdk/core/daemon/daemon-mode-detect.js';
import { createGitHttpFixture, type GitHttpFixture } from '../fixtures/git-http-fixture.js';

const execFileAsync = promisify(execFile);

let tempRoot: string;
let fixture: GitHttpFixture | undefined;
let bareDir: string;
let bareRepoUrl: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w5-iii-'));
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
  if (fixture) {
    await fixture.close();
    fixture = undefined;
  }
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('v1.2.0 W5-new slice (iii) — pushMissionBranchToUpstream (SDK-direct)', () => {
  it('pushes mission/<id> to upstream + returns successCount = 1 for single-repo writer', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: bareRepoUrl });
    await mc.start(handle.id);

    // mc.start clones the repo + creates mission/<id> branch locally; no push to upstream yet.
    // Verify upstream has NO mission/<id> branch pre-call.
    const { stdout: refsBefore } = await execFileAsync('git', ['for-each-ref', '--format=%(refname)'], { cwd: bareDir });
    expect(refsBefore).not.toContain(`refs/heads/mission/${handle.id}`);

    // Trigger push-cadence
    const successCount = await mc.pushMissionBranchToUpstream(handle.id);
    expect(successCount).toBe(1);

    // SHAPE: upstream now has mission/<id>
    const { stdout: refsAfter } = await execFileAsync('git', ['for-each-ref', '--format=%(refname)'], { cwd: bareDir });
    expect(refsAfter).toContain(`refs/heads/mission/${handle.id}`);
  }, 30_000);

  it('reader-mission (readOnly) returns 0 (no-op; readers have no mission-branch to push)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const reader = await mc.create('mission', {
      repo: bareRepoUrl,
      readOnly: true,
      sourceRemote: bareRepoUrl,
      sourceBranch: 'main',
    });
    const successCount = await mc.pushMissionBranchToUpstream(reader.id);
    expect(successCount).toBe(0);
  });

  it('non-existent mission returns 0 (graceful early-exit)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const successCount = await mc.pushMissionBranchToUpstream('msn-deadbeef');
    expect(successCount).toBe(0);
  });

  it('terminal-lifecycle mission (completed) returns 0 (no-op gate)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: bareRepoUrl });

    // Manually advance to 'completed' via direct config-edit (test-fixture shortcut)
    const configPath = join(tempRoot, 'config', 'missions', `${handle.id}.yaml`);
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(configPath, 'utf8');
    await writeFile(configPath, content.replace(/lifecycle-state: \w+/, 'lifecycle-state: completed'), 'utf8');

    const successCount = await mc.pushMissionBranchToUpstream(handle.id);
    expect(successCount).toBe(0);
  });

  it('idempotent: second-call no-op push returns successCount = 1 (already-up-to-date)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: bareRepoUrl });
    await mc.start(handle.id);

    const first = await mc.pushMissionBranchToUpstream(handle.id);
    expect(first).toBe(1);

    // Second call: nothing to push, but git push origin returns success on already-up-to-date
    const second = await mc.pushMissionBranchToUpstream(handle.id);
    expect(second).toBe(1);
  }, 30_000);
});

describe('v1.2.0 W5-new slice (iii) — detectWriterPushCadence (daemon-dispatch layer; calibration #74)', () => {
  it('writer-mission with default config (no stateDurability) → enabled + intervalSeconds=60', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: bareRepoUrl });

    const detected = await detectWriterPushCadence(tempRoot, handle.id);
    expect(detected.enabled).toBe(true);
    expect(detected.intervalSeconds).toBe(60);
  });

  it('writer-mission with explicit pushCadence=every-Ns + pushIntervalSeconds=30 → enabled + intervalSeconds=30', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: bareRepoUrl });
    // Append stateDurability override
    const configPath = join(tempRoot, 'config', 'missions', `${handle.id}.yaml`);
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(configPath, 'utf8');
    await writeFile(
      configPath,
      content + '\nstate-durability:\n  push-cadence: every-Ns\n  push-interval-seconds: 30\n',
      'utf8',
    );

    const detected = await detectWriterPushCadence(tempRoot, handle.id);
    expect(detected.enabled).toBe(true);
    expect(detected.intervalSeconds).toBe(30);
  });

  it('writer-mission with pushCadence=on-complete-only → enabled=false (push-cadence timer gated OFF)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: bareRepoUrl });
    const configPath = join(tempRoot, 'config', 'missions', `${handle.id}.yaml`);
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(configPath, 'utf8');
    await writeFile(configPath, content + '\nstate-durability:\n  push-cadence: on-complete-only\n', 'utf8');

    const detected = await detectWriterPushCadence(tempRoot, handle.id);
    expect(detected.enabled).toBe(false);
  });

  it('writer-mission with pushCadence=on-demand → enabled=false (push-cadence timer gated OFF; manual API-trigger reserved)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: bareRepoUrl });
    const configPath = join(tempRoot, 'config', 'missions', `${handle.id}.yaml`);
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(configPath, 'utf8');
    await writeFile(configPath, content + '\nstate-durability:\n  push-cadence: on-demand\n', 'utf8');

    const detected = await detectWriterPushCadence(tempRoot, handle.id);
    expect(detected.enabled).toBe(false);
  });

  it('reader-mission (readOnly: true) → enabled=false (push-cadence-IRRELEVANT for readers)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const reader = await mc.create('mission', {
      repo: bareRepoUrl,
      readOnly: true,
      sourceRemote: bareRepoUrl,
      sourceBranch: 'main',
    });
    const detected = await detectWriterPushCadence(tempRoot, reader.id);
    expect(detected.enabled).toBe(false);
  });

  it('non-existent mission → enabled=false + default intervalSeconds (60) (silent-default fallback)', async () => {
    const detected = await detectWriterPushCadence(tempRoot, 'msn-deadbeef');
    expect(detected.enabled).toBe(false);
    expect(detected.intervalSeconds).toBe(60);
  });

  it('writer-mission with intervalSeconds at min boundary (10s) → enabled + intervalSeconds=10', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: bareRepoUrl });
    const configPath = join(tempRoot, 'config', 'missions', `${handle.id}.yaml`);
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(configPath, 'utf8');
    await writeFile(configPath, content + '\nstate-durability:\n  push-interval-seconds: 10\n', 'utf8');

    const detected = await detectWriterPushCadence(tempRoot, handle.id);
    expect(detected.enabled).toBe(true);
    expect(detected.intervalSeconds).toBe(10);
  });
});
