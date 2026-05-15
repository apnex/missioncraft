// W5c slice (ii) — Missioncraft.workspace(idOrCoordinate, repoName?) substrate-coordinate
// runtime-resolution tests + HTTP-server fixture smoke-test.
//
// Tests:
//   - parseSubstrateCoordinate parses 4 input shapes (mission-only, mission:repo, mission:repo/path, plain)
//   - Missioncraft.workspace() with plain mission-id (single repo / multi-repo / repoName arg)
//   - Missioncraft.workspace() with coordinate-form `<id>:<repo>` (repo lookup)
//   - Missioncraft.workspace() with coordinate-form `<id>:<repo>/<path>` (path-suffix)
//   - createGitHttpFixture starts/stops + URL is reachable + clone roundtrip via real git CLI

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Missioncraft, ConfigValidationError, MissionStateError } from '@apnex/missioncraft';
import { parseSubstrateCoordinate } from '../../src/missioncraft-sdk/core/coordinate.js';
import { createGitHttpFixture, type GitHttpFixture } from '../fixtures/git-http-fixture.js';

const execFileAsync = promisify(execFile);

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w5c-ii-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('W5c slice (ii) — parseSubstrateCoordinate', () => {
  it('returns undefined for plain mission-id (no colon)', () => {
    expect(parseSubstrateCoordinate('msn-abc12345')).toBeUndefined();
  });

  it('parses mission-only coordinate (trailing colon)', () => {
    expect(parseSubstrateCoordinate('msn-abc12345:')).toEqual({ mission: 'msn-abc12345' });
  });

  it('parses mission:repo coordinate', () => {
    expect(parseSubstrateCoordinate('msn-abc12345:design-repo')).toEqual({
      mission: 'msn-abc12345',
      repo: 'design-repo',
    });
  });

  it('parses mission:repo/path coordinate (gsutil-style)', () => {
    expect(parseSubstrateCoordinate('msn-abc12345:design-repo/src/file.ts')).toEqual({
      mission: 'msn-abc12345',
      repo: 'design-repo',
      path: 'src/file.ts',
    });
  });

  it('rejects whitespace inside coordinate with ConfigValidationError', () => {
    expect(() => parseSubstrateCoordinate('msn-abc12345:design repo')).toThrow(/whitespace inside coordinate/);
  });
});

