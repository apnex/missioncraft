// v1.2.0 W5-new Fix #12 — complete() force-push for post-push-cadence squash-rewrite scenario.
//
// Architect-dogfood thread-548 round 13 surfaced this v1.2.0 BLOCKER: slice (iii) push-cadence
// independent setInterval timer (default 60s) auto-pushes daemon-chain mission/<id> to upstream.
// `mc.complete` then squashes mission/<id> to a single squashed commit on top of base, and
// pushes the rewritten branch — pre-Fix-#12 this push FAILED non-fast-forward because the local
// squashed mission/<id> is NOT a descendant of the daemon-chain version on upstream.
//
// Fix: complete()'s `runPublishLoop` uses `pushWithRetry({branch, force: true})` for the squash-
// publish push. Semantically: "this published squash supersedes the in-progress daemon-chain
// pushed by push-cadence".
//
// Regression test: simulate dogfood scenario by manually firing pushMissionBranchToUpstream
// (pre-publishing the daemon-chain) THEN running mc.complete; assert lifecycle reaches
// 'completed' + upstream mission/<id> tip equals the squashed commit (not the daemon-chain).

import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Missioncraft } from '@apnex/missioncraft';
import { createGitHttpFixture, type GitHttpFixture } from '../fixtures/git-http-fixture.js';

const execFileAsync = promisify(execFile);
let tempRoot: string;
let fixture: GitHttpFixture | undefined;
let bareDir: string;
let bareRepoUrl: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w5-fix12-'));
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

describe('v1.2.0 W5-new Fix #12 — complete() force-push for post-push-cadence squash-rewrite', () => {
  it('after push-cadence pushed daemon-chain, complete() squash + force-push succeeds; upstream tip = squashed commit', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writer = await mc.create('mission', { repo: bareRepoUrl });
    await mc.start(writer.id);

    // Snapshot upstream main pre-bilateral (Fix #9 SHAPE — adjacent-ref untouchedness)
    const upstreamMainPre = (
      await execFileAsync('git', ['rev-parse', 'refs/heads/main'], { cwd: bareDir })
    ).stdout.trim();

    // Simulate daemon-commit (chokidar debounce → commitToRef)
    const handles = await mc.storage.list(writer.id);
    const wsPath = handles[0].path;
    await writeFile(join(wsPath, 'OUTPUT.md'), '# Daemon work\n', 'utf8');
    const identity = await mc.identity.resolve();
    await mc.gitEngine.commitToRef(handles[0], `refs/heads/mission/${writer.id}`, {
      message: '[auto] daemon-commit',
      author: identity,
      autoStage: true,
    });

    // Simulate push-cadence first-fire — pushes daemon-chain mission/<id> to upstream
    expect(await mc.pushMissionBranchToUpstream(writer.id)).toBe(1);
    const upstreamTipPostPushCadence = (
      await execFileAsync('git', ['rev-parse', `refs/heads/mission/${writer.id}`], { cwd: bareDir })
    ).stdout.trim();
    expect(upstreamTipPostPushCadence).toMatch(/^[0-9a-f]{40}$/);

    // Now mc.complete — pre-Fix-#12 this would fail non-fast-forward at pushWithRetry call.
    // Post-Fix-#12 the push uses force: true so the squashed mission/<id> overwrites the daemon-
    // chain on upstream cleanly.
    const publishMessage = 'Fix-#12 publish-message-from-test';
    const result = await mc.complete(writer.id, publishMessage);

    // SHAPE-1: lifecycle advanced to 'completed' (proves pushWithRetry succeeded)
    expect(result.lifecycleState).toBe('completed');
    expect(result.publishStatus?.['sandbox']).toBe('pr-opened');

    // SHAPE-2: upstream mission/<id> tip is now the squashed commit (NOT the daemon-chain version)
    const upstreamTipPostComplete = (
      await execFileAsync('git', ['rev-parse', `refs/heads/mission/${writer.id}`], { cwd: bareDir })
    ).stdout.trim();
    expect(upstreamTipPostComplete).not.toBe(upstreamTipPostPushCadence);

    // SHAPE-3: upstream mission/<id> tip's commit-message === publishMessage (carry-forward W3-new
    // Fix #9 SHAPE — squash collapses chain to single commit with operator-msg)
    const { stdout: tipMsg } = await execFileAsync(
      'git', ['log', '-1', '--pretty=format:%s', `refs/heads/mission/${writer.id}`], { cwd: bareDir },
    );
    expect(tipMsg).toBe(publishMessage);

    // SHAPE-4: upstream mission/<id> tip's parent === upstream main tip (squash-parent invariant)
    const { stdout: tipParents } = await execFileAsync(
      'git', ['rev-list', '--parents', '-n1', `refs/heads/mission/${writer.id}`], { cwd: bareDir },
    );
    const parents = tipParents.trim().split(/\s+/).slice(1);
    expect(parents).toEqual([upstreamMainPre]);

    // SHAPE-5: ahead-count = 1 (single squashed commit; not the daemon-chain)
    const { stdout: aheadCount } = await execFileAsync(
      'git', ['rev-list', '--count', `refs/heads/main..refs/heads/mission/${writer.id}`], { cwd: bareDir },
    );
    expect(aheadCount.trim()).toBe('1');

    // SHAPE-6: upstream main UNCHANGED post-complete (Fix #8 carry-forward; squash updates headRef
    // not baseRef)
    const upstreamMainPost = (
      await execFileAsync('git', ['rev-parse', 'refs/heads/main'], { cwd: bareDir })
    ).stdout.trim();
    expect(upstreamMainPost).toBe(upstreamMainPre);
  }, 60_000);
});
