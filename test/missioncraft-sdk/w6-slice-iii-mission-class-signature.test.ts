// W6 slice (iii) — mission-class signature integration audit-pass per Q5=b §2.7.2.
//
// Per task-401 §4: 5 targeted integration scenarios covering process-crash + disk-failure +
// network-partition + lock-timeout + multi-participant audit-pass. Architect-ratified
// dispositions (thread-526 round 3):
//
//   - Process-crash recovery: covered by daemon-shutdown surface in W4.4 slice tests
//     + #5 W4.4-carry-over (complete/abandon with-daemon) folded here as documentation marker
//   - Disk-failure recovery: doc-marker per Q5=b boundary (bundle-ops not implemented;
//     v4.10 PATCH item #12 substrate-completeness gap; v1.x carry-forward)
//   - Network-partition resilience: SUBSTANTIVE test below (mid-push fixture-close)
//   - Lock-timeout-recovery: covered by W4.4 slice (iii) daemon-IPC tests + storage-engine
//     dead-pid 7-step + W4.4 slice (i) lockfile-state tests
//   - Multi-participant cross-host topology: covered by W5c slice (iii) real-engine integration tests

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Missioncraft } from '@apnex/missioncraft';
import { createGitHttpFixture, type GitHttpFixture } from '../fixtures/git-http-fixture.js';

const execFileAsync = promisify(execFile);

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w6-iii-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('W6 slice (iii) — network-partition resilience (Q5=b §2.7.2 mission-class signature)', () => {
  it('pushWithRetry exponential-backoff exhausts retry budget when fixture closes mid-flight', async () => {
    // Set up a writer with bare repo on fixture
    const repoBase = join(tempRoot, 'coord-repos');
    const bareDir = join(repoBase, 'mission-coord.git');
    await mkdir(bareDir, { recursive: true });
    await execFileAsync('git', ['init', '--quiet', '--bare'], { cwd: bareDir });
    await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: bareDir });

    let fixture: GitHttpFixture | undefined = await createGitHttpFixture(repoBase, { autoCreate: false });
    const coordRemoteUrl = `${fixture.url}/mission-coord.git`;

    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: 'file:///tmp/w6-iii-1' });
    const ws = await mc.storage.allocate(handle.id, 'file:///tmp/w6-iii-1');
    await execFileAsync('git', ['init', '--quiet'], { cwd: ws.path });
    await execFileAsync('git', ['config', 'user.email', 'w@x.com'], { cwd: ws.path });
    await execFileAsync('git', ['config', 'user.name', 'W'], { cwd: ws.path });
    await writeFile(join(ws.path, 'data.txt'), 'data\n', 'utf8');
    await mc.gitEngine.commitToRef(ws, `refs/heads/wip/${handle.id}`, {
      message: 'wip-1',
      author: { name: 'W', email: 'w@x.com' },
      autoStage: true,
    });

    // Seed mission with reader + coord-remote
    const path = join(tempRoot, 'config', `${handle.id}.yaml`);
    const content = await readFile(path, 'utf8');
    const ts = new Date().toISOString();
    const block = `  participants:\n    - principal: writer@host\n      role: writer\n      added-at: ${ts}\n    - principal: reader@host\n      role: reader\n      added-at: ${ts}\n  coordination-remote: ${coordRemoteUrl}\n`;
    const updated = content
      .replace(/lifecycle-state: [\w-]+/, 'lifecycle-state: in-progress')
      .replace(/^repos:/m, `${block}repos:`);
    await writeFile(path, updated, 'utf8');

    // Verify push works while fixture is up
    const initialCount = await mc.pushWipToCoordRemote(handle.id);
    expect(initialCount).toBe(1);

    // Network-partition simulation: close fixture; subsequent push should fail after retry budget
    await fixture.close();
    fixture = undefined;

    // pushWithRetry attempts 3 backoff retries (100ms→400ms→1600ms) per W4.4 §2.6.3 spec.
    // pushWipToCoordRemote catches per-repo failures + returns success-count (0).
    const partitionedCount = await mc.pushWipToCoordRemote(handle.id);
    expect(partitionedCount).toBe(0);     // Network-partition exhausts retry budget; non-aborting

    // Cleanup is best-effort (afterEach handles tempRoot rm)
  }, 30_000);
});

describe('W6 slice (iii) — mission-class signature audit-pass coverage map', () => {
  it('NOTE: documentation marker for Q5=b §2.7.2 5-scenario coverage map', () => {
    // Per architect-ratified dispositions at thread-526 round 3:
    //
    // | Scenario | Coverage |
    // |---|---|
    // | Process-crash recovery (kill -9 mid-commit) | W4.4 slice (iii) daemon-IPC + dead-pid 7-step + W4.4 slice (iv) daemonTickAdvance tests |
    // | Disk-failure recovery (bundle-restore) | DOC-MARKER per Q5=b boundary; bundle-ops not implemented (v4.10 PATCH item #12 substrate-completeness gap; v1.x carry-forward) |
    // | Network-partition resilience (mid-push fixture-close) | W6 slice (iii) substantive test above ✓ |
    // | Lock-timeout-recovery | W4.4 slice (i) lockfile-state + W4.4 slice (iii) daemon-IPC tests; W2 storage-engine dead-pid coverage |
    // | Multi-participant cross-host topology | W5c slice (iii) real-engine integration tests (4 scenarios via fixture) |
    //
    // Cumulative mission-class signature coverage = SUBSTANTIAL across W4.4 + W5c + W6 slice (iii).
    // Disk-failure recovery doc-marker carries to v4.10 PATCH item #12 + v1.x roadmap; surfaced
    // explicitly in slice (iv) closing-audit doc per architect's pre-publish discipline.
    expect(true).toBe(true);
  });
});