describe('W5c slice (ii) — Missioncraft.workspace() runtime-resolution', () => {
  // v1.0.3 slice (vi): workspace() now READS existing handles via storage.list (no create-on-
  // demand); tests must pre-allocate via storage.allocate to substrate-bypass the start() step.
  it('resolves single-repo mission with plain mission-id to mission-root (bug-92)', async () => {
    // mission-82 bug-92 (Director-ratified Option A — cd-consistency): bare workspace() resolves
    // to the mission-root for BOTH single-repo and multi-repo missions, regardless of repo-count.
    // Pre-fix: bare-single auto-picked the sole repo subdir (the bug-92 inconsistency that bug-88
    // accidentally introduced when it added bare-multi → mission-root).
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/w5c-ii-1';
    const handle = await mc.create('mission', { repo: repoUrl });
    await mc.storage.allocate(handle.id, repoUrl);

    const wsPath = await mc.workspace(handle.id);
    expect(wsPath).toMatch(new RegExp(`/missions/${handle.id}$`));      // mission-root, no repo suffix
  });

  it('single-repo mission with explicit repoName arg → repo subdir (bug-92 unchanged path)', async () => {
    // bug-92 directive: bare → mission-root; named-repo still selects the specific repo subdir.
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/w5c-ii-1b';
    const handle = await mc.create('mission', { repo: repoUrl });
    await mc.storage.allocate(handle.id, repoUrl);

    const wsPath = await mc.workspace(handle.id, 'w5c-ii-1b');
    expect(wsPath).toMatch(new RegExp(`/missions/${handle.id}/w5c-ii-1b$`));
  });

  it('resolves multi-repo mission with plain mission-id to mission-root (bug-88)', async () => {
    // mission-81 slice (ii) bug-88: bare workspace() on a multi-repo mission resolves to the
    // mission-root dir (the parent containing the per-repo subdirs), not a throw. storage.allocate
    // on one repo is enough for the mission-root dir to exist on-disk.
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: ['file:///tmp/w5c-ii-2a', 'file:///tmp/w5c-ii-2b'] });
    await mc.storage.allocate(handle.id, 'file:///tmp/w5c-ii-2a');

    const wsPath = await mc.workspace(handle.id);
    expect(wsPath).toMatch(new RegExp(`/missions/${handle.id}$`));      // mission-root, no repo suffix
  });

  it('multi-repo mission with plain mission-id throws when mission-root absent (not started)', async () => {
    // bug-88 edge: if no workspace dir exists yet (mission never started / no allocate),
    // the mission-root path doesn't exist — throw a clear MissionStateError, not a stale path.
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: ['file:///tmp/w5c-ii-2c', 'file:///tmp/w5c-ii-2d'] });

    await expect(mc.workspace(handle.id)).rejects.toBeInstanceOf(MissionStateError);
    await expect(mc.workspace(handle.id)).rejects.toThrow(/mission-root not found/);
  });

  it('resolves multi-repo mission with explicit repoName arg', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: ['file:///tmp/w5c-ii-3a', 'file:///tmp/w5c-ii-3b'] });
    await mc.storage.allocate(handle.id, 'file:///tmp/w5c-ii-3b');

    const wsPath = await mc.workspace(handle.id, 'w5c-ii-3b');
    expect(wsPath).toMatch(new RegExp(`/missions/${handle.id}/w5c-ii-3b$`));
  });

  it('resolves coordinate-form `<id>:<repo>`', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: ['file:///tmp/w5c-ii-4a', 'file:///tmp/w5c-ii-4b'] });
    await mc.storage.allocate(handle.id, 'file:///tmp/w5c-ii-4a');

    const wsPath = await mc.workspace(`${handle.id}:w5c-ii-4a`);
    expect(wsPath).toMatch(new RegExp(`/missions/${handle.id}/w5c-ii-4a$`));
  });

  it('resolves coordinate-form `<id>:<repo>/<path>` with path suffix appended', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/w5c-ii-5' });
    await mc.storage.allocate(handle.id, 'file:///tmp/w5c-ii-5');

    const wsPath = await mc.workspace(`${handle.id}:w5c-ii-5/src/module.ts`);
    expect(wsPath).toMatch(new RegExp(`/missions/${handle.id}/w5c-ii-5/src/module\\.ts$`));
  });

  // idea-268 regression (v1.0.3 slice vi): terminal-state-guard
  it('idea-268 — rejects workspace lookup on abandoned mission (terminal-state-guard)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/idea-268-abandoned';
    const handle = await mc.create('mission', { repo: repoUrl });
    await mc.storage.allocate(handle.id, repoUrl);
    // Substrate-bypass: seed lifecycle directly via YAML edit (start over file:// would clone-fail)
    const path = join(tempRoot, 'config', 'missions', `${handle.id}.yaml`);
    const content = await readFile(path, 'utf8');
    await writeFile(path, content.replace(/lifecycle-state: [\w-]+/, 'lifecycle-state: abandoned'), 'utf8');

    await expect(mc.workspace(handle.id)).rejects.toThrow(
      /workspace destroyed; mission '.+' in terminal state 'abandoned'/,
    );
  });

  it('idea-268 — rejects workspace lookup on completed mission (terminal-state-guard)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const repoUrl = 'file:///tmp/idea-268-completed';
    const handle = await mc.create('mission', { repo: repoUrl });
    await mc.storage.allocate(handle.id, repoUrl);
    const path = join(tempRoot, 'config', 'missions', `${handle.id}.yaml`);
    const content = await readFile(path, 'utf8');
    await writeFile(path, content.replace(/lifecycle-state: [\w-]+/, 'lifecycle-state: completed'), 'utf8');

    await expect(mc.workspace(handle.id)).rejects.toThrow(
      /workspace destroyed; mission '.+' in terminal state 'completed'/,
    );
  });

  it('idea-268 — rejects workspace lookup when workspace dir missing (safety-net)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    // Mission created but NOT allocated — safety-net should fire (non-terminal-but-missing-workspace).
    // mission-82 bug-92: bare workspace() now resolves to mission-root, so the safety-net fires
    // at the mission-root-absent gate (not the per-repo find-handle gate). The intent — clear
    // diagnostic when the workspace doesn't exist on-disk — is preserved.
    const handle = await mc.create('mission', { repo: 'file:///tmp/idea-268-missing' });

    await expect(mc.workspace(handle.id)).rejects.toThrow(
      /mission-root not found .+ \(try 'msn start' to create the workspace\)/,
    );
  });

  it('rejects coordinate with non-existent repo', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/w5c-ii-6' });

    await expect(mc.workspace(`${handle.id}:other-repo`)).rejects.toBeInstanceOf(MissionStateError);
    await expect(mc.workspace(`${handle.id}:other-repo`)).rejects.toThrow(/repo 'other-repo' not in mission/);
  });

  it('rejects when mission config does not exist', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(mc.workspace('msn-deadbeef')).rejects.toThrow(/mission 'msn-deadbeef' not found/);
  });

  it('rejects empty idOrCoordinate', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(mc.workspace('')).rejects.toBeInstanceOf(ConfigValidationError);
  });
});

