// v1.2.0 W3-new — Single-branch substrate-extension transparency gate test.
//
// THE dispositive transparency gate for THIS wave per thread-545 spec + carry-forward
// `feedback_substrate_extension_wire_flow_integration_test.md`. End-to-end Flow B canonical:
// operator-edits-files-only → daemon-watcher auto-commits to mission/<id> directly (no wip-branch
// sidecar) → msn complete → squashCommit + push → published-content has the operator's edits.
//
// Pre-v5.0: daemon committed to wip/<id> + publish-loop squashed mission/<id> (empty); the W2-
// extension dogfood surfaced this as recursive-defect-activation (Fix #3, #4, #5-debate).
// Post-v5.0: daemon commits to mission/<id> directly; publish-loop's squashCommit consumes
// mission/<id> non-empty; dogfood-failure-mode structurally eliminated.

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
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
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-v120-w3-new-'));
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
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

/** Poll for the mission-branch to advance past its initial-base SHA (i.e., daemon-watcher has
 * fired commitToRef at least once). Returns true if advanced within timeoutMs. */
async function waitForMissionBranchAdvance(
  workspacePath: string,
  missionId: string,
  baseSha: string,
  timeoutMs = 5000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', `refs/heads/mission/${missionId}`], { cwd: workspacePath });
      if (stdout.trim() !== baseSha) return true;
    } catch { /* ref may not exist yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

describe('v1.2.0 W3-new — Flow B canonical end-to-end: daemon-commit → mission-branch → complete → published', () => {
  it('operator edits files only (no manual git commit); daemon-watcher commits to mission/<id>; complete publishes the content', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: bareRepoUrl });
    await mc.start(handle.id);

    // Wait for daemon-watcher to advance lifecycle past 'started' (daemon spawned + first tick fired)
    const lifecycleDeadline = Date.now() + 5000;
    while (Date.now() < lifecycleDeadline) {
      const state = await mc.get('mission', handle.id);
      if (state.lifecycleState === 'in-progress') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Verify daemon spawned + mission-branch at base SHA initially
    const workspaces = await mc.storage.list(handle.id);
    expect(workspaces.length).toBe(1);
    const wsPath = workspaces[0].path;
    const { stdout: baseShaOut } = await execFileAsync('git', ['rev-parse', `refs/heads/mission/${handle.id}`], { cwd: wsPath });
    const baseSha = baseShaOut.trim();
    expect(baseSha).toMatch(/^[0-9a-f]{40}$/);

    // Flow B canonical: operator only edits a file; no `git add` + no `git commit`
    // (per Design v5.0 §2 row 2; per Flow-B-canonical operator-DX promise).
    // chokidar's daemon-watcher fires on `change` events (not `add`); modify the cloned README
    // (existing file) so the daemon picks up the edit on debounce.
    await writeFile(
      join(wsPath, 'README.md'),
      '# sandbox\n\nW3-new Flow B canonical test content — operator edited; daemon should auto-commit\n',
      'utf8',
    );

    // Daemon-watcher debounces (~200ms stabilityThreshold + 100ms pollInterval) then fires
    // commitToRef(refs/heads/mission/<id>, ...) — wait for mission-branch to advance past base
    const advanced = await waitForMissionBranchAdvance(wsPath, handle.id, baseSha, 8000);
    expect(advanced).toBe(true);

    // Verify mission-branch's HEAD-tree captures the operator's edit (README content updated)
    const { stdout: readmeContent } = await execFileAsync(
      'git', ['show', `refs/heads/mission/${handle.id}:README.md`], { cwd: wsPath },
    );
    expect(readmeContent).toContain('W3-new Flow B canonical test content');

    // Operator publishes via msn complete (Flow B canonical: operator never typed git)
    const result = await mc.complete(handle.id, 'W3-new Flow B canonical e2e test — daemon→mission→publish');
    expect(result.lifecycleState).toBe('completed');
    expect(result.publishStatus?.['sandbox']).toBe('pr-opened');

    // Verify upstream mission-branch was pushed + has the edited README content
    const { stdout: upstreamReadme } = await execFileAsync(
      'git', ['show', `refs/heads/mission/${handle.id}:README.md`], { cwd: bareDir },
    );
    expect(upstreamReadme).toContain('W3-new Flow B canonical test content');

    // Verify squashed publish content is non-empty (diff between upstream main and upstream mission-branch)
    const { stdout: diffStat } = await execFileAsync(
      'git', ['diff', '--stat', `refs/heads/main..refs/heads/mission/${handle.id}`], { cwd: bareDir },
    );
    expect(diffStat).toContain('README.md');
    expect(diffStat).toMatch(/1 file changed/);
  }, 60_000);
});
