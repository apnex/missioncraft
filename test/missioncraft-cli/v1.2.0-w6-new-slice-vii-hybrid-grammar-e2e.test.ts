// v1.2.0 W6-new slice (vii) — End-to-end transparency-gate test for hybrid grammar.
//
// Per architect-spec thread-551 §2 slice (vii): operator-DX exercise of ALL new W6-new verb
// shapes per Design v5.0 §10.6 hybrid grammar three-class taxonomy. SDK-direct + parser-direct
// composition (SDK-composition + dispatch-layer per calibration #72 + #74); real-daemon end-to-
// end deferred to slice (viii) architect-dogfood (substrate-extension wire-flow gate).
//
// SHAPE assertions per calibration #72: parsed shape (verb + missionRef + positionals + flags) +
// SDK lifecycle transitions + slug-validation collision rejection + verb-first form rejection
// for mission-targeted verbs (slice v.b enforcement).

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Missioncraft, ConfigValidationError } from '@apnex/missioncraft';
import { parse } from '../../src/missioncraft-cli/grammar/parser.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w6-vii-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('v1.2.0 W6-new slice (vii) — Class (1) GLOBAL VERBS — verb-first; no mission target', () => {
  it('msn list (no positional) — globals dispatcher; no missionRef', () => {
    const parsed = parse(['list']);
    expect(parsed.verb).toBe('list');
    expect(parsed.missionRef).toBeUndefined();
    expect(parsed.positionals).toEqual([]);
  });

  it('msn version — globals; no missionRef', () => {
    const parsed = parse(['version']);
    expect(parsed.verb).toBe('--version');
    expect(parsed.missionRef).toBeUndefined();
  });

  it('msn config get <key> — globals with sub-action', () => {
    const parsed = parse(['config', 'get', 'defaults.workspace-root']);
    expect(parsed.verb).toBe('config');
    expect(parsed.subAction).toBe('get');
    expect(parsed.missionRef).toBeUndefined();
    expect(parsed.positionals).toEqual(['defaults.workspace-root']);
  });

  it('msn scope create --name <slug> — globals with sub-verb', () => {
    const parsed = parse(['scope', 'create', '--name', 'my-scope']);
    expect(parsed.verb).toBe('scope');
    expect(parsed.subAction).toBe('create');
    expect(parsed.missionRef).toBeUndefined();
    expect(parsed.flags.get('--name')).toBe('my-scope');
  });

  it('msn tree — globals; no missionRef', () => {
    const parsed = parse(['tree']);
    expect(parsed.verb).toBe('tree');
    expect(parsed.missionRef).toBeUndefined();
  });

  it('msn shell-init bash — globals with positional', () => {
    const parsed = parse(['shell-init', 'bash']);
    expect(parsed.verb).toBe('shell-init');
    expect(parsed.missionRef).toBeUndefined();
    expect(parsed.positionals).toEqual(['bash']);
  });
});

describe('v1.2.0 W6-new slice (vii) — Class (2) CREATION VERBS — verb-first; return mission-id; --start flag', () => {
  it('msn create [--repo url] — creation verb-first; SDK returns mission handle', async () => {
    const parsed = parse(['create', '--repo', 'https://github.com/example/repo.git']);
    expect(parsed.verb).toBe('create');
    expect(parsed.missionRef).toBeUndefined();
    expect(parsed.flags.get('--repo')).toBe('https://github.com/example/repo.git');
  });

  it('msn create --start — --start flag detected for sequential mc.create + mc.start composition', () => {
    const parsed = parse(['create', '--repo', 'https://github.com/example/repo.git', '--start']);
    expect(parsed.flags.has('--start')).toBe(true);
  });

  it('msn join <writer-id> [--start] — BRANCH-TRACKER reader creation', () => {
    const parsed = parse(['join', 'msn-12345678', '--start']);
    expect(parsed.verb).toBe('join');
    expect(parsed.missionRef).toBeUndefined();    // creation-verb verb-first; no missionRef
    expect(parsed.flags.has('--start')).toBe(true);
    expect(parsed.positionals).toEqual(['msn-12345678']);
  });

  it('msn watch --repo --branch [--start] — PERSISTENT-TRACKER reader creation', () => {
    const parsed = parse(['watch', '--repo', 'https://github.com/example/repo.git', '--branch', 'main', '--start']);
    expect(parsed.verb).toBe('watch');
    expect(parsed.missionRef).toBeUndefined();
    expect(parsed.flags.has('--start')).toBe(true);
  });

  it('SDK end-to-end: mc.create({name}) + slug-validation accepts valid DNS-style slug', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const handle = await mc.create('mission', { name: 'my-mission' });
    expect(handle.id).toMatch(/^msn-[a-f0-9]{8}$/);
    expect(handle.name).toBe('my-mission');
  });

  it('SDK slug-validation REJECTS verb-collision name (defense-in-depth at SDK layer)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    await expect(mc.create('mission', { name: 'show' })).rejects.toBeInstanceOf(ConfigValidationError);
    await expect(mc.create('mission', { name: 'show' })).rejects.toThrow(/reserved verb\/sub-action/);
  });
});

