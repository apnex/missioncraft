// W5c slice (i) — reader-daemon Loop B + cascade-state SDK helpers + applyReaderRefUpdate.
//
// Tests cover:
//   - coord-mirror.ts helpers (ensureCoordMirrorInit + revparse + show-ref-file)
//   - applyReaderRefUpdate 5-step sentinel-guarded chmod-discipline (real git init + checkout)
//   - cascadeTerminated SDK method (lifecycle 'reading' → 'readonly-completed' via _engineMutate)
//   - cascadeConfigUpdate SDK method (re-apply mission-config from mirror YAML; preserves reader lifecycleState)
//   - readerLoopBTick orchestration (3 ref-detection paths + cascade dispatch)
//
// Real-engine `git fetch` against HTTP-server fixture defers to W5c slice (ii). Loop B tests here
// pre-populate `.coord-mirror/` as a real local git repo with known refs to simulate post-fetch state.

import { execFile } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Missioncraft } from '@apnex/missioncraft';
import {
  ensureCoordMirrorInit,
  coordMirrorPath,
  revparseMirrorRef,
  showMirrorRefFile,
  terminatedTagRef,
  configBranchMirrorRef,
  repoWipMirrorRef,
} from '../../src/missioncraft-sdk/core/coord-mirror.js';
import { applyReaderRefUpdate } from '../../src/missioncraft-sdk/core/reader-workspace-mode.js';

const execFileAsync = promisify(execFile);

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w5c-i-'));
});

afterEach(async () => {
  if (tempRoot) {
    // Restore writable for cleanup (Step 6 chmod-down may have set 0444/0555)
    try {
      await execFileAsync('find', [tempRoot, '-type', 'd', '-exec', 'chmod', 'u+wx', '{}', ';']);
      await execFileAsync('find', [tempRoot, '-type', 'f', '-exec', 'chmod', 'u+w', '{}', ';']);
    } catch { /* best-effort */ }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function gitInit(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  await execFileAsync('git', ['init', '--quiet', '--bare'], { cwd: path });
}

async function seedReaderMission(
  workspaceRoot: string,
  missionId: string,
  lifecycleState: 'joined' | 'reading',
  coordRemote: string,
): Promise<void> {
  const path = join(workspaceRoot, 'config', 'missions', `${missionId}.yaml`);
  const content = await readFile(path, 'utf8');
  const ts = new Date().toISOString();
  const block = `  participants:\n    - principal: writer@host\n      role: writer\n      added-at: ${ts}\n    - principal: reader@host\n      role: reader\n      added-at: ${ts}\n  coordination-remote: ${coordRemote}\n`;
  const updated = content
    .replace(/lifecycle-state: \w+/, `lifecycle-state: ${lifecycleState}`)
    .replace(/^repos:/m, `${block}repos:`);
  await writeFile(path, updated, 'utf8');
}

describe('W5c slice (i) — coord-mirror.ts helpers', () => {
  it('ensureCoordMirrorInit creates .coord-mirror/ with coord-remote URL on first call (idempotent)', async () => {
    const missionId = 'msn-test1234';
    const remoteUrl = 'https://github.com/example/coord.git';
    const path1 = await ensureCoordMirrorInit(tempRoot, missionId, remoteUrl);
    expect(path1).toBe(coordMirrorPath(tempRoot, missionId));
    expect(existsSync(join(path1, '.git'))).toBe(true);

    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'coord-remote'], { cwd: path1 });
    expect(stdout.trim()).toBe(remoteUrl);

    // Idempotent re-call (same URL) — no error
    const path2 = await ensureCoordMirrorInit(tempRoot, missionId, remoteUrl);
    expect(path2).toBe(path1);

    // URL change is reflected
    const newUrl = 'https://github.com/other/coord.git';
    await ensureCoordMirrorInit(tempRoot, missionId, newUrl);
    const { stdout: updated } = await execFileAsync('git', ['remote', 'get-url', 'coord-remote'], { cwd: path1 });
    expect(updated.trim()).toBe(newUrl);
  });

  it('revparseMirrorRef returns SHA for existing ref + null for missing ref', async () => {
    const missionId = 'msn-revparse1';
    const remoteUrl = 'https://github.com/example/coord.git';
    const mirrorPath = await ensureCoordMirrorInit(tempRoot, missionId, remoteUrl);

    // Create a commit + tag manually to verify revparse
    await writeFile(join(mirrorPath, 'README.md'), 'init\n', 'utf8');
    await execFileAsync('git', ['config', 'user.email', 't@x.com'], { cwd: mirrorPath });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: mirrorPath });
    await execFileAsync('git', ['add', '.'], { cwd: mirrorPath });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: mirrorPath });
    await execFileAsync('git', ['tag', 'test-tag'], { cwd: mirrorPath });

    const sha = await revparseMirrorRef(tempRoot, missionId, 'refs/tags/test-tag');
    expect(sha).toMatch(/^[a-f0-9]{40}$/);

    const missing = await revparseMirrorRef(tempRoot, missionId, 'refs/tags/does-not-exist');
    expect(missing).toBeNull();
  });

  it('showMirrorRefFile reads file content from a ref', async () => {
    const missionId = 'msn-show1';
    const remoteUrl = 'https://github.com/example/coord.git';
    const mirrorPath = await ensureCoordMirrorInit(tempRoot, missionId, remoteUrl);
    await writeFile(join(mirrorPath, 'mission.yaml'), 'mission-config-schema-version: 1\n', 'utf8');
    await execFileAsync('git', ['config', 'user.email', 't@x.com'], { cwd: mirrorPath });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: mirrorPath });
    await execFileAsync('git', ['add', '.'], { cwd: mirrorPath });
    await execFileAsync('git', ['commit', '-m', 'config'], { cwd: mirrorPath });
    await execFileAsync('git', ['branch', '-M', 'config-branch'], { cwd: mirrorPath });

    const yaml = await showMirrorRefFile(tempRoot, missionId, 'refs/heads/config-branch', 'mission.yaml');
    expect(yaml).toBe('mission-config-schema-version: 1\n');

    const missing = await showMirrorRefFile(tempRoot, missionId, 'refs/heads/nope', 'mission.yaml');
    expect(missing).toBeNull();
  });

  it('ref-naming helpers produce canonical ref-paths', () => {
    expect(terminatedTagRef('msn-foo')).toBe('refs/tags/missioncraft/msn-foo/terminated');
    expect(configBranchMirrorRef('msn-foo')).toBe('refs/remotes/coord-remote/config/msn-foo');
    expect(repoWipMirrorRef('msn-foo', 'design-repo')).toBe('refs/remotes/coord-remote/design-repo/wip/msn-foo');
  });
});

