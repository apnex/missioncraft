// mission-80 slice (vii) — MSN_WORKSPACE_ROOT env-var implementation.
//
// Pre-fix: docs (docs/scenarios/01-readonly-single-repo.md:78 + operator-config-schema.ts:50)
// referenced MSN_WORKSPACE_ROOT env-var precedence as if implemented; only
// options.workspaceRoot > ~/.missioncraft was implemented (env-var read missing at SDK +
// LocalFilesystemStorage default-resolution sites).
//
// Fix: SDK constructor + LocalFilesystemStorage constructor now read process.env.MSN_WORKSPACE_ROOT
// when options.workspaceRoot is undefined; precedence chain now:
//   1. options.workspaceRoot (explicit; CLI's --workspace-root flag lands here)
//   2. process.env.MSN_WORKSPACE_ROOT
//   3. ~/.missioncraft (default)

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { Missioncraft } from '@apnex/missioncraft';
import { LocalFilesystemStorage } from '../../src/missioncraft-sdk/defaults/local-filesystem-storage.js';

let tempRoot: string;
let origEnv: string | undefined;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-msn-env-'));
  origEnv = process.env.MSN_WORKSPACE_ROOT;
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  if (origEnv === undefined) delete process.env.MSN_WORKSPACE_ROOT;
  else process.env.MSN_WORKSPACE_ROOT = origEnv;
});

describe('mission-80 slice (vii) — MSN_WORKSPACE_ROOT env-var precedence', () => {
  it('options.workspaceRoot wins over MSN_WORKSPACE_ROOT env-var (Missioncraft)', () => {
    process.env.MSN_WORKSPACE_ROOT = '/some/env-root';
    const explicitRoot = tempRoot;
    const mc = new Missioncraft({ workspaceRoot: explicitRoot });
    expect(mc.workspaceRoot).toBe(resolve(explicitRoot));                         // options wins
  });

  it('MSN_WORKSPACE_ROOT env-var used when options.workspaceRoot absent (Missioncraft)', () => {
    process.env.MSN_WORKSPACE_ROOT = tempRoot;
    const mc = new Missioncraft();
    expect(mc.workspaceRoot).toBe(resolve(tempRoot));                             // env-var wins over default
  });

  it('default ~/.missioncraft used when both options + env-var absent (Missioncraft)', () => {
    delete process.env.MSN_WORKSPACE_ROOT;
    const mc = new Missioncraft();
    expect(mc.workspaceRoot).toBe(resolve(join(homedir(), '.missioncraft')));     // default
  });

  it('empty-string env-var treated as unset; falls through to default (Missioncraft)', () => {
    process.env.MSN_WORKSPACE_ROOT = '';
    const mc = new Missioncraft();
    expect(mc.workspaceRoot).toBe(resolve(join(homedir(), '.missioncraft')));     // empty-string → unset → default
  });

  it('options.workspaceRoot wins over MSN_WORKSPACE_ROOT (LocalFilesystemStorage direct)', () => {
    process.env.MSN_WORKSPACE_ROOT = '/some/env-root';
    const explicitRoot = tempRoot;
    const storage = new LocalFilesystemStorage({ workspaceRoot: explicitRoot });
    expect((storage as unknown as { workspaceRoot: string }).workspaceRoot).toBe(resolve(explicitRoot));
  });

  it('MSN_WORKSPACE_ROOT env-var used when options absent (LocalFilesystemStorage direct)', () => {
    process.env.MSN_WORKSPACE_ROOT = tempRoot;
    const storage = new LocalFilesystemStorage();
    expect((storage as unknown as { workspaceRoot: string }).workspaceRoot).toBe(resolve(tempRoot));
  });
});
