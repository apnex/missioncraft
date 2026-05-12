// v1.2.0 W4-new slice (vii) — Writer+reader bilateral transparency-gate test.
//
// THE dispositive substrate-extension wire-flow gate for W4-new reader-mission flow per
// `feedback_substrate_extension_wire_flow_integration_test.md`. End-to-end bilateral:
// writer-mission produces mission/<writer-id> branch on upstream; reader-mission (BRANCH-TRACKER
// or PERSISTENT-TRACKER) consumes via Loop B fetch+reset → workspace tracks source-branch tip;
// reader-mission workspace 0444; auto-close cascade on writer-terminal.
//
// SHAPE assertions per calibration #72 (architect-spec target-set; thread-547 §C):
// - Reader workspace tip === source-branch tip post-Loop-B-tick
// - Reader workspace files 0444 (read-only operator-DX invariant)
// - Reader lifecycleState 'started' post-start
// - Branch-namespace invariant: NO `refs/heads/wip/` refs anywhere (carry-forward from W3-new
//   Fix #9 transparency-gate)
// - Adjacent-ref untouchedness: local main + upstream main unchanged post-bilateral
// - Auto-close cascade: writer terminal → reader Loop B → ReaderAutoCloseError → readerAutoAbandon
//   → reader lifecycleState 'abandoned' + abandonMessage set
//
// Test-fixture shape: SINGLE HTTP-fixture upstream per test (architect-disposition (a) at
// thread-547 round 3). Mirrors production scenario: operator A `msn create`; operator B `msn join`
// against the same shared upstream.

import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, unlink, stat } from 'node:fs/promises';
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
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w4-vii-'));
  const repoBase = join(tempRoot, 'origin-repos');
  bareDir = join(repoBase, 'sandbox.git');
  await mkdir(bareDir, { recursive: true });
  await execFileAsync('git', ['init', '--quiet', '--bare'], { cwd: bareDir });
  await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: bareDir });

  // Seed bare repo with initial commit on main
  const seedDir = join(tempRoot, 'seed');
  await mkdir(seedDir, { recursive: true });
  await execFileAsync('git', ['init', '--quiet'], { cwd: seedDir });
  await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: seedDir });
  await execFileAsync('git', ['config', 'user.email', 'seed@x.com'], { cwd: seedDir });
  await execFileAsync('git', ['config', 'user.name', 'Seed'], { cwd: seedDir });
  await writeFile(join(seedDir, 'README.md'), '# sandbox\n', 'utf8');
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
    // chmod-up before rm so cleanup doesn't EACCES on chmod-down reader-workspaces
    try { await execFileAsync('chmod', ['-R', 'u+rwX', tempRoot]); } catch { /* best-effort */ }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

/**
 * Test-fixture helper: simulate writer pushing a new mission-branch state to upstream. Mimics what
 * W5-new push-on-cadence will do (or what `msn complete` does today at squash-time). Operates
 * directly on bare-repo with explicit branch + content (test-only shortcut).
 */
let stageCounter = 0;
async function seedUpstreamMissionBranch(
  writerMissionId: string,
  fileName: string,
  fileContent: string,
  commitMsg: string,
): Promise<string> {
  // Unique stage dir per call (test invokes seed multiple times for v1/v2 advance scenarios)
  const stageDir = join(tempRoot, `writer-stage-${writerMissionId}-${stageCounter++}`);
  await mkdir(stageDir, { recursive: true });
  await execFileAsync('git', ['clone', '--quiet', bareRepoUrl, stageDir]);
  await execFileAsync('git', ['config', 'user.email', 'writer@x.com'], { cwd: stageDir });
  await execFileAsync('git', ['config', 'user.name', 'Writer'], { cwd: stageDir });
  // Use checkout -B (force-reset) to handle both first-create + subsequent-advance via same fn
  // If mission-branch already exists on upstream, we want to start from its tip + add new commit.
  try {
    await execFileAsync('git', ['fetch', 'origin', `mission/${writerMissionId}`], { cwd: stageDir });
    await execFileAsync('git', ['checkout', '-B', `mission/${writerMissionId}`, `origin/mission/${writerMissionId}`], { cwd: stageDir });
  } catch {
    // First-create: branch doesn't exist on upstream yet; create from main
    await execFileAsync('git', ['checkout', '-b', `mission/${writerMissionId}`], { cwd: stageDir });
  }
  await writeFile(join(stageDir, fileName), fileContent, 'utf8');
  await execFileAsync('git', ['add', '.'], { cwd: stageDir });
  await execFileAsync('git', ['commit', '-m', commitMsg], { cwd: stageDir });
  await execFileAsync('git', ['push', 'origin', `mission/${writerMissionId}`], { cwd: stageDir });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: stageDir });
  return stdout.trim();
}

