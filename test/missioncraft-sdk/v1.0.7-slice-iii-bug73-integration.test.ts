// v1.0.7 slice (iii) — bug-73 full-lifecycle integration test.
//
// THE test that would have caught bug-73 pre-ship: exercises scope-bound mission
// (bug-70 v1.0.6 code-path) through complete-success — which post-fix actually finds the
// workspace handle (Option A `basename(path)` match) + reaches the publish-loop's push step.
//
// Coverage:
// - scope-bound mission (`msn create --scope`) → start → daemon-tick → complete-success
// - scope-bound mission → start → daemon-tick → abandon-success
// - --repo direct-binding mission (regression-net for the same fix path)
//
// Uses node-git-server HTTP fixture (proven W6 pattern); no RemoteProvider configured so
// complete()'s `if (this.remote && supportsPullRequests)` branch is skipped — publish-loop
// pushes wip → marks 'pr-opened' status without opening PR.

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
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
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-v107-iii-'));
  const repoBase = join(tempRoot, 'origin-repos');
  const bareDir = join(repoBase, 'sandbox.git');
  await mkdir(bareDir, { recursive: true });
  await execFileAsync('git', ['init', '--quiet', '--bare'], { cwd: bareDir });
  await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: bareDir });

  // Seed the bare repo with one commit so clone has something to fetch.
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
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

/** Simulate operator file-edit + commit. Operator's only direct git interaction is the standard
 * git add + git commit workflow inside the workspace; branch setup is substrate's responsibility
 * (per `feedback_operator_never_runs_git_commands.md`). If start() doesn't set up the working
 * branch correctly, the operator's commit lands in the wrong place and complete fails. */
async function simulateOperatorEdit(workspacePath: string): Promise<void> {
  await execFileAsync('git', ['config', 'user.email', 'op@x.com'], { cwd: workspacePath });
  await execFileAsync('git', ['config', 'user.name', 'Operator'], { cwd: workspacePath });
  await writeFile(join(workspacePath, 'work.md'), 'operator work\n', 'utf8');
  await execFileAsync('git', ['add', '.'], { cwd: workspacePath });
  await execFileAsync('git', ['commit', '-m', 'operator commit'], { cwd: workspacePath });
}

/** Poll for lifecycle-state advance with a short timeout — daemon-tick happens at boot, so this
 * usually flips within a few hundred ms post-start(). */
async function waitForLifecycle(
  mc: Missioncraft,
  missionId: string,
  target: string,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await mc.get('mission', missionId);
    if (state.lifecycleState === target) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  const final = await mc.get('mission', missionId);
  throw new Error(`waitForLifecycle: expected '${target}' within ${timeoutMs}ms; final = '${final.lifecycleState}'`);
}

describe('v1.0.7 slice (iii) — bug-73 full-lifecycle integration (scope-bound + --repo paths)', () => {
  it('scope-bound mission: scope create → mission --scope → start → daemon-tick → complete-success', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });

    // Phase 1: scope create with the HTTP-fixture repo URL
    const scope = await mc.create('scope', { name: 'sandbox-scope', repo: bareRepoUrl });

    // Phase 2: mission --scope (bug-70 eager-inline code-path)
    const mission = await mc.create('mission', { name: 'scenario-02', scope: scope.id });
    const initial = await mc.get('mission', mission.id);
    expect(initial.scopeId).toBe(scope.id);
    expect(initial.repos.length).toBe(1);
    expect(initial.lifecycleState).toBe('configured');

    // Phase 3: start (real HTTP clone via fixture)
    await mc.start(mission.id);

    // Phase 4: daemon-tick auto-advances 'started' → 'in-progress' (fires at watcher-entry boot)
    await waitForLifecycle(mc, mission.id, 'in-progress');

    // Phase 5: operator-work — checkout mission branch + commit (real-world operator does this
    // between start and complete; complete's squash-loop requires mission/<id> to exist).
    const workspacePath = await mc.workspace(mission.id, 'sandbox');
    await simulateOperatorEdit(workspacePath);

    // Phase 6: complete-success — pre-v1.0.7 this threw "workspace handle missing for repo
    // 'sandbox'" because storage.list returned handles with empty repoUrl. Post-fix the basename
    // match succeeds, squash + push run, lifecycle advances to 'completed'.
    const result = await mc.complete(mission.id, 'integration-test publish');

    expect(result.lifecycleState).toBe('completed');
    expect(result.publishMessage).toBe('integration-test publish');
    expect(result.publishStatus?.['sandbox']).toBe('pr-opened');           // no RemoteProvider → marks pr-opened post-push
  }, 60_000);

  it('scope-bound mission: scope create → mission --scope → start → daemon-tick → abandon-success', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const scope = await mc.create('scope', { name: 'sandbox-scope-b', repo: bareRepoUrl });
    const mission = await mc.create('mission', { name: 'scenario-02b', scope: scope.id });

    await mc.start(mission.id);
    await waitForLifecycle(mc, mission.id, 'in-progress');

    // Operator-work seeds the mission branch so abandon's deleteBranch has something to remove.
    const workspacePath = await mc.workspace(mission.id, 'sandbox');
    await simulateOperatorEdit(workspacePath);

    // Same bug-73 surface but via abandon path (line 864 fix)
    const result = await mc.abandon(mission.id, 'integration-test cleanup');

    expect(result.lifecycleState).toBe('abandoned');
    expect(result.abandonMessage).toBe('integration-test cleanup');
    expect(result.abandonRepoStatus?.['sandbox']).toBe('cleaned');         // mission/<id> branch deleted via gitEngine
  }, 60_000);

  it('--repo direct-binding mission: same complete-success path (regression net for non-scope path)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });

    // --repo path (pre-bug-70 code-path; not scope-bound)
    const mission = await mc.create('mission', { name: 'direct-bind', repo: bareRepoUrl });
    expect((await mc.get('mission', mission.id)).scopeId).toBeUndefined();

    await mc.start(mission.id);
    await waitForLifecycle(mc, mission.id, 'in-progress');

    const workspacePath = await mc.workspace(mission.id, 'sandbox');
    await simulateOperatorEdit(workspacePath);

    const result = await mc.complete(mission.id, 'direct-bind publish');

    expect(result.lifecycleState).toBe('completed');
    expect(result.publishStatus?.['sandbox']).toBe('pr-opened');
  }, 60_000);
});