describe('W5c slice (ii) — createGitHttpFixture (node-git-server smoke-test)', () => {
  let fixture: GitHttpFixture | undefined;

  afterEach(async () => {
    if (fixture) {
      await fixture.close();
      fixture = undefined;
    }
  });

  it('starts on OS-assigned port + URL is reachable', async () => {
    const repoBase = join(tempRoot, 'repos');
    fixture = await createGitHttpFixture(repoBase);
    expect(fixture.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(fixture.repoBaseDir).toBe(repoBase);
  });

  it('clone-then-push roundtrip via real git CLI against fixture', async () => {
    const repoBase = join(tempRoot, 'repos');
    // Pre-create the bare repo manually (avoids autoCreate timing/HEAD edge-case)
    const bareDir = join(repoBase, 'test-repo.git');
    await mkdir(bareDir, { recursive: true });
    await execFileAsync('git', ['init', '--quiet', '--bare'], { cwd: bareDir });
    // git 2.25.x predates --initial-branch; rewrite HEAD ref directly
    await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: bareDir });

    fixture = await createGitHttpFixture(repoBase, { autoCreate: false });

    // Set up a source repo and push to fixture
    const srcDir = join(tempRoot, 'src');
    await mkdir(srcDir, { recursive: true });
    await execFileAsync('git', ['init', '--quiet'], { cwd: srcDir });
    await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: srcDir });
    await execFileAsync('git', ['config', 'user.email', 't@x.com'], { cwd: srcDir });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: srcDir });
    await writeFile(join(srcDir, 'README.md'), '# fixture-test\n', 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: srcDir });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: srcDir });

    const remoteUrl = `${fixture.url}/test-repo.git`;
    await execFileAsync('git', ['remote', 'add', 'fixture', remoteUrl], { cwd: srcDir });
    await execFileAsync('git', ['push', 'fixture', 'main'], { cwd: srcDir });

    // Clone from fixture into a different dir
    const cloneDir = join(tempRoot, 'clone');
    await execFileAsync('git', ['clone', remoteUrl, cloneDir]);

    expect(existsSync(join(cloneDir, 'README.md'))).toBe(true);
    const { stdout } = await execFileAsync('git', ['log', '--oneline', '-1'], { cwd: cloneDir });
    expect(stdout).toMatch(/initial/);
  }, 15_000);     // 15s timeout for HTTP-server startup + git network roundtrip
});
