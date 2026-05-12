// v1.2.0 W5-new slice (v) — End-to-end transparency-gate: bilateral via cadence config.
//
// Architect-disposition thread-548 round 9: (i) SDK-composition test architecture per layer-A
// SHAPE-assertion target-set (calibration #72 + #74 carry-forward). Layer (B) daemon-dispatch is
// already covered by slice (iii) + (iv) helper tests (detectWriterPushCadence +
// detectReaderPullCadence); layer (C) real-daemon end-to-end is deferred to slice (vi)
// architect-dogfood (substrate-extension wire-flow gate; calibration #75 orphan-accumulation
// makes real-daemon-spawn an unsuitable test-suite cost).
//
// Single HTTP-fixture upstream per test (carry-forward (a) shape from W4-new slice (vii)).
// Driven by:
// - Writer-side: `Missioncraft.pushMissionBranchToUpstream(writer-id)` (simulating what daemon's
//   setInterval push-cadence timer fires at pushIntervalSeconds)
// - Reader-side: `Missioncraft.readerLoopBV5Tick(reader-id)` (simulating what reader-daemon Loop B
//   fires at pullIntervalSeconds)
//
// SHAPE assertions per calibration #72: writer's upstream branch-tip equality + reader workspace
// content + lifecycle transitions + workspace 0444 + branch-namespace invariants + adjacent-ref
// untouchedness.

import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Missioncraft, ReaderAutoCloseError } from '@apnex/missioncraft';
import { createGitHttpFixture, type GitHttpFixture } from '../fixtures/git-http-fixture.js';

const execFileAsync = promisify(execFile);

let tempRoot: string;
let fixture: GitHttpFixture | undefined;
let bareDir: string;
let bareRepoUrl: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w5-v-'));
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
  if (tempRoot) {
    try { await execFileAsync('chmod', ['-R', 'u+rwX', tempRoot]); } catch { /* best-effort */ }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

/** Simulate writer's daemon-commit by directly invoking gitEngine.commitToRef on writer's workspace.
 * This mimics what chokidar's debounced fireDebouncedCommit handler does in production. */
async function simulateWriterCommit(
  mc: Missioncraft,
  writerId: string,
  fileName: string,
  content: string,
  commitMsg: string,
): Promise<string> {
  const handles = await mc.storage.list(writerId);
  if (handles.length === 0) throw new Error('writer has no workspaces');
  const wsPath = handles[0].path;
  await writeFile(join(wsPath, fileName), content, 'utf8');
  const identity = await mc.identity.resolve();
  await mc.gitEngine.commitToRef(handles[0], `refs/heads/mission/${writerId}`, {
    message: commitMsg,
    author: identity,
    autoStage: true,
  });
  const { stdout } = await execFileAsync('git', ['rev-parse', `refs/heads/mission/${writerId}`], { cwd: wsPath });
  return stdout.trim();
}

describe('v1.2.0 W5-new slice (v) — Writer-side push-cadence SDK-composition', () => {
  it('pushMissionBranchToUpstream advances upstream mission/<id> matching local tip; idempotent on repeat', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writer = await mc.create('mission', { repo: bareRepoUrl });
    await mc.start(writer.id);

    // Writer's daemon-commit (simulated)
    const localTipV1 = await simulateWriterCommit(
      mc, writer.id, 'OUTPUT.md', '# Writer Output v1\n', '[auto] daemon-commit v1',
    );

    // Push-cadence (simulating daemon setInterval firing at pushIntervalSeconds)
    expect(await mc.pushMissionBranchToUpstream(writer.id)).toBe(1);

    // SHAPE-1: upstream mission/<writer-id> tip matches local tip
    const { stdout: upstreamTipV1 } = await execFileAsync(
      'git', ['rev-parse', `refs/heads/mission/${writer.id}`], { cwd: bareDir },
    );
    expect(upstreamTipV1.trim()).toBe(localTipV1);

    // SHAPE-2: idempotent — second call returns 1 (already-up-to-date push is success)
    expect(await mc.pushMissionBranchToUpstream(writer.id)).toBe(1);

    // SHAPE-3: writer advances; push fires; upstream advances to new tip
    const localTipV2 = await simulateWriterCommit(
      mc, writer.id, 'OUTPUT.md', '# Writer Output v2 (advanced)\n', '[auto] daemon-commit v2',
    );
    expect(await mc.pushMissionBranchToUpstream(writer.id)).toBe(1);
    const { stdout: upstreamTipV2 } = await execFileAsync(
      'git', ['rev-parse', `refs/heads/mission/${writer.id}`], { cwd: bareDir },
    );
    expect(upstreamTipV2.trim()).toBe(localTipV2);
    expect(localTipV2).not.toBe(localTipV1);
  }, 30_000);
});