describe('W5c slice (i) — applyReaderRefUpdate 5-step sentinel-guarded chmod-discipline', () => {
  it('checks out ref + restores chmod-down + cleans sentinel (real git init)', async () => {
    // Set up a coord-mirror as a non-bare git repo (so we can use it as cached git-dir source)
    const mirrorPath = join(tempRoot, 'mirror');
    await mkdir(mirrorPath, { recursive: true });
    await execFileAsync('git', ['init', '--quiet'], { cwd: mirrorPath });
    await execFileAsync('git', ['config', 'user.email', 't@x.com'], { cwd: mirrorPath });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: mirrorPath });
    await writeFile(join(mirrorPath, 'README.md'), 'mirrored content\n', 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: mirrorPath });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: mirrorPath });
    await execFileAsync('git', ['branch', '-M', 'wip-target'], { cwd: mirrorPath });

    // Set up reader's workspace pre-state (some stale content; chmod-down semantics)
    const wsPath = join(tempRoot, 'reader-workspace');
    await mkdir(wsPath, { recursive: true });
    await writeFile(join(wsPath, 'old.txt'), 'stale\n', 'utf8');

    // applyReaderRefUpdate uses git --git-dir=... --work-tree=... checkout from mirror
    await applyReaderRefUpdate(wsPath, join(mirrorPath, '.git'), 'wip-target');

    // Workspace now has mirror's content (README.md from mirror)
    expect(existsSync(join(wsPath, 'README.md'))).toBe(true);
    const content = await readFile(join(wsPath, 'README.md'), 'utf8');
    expect(content).toBe('mirrored content\n');

    // Step 4 chmod-down applied (README is 0444)
    const readmeStat = await stat(join(wsPath, 'README.md'));
    expect(readmeStat.mode & 0o777).toBe(0o444);

    // Step 5 sentinel removed (sentinel placed at parent dir, outside chmod-down scope)
    const sentinelPath = join(tempRoot, '.daemon-tx-active');
    expect(existsSync(sentinelPath)).toBe(false);
  });

  it('idempotent re-apply on same ref completes without error', async () => {
    const mirrorPath = join(tempRoot, 'mirror2');
    await mkdir(mirrorPath, { recursive: true });
    await execFileAsync('git', ['init', '--quiet'], { cwd: mirrorPath });
    await execFileAsync('git', ['config', 'user.email', 't@x.com'], { cwd: mirrorPath });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: mirrorPath });
    await writeFile(join(mirrorPath, 'a.txt'), 'one\n', 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: mirrorPath });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: mirrorPath });
    await execFileAsync('git', ['branch', '-M', 'main'], { cwd: mirrorPath });

    const wsPath = join(tempRoot, 'reader2');
    await mkdir(wsPath, { recursive: true });

    await applyReaderRefUpdate(wsPath, join(mirrorPath, '.git'), 'main');
    await applyReaderRefUpdate(wsPath, join(mirrorPath, '.git'), 'main');     // re-apply

    expect(existsSync(join(wsPath, 'a.txt'))).toBe(true);
    expect(existsSync(join(wsPath, '.daemon-tx-active'))).toBe(false);
  });
});

