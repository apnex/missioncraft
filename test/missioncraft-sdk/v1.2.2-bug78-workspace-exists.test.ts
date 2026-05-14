// mission-80 cluster-2 slice (vi) — bug-78 pre-clone workspace-state detection.
//
// Pre-fix: prior `msn start <id>` mid-flow failure (post-clone, pre-checkout) leaves
// partial workspace; retry `msn start <id>` fails with raw git "destination path already
// exists and is not an empty directory" error.
//
// Fix: pre-clone detection at missioncraft.ts. Three cases:
//   - empty/missing → clone normally
//   - non-empty + .git/HEAD present → idempotent retry; skip clone (proceed to checkout)
//   - non-empty + no .git/HEAD → partial state; throw MissionStateError with operator-DX
//     `rm -rf <path>` hint (avoids raw git error)

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Missioncraft, MissionStateError } from '@apnex/missioncraft';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-bug78-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('mission-80 bug-78 — pre-clone workspace-state detection', () => {
  it('partial workspace (non-empty + no .git/HEAD) throws clean operator-DX error', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { name: 'partial-ws-test', repo: 'file:///tmp/nonexistent-bug78' });

    const workspacePath = join(tempRoot, 'missions', handle.id, 'nonexistent-bug78');
    await mkdir(workspacePath, { recursive: true });
    await writeFile(join(workspacePath, 'leftover.txt'), 'partial state from prior failed start\n', 'utf8');

    await expect(mc.start(handle.id)).rejects.toMatchObject({
      message: expect.stringMatching(/workspace at .* exists but is not a clean clone/),
    });
    await expect(mc.start(handle.id)).rejects.toMatchObject({
      message: expect.stringMatching(/Manually `rm -rf .* then retry\./),
    });
    await expect(mc.start(handle.id)).rejects.toBeInstanceOf(MissionStateError);
  });
});