describe('v1.2.0 W4-new slice (vii) — Writer+reader bilateral transparency-gate', () => {
  it('BRANCH-TRACKER bilateral: reader workspace tracks writer mission-branch tip (post-start + post-Loop-B advance)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });

    // Step 1: writer-mission created + started (writer lifecycle 'configured' → 'started')
    const writer = await mc.create('mission', { name: 'writer-alpha', repo: bareRepoUrl });
    // We do NOT call mc.start(writer.id) here because that spawns the daemon-watcher which would
    // start firing chokidar-driven commit cycles asynchronously. For deterministic bilateral
    // testing, we simulate the writer-side mission-branch-push directly via seedUpstreamMissionBranch.
    // This matches what W5-new push-on-cadence (OR msn complete) will do at production-time.

    // Step 2: seed upstream with writer's mission-branch at content version 1
    const upstreamTipV1 = await seedUpstreamMissionBranch(
      writer.id,
      'WRITER-OUTPUT.md',
      '# Writer Output\n\nVersion 1 content\n',
      `writer-${writer.id} commit v1`,
    );
    expect(upstreamTipV1).toMatch(/^[0-9a-f]{40}$/);

    // Snapshot upstream main pre-bilateral (untouchedness assertion)
    const upstreamMainPreBilateral = (
      await execFileAsync('git', ['rev-parse', 'refs/heads/main'], { cwd: bareDir })
    ).stdout.trim();

    // Step 3: reader-mission via BRANCH-TRACKER (msn join writer-mission)
    const reader = await mc.create('mission', { readOnly: true, sourceMissionId: writer.id });

    // Step 4: reader-mission start (slice v.b flow: clone + checkout mission/<writer-id> + chmod-down)
    await mc.start(reader.id);

    // ─── SHAPE assertions: post-start state ───

    // SHAPE-1: reader lifecycleState 'started' (slice v.b lifecycle-gate widened: 'joined' → 'started')
    const readerStatePostStart = await mc.get('mission', reader.id);
    expect(readerStatePostStart.lifecycleState).toBe('started');

    // SHAPE-2: reader workspace at writer's mission-branch tip (v1 SHA)
    const handles = await mc.storage.list(reader.id);
    expect(handles).toHaveLength(1);
    const readerWsPath = handles[0].path;
    const readerTipPostStart = (
      await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: readerWsPath })
    ).stdout.trim();
    expect(readerTipPostStart).toBe(upstreamTipV1);

    // SHAPE-3: reader workspace contains writer's content (READMD.md from initial + WRITER-OUTPUT.md from v1)
    const writerOutputV1 = (
      await execFileAsync('git', ['ls-files'], { cwd: readerWsPath })
    ).stdout;
    expect(writerOutputV1).toContain('WRITER-OUTPUT.md');

    // SHAPE-4: reader workspace files 0444 (read-only operator-DX invariant)
    const writerOutputStat = await stat(join(readerWsPath, 'WRITER-OUTPUT.md'));
    expect(writerOutputStat.mode & 0o222).toBe(0);            // no write bits anywhere

    // ─── Step 5: writer advances to v2; reader Loop B tick fetches+reset ───

    const upstreamTipV2 = await seedUpstreamMissionBranch(
      writer.id,
      'WRITER-OUTPUT.md',
      '# Writer Output\n\nVersion 2 content (advanced)\n',
      `writer-${writer.id} commit v2`,
    );
    expect(upstreamTipV2).not.toBe(upstreamTipV1);

    // Trigger Loop B tick directly (test deterministic; in production this runs every coordPollMs)
    const successCount = await mc.readerLoopBV5Tick(reader.id);
    expect(successCount).toBe(1);

    // SHAPE-5: reader workspace advanced to v2 tip
    const readerTipPostTick = (
      await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: readerWsPath })
    ).stdout.trim();
    expect(readerTipPostTick).toBe(upstreamTipV2);

    // SHAPE-6: reader workspace files STILL 0444 post-Loop-B (chmod-cycle finally-block invariant)
    const writerOutputStatPostTick = await stat(join(readerWsPath, 'WRITER-OUTPUT.md'));
    expect(writerOutputStatPostTick.mode & 0o222).toBe(0);

    // SHAPE-7: branch-namespace invariant — NO `refs/heads/wip/` refs in reader workspace OR upstream
    // (carry-forward from W3-new Fix #9 transparency-gate; v5.0 single-branch architecture)
    const { stdout: readerRefs } = await execFileAsync('git', ['for-each-ref', '--format=%(refname)'], { cwd: readerWsPath });
    expect(readerRefs).not.toMatch(/refs\/heads\/wip\//);
    const { stdout: upstreamRefs } = await execFileAsync('git', ['for-each-ref', '--format=%(refname)'], { cwd: bareDir });
    expect(upstreamRefs).not.toMatch(/refs\/heads\/wip\//);

    // SHAPE-8: adjacent-ref untouchedness — upstream main unchanged post-bilateral
    const upstreamMainPostBilateral = (
      await execFileAsync('git', ['rev-parse', 'refs/heads/main'], { cwd: bareDir })
    ).stdout.trim();
    expect(upstreamMainPostBilateral).toBe(upstreamMainPreBilateral);
  }, 60_000);

  it('PERSISTENT-TRACKER bilateral: reader workspace tracks upstream branch (long-lived tracker)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });

    // PERSISTENT-TRACKER target: long-lived branch like main. Reader watches it; upstream
    // advances; Loop B fetches+resets.
    const reader = await mc.create('mission', {
      name: 'reader-persistent',
      repo: bareRepoUrl,
      readOnly: true,
      sourceRemote: bareRepoUrl,
      sourceBranch: 'main',
    });

    // Reader-mission start → clone upstream + checkout main + chmod-down
    await mc.start(reader.id);

    // SHAPE-1: reader workspace at upstream main (initial seed README.md content)
    const handles = await mc.storage.list(reader.id);
    const readerWsPath = handles[0].path;
    const readmePreAdvance = (await execFileAsync(
      'git', ['show', 'HEAD:README.md'], { cwd: readerWsPath },
    )).stdout;
    expect(readmePreAdvance).toContain('# sandbox');

    // Verify workspace 0444 post-start
    const readmeStat = await stat(join(readerWsPath, 'README.md'));
    expect(readmeStat.mode & 0o222).toBe(0);

    // ─── Upstream main advances ───

    const stageDir = join(tempRoot, 'main-stage');
    await mkdir(stageDir, { recursive: true });
    await execFileAsync('git', ['clone', '--quiet', bareRepoUrl, stageDir]);
    await execFileAsync('git', ['config', 'user.email', 'pusher@x.com'], { cwd: stageDir });
    await execFileAsync('git', ['config', 'user.name', 'Pusher'], { cwd: stageDir });
    await writeFile(join(stageDir, 'README.md'), '# sandbox\n\nUpdated by upstream pusher\n', 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: stageDir });
    await execFileAsync('git', ['commit', '-m', 'upstream main advance'], { cwd: stageDir });
    await execFileAsync('git', ['push', 'origin', 'main'], { cwd: stageDir });

    // Trigger Loop B tick on reader
    const successCount = await mc.readerLoopBV5Tick(reader.id);
    expect(successCount).toBe(1);

    // SHAPE-2: reader workspace synced to upstream's new tip
    const readmePostAdvance = (await execFileAsync(
      'git', ['show', 'HEAD:README.md'], { cwd: readerWsPath },
    )).stdout;
    expect(readmePostAdvance).toContain('Updated by upstream pusher');

    // SHAPE-3: workspace 0444 invariant preserved
    const readmeStatPostAdvance = await stat(join(readerWsPath, 'README.md'));
    expect(readmeStatPostAdvance.mode & 0o222).toBe(0);

    // SHAPE-4: branch-namespace invariant
    const { stdout: readerRefs } = await execFileAsync('git', ['for-each-ref', '--format=%(refname)'], { cwd: readerWsPath });
    expect(readerRefs).not.toMatch(/refs\/heads\/wip\//);
    expect(readerRefs).not.toMatch(/refs\/heads\/mission\//);   // PERSISTENT-TRACKER tracks main; no mission-branch
  }, 60_000);

  it('Auto-close cascade failure-mode 2: writer→terminal triggers reader→abandoned via daemon-side cascade', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writer = await mc.create('mission', { repo: bareRepoUrl });
    const reader = await mc.create('mission', { readOnly: true, sourceMissionId: writer.id });

    // Seed upstream so reader-start succeeds (clone + checkout mission/<writer-id>)
    await seedUpstreamMissionBranch(
      writer.id,
      'OUTPUT.md',
      '# Writer Output\n',
      `writer-${writer.id} initial`,
    );

    await mc.start(reader.id);

    // Manually advance writer to 'completed' (test shortcut; in production this is mc.complete)
    const writerPath = join(tempRoot, 'config', 'missions', `${writer.id}.yaml`);
    const { readFile, writeFile } = await import('node:fs/promises');
    const writerContent = await readFile(writerPath, 'utf8');
    await writeFile(writerPath, writerContent.replace(/lifecycle-state: \w+/, 'lifecycle-state: completed'), 'utf8');

    // Loop B tick should now throw ReaderAutoCloseError (failure-mode 2 detection)
    let thrown: unknown;
    try {
      await mc.readerLoopBV5Tick(reader.id);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ReaderAutoCloseError);

    // Simulate daemon-side cascade: catch → readerAutoAbandon (matches watcher-entry.ts handler)
    if (thrown instanceof ReaderAutoCloseError) {
      await mc.readerAutoAbandon(reader.id, thrown.message);
    }

    // SHAPE: reader lifecycleState 'abandoned' + abandonMessage set per cascade
    const readerStatePostAutoClose = await mc.get('mission', reader.id);
    expect(readerStatePostAutoClose.lifecycleState).toBe('abandoned');
    expect(readerStatePostAutoClose.abandonMessage).toMatch(/is terminal \(completed\)/);
  }, 60_000);

  it('Auto-close cascade failure-mode 1: writer config-deleted triggers reader→abandoned cascade', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writer = await mc.create('mission', { repo: bareRepoUrl });
    const reader = await mc.create('mission', { readOnly: true, sourceMissionId: writer.id });

    await seedUpstreamMissionBranch(
      writer.id,
      'OUTPUT.md',
      '# Writer Output\n',
      `writer-${writer.id} initial`,
    );
    await mc.start(reader.id);

    // Delete writer config-file (simulates writer's local state gone — fail-mode 1)
    await unlink(join(tempRoot, 'config', 'missions', `${writer.id}.yaml`));

    let thrown: unknown;
    try {
      await mc.readerLoopBV5Tick(reader.id);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ReaderAutoCloseError);

    if (thrown instanceof ReaderAutoCloseError) {
      await mc.readerAutoAbandon(reader.id, thrown.message);
    }

    const readerStatePostAutoClose = await mc.get('mission', reader.id);
    expect(readerStatePostAutoClose.lifecycleState).toBe('abandoned');
    expect(readerStatePostAutoClose.abandonMessage).toMatch(/config-file missing/);
  }, 60_000);
});
