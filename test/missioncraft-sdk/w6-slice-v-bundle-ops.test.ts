// W6 slice (v) — bundle-ops substrate-extension per Director (Y) directive.
//
// Tests cover:
//   1. IsomorphicGitEngine.createBundle / restoreBundle native-git shell-out primitives
//   2. snapshot.ts module helpers (snapshotRepoDir + findLatestBundle + listMissionBundles)
//   3. SDK Missioncraft.snapshotWipBranches conditional + per-repo orchestration
//   4. SDK Missioncraft.restoreFromSnapshot recovery primitive
//   5. End-to-end disk-failure recovery: rm -rf workspaceRoot → restoreFromSnapshot reconstructs

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Missioncraft, IsomorphicGitEngine } from '@apnex/missioncraft';
import {
  defaultSnapshotRoot,
  snapshotRepoDir,
  snapshotBundlePath,
  findLatestBundle,
  listMissionBundles,
  ensureSnapshotRepoDir,
} from '../../src/missioncraft-sdk/core/snapshot.js';

const execFileAsync = promisify(execFile);

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w6-v-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('W6 slice (v) — snapshot.ts module helpers', () => {
  it('defaultSnapshotRoot returns sibling-of-workspaceRoot location', () => {
    expect(defaultSnapshotRoot('/home/user/mc-ws')).toBe('/home/user/.missioncraft-snapshots');
  });

  it('snapshotRepoDir + snapshotBundlePath compose canonical paths', () => {
    expect(snapshotRepoDir('/snap', 'msn-foo', 'repo-a')).toBe('/snap/msn-foo/repo-a');
    expect(snapshotBundlePath('/snap', 'msn-foo', 'repo-a', 'abc123')).toBe('/snap/msn-foo/repo-a/abc123.bundle');
  });

  it('findLatestBundle returns null when no bundles + picks mtime-latest when present', async () => {
    const snapshotRoot = join(tempRoot, 'snap');
    expect(await findLatestBundle(snapshotRoot, 'msn-foo', 'repo-a')).toBeNull();

    await ensureSnapshotRepoDir(snapshotRoot, 'msn-foo', 'repo-a');
    await writeFile(join(snapshotRoot, 'msn-foo', 'repo-a', 'sha-old.bundle'), 'old\n', 'utf8');
    await new Promise((r) => setTimeout(r, 20));    // ensure mtime distinguishable
    await writeFile(join(snapshotRoot, 'msn-foo', 'repo-a', 'sha-new.bundle'), 'new\n', 'utf8');

    const latest = await findLatestBundle(snapshotRoot, 'msn-foo', 'repo-a');
    expect(latest).toMatch(/sha-new\.bundle$/);
  });

  it('listMissionBundles returns mtime-descending sorted list', async () => {
    const snapshotRoot = join(tempRoot, 'snap');
    await ensureSnapshotRepoDir(snapshotRoot, 'msn-foo', 'repo-a');
    await writeFile(join(snapshotRoot, 'msn-foo', 'repo-a', 'a.bundle'), 'a', 'utf8');
    await new Promise((r) => setTimeout(r, 20));
    await writeFile(join(snapshotRoot, 'msn-foo', 'repo-a', 'b.bundle'), 'b', 'utf8');
    await new Promise((r) => setTimeout(r, 20));
    await writeFile(join(snapshotRoot, 'msn-foo', 'repo-a', 'c.bundle'), 'c', 'utf8');

    const list = await listMissionBundles(snapshotRoot, 'msn-foo', 'repo-a');
    expect(list.length).toBe(3);
    expect(list[0].path).toMatch(/c\.bundle$/);
    expect(list[2].path).toMatch(/a\.bundle$/);
  });
});