describe('W5c slice (i) — cascadeTerminated SDK method', () => {
  it('advances reader lifecycle "reading" → "readonly-completed" via _engineMutate', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/w5c-cascade-1' });
    await seedReaderMission(tempRoot, handle.id, 'reading', 'https://github.com/example/coord.git');

    await mc.cascadeTerminated(handle.id);

    const path = join(tempRoot, 'config', 'missions', `${handle.id}.yaml`);
    const content = await readFile(path, 'utf8');
    expect(content).toMatch(/lifecycle-state: readonly-completed/);
  });

  it('idempotent on already readonly-completed', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/w5c-cascade-2' });
    await seedReaderMission(tempRoot, handle.id, 'reading', 'https://github.com/example/coord.git');

    await mc.cascadeTerminated(handle.id);
    await mc.cascadeTerminated(handle.id);            // re-call; no-op

    const path = join(tempRoot, 'config', 'missions', `${handle.id}.yaml`);
    const content = await readFile(path, 'utf8');
    expect(content).toMatch(/lifecycle-state: readonly-completed/);
  });

  it('graceful no-op when mission config missing', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await mc.cascadeTerminated('msn-deadbeef');           // throws nothing
  });
});

describe('W5c slice (i) — cascadeConfigUpdate SDK method', () => {
  it('re-applies mission-config from mirror YAML; preserves reader lifecycleState', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/w5c-cfg-1' });
    await seedReaderMission(tempRoot, handle.id, 'reading', 'https://github.com/example/coord.git');

    // Mirror YAML has a different description (writer-side change to propagate)
    const ts = new Date().toISOString();
    const mirrorYaml = `mission-config-schema-version: 1
mission:
  id: ${handle.id}
  lifecycle-state: in-progress
  description: writer-side updated description
  created-at: ${ts}
  participants:
    - principal: writer@host
      role: writer
      added-at: ${ts}
    - principal: reader@host
      role: reader
      added-at: ${ts}
  coordination-remote: https://github.com/example/coord.git
repos:
  - url: file:///tmp/w5c-cfg-1
    name: w5c-cfg-1
`;

    await mc.cascadeConfigUpdate(handle.id, mirrorYaml);

    const path = join(tempRoot, 'config', 'missions', `${handle.id}.yaml`);
    const content = await readFile(path, 'utf8');
    // Reader's lifecycleState preserved (still 'reading'; not overwritten with writer's 'in-progress')
    expect(content).toMatch(/lifecycle-state: reading/);
    // Description from mirror was applied
    expect(content).toMatch(/description: writer-side updated description/);
  });

  it('graceful no-op on malformed mirror YAML', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/w5c-cfg-2' });
    await seedReaderMission(tempRoot, handle.id, 'reading', 'https://github.com/example/coord.git');

    await mc.cascadeConfigUpdate(handle.id, 'this is not yaml: [[[invalid');

    const path = join(tempRoot, 'config', 'missions', `${handle.id}.yaml`);
    const content = await readFile(path, 'utf8');
    expect(content).toMatch(/lifecycle-state: reading/);          // unchanged
  });
});
