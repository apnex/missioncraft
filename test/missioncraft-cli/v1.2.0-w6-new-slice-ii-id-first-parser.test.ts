// v1.2.0 W6-new slice (ii) — id-first parser detection (γ disposition).
//
// Per architect-disposition thread-550 round 2: parser-level pattern-detection (msn-<8hex>) only;
// dispatcher resolves slug → id via mc.resolveMissionRef AFTER parse. Slugs (operator-assigned
// names) NOT detected at parser; verb-first form retained for slug access. Slug-validation guard
// at slice (iv) prevents future verb-collision-prone names.
//
// SHAPE assertions per calibration #72: assert parsed shape (verb + missionRef + positionals)
// for both id-first form (NEW W6-new) and verb-first form (legacy v1.x; retained for slugs +
// global-class verbs).

import { describe, it, expect } from 'vitest';
import { parse } from '../../src/missioncraft-cli/grammar/parser.js';

describe('v1.2.0 W6-new slice (ii) — id-first parser detection', () => {
  it('id-first `msn <msn-id> show`: missionRef set; verb=show; positionals[0]=missionRef (prepended for back-compat)', () => {
    const parsed = parse(['msn-12345678', 'show']);
    expect(parsed.verb).toBe('show');
    expect(parsed.missionRef).toBe('msn-12345678');
    expect(parsed.positionals[0]).toBe('msn-12345678');
  });

  it('id-first `msn <msn-id> complete "msg"`: missionRef + verb=complete + positionals[1]=msg', () => {
    const parsed = parse(['msn-deadbeef', 'complete', 'publish-message']);
    expect(parsed.verb).toBe('complete');
    expect(parsed.missionRef).toBe('msn-deadbeef');
    expect(parsed.positionals).toEqual(['msn-deadbeef', 'publish-message']);
  });

  it('id-first `msn <msn-id> abandon "msg"`: same shape as complete', () => {
    const parsed = parse(['msn-cafef00d', 'abandon', 'abandon-reason']);
    expect(parsed.verb).toBe('abandon');
    expect(parsed.missionRef).toBe('msn-cafef00d');
    expect(parsed.positionals).toEqual(['msn-cafef00d', 'abandon-reason']);
  });

  it('id-first `msn <msn-id> start`: verb=start; missionRef set', () => {
    const parsed = parse(['msn-aabbccdd', 'start']);
    expect(parsed.verb).toBe('start');
    expect(parsed.missionRef).toBe('msn-aabbccdd');
    expect(parsed.positionals).toEqual(['msn-aabbccdd']);
  });

  it('id-first bare `msn <msn-id>` (no verb): defaults to `show` verb (quick-inspect convenience)', () => {
    const parsed = parse(['msn-11223344']);
    expect(parsed.verb).toBe('show');
    expect(parsed.missionRef).toBe('msn-11223344');
    expect(parsed.positionals[0]).toBe('msn-11223344');
  });

  it('id-first `msn <msn-id> workspace <repo>`: positionals includes repo arg', () => {
    const parsed = parse(['msn-deadc0de', 'workspace', 'my-repo']);
    expect(parsed.verb).toBe('workspace');
    expect(parsed.missionRef).toBe('msn-deadc0de');
    expect(parsed.positionals).toEqual(['msn-deadc0de', 'my-repo']);
  });

  it('id-first `msn <msn-id> update name new-name`: sub-action update + name shape', () => {
    const parsed = parse(['msn-fedcba98', 'update', 'name', 'new-alpha']);
    expect(parsed.verb).toBe('update');
    expect(parsed.missionRef).toBe('msn-fedcba98');
    expect(parsed.subAction).toBe('name');
    expect(parsed.positionals).toEqual(['msn-fedcba98', 'new-alpha']);
  });

  it('verb-first `msn show <msn-id>` REJECTED at slice (v.b) (no-backward-compat per Design v5.0 §10.6)', () => {
    // mission-78 W6-new slice (v.b): verb-first form for mission-targeted verbs REMOVED entirely.
    // Operator-DX-clear error directs to id-first form `msn <id> show`. Replaces the slice (ii)
    // transitional state where both forms were parseable.
    expect(() => parse(['show', 'msn-12345678'])).toThrow(/requires id-first form/);
  });

  it('verb-first `msn create --repo X` (creation verb; no missionRef)', () => {
    const parsed = parse(['create', '--repo', 'https://github.com/example/repo.git']);
    expect(parsed.verb).toBe('create');
    expect(parsed.missionRef).toBeUndefined();
    expect(parsed.flags.get('--repo')).toBe('https://github.com/example/repo.git');
  });

  it('verb-first `msn list` (global verb; no missionRef)', () => {
    const parsed = parse(['list']);
    expect(parsed.verb).toBe('list');
    expect(parsed.missionRef).toBeUndefined();
  });

  it('verb-first `msn show <slug-name>` REJECTED at slice (v.b) (slug-via-verb-first removed; use msn list + id-first)', () => {
    // mission-78 W6-new slice (v.b): verb-first form removed for ALL mission-targeted verbs,
    // regardless of positional shape (id OR slug). Operator workflow: `msn list` to find id,
    // then `msn <id> show`. Per (γ) parser disposition, slugs are NOT detected at parse-time;
    // only canonical msn-<8hex> ids trigger id-first form.
    expect(() => parse(['show', 'alpha-mission'])).toThrow(/requires id-first form/);
  });

  it('rejects partial-hex msn-id (less than 8 hex chars) — not matched as id-first; verb-first parsing applies', () => {
    // `msn-abc` (3 hex) — doesn't match canonical id pattern → not id-first
    // Will be tokenized as verb (rejected as unknown verb since 'msn-abc' isn't in RESERVED_VERBS)
    expect(() => parse(['msn-abc', 'show'])).toThrow(/unknown verb 'msn-abc'/);
  });

  it('rejects uppercase-hex msn-id (id pattern requires lowercase) — not matched as id-first', () => {
    // `msn-DEADBEEF` (uppercase hex) — doesn't match [a-f0-9]+ → not id-first
    expect(() => parse(['msn-DEADBEEF', 'show'])).toThrow(/unknown verb 'msn-DEADBEEF'/);
  });

  it('rejects mission-id with verb that is not in RESERVED_VERBS', () => {
    // `msn msn-12345678 nonexistent-verb` → id-first detected, but 'nonexistent-verb' not in
    // RESERVED_VERBS so falls back to verb-not-found path. SHAPE: should reject cleanly.
    expect(() => parse(['msn-12345678', 'nonexistent-verb'])).toThrow(/unknown verb 'nonexistent-verb'/);
  });
});
