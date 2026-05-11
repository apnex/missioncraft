// v1.0.6 slice (vi) — bug-72 `msn complete --purge-workspace` symmetric flag.
//
// Default behavior change: workspace PRESERVED by default at terminal `complete` (forensic-history).
// --purge-workspace opts-in to destroy (reuses abandon Step 6 substrate). Mutually exclusive with
// --retain per architect scope-question disposition.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Missioncraft, ConfigValidationError } from '@apnex/missioncraft';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-v106-vi-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('v1.0.6 slice (vi) — bug-72 complete --purge-workspace mutex validation', () => {
  it('complete with retain + purgeWorkspace combined throws ConfigValidationError', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(
      mc.complete('msn-1234abcd', 'msg', { retain: true, purgeWorkspace: true }),
    ).rejects.toThrow(/--retain and --purge-workspace are mutually exclusive/);
  });

  it('complete retains existing retain + purgeConfig mutex (backward-compat)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(
      mc.complete('msn-5678efef', 'msg', { retain: true, purgeConfig: true }),
    ).rejects.toThrow(/--retain and --purge-config are mutually exclusive/);
  });

  it('complete with only purgeWorkspace (no retain) does NOT throw on opts-validation', async () => {
    // Reaches FSM pre-flight (bug-68 slice iii) and throws not-found instead — proves opts-validation passed.
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(
      mc.complete('msn-99999999', 'msg', { purgeWorkspace: true }),
    ).rejects.toThrow(/mission 'msn-99999999' not found/);
  });

  it('complete with both purgeWorkspace + purgeConfig (full cleanup) does NOT throw on opts-validation', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(
      mc.complete('msn-99999999', 'msg', { purgeWorkspace: true, purgeConfig: true }),
    ).rejects.toThrow(/mission 'msn-99999999' not found/);
  });
});