describe('v1.2.0 W5-new slice (v) — BRANCH-TRACKER reader-side pullCadence SDK-composition', () => {
  it('reader workspace tracks writer-mission tip via cadence-driven push + pull cycle', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });

    // Writer: create + start + daemon-commit + push-cadence-fire
    const writer = await mc.create('mission', { repo: bareRepoUrl });
    await mc.start(writer.id);
    const writerTipV1 = await simulateWriterCommit(
      mc, writer.id, 'WRITER-OUTPUT.md', '# Writer v1\n', 'writer commit v1',
    );
    expect(await mc.pushMissionBranchToUpstream(writer.id)).toBe(1);

    // Reader: msn join (BRANCH-TRACKER) + start (which clones writer's repo + checks out mission/<writer-id>)
    const reader = await mc.create('mission', { readOnly: true, sourceMissionId: writer.id });
    await mc.start(reader.id);

    // SHAPE-1: reader workspace at writer-tip post-start (mc.start clone+checkout already syncs)
    const readerHandles = await mc.storage.list(reader.id);
    expect(readerHandles).toHaveLength(1);
    const readerWsPath = readerHandles[0].path;
    const readerTipPostStart = (
      await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: readerWsPath })
    ).stdout.trim();
    expect(readerTipPostStart).toBe(writerTipV1);

    // SHAPE-2: reader workspace 0444 (read-only operator-DX invariant)
    const writerOutputStat = await stat(join(readerWsPath, 'WRITER-OUTPUT.md'));
    expect(writerOutputStat.mode & 0o222).toBe(0);

    // SHAPE-3: reader lifecycle 'started' post-start
    const readerStatePostStart = await mc.get('mission', reader.id);
    expect(readerStatePostStart.lifecycleState).toBe('started');

    // ─── Writer advances; reader pull-cadence-fire syncs ───
    const writerTipV2 = await simulateWriterCommit(
      mc, writer.id, 'WRITER-OUTPUT.md', '# Writer v2 (advanced)\n', 'writer commit v2',
    );
    expect(await mc.pushMissionBranchToUpstream(writer.id)).toBe(1);

    // Reader Loop B tick (simulating what daemon setInterval fires at pullIntervalSeconds)
    expect(await mc.readerLoopBV5Tick(reader.id)).toBe(1);

    // SHAPE-4: reader workspace advanced to v2 tip
    const readerTipPostTick = (
      await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: readerWsPath })
    ).stdout.trim();
    expect(readerTipPostTick).toBe(writerTipV2);

    // SHAPE-5: workspace 0444 invariant preserved post-tick (chmod-cycle finally-block)
    const v2Stat = await stat(join(readerWsPath, 'WRITER-OUTPUT.md'));
    expect(v2Stat.mode & 0o222).toBe(0);

    // SHAPE-6: branch-namespace invariant — no wip/<id> refs anywhere
    const { stdout: readerRefs } = await execFileAsync('git', ['for-each-ref', '--format=%(refname)'], { cwd: readerWsPath });
    expect(readerRefs).not.toMatch(/refs\/heads\/wip\//);
    const { stdout: upstreamRefs } = await execFileAsync('git', ['for-each-ref', '--format=%(refname)'], { cwd: bareDir });
    expect(upstreamRefs).not.toMatch(/refs\/heads\/wip\//);

    // SHAPE-7: adjacent-ref untouchedness — upstream main unchanged
    const seedDir = join(tempRoot, 'seed');
    const initialMain = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: seedDir })).stdout.trim();
    const upstreamMain = (
      await execFileAsync('git', ['rev-parse', 'refs/heads/main'], { cwd: bareDir })
    ).stdout.trim();
    expect(upstreamMain).toBe(initialMain);
  }, 60_000);
});

