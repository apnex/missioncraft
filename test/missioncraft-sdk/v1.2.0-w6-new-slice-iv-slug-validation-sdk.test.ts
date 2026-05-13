// v1.2.0 W6-new slice (iv) — SDK-side slug-validation guard at create-time.
//
// Per (c) audit+SDK-defense disposition thread-550 round 6: defense-in-depth at SDK layer so
// non-CLI consumers (Hub-MCP via idea-291 future + direct API users) get the same parser-level
// validation as CLI parse-time check (`grammar/parser.ts:78` validateSlugFormat).
//
// SHAPE assertions per calibration #72: assert ConfigValidationError throw + specific
// error-message shape per rejection-reason class.
//
// Audit-component (a): RESERVED_NAMES_PROTECTED_SDK includes ALL W6-new hybrid grammar verbs.
// Engineer-audit verified at slice (iv): create/list/show/start/apply/update/complete/abandon/
// tick/scope/workspace/config/join/leave/watch/help/cd/shell-init/version/tree all included.
// Plus update sub-actions, scope sub-verbs, config sub-verbs.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Missioncraft, ConfigValidationError } from '@apnex/missioncraft';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w6-iv-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('v1.2.0 W6-new slice (iv) — SDK-side slug-validation: mission verb-collision rejection', () => {
  it('mc.create({name: "show"}) rejects W6-new mission-targeted verb', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(mc.create('mission', { name: 'show' })).rejects.toBeInstanceOf(ConfigValidationError);
    await expect(mc.create('mission', { name: 'show' })).rejects.toThrow(/reserved verb\/sub-action/);
  });

  it('mc.create({name: "complete"}) rejects W6-new mission-targeted verb', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(mc.create('mission', { name: 'complete' })).rejects.toBeInstanceOf(ConfigValidationError);
  });

  it('mc.create({name: "create"}) rejects creation-verb itself', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(mc.create('mission', { name: 'create' })).rejects.toThrow(/reserved verb\/sub-action/);
  });

  it('mc.create({name: "join"}) rejects W4-new BRANCH-TRACKER creation-verb', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(mc.create('mission', { name: 'join' })).rejects.toThrow(/reserved verb\/sub-action/);
  });

  it('mc.create({name: "watch"}) rejects W4-new PERSISTENT-TRACKER creation-verb', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(mc.create('mission', { name: 'watch' })).rejects.toThrow(/reserved verb\/sub-action/);
  });

  it('mc.create({name: "tree"}) rejects v1.0.4 global verb (idea-272)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(mc.create('mission', { name: 'tree' })).rejects.toThrow(/reserved verb\/sub-action/);
  });

  it('mc.create({name: "version"}) rejects v1.0.4 global verb (bug-66 item 1)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(mc.create('mission', { name: 'version' })).rejects.toThrow(/reserved verb\/sub-action/);
  });

  it('mc.create({name: "config"}) rejects global verb', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(mc.create('mission', { name: 'config' })).rejects.toThrow(/reserved verb\/sub-action/);
  });

  it('mc.create({name: "scope"}) rejects global verb (namespace-prefix collides with sub-verbs)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(mc.create('mission', { name: 'scope' })).rejects.toThrow(/reserved verb\/sub-action/);
  });

  it('mc.create({name: "shell-init"}) rejects v1.0.3 global verb (idea-269)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(mc.create('mission', { name: 'shell-init' })).rejects.toThrow(/reserved verb\/sub-action/);
  });
});

describe('v1.2.0 W6-new slice (iv) — SDK-side slug-validation: mission namespace + format rejection', () => {
  it('mc.create({name: "msn-12345678"}) rejects auto-id namespace prefix', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(mc.create('mission', { name: 'msn-12345678' })).rejects.toThrow(/auto-id namespace prefix/);
  });

  it('mc.create({name: "scp-deadbeef"}) rejects scope namespace prefix', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(mc.create('mission', { name: 'scp-deadbeef' })).rejects.toThrow(/auto-id namespace prefix/);
  });

  it('mc.create({name: "alpha:repo"}) rejects substrate-coordinate-collision', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(mc.create('mission', { name: 'alpha:repo' })).rejects.toThrow(/substrate-coordinate parsing/);
  });

  it('mc.create({name: "Invalid-Caps"}) rejects DNS-pattern violation (uppercase)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(mc.create('mission', { name: 'Invalid-Caps' })).rejects.toThrow(/DNS-style pattern/);
  });

  it('mc.create({name: ""}) rejects empty slug (DNS-pattern requires at least 2 chars)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(mc.create('mission', { name: '' })).rejects.toThrow(/DNS-style pattern/);
  });
});

describe('v1.2.0 W6-new slice (iv) — SDK-side slug-validation: scope mirror', () => {
  it('mc.create("scope", {name: "show"}) rejects W6-new mission-targeted verb (sister to mission)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(mc.create('scope', { name: 'show' })).rejects.toBeInstanceOf(ConfigValidationError);
    await expect(mc.create('scope', { name: 'show' })).rejects.toThrow(/reserved verb\/sub-action/);
  });

  it('mc.create("scope", {name: "tree"}) rejects v1.0.4 global verb (sister to mission)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(mc.create('scope', { name: 'tree' })).rejects.toThrow(/reserved verb\/sub-action/);
  });

  it('mc.create("scope", {name: "scp-12345678"}) rejects scope namespace prefix', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(mc.create('scope', { name: 'scp-12345678' })).rejects.toThrow(/auto-id namespace prefix/);
  });
});

describe('v1.2.0 W6-new slice (iv) — SDK-side slug-validation: ACCEPT-shapes (regression net)', () => {
  it('mc.create({name: "alpha-mission"}) accepts valid DNS-style slug', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { name: 'alpha-mission' });
    expect(handle.id).toMatch(/^msn-[a-f0-9]{8}$/);
    expect(handle.name).toBe('alpha-mission');
  });

  it('mc.create({name: "valid-slug-with-numbers-123"}) accepts valid alphanumeric slug', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { name: 'valid-slug-with-numbers-123' });
    expect(handle.name).toBe('valid-slug-with-numbers-123');
  });

  it('mc.create() WITHOUT name (undefined) accepted (slug-validation only fires when name set)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', {});
    expect(handle.id).toMatch(/^msn-[a-f0-9]{8}$/);
    expect(handle.name).toBeUndefined();
  });

  it('mc.create("scope", {name: "valid-scope"}) accepts valid DNS-style slug', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('scope', { name: 'valid-scope' });
    expect(handle.id).toMatch(/^scp-[a-f0-9]{8}$/);
    expect(handle.name).toBe('valid-scope');
  });
});