describe('v1.2.0 W6-new slice (vii) — Class (3) MISSION-TARGETED VERBS — id-first canonical', () => {
  it('msn <id> show — id-first form: missionRef set + verb=show', () => {
    const parsed = parse(['msn-12345678', 'show']);
    expect(parsed.verb).toBe('show');
    expect(parsed.missionRef).toBe('msn-12345678');
    expect(parsed.positionals[0]).toBe('msn-12345678');
  });

  it('bare msn <id> — defaults to show verb (operator-DX-convenience)', () => {
    const parsed = parse(['msn-12345678']);
    expect(parsed.verb).toBe('show');
    expect(parsed.missionRef).toBe('msn-12345678');
  });

  it('msn <id> start — id-first; idempotent semantic at CLI layer', () => {
    const parsed = parse(['msn-12345678', 'start']);
    expect(parsed.verb).toBe('start');
    expect(parsed.missionRef).toBe('msn-12345678');
  });

  it('msn <id> complete <message> — id-first with message positional', () => {
    const parsed = parse(['msn-12345678', 'complete', 'publish-message']);
    expect(parsed.verb).toBe('complete');
    expect(parsed.missionRef).toBe('msn-12345678');
    expect(parsed.positionals).toEqual(['msn-12345678', 'publish-message']);
  });

  it('msn <id> abandon <message> — id-first with message positional', () => {
    const parsed = parse(['msn-deadbeef', 'abandon', 'reason-text']);
    expect(parsed.verb).toBe('abandon');
    expect(parsed.missionRef).toBe('msn-deadbeef');
    expect(parsed.positionals).toEqual(['msn-deadbeef', 'reason-text']);
  });

  it('msn <id> workspace [<repo>] — id-first; optional repo positional', () => {
    const parsed = parse(['msn-12345678', 'workspace', 'backend']);
    expect(parsed.verb).toBe('workspace');
    expect(parsed.missionRef).toBe('msn-12345678');
  });

  it('msn <id> cd — id-first form (shell-fn wrapper required for actual cd)', () => {
    const parsed = parse(['msn-12345678', 'cd']);
    expect(parsed.verb).toBe('cd');
    expect(parsed.missionRef).toBe('msn-12345678');
  });

  it('msn <id> update <sub-action> [args] — id-first form for update', () => {
    const parsed = parse(['msn-fedcba98', 'update', 'name', 'new-alpha']);
    expect(parsed.verb).toBe('update');
    expect(parsed.missionRef).toBe('msn-fedcba98');
    expect(parsed.subAction).toBe('name');
  });
});