describe('W6 slice (v) — IsomorphicGitEngine.createBundle / restoreBundle native-git shell-out', () => {
  it('createBundle produces a git bundle file containing the named ref + history', async () => {
    const wsPath = join(tempRoot, 'ws');
    await mkdir(wsPath, { recursive: true });
    await execFileAsync('git', ['init', '--quiet'], { cwd: wsPath });
    await execFileAsync('git', ['config', 'user.email', 't@x.com'], { cwd: wsPath });
    await execFileAsync('git', ['config', 'user.name', 'T'], { cwd: wsPath });
    await writeFile(join(wsPath, 'a.txt'), 'one\n', 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: wsPath });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: wsPath });
    await execFileAsync('git', ['branch', '-M', 'main'], { cwd: wsPath });

    const bundlePath = join(tempRoot, 'snap.bundle');
    const engine = new IsomorphicGitEngine();
    const handle = { missionId: 'msn-foo', repoUrl: 'file:///x', path: wsPath };
    const result = await engine.createBundle(handle, bundlePath, 'main');

    expect(result).toBe(bundlePath);
    expect(existsSync(bundlePath)).toBe(true);
    const fileStat = await stat(bundlePath);
    expect(fileStat.size).toBeGreaterThan(0);
  });

  it('restoreBundle unbundles a created bundle into a fresh workspace + sets the named ref', async () => {
    // Create source repo + bundle
    const srcPath = join(tempRoot, 'src');
    await mkdir(srcPath, { recursive: true });
    await execFileAsync('git', ['init', '--quiet'], { cwd: srcPath });
    await execFileAsync('git', ['config', 'user.email', 't@x.com'], { cwd: srcPath });
    await execFileAsync('git', ['config', 'user.name', 'T'], { cwd: srcPath });
    await writeFile(join(srcPath, 'data.txt'), 'restorable content\n', 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: srcPath });
    await execFileAsync('git', ['commit', '-m', 'baseline'], { cwd: srcPath });
    await execFileAsync('git', ['branch', '-M', 'wip-branch'], { cwd: srcPath });
    const { stdout: srcSha } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: srcPath });

    const bundlePath = join(tempRoot, 'restore.bundle');
    const engine = new IsomorphicGitEngine();
    const srcHandle = { missionId: 'msn-foo', repoUrl: 'file:///x', path: srcPath };
    await engine.createBundle(srcHandle, bundlePath, 'wip-branch');

    // Restore into fresh workspace
    const restorePath = join(tempRoot, 'restored');
    await mkdir(restorePath, { recursive: true });
    await execFileAsync('git', ['init', '--quiet'], { cwd: restorePath });
    const restoreHandle = { missionId: 'msn-foo', repoUrl: 'file:///x', path: restorePath };
    await engine.restoreBundle(restoreHandle, bundlePath, 'refs/heads/wip-branch');

    // Verify ref set + history accessible
    const { stdout: restoredSha } = await execFileAsync('git', ['rev-parse', 'refs/heads/wip-branch'], { cwd: restorePath });
    expect(restoredSha.trim()).toBe(srcSha.trim());

    // Checkout + verify content
    await execFileAsync('git', ['checkout', 'wip-branch'], { cwd: restorePath });
    expect(existsSync(join(restorePath, 'data.txt'))).toBe(true);
    const content = await readFile(join(restorePath, 'data.txt'), 'utf8');
    expect(content).toBe('restorable content\n');
  });
});

describe('W6 slice (v) — Missioncraft.snapshotWipBranches SDK orchestration', () => {
  it('snapshotWipBranches creates per-repo bundle at <snapshotRoot>/<missionId>/<repoName>/<sha>.bundle', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/w6-v-1' });
    const ws = await mc.storage.allocate(handle.id, 'file:///tmp/w6-v-1');

    // Create mission-branch in workspace (v5.0 single-branch)
    await execFileAsync('git', ['init', '--quiet'], { cwd: ws.path });
    await execFileAsync('git', ['config', 'user.email', 't@x.com'], { cwd: ws.path });
    await execFileAsync('git', ['config', 'user.name', 'T'], { cwd: ws.path });
    await writeFile(join(ws.path, 'work.txt'), 'work\n', 'utf8');
    await mc.gitEngine.commitToRef(ws, `refs/heads/mission/${handle.id}`, {
      message: 'wip-1',
      author: { name: 'T', email: 't@x.com' },
      autoStage: true,
    });

    const count = await mc.snapshotWipBranches(handle.id);
    expect(count).toBe(1);

    // Verify bundle landed at sibling-snapshot location
    const expectedSnapDir = join(defaultSnapshotRoot(tempRoot), handle.id, 'w6-v-1');
    expect(existsSync(expectedSnapDir)).toBe(true);
    const bundles = await listMissionBundles(defaultSnapshotRoot(tempRoot), handle.id, 'w6-v-1');
    expect(bundles.length).toBe(1);
    expect(bundles[0].path).toMatch(/\.bundle$/);
  });

  it('snapshotWipBranches idempotent on already-snapshotted SHA (no duplicate bundle)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/w6-v-2' });
    const ws = await mc.storage.allocate(handle.id, 'file:///tmp/w6-v-2');
    await execFileAsync('git', ['init', '--quiet'], { cwd: ws.path });
    await execFileAsync('git', ['config', 'user.email', 't@x.com'], { cwd: ws.path });
    await execFileAsync('git', ['config', 'user.name', 'T'], { cwd: ws.path });
    await writeFile(join(ws.path, 'a.txt'), 'a', 'utf8');
    await mc.gitEngine.commitToRef(ws, `refs/heads/mission/${handle.id}`, {
      message: 'wip',
      author: { name: 'T', email: 't@x.com' },
      autoStage: true,
    });

    const count1 = await mc.snapshotWipBranches(handle.id);
    const count2 = await mc.snapshotWipBranches(handle.id);
    expect(count1).toBe(1);
    expect(count2).toBe(1);     // idempotent (same SHA → existing bundle)

    const bundles = await listMissionBundles(defaultSnapshotRoot(tempRoot), handle.id, 'w6-v-2');
    expect(bundles.length).toBe(1);
  });

  it('snapshotWipBranches returns 0 when wip-ref does not exist (no commit yet)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/w6-v-3' });
    await mc.storage.allocate(handle.id, 'file:///tmp/w6-v-3');
    // No git init / no wip commit; revparse fails per repo → skip
    const count = await mc.snapshotWipBranches(handle.id);
    expect(count).toBe(0);
  });
});

