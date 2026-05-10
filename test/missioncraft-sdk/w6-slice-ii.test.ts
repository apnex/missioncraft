// W6 slice (ii) — W5c-deferred carry-over real-engine integration tests.
//
// Per task-401 deliverable #3 (2 W5c-deferred items): sync-deletion-handling +
// real-engine join() happy-path + real-engine leave() integration.
//
// Reuses node-git-server@1.0.0 fixture from W5c slice (ii); exercises the
// real-engine Step 5 impl-extension landed in this slice (best-effort fetch+checkout
// via coord-mirror primitives).

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, readFile, unlink } from 'node:fs/promises';
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
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w6-ii-'));
  const repoBase = join(tempRoot, 'coord-repos');
  const bareDir = join(repoBase, 'mission-coord.git');
  await mkdir(bareDir, { recursive: true });
  await execFileAsync('git', ['init', '--quiet', '--bare'], { cwd: bareDir });
  await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: bareDir });

  fixture = await createGitHttpFixture(repoBase, { autoCreate: false });
  bareRepoUrl = `${fixture.url}/mission-coord.git`;
});

afterEach(async () => {
  if (fixture) {
    await fixture.close();
    fixture = undefined;
  }
  if (tempRoot) {
    try {
      await execFileAsync('find', [tempRoot, '-type', 'd', '-exec', 'chmod', 'u+wx', '{}', ';']);
      await execFileAsync('find', [tempRoot, '-type', 'f', '-exec', 'chmod', 'u+w', '{}', ';']);
    } catch { /* best-effort */ }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function seedWriterMission(
  workspaceRoot: string,
  missionId: string,
  coordRemote: string,
): Promise<void> {
  const path = join(workspaceRoot, 'config', `${missionId}.yaml`);
  const content = await readFile(path, 'utf8');
  const ts = new Date().toISOString();
  const block = `  participants:\n    - principal: writer@host\n      role: writer\n      added-at: ${ts}\n    - principal: reader@host\n      role: reader\n      added-at: ${ts}\n  coordination-remote: ${coordRemote}\n`;
  const updated = content
    .replace(/lifecycle-state: [\w-]+/, 'lifecycle-state: in-progress')
    .replace(/^repos:/m, `${block}repos:`);
  await writeFile(path, updated, 'utf8');
}

describe('W6 slice (ii) — sync-deletion-handling end-to-end (W5c-deferred carry-over)', () => {
  it('writer wip-deletes file → reader Loop B fetches + checkout removes file from reader workspace', async () => {
    // Writer: create mission + commit content + push wip-branch with file
    const writerRoot = join(tempRoot, 'writer-ws');
    const mcWriter = new Missioncraft({ workspaceRoot: writerRoot });
    const handle = await mcWriter.create('mission', { repo: 'file:///tmp/w6-ii-1' });
    const ws = await mcWriter.storage.allocate(handle.id, 'file:///tmp/w6-ii-1');
    await execFileAsync('git', ['init', '--quiet'], { cwd: ws.path });
    await execFileAsync('git', ['config', 'user.email', 'w@x.com'], { cwd: ws.path });
    await execFileAsync('git', ['config', 'user.name', 'W'], { cwd: ws.path });
    await writeFile(join(ws.path, 'keeper.txt'), 'persists\n', 'utf8');
    await writeFile(join(ws.path, 'doomed.txt'), 'will be deleted\n', 'utf8');
    await mcWriter.gitEngine.commitToRef(ws, `refs/heads/wip/${handle.id}`, {
      message: 'wip-1: both files',
      author: { name: 'W', email: 'w@x.com' },
      autoStage: true,
    });
    await seedWriterMission(writerRoot, handle.id, bareRepoUrl);

    // Push v1 (with both files)
    await mcWriter.pushWipToCoordRemote(handle.id);

    // Reader: bootstrap config + workspace; Loop B fetches → applyReaderRefUpdate (real-engine)
    const readerRoot = join(tempRoot, 'reader-ws');
    await mkdir(join(readerRoot, 'config'), { recursive: true });
    const writerConfig = await readFile(join(writerRoot, 'config', `${handle.id}.yaml`), 'utf8');
    const readerConfigPath = join(readerRoot, 'config', `${handle.id}.yaml`);
    await writeFile(
      readerConfigPath,
      writerConfig.replace(/lifecycle-state: [\w-]+/, 'lifecycle-state: reading'),
      'utf8',
    );
    const mcReader = new Missioncraft({ workspaceRoot: readerRoot, principal: 'reader@host' });
    const readerWs = await mcReader.storage.allocate(handle.id, 'file:///tmp/w6-ii-1');

    await mcReader.readerLoopBTick(handle.id, 'reader@host');

    // Reader has both files now
    expect(existsSync(join(readerWs.path, 'keeper.txt'))).toBe(true);
    expect(existsSync(join(readerWs.path, 'doomed.txt'))).toBe(true);

    // Writer deletes a file + commits + pushes
    await execFileAsync('chmod', ['u+w', ws.path]);
    await unlink(join(ws.path, 'doomed.txt'));
    await mcWriter.gitEngine.commitToRef(ws, `refs/heads/wip/${handle.id}`, {
      message: 'wip-2: deleted doomed.txt',
      author: { name: 'W', email: 'w@x.com' },
      autoStage: true,
    });
    await mcWriter.pushWipToCoordRemote(handle.id);

    // Reader Loop B re-fetches + applyReaderRefUpdate → checkout removes doomed.txt from workspace
    await mcReader.readerLoopBTick(handle.id, 'reader@host');

    // Verify deletion synced through
    expect(existsSync(join(readerWs.path, 'keeper.txt'))).toBe(true);
    expect(existsSync(join(readerWs.path, 'doomed.txt'))).toBe(false);     // sync-deletion-handling ✓
  }, 30_000);
});

describe('W6 slice (ii) — real-engine join() + leave() happy-path (W5c-deferred carry-over)', () => {
  it('reader join() uses real-engine fetch+checkout from coord-remote (Step 5 impl-extension)', async () => {
    // Writer: bootstrap mission + push wip-branch with content
    const writerRoot = join(tempRoot, 'writer-ws');
    const mcWriter = new Missioncraft({ workspaceRoot: writerRoot });
    const handle = await mcWriter.create('mission', { repo: 'file:///tmp/w6-ii-2' });
    const ws = await mcWriter.storage.allocate(handle.id, 'file:///tmp/w6-ii-2');
    await execFileAsync('git', ['init', '--quiet'], { cwd: ws.path });
    await execFileAsync('git', ['config', 'user.email', 'w@x.com'], { cwd: ws.path });
    await execFileAsync('git', ['config', 'user.name', 'W'], { cwd: ws.path });
    await writeFile(join(ws.path, 'shared-doc.md'), '# Shared Document\n', 'utf8');
    await mcWriter.gitEngine.commitToRef(ws, `refs/heads/wip/${handle.id}`, {
      message: 'wip-1',
      author: { name: 'W', email: 'w@x.com' },
      autoStage: true,
    });
    await seedWriterMission(writerRoot, handle.id, bareRepoUrl);
    await mcWriter.pushWipToCoordRemote(handle.id);

    // Reader: bootstrap minimal config + call join()
    const readerRoot = join(tempRoot, 'reader-ws');
    await mkdir(join(readerRoot, 'config'), { recursive: true });
    const writerConfig = await readFile(join(writerRoot, 'config', `${handle.id}.yaml`), 'utf8');
    const readerConfigPath = join(readerRoot, 'config', `${handle.id}.yaml`);
    // Reader's local config starts at 'configured' (pre-join writer-state)
    await writeFile(
      readerConfigPath,
      writerConfig.replace(/lifecycle-state: [\w-]+/, 'lifecycle-state: configured'),
      'utf8',
    );

    const mcReader = new Missioncraft({ workspaceRoot: readerRoot, principal: 'reader@host' });
    const result = await mcReader.join(handle.id, bareRepoUrl, 'reader@host');
    expect(result.lifecycleState).toBe('reading');

    // Step 5 real-engine fetch+checkout populated reader's workspace with writer's content
    const readerHandles = await mcReader.storage.list(handle.id);
    expect(readerHandles.length).toBe(1);
    expect(existsSync(join(readerHandles[0].path, 'shared-doc.md'))).toBe(true);
    const content = await readFile(join(readerHandles[0].path, 'shared-doc.md'), 'utf8');
    expect(content).toBe('# Shared Document\n');
  }, 30_000);

  it('reader leave({purgeWorkspace: true}) cleans workspace + config post-real-engine-join', async () => {
    // Writer setup + push (same as previous test)
    const writerRoot = join(tempRoot, 'writer-ws');
    const mcWriter = new Missioncraft({ workspaceRoot: writerRoot });
    const handle = await mcWriter.create('mission', { repo: 'file:///tmp/w6-ii-3' });
    const ws = await mcWriter.storage.allocate(handle.id, 'file:///tmp/w6-ii-3');
    await execFileAsync('git', ['init', '--quiet'], { cwd: ws.path });
    await execFileAsync('git', ['config', 'user.email', 'w@x.com'], { cwd: ws.path });
    await execFileAsync('git', ['config', 'user.name', 'W'], { cwd: ws.path });
    await writeFile(join(ws.path, 'data.txt'), 'data\n', 'utf8');
    await mcWriter.gitEngine.commitToRef(ws, `refs/heads/wip/${handle.id}`, {
      message: 'wip-1',
      author: { name: 'W', email: 'w@x.com' },
      autoStage: true,
    });
    await seedWriterMission(writerRoot, handle.id, bareRepoUrl);
    await mcWriter.pushWipToCoordRemote(handle.id);

    // Reader: full join + leave-purge cycle
    const readerRoot = join(tempRoot, 'reader-ws');
    await mkdir(join(readerRoot, 'config'), { recursive: true });
    const writerConfig = await readFile(join(writerRoot, 'config', `${handle.id}.yaml`), 'utf8');
    const readerConfigPath = join(readerRoot, 'config', `${handle.id}.yaml`);
    await writeFile(
      readerConfigPath,
      writerConfig.replace(/lifecycle-state: [\w-]+/, 'lifecycle-state: configured'),
      'utf8',
    );
    const mcReader = new Missioncraft({ workspaceRoot: readerRoot, principal: 'reader@host' });
    await mcReader.join(handle.id, bareRepoUrl, 'reader@host');

    const readerHandles = await mcReader.storage.list(handle.id);
    expect(readerHandles.length).toBe(1);
    expect(existsSync(readerHandles[0].path)).toBe(true);

    await mcReader.leave(handle.id, { purgeWorkspace: true });

    // Workspace destroyed + config purged (terminal-removed semantic)
    expect(existsSync(readerHandles[0].path)).toBe(false);
    expect(existsSync(readerConfigPath)).toBe(false);
  }, 30_000);
});