describe('v1.2.0 W6-new slice (vii) — Class (3) — verb-first form REJECTED (slice (v.b) enforcement)', () => {
  it('msn show <id> — verb-first REJECTED with id-first-form-required error', () => {
    expect(() => parse(['show', 'msn-12345678'])).toThrow(/requires id-first form/);
  });

  it('msn show <slug> — verb-first REJECTED (slugs also need id-lookup workflow)', () => {
    expect(() => parse(['show', 'alpha-mission'])).toThrow(/requires id-first form/);
  });

  it('msn start (no args) — REJECTED with id-first-form-required hint', () => {
    expect(() => parse(['start'])).toThrow(/requires id-first form/);
  });

  it('msn complete <id> <msg> — verb-first REJECTED', () => {
    expect(() => parse(['complete', 'msn-12345678', 'msg'])).toThrow(/requires id-first form/);
  });

  it('msn abandon <id> <msg> — verb-first REJECTED', () => {
    expect(() => parse(['abandon', 'msn-12345678', 'reason'])).toThrow(/requires id-first form/);
  });

  it('msn cd <id> — verb-first REJECTED (no coord-form ":")', () => {
    expect(() => parse(['cd', 'msn-12345678'])).toThrow(/requires id-first form/);
  });
});

describe('v1.2.0 W6-new slice (vii) — Coord-form exception (workspace + cd preserved)', () => {
  it('msn workspace <id>:<repo> — coord-form preserved (verb-first exception via Rule 7)', () => {
    const parsed = parse(['workspace', 'msn-12345678:backend']);
    expect(parsed.verb).toBe('workspace');
    expect(parsed.coordinate).toEqual({ mission: 'msn-12345678', repo: 'backend' });
  });

  it('msn workspace <id>:<repo>/<path> — coord-form with path-suffix preserved', () => {
    const parsed = parse(['workspace', 'msn-12345678:backend/src/app.ts']);
    expect(parsed.coordinate).toEqual({ mission: 'msn-12345678', repo: 'backend', path: 'src/app.ts' });
  });

  it('msn cd <id>:<repo> — coord-form preserved for cd', () => {
    const parsed = parse(['cd', 'msn-12345678:frontend']);
    expect(parsed.coordinate).toEqual({ mission: 'msn-12345678', repo: 'frontend' });
  });
});

describe('v1.2.0 W6-new slice (vii) — DROPPED verbs (slice (v) DROP)', () => {
  it('msn apply — REJECTED as unknown verb (slice (v) removed from RESERVED_VERBS)', () => {
    expect(() => parse(['apply'])).toThrow(/unknown verb 'apply'/);
  });

  it('msn tick <id> — REJECTED as unknown verb (slice (v) removed from RESERVED_VERBS)', () => {
    expect(() => parse(['tick', 'msn-12345678'])).toThrow(/unknown verb 'tick'/);
  });

  it('msn <id> tick — id-first form ALSO rejects (verb not in RESERVED_VERBS)', () => {
    expect(() => parse(['msn-12345678', 'tick'])).toThrow(/unknown verb 'tick'/);
  });

  it('SDK slug-validation accepts apply/tick as names (no longer in RESERVED_NAMES_PROTECTED_SDK)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    // Post-slice-(v) drop: apply + tick removed from reserved-set; valid as mission slugs
    const applyMission = await mc.create('mission', { name: 'apply' });
    expect(applyMission.name).toBe('apply');
    const tickMission = await mc.create('mission', { name: 'tick' });
    expect(tickMission.name).toBe('tick');
  });
});

describe('v1.2.0 W6-new slice (vii) — update verb-first PRESERVED (W6-new slice (v.b) exemption)', () => {
  it('msn update <id> <sub> — verb-first form PRESERVED for update sub-action shape', () => {
    const parsed = parse(['update', 'msn-12345678', 'name', 'new-name']);
    expect(parsed.verb).toBe('update');
    expect(parsed.subAction).toBe('name');
    expect(parsed.missionRef).toBeUndefined();    // verb-first; no missionRef
    expect(parsed.positionals).toEqual(['msn-12345678', 'new-name']);
  });

  it('msn update <slug> <sub> — verb-first slug access PRESERVED (engineer-judgment exemption)', () => {
    const parsed = parse(['update', 'alpha-mission', 'description', 'new desc text']);
    expect(parsed.verb).toBe('update');
    expect(parsed.subAction).toBe('description');
    expect(parsed.positionals).toEqual(['alpha-mission', 'new desc text']);
  });
});

// `leave` verb-first PRESERVED describe block DELETED in W7-new slice (iii) — leave verb removed
// entirely (CLI dispatch + arg-spec + RESERVED_VERBS + slug-validation set + mc.leave SDK).