describe('W6 slice (v) — disk-failure recovery via Missioncraft.restoreFromSnapshot', () => {
  it('rm -rf workspaceRoot → restoreFromSnapshot reconstructs wip-branch from snapshotRoot bundle', async () => {
    // Phase 1: writer creates mission + commits wip + snapshots
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/w6-v-recover' });
    const ws = await mc.storage.allocate(handle.id, 'file:///tmp/w6-v-recover');
    await execFileAsync('git', ['init', '--quiet'], { cwd: ws.path });
    await execFileAsync('git', ['config', 'user.email', 't@x.com'], { cwd: ws.path });
    await execFileAsync('git', ['config', 'user.name', 'T'], { cwd: ws.path });
    await writeFile(join(ws.path, 'critical-data.txt'), 'must-survive-disk-failure\n', 'utf8');
    await mc.gitEngine.commitToRef(ws, `refs/heads/mission/${handle.id}`, {
      message: 'wip-pre-disaster',
      author: { name: 'T', email: 't@x.com' },
      autoStage: true,
    });
    const { stdout: preSha } = await execFileAsync('git', ['rev-parse', `refs/heads/mission/${handle.id}`], { cwd: ws.path });
    await mc.snapshotWipBranches(handle.id);

    // Phase 2: simulate disk-failure (rm -rf workspaceRoot's missions/<id>/ tree)
    // Snapshot lives at sibling .missioncraft-snapshots/ which is OUT-OF-BAND.
    await rm(join(tempRoot, 'missions', handle.id), { recursive: true, force: true });
    expect(existsSync(ws.path)).toBe(false);

    // Verify snapshot survived (sibling location)
    const snapBundles = await listMissionBundles(defaultSnapshotRoot(tempRoot), handle.id, 'w6-v-recover');
    expect(snapBundles.length).toBeGreaterThanOrEqual(1);

    // Phase 3: recovery via restoreFromSnapshot
    const recoveredCount = await mc.restoreFromSnapshot(handle.id);
    expect(recoveredCount).toBe(1);

    // Verify wip-branch reconstructed at original SHA
    const newWs = await mc.storage.allocate(handle.id, 'file:///tmp/w6-v-recover');
    const { stdout: recoveredSha } = await execFileAsync('git', ['rev-parse', `refs/heads/mission/${handle.id}`], { cwd: newWs.path });
    expect(recoveredSha.trim()).toBe(preSha.trim());

    // Checkout + verify content survived
    await execFileAsync('git', ['checkout', `refs/heads/mission/${handle.id}`, '--', 'critical-data.txt'], { cwd: newWs.path });
    expect(existsSync(join(newWs.path, 'critical-data.txt'))).toBe(true);
    const content = await readFile(join(newWs.path, 'critical-data.txt'), 'utf8');
    expect(content).toBe('must-survive-disk-failure\n');
  }, 30_000);

  it('restoreFromSnapshot returns 0 when no bundles present (graceful no-op)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/w6-v-norecover' });
    // No snapshots ever created
    const count = await mc.restoreFromSnapshot(handle.id);
    expect(count).toBe(0);
  });
});