describe('v1.2.0 W5-new slice (v) — PERSISTENT-TRACKER reader-side pullCadence SDK-composition', () => {
  it('reader workspace tracks upstream main advance via pull-cadence tick', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const reader = await mc.create('mission', {
      repo: bareRepoUrl,
      readOnly: true,
      sourceRemote: bareRepoUrl,
      sourceBranch: 'main',
    });
    await mc.start(reader.id);

    const handles = await mc.storage.list(reader.id);
    const readerWsPath = handles[0].path;
    // SHAPE-1: reader at initial main tip + workspace 0444
    const initStat = await stat(join(readerWsPath, 'README.md'));
    expect(initStat.mode & 0o222).toBe(0);

    // Upstream main advances (simulating external operator-push)
    const pusherDir = join(tempRoot, 'pusher-stage');
    await mkdir(pusherDir, { recursive: true });
    await execFileAsync('git', ['clone', '--quiet', bareRepoUrl, pusherDir]);
    await execFileAsync('git', ['config', 'user.email', 'pusher@x.com'], { cwd: pusherDir });
    await execFileAsync('git', ['config', 'user.name', 'Pusher'], { cwd: pusherDir });
    await writeFile(join(pusherDir, 'README.md'), '# initial\n\nUpdated by pusher (slice-v test)\n', 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: pusherDir });
    await execFileAsync('git', ['commit', '-m', 'main advance'], { cwd: pusherDir });
    await execFileAsync('git', ['push', 'origin', 'main'], { cwd: pusherDir });

    // Reader pull-cadence-tick syncs
    expect(await mc.readerLoopBV5Tick(reader.id)).toBe(1);

    // SHAPE-2: reader workspace synced to upstream-advance content
    const { stdout: readmePostTick } = await execFileAsync(
      'git', ['show', 'HEAD:README.md'], { cwd: readerWsPath },
    );
    expect(readmePostTick).toContain('Updated by pusher (slice-v test)');

    // SHAPE-3: workspace 0444 invariant preserved
    const postStat = await stat(join(readerWsPath, 'README.md'));
    expect(postStat.mode & 0o222).toBe(0);

    // SHAPE-4: branch-namespace — no wip/ AND no mission/ (PERSISTENT tracks main only)
    const { stdout: refs } = await execFileAsync('git', ['for-each-ref', '--format=%(refname)'], { cwd: readerWsPath });
    expect(refs).not.toMatch(/refs\/heads\/wip\//);
    expect(refs).not.toMatch(/refs\/heads\/mission\//);
  }, 60_000);
});

describe('v1.2.0 W5-new slice (v) — Auto-close cascade via pull-cadence detection', () => {
  it('writer→complete-lifecycle triggers reader Loop B ReaderAutoCloseError + readerAutoAbandon cascade', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writer = await mc.create('mission', { repo: bareRepoUrl });
    await mc.start(writer.id);
    await simulateWriterCommit(
      mc, writer.id, 'OUTPUT.md', '# Writer Output\n', 'writer initial',
    );
    expect(await mc.pushMissionBranchToUpstream(writer.id)).toBe(1);

    const reader = await mc.create('mission', { readOnly: true, sourceMissionId: writer.id });
    await mc.start(reader.id);

    // Manually advance writer to 'completed' (test shortcut; production: mc.complete)
    const writerPath = join(tempRoot, 'config', 'missions', `${writer.id}.yaml`);
    const { readFile } = await import('node:fs/promises');
    const writerContent = await readFile(writerPath, 'utf8');
    await writeFile(writerPath, writerContent.replace(/lifecycle-state: \w+/, 'lifecycle-state: completed'), 'utf8');

    // Reader's pull-cadence-tick now detects terminal writer-state → ReaderAutoCloseError
    let thrown: unknown;
    try {
      await mc.readerLoopBV5Tick(reader.id);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ReaderAutoCloseError);

    // Simulate daemon-cascade (matches watcher-entry.ts handler from slice v.b)
    if (thrown instanceof ReaderAutoCloseError) {
      await mc.readerAutoAbandon(reader.id, thrown.message);
    }

    // SHAPE: reader lifecycle 'abandoned' + abandonMessage matches /is terminal \(completed\)/
    const readerStatePostAutoClose = await mc.get('mission', reader.id);
    expect(readerStatePostAutoClose.lifecycleState).toBe('abandoned');
    expect(readerStatePostAutoClose.abandonMessage).toMatch(/is terminal \(completed\)/);
  }, 60_000);
});
