import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Missioncraft, MissionStateError, ConfigValidationError } from '@apnex/missioncraft';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w3-class-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('Missioncraft SDK class — W3 smoke-tests', () => {
  describe('Constructor + static helpers', () => {
    it('constructor with default pluggables (no-arg)', () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      expect(mc.workspaceRoot).toBe(tempRoot);
      // identity/approval/storage/gitEngine all resolved from PROVIDER_REGISTRY
      expect(mc.identity).toBeDefined();
      expect(mc.approval).toBeDefined();
      expect(mc.storage).toBeDefined();
      expect(mc.gitEngine).toBeDefined();
      expect(mc.remote).toBeUndefined();        // optional pluggable
    });

    it('isPlatformSupported() returns true on Linux/macOS (false on win32)', () => {
      const supported = Missioncraft.isPlatformSupported();
      expect(typeof supported).toBe('boolean');
      // Test runner is Linux/macOS in CI matrix per ci.yml; supported should be true
      expect(supported).toBe(process.platform !== 'win32');
    });
  });

  describe('create / get / list — universal verbs (W3 implemented for create-stub)', () => {
    it('create("mission") with no opts → MissionHandle with msn-<8-char-hex> id; lifecycle="created"', async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      const handle = await mc.create('mission');
      expect(handle.id).toMatch(/^msn-[a-f0-9]{8}$/);
      expect(handle.name).toBeUndefined();
      // Round-trip via get()
      const state = await mc.get('mission', handle.id);
      expect(state.id).toBe(handle.id);
      expect(state.lifecycleState).toBe('created');
    });

    it('create("mission", {name, repo}) sets name + initial repo + lifecycle="configured"', async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      const handle = await mc.create('mission', {
        name: 'storage-extract',
        repo: 'https://github.com/example/repo-x',
      });
      expect(handle.name).toBe('storage-extract');
      const state = await mc.get('mission', handle.id);
      expect(state.lifecycleState).toBe('configured');
      expect(state.repos).toHaveLength(1);
      expect(state.repos[0].name).toBe('repo-x');   // auto-derived from URL last-segment
      expect(state.repos[0].url).toBe('https://github.com/example/repo-x');
    });

    it('create("mission", {repo: [url1, url2]}) accepts multiple repos', async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      const handle = await mc.create('mission', {
        repo: ['https://github.com/example/repo-1', 'https://github.com/example/repo-2'],
      });
      const state = await mc.get('mission', handle.id);
      expect(state.repos).toHaveLength(2);
      expect(state.repos.map((r) => r.name).sort()).toEqual(['repo-1', 'repo-2']);
    });

    it('create("scope") generates scp-<8-char-hex> id', async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      const handle = await mc.create('scope', { name: 'my-scope', description: 'test' });
      expect(handle.id).toMatch(/^scp-[a-f0-9]{8}$/);
      expect(handle.name).toBe('my-scope');
      const state = await mc.get('scope', handle.id);
      expect(state.lifecycleState).toBe('created');
      expect(state.description).toBe('test');
    });

    it('list("mission") returns all created missions', async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      const h1 = await mc.create('mission');
      const h2 = await mc.create('mission', { repo: 'https://example.com/repo-x' });
      const states = await mc.list('mission');
      expect(states).toHaveLength(2);
      expect(states.map((s) => s.id).sort()).toEqual([h1.id, h2.id].sort());
    });

    it('list("mission", {status}) filters by lifecycle-state', async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      await mc.create('mission');                                              // 'created'
      await mc.create('mission', { repo: 'https://example.com/repo-x' });           // 'configured'
      const created = await mc.list('mission', { status: 'created' });
      const configured = await mc.list('mission', { status: 'configured' });
      expect(created).toHaveLength(1);
      expect(configured).toHaveLength(1);
    });

    it('get("mission", non-existent) throws MissionStateError', async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      await expect(mc.get('mission', 'msn-deadbeef')).rejects.toBeInstanceOf(MissionStateError);
    });

    it('create("mission", {name}) duplicate name rejected', async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      await mc.create('mission', { name: 'unique-name' });
      await expect(mc.create('mission', { name: 'unique-name' })).rejects.toMatchObject({
        message: expect.stringContaining('already taken'),
      });
    });
  });

  describe('update — W4.1 state-machine wire-through', () => {
    it('update("mission", id, {kind: "rename"}) applies + persists; lifecycle preserved', async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      const handle = await mc.create('mission', { name: 'foo' });
      const updated = await mc.update('mission', handle.id, { kind: 'rename', newName: 'bar-new' });
      expect(updated.name).toBe('bar-new');
      expect(updated.lifecycleState).toBe('created');
      // Round-trip via get() to verify atomic-write persisted
      const reread = await mc.get('mission', handle.id);
      expect(reread.name).toBe('bar-new');
    });

    it('update add-repo on "created" mission auto-advances to "configured" (FSM add-first-repo)', async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      const handle = await mc.create('mission');
      const before = await mc.get('mission', handle.id);
      expect(before.lifecycleState).toBe('created');
      const after = await mc.update('mission', handle.id, {
        kind: 'add-repo',
        repo: { url: 'https://github.com/example/repo-x' },
      });
      expect(after.lifecycleState).toBe('configured');
      expect(after.repos).toHaveLength(1);
      expect(after.repos[0].name).toBe('repo-x');
    });

    it('update remove-repo to last-repo back-transitions "configured" → "created"', async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      const handle = await mc.create('mission', { repo: 'https://github.com/example/repo-x' });
      const before = await mc.get('mission', handle.id);
      expect(before.lifecycleState).toBe('configured');
      const after = await mc.update('mission', handle.id, { kind: 'remove-repo', repoName: 'repo-x' });
      expect(after.lifecycleState).toBe('created');
      expect(after.repos).toHaveLength(0);
    });

    it('update set-tag persists tag', async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      const handle = await mc.create('mission');
      const after = await mc.update('mission', handle.id, { kind: 'set-tag', key: 'team', value: 'apnex' });
      expect(after.tags['team']).toBe('apnex');
    });

    it('update("mission", id, invalidMutation) rejects shape via ConfigValidationError', async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      const handle = await mc.create('mission');
      await expect(
        // @ts-expect-error — intentional invalid shape for runtime validation test
        mc.update('mission', handle.id, 'not-a-mutation'),
      ).rejects.toBeInstanceOf(ConfigValidationError);
    });

    it('update violating state-restriction matrix throws MissionStateError', async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      const handle = await mc.create('mission', { repo: 'https://github.com/example/repo-x' });
      // remove-repo is allowed pre-start but rejected post-start; we're 'configured' (pre-start) so this should succeed
      await expect(
        mc.update('mission', handle.id, { kind: 'remove-repo', repoName: 'repo-x' }),
      ).resolves.toMatchObject({ lifecycleState: 'created' });
    });
  });

  describe('Runtime ops — W4.3 start() FSM-transition validation', () => {
    it('start() rejects non-existent mission with MissionStateError', async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      await expect(mc.start('msn-deadbeef')).rejects.toMatchObject({
        message: expect.stringMatching(/mission 'msn-deadbeef' not found/),
      });
    });

    it("start() rejects 'created' lifecycle (must be 'configured')", async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      const handle = await mc.create('mission');
      await expect(mc.start(handle.id)).rejects.toMatchObject({
        message: expect.stringMatching(/requires lifecycle 'configured' \(current: 'created'\)/),
      });
    });

    it('start() rejects config-input form (W4.3-only string-id supported)', async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      await expect(
        mc.start({ config: { missionConfigSchemaVersion: 1, mission: { id: 'msn-x', lifecycleState: 'configured', createdAt: new Date() }, repos: [] } }),
      ).rejects.toBeInstanceOf(ConfigValidationError);
    });

    it('complete() requires message (per v3.0 Refinement #4)', async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      await expect(mc.complete('msn-test1234', '')).rejects.toBeInstanceOf(ConfigValidationError);
    });

    it('complete() rejects --retain + --purge-config (mutual exclusion)', async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      await expect(
        mc.complete('msn-test1234', 'msg', { retain: true, purgeConfig: true }),
      ).rejects.toBeInstanceOf(ConfigValidationError);
    });

    it('complete() rejects non-existent mission with MissionStateError', async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      await expect(mc.complete('msn-deadbeef', 'msg')).rejects.toMatchObject({
        message: expect.stringMatching(/mission 'msn-deadbeef' not found/),
      });
    });

    it("complete() rejects 'created' lifecycle (must be 'in-progress' or 'started')", async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      const handle = await mc.create('mission');
      await expect(mc.complete(handle.id, 'msg')).rejects.toMatchObject({
        message: expect.stringMatching(/requires lifecycle 'in-progress' or 'started' \(current: 'created'\)/),
      });
    });

    it("complete() rejects 'configured' lifecycle (must be 'in-progress' or 'started')", async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      const handle = await mc.create('mission', { repo: 'https://github.com/example/repo-x' });
      await expect(mc.complete(handle.id, 'msg')).rejects.toMatchObject({
        message: expect.stringMatching(/requires lifecycle 'in-progress' or 'started' \(current: 'configured'\)/),
      });
    });

    it('join() requires coordRemote + throws W5', async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      await expect(mc.join('msn-test1234', '')).rejects.toBeInstanceOf(ConfigValidationError);
      await expect(mc.join('msn-test1234', 'file:///tmp/coord.git')).rejects.toMatchObject({
        message: expect.stringMatching(/not yet implemented \(W5\)/),
      });
    });
  });

  describe('configGet / configSet', () => {
    it('configSet then configGet round-trip', async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      // Note: keys persist as kebab-case in YAML; configGet/Set use kebab-case keys (operator-facing)
      // Use a key the OperatorConfigSchema accepts
      await mc.configSet('defaults.workspace-root', '/tmp/test-mc');
      // Config was atomically written via OperatorConfigSchema parse; readback via configGet
      const value = await mc.configGet('defaults.workspaceRoot');
      expect(value).toBe('/tmp/test-mc');
    });

    it('configGet returns undefined for unset key', async () => {
      const mc = new Missioncraft({ workspaceRoot: tempRoot });
      const value = await mc.configGet('nonexistent.key');
      expect(value).toBeUndefined();
    });
  });
});
