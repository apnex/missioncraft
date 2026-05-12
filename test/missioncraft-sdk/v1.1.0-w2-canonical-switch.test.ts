// v1.1.0 W2 — mission-78 canonical-switch (gitEngineProviderName default → 'native-git').
//
// Per task-406: flip mission YAML default `gitEngineProviderName` from `'isomorphic-git'` to
// `'native-git'`. NativeGitEngine becomes the canonical default per Path D2 architectural decision.
//
// Coverage targets:
//
// §1 Default-injection contract — `new Missioncraft()` (no explicit gitEngine config) yields a
//    NativeGitEngine instance; `gitEngineProviderName` on a created mission resolves to
//    `'native-git'` (the canonical default post-W2).
//
// §2 Explicit-override contract — callers passing `config.gitEngine` instance OR mission YAML
//    with `gitEngine.provider: 'isomorphic-git'` continue to work unchanged (transparent
//    backward-compat through W3; W4 removes IsoEng entirely).
//
// §3 End-to-end transparency — mission-create + start with default 'native-git' produces same
//    observable behavior as pre-W2 (per W1 slice (iv) §3 IsoEng/NativeEng merge-parity verification).
//    Multi-word commit messages per `feedback_test_assertion_too_permissive_regex.md`; SPECIFIC
//    assertions on the resulting publishStatus / lifecycleState (not regex-disjoint).

import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Missioncraft, NativeGitEngine, IsomorphicGitEngine } from '@apnex/missioncraft';
import { createGitHttpFixture, type GitHttpFixture } from '../fixtures/git-http-fixture.js';

const execFileAsync = promisify(execFile);

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w2-canonical-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════════════════════════
// §1 Default-injection contract
// ════════════════════════════════════════════════════════════════════════════════════════

describe('v1.1.0 W2 §1 — default-injection: gitEngine defaults to NativeGitEngine post-canonical-switch', () => {
  it('new Missioncraft() (no explicit gitEngine config) instantiates a NativeGitEngine', () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    expect(mc.gitEngine).toBeInstanceOf(NativeGitEngine);
    expect(mc.gitEngine).not.toBeInstanceOf(IsomorphicGitEngine);
  });

  it('the canonical default providerName is "native-git"', () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    // Static class member — verifies the wired class is NativeGitEngine, not IsoEng
    expect((mc.gitEngine.constructor as typeof NativeGitEngine).providerName).toBe('native-git');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
// §2 Explicit-override contract — backward-compat through W3
// ════════════════════════════════════════════════════════════════════════════════════════

describe('v1.1.0 W2 §2 — explicit-override: callers can still inject IsoEng via config (W3-bridge)', () => {
  it('config.gitEngine = new IsomorphicGitEngine() overrides the canonical default', () => {
    const isoEng = new IsomorphicGitEngine();
    const mc = new Missioncraft({ workspaceRoot: tempRoot, gitEngine: isoEng });
    expect(mc.gitEngine).toBeInstanceOf(IsomorphicGitEngine);
    expect(mc.gitEngine).toBe(isoEng);
  });

  it('config.gitEngine = new NativeGitEngine() (explicit) is accepted (idempotent with default)', () => {
    const nativeEng = new NativeGitEngine();
    const mc = new Missioncraft({ workspaceRoot: tempRoot, gitEngine: nativeEng });
    expect(mc.gitEngine).toBe(nativeEng);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
// §3 End-to-end transparency — mission-create + start through default 'native-git'
// ════════════════════════════════════════════════════════════════════════════════════════

describe('v1.1.0 W2 §3 — end-to-end: mission lifecycle transparent through default NativeGitEngine', () => {
  let fixture: GitHttpFixture | undefined;
  let bareRepoUrl: string;

  beforeEach(async () => {
    const repoBase = join(tempRoot, 'origin-repos');
    const bareDir = join(repoBase, 'upstream.git');
    await mkdir(bareDir, { recursive: true });
    await execFileAsync('git', ['init', '--quiet', '--bare'], { cwd: bareDir });
    await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: bareDir });
    const seedDir = join(tempRoot, 'seed');
    await mkdir(seedDir, { recursive: true });
    await execFileAsync('git', ['init', '--quiet'], { cwd: seedDir });
    await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: seedDir });
    await execFileAsync('git', ['config', 'user.email', 'seed@x.com'], { cwd: seedDir });
    await execFileAsync('git', ['config', 'user.name', 'Seed'], { cwd: seedDir });
    await writeFile(join(seedDir, 'README.md'), '# upstream-content\n', 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: seedDir });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'initial canonical-switch test commit'], { cwd: seedDir });

    fixture = await createGitHttpFixture(repoBase, { autoCreate: false });
    bareRepoUrl = `${fixture.url}/upstream.git`;
    await execFileAsync('git', ['remote', 'add', 'origin', bareRepoUrl], { cwd: seedDir });
    await execFileAsync('git', ['push', 'origin', 'main'], { cwd: seedDir });
  });

  afterEach(async () => {
    if (fixture) {
      await fixture.close();
      fixture = undefined;
    }
  });

  it('create + start mission via default NativeGitEngine; mission record records gitEngineProviderName="native-git"', async () => {
    // Default constructor — no gitEngine override; should pick up canonical 'native-git'
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { repo: bareRepoUrl });
    const beforeStart = await mc.get('mission', handle.id);

    // Specific assertion (per feedback_test_assertion_too_permissive_regex.md): assert exact
    // value, not a regex covering both 'isomorphic-git' and 'native-git'
    expect(beforeStart.gitEngineProviderName).toBe('native-git');
    expect(beforeStart.lifecycleState).toBe('configured');

    // Lifecycle advance via the default engine — exercises real NativeGitEngine.clone end-to-end
    const startedHandle = await mc.start(handle.id);
    expect(startedHandle.id).toBe(handle.id);
    const afterStart = await mc.get('mission', handle.id);
    expect(afterStart.lifecycleState).toBe('started');
    expect(afterStart.gitEngineProviderName).toBe('native-git');     // unchanged across lifecycle

    // Workspace populated via NativeGitEngine.clone (the canonical-switch transparency target)
    const workspaces = await mc.storage.list(handle.id);
    expect(workspaces.length).toBe(1);
    expect(existsSync(join(workspaces[0].path, 'README.md'))).toBe(true);
  }, 30_000);

  it('explicit IsomorphicGitEngine override produces gitEngineProviderName="isomorphic-git" (W3-bridge)', async () => {
    // Override-path: existing callers using `gitEngine: new IsomorphicGitEngine()` still work
    const mc = new Missioncraft({ workspaceRoot: tempRoot, gitEngine: new IsomorphicGitEngine() });
    const handle = await mc.create('mission', { repo: bareRepoUrl });
    const created = await mc.get('mission', handle.id);
    expect(created.gitEngineProviderName).toBe('isomorphic-git');
  });
});
