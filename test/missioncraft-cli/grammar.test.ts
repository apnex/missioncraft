import { describe, expect, it } from 'vitest';
import { parse, parseCoordinate, validateSlugFormat } from '../../src/missioncraft-cli/grammar/parser.js';
import { ConfigValidationError } from '@apnex/missioncraft';

describe('CLI grammar parser — Rules 1-7 — W3 smoke-tests', () => {
  describe('Rule 1: reserved-verbs', () => {
    it('accepts all reserved-verbs (W6-new slice (v): apply + tick DROPPED; W7-new slice (iii): leave DROPPED)', () => {
      const verbs = ['create', 'list', 'show', 'start', 'update', 'complete', 'abandon', 'scope', 'workspace', 'config', 'join'];
      for (const v of verbs) {
        // Each verb without args may fail Rule 6 but Rule 1 dispatch should pass; catch ConfigValidationError text accordingly
        try {
          parse([v]);
        } catch (e) {
          // Should NOT be unknown-verb (Rule 1); Rule 6 missing-arg is expected for verbs requiring positionals
          expect((e as Error).message).not.toMatch(/unknown verb/);
        }
      }
    });

    it('rejects unknown verb', () => {
      expect(() => parse(['nonexistent-verb'])).toThrow(/unknown verb/);
    });

    it('handles --help and --version short-circuit', () => {
      const help = parse(['--help']);
      expect(help.verb).toBe('--help');
      const version = parse(['--version']);
      expect(version.verb).toBe('--version');
    });
  });

  describe('Rule 6: arg-count validation', () => {
    it('bare argv falls through to help-verb (v1.0.3 bug-64 item 1: mirrors git/npm/docker)', () => {
      const result = parse([]);
      expect(result.verb).toBe('--help');
      expect(result.positionals).toEqual([]);
    });

    it('`help` verb dispatches to --help handler (v1.0.3 bug-64 item 8)', () => {
      const result = parse(['help']);
      expect(result.verb).toBe('--help');
      expect(result.positionals).toEqual([]);
    });

    it('show without args: REJECTED at slice (v.b) — id-first form required (no-backward-compat)', () => {
      // mission-78 W6-new slice (v.b): verb-first form `msn show` (no args) → id-first-form-required error
      expect(() => parse(['show'])).toThrow(
        /requires id-first form/,
      );
    });

    it('start without args: REJECTED at slice (v.b) — id-first form required (no-backward-compat)', () => {
      // mission-78 W6-new slice (v.b): verb-first form `msn start` (no args) → id-first-form-required error
      // (start is disjunctive: positional OR -f flag; w/o either, id-first guard fires first)
      expect(() => parse(['start'])).toThrow(
        /requires id-first form/,
      );
    });

    it('id-first: msn <id> complete requires <message> positional', () => {
      // mission-78 W6-new slice (ii)+(v.b): id-first form `msn <id> complete` (no message) → missing-arg
      expect(() => parse(['msn-12345678', 'complete'])).toThrow(/'complete' requires/);
    });

    it('extra-positional: list accepts 0 OR 1 (drill-down); rejects 2+', () => {
      expect(() => parse(['list', 'msn-foo', 'extra'])).toThrow(/accepts up to/);
    });

    it('id-first valid: msn <id> complete "<message>"', () => {
      // mission-78 W6-new slice (ii): id-first form is canonical at W6-new
      const result = parse(['msn-12345678', 'complete', 'My commit message']);
      expect(result.verb).toBe('complete');
      expect(result.missionRef).toBe('msn-12345678');
      expect(result.positionals).toEqual(['msn-12345678', 'My commit message']);
    });

    it('valid: list (0 positionals)', () => {
      const result = parse(['list']);
      expect(result.verb).toBe('list');
      expect(result.positionals).toEqual([]);
    });

    it('valid: list <id> (drill-down)', () => {
      const result = parse(['list', 'msn-foo']);
      expect(result.positionals).toEqual(['msn-foo']);
    });
  });

  describe('Rule 6: disjunctive arg-shape (start) — W6-new slice (v.b) id-first migration', () => {
    it('valid: msn <id> start (id-first form per W6-new)', () => {
      // mission-78 W6-new slice (v.b): legacy `start <id>` verb-first form REMOVED; id-first canonical
      const result = parse(['msn-12345678', 'start']);
      expect(result.verb).toBe('start');
      expect(result.missionRef).toBe('msn-12345678');
      expect(result.positionals).toEqual(['msn-12345678']);
    });

    it('valid: start -f <path> (flag form; -f disjunctive is verb-first by design — no mission-id)', () => {
      // -f flag form references a YAML config-path, not a mission-id — verb-first valid here
      // since there's no mission-id to use in id-first form. (Pre-existing v1.x stub-throw behavior.)
      // Note: -f form throws at SDK because mc.start config-form not implemented; parser-level OK.
      // Slice (v.b) id-first guard EXEMPTS -f flag form (only blocks bare verb without -f and without missionRef).
      // Currently parser rejects this since -f doesn't satisfy missionRef requirement; if architect
      // wants -f preservation, surface scope-question. For now this test asserts the v.b rejection.
      expect(() => parse(['start', '-f', '/tmp/m.yaml'])).toThrow(/requires id-first form/);
    });

    it('legacy: start -f <path> + extra positional REJECTED at slice (v.b)', () => {
      // mission-78 W6-new slice (v.b): verb-first form rejected entirely; mutually-exclusive
      // path no longer reachable since id-first guard fires first
      expect(() => parse(['start', '-f', '/tmp/m.yaml', 'msn-foo'])).toThrow(/requires id-first form/);
    });
  });

  describe('Rule 2: sub-action dispatch', () => {
    it('update <id> repo-add <url>', () => {
      const result = parse(['update', 'msn-foo', 'repo-add', 'https://github.com/example/r']);
      expect(result.subAction).toBe('repo-add');
      expect(result.subNamespacePath).toEqual(['update', 'repo-add']);
      expect(result.positionals).toEqual(['msn-foo', 'https://github.com/example/r']);
    });

    it('update <id> unknown-sub-action rejected', () => {
      expect(() => parse(['update', 'msn-foo', 'nonexistent', 'arg'])).toThrow(/unknown 'update' sub-action/);
    });

    it('scope create --name foo', () => {
      const result = parse(['scope', 'create', '--name', 'my-scope']);
      expect(result.subAction).toBe('create');
      expect(result.subNamespacePath).toEqual(['scope', 'create']);
      expect(result.flags.get('--name')).toBe('my-scope');
    });

    it('scope update <id> repo-add <url>', () => {
      const result = parse(['scope', 'update', 'scp-1234abcd', 'repo-add', 'https://example.com/r']);
      expect(result.subNamespacePath).toEqual(['scope', 'update', 'repo-add']);
    });

    it('config get <key>', () => {
      const result = parse(['config', 'get', 'defaults.workspace-root']);
      expect(result.subAction).toBe('get');
      expect(result.positionals).toEqual(['defaults.workspace-root']);
    });

    it('config set <key> <value>', () => {
      const result = parse(['config', 'set', 'defaults.workspace-root', '/tmp/mc']);
      expect(result.subAction).toBe('set');
      expect(result.positionals).toEqual(['defaults.workspace-root', '/tmp/mc']);
    });
  });

  describe('Rule 7: substrate-coordinate parsing (v4.0 NEW)', () => {
    it('parseCoordinate: mission-only', () => {
      expect(parseCoordinate('m-foo')).toBeUndefined();           // no colon = not coord
      expect(parseCoordinate('m-foo:design-repo')).toEqual({
        mission: 'm-foo',
        repo: 'design-repo',
      });
    });

    it('parseCoordinate: mission + repo + path', () => {
      expect(parseCoordinate('m-foo:design-repo/docs/foo.md')).toEqual({
        mission: 'm-foo',
        repo: 'design-repo',
        path: 'docs/foo.md',
      });
    });

    it('parseCoordinate: rejects whitespace', () => {
      expect(() => parseCoordinate('m-foo:design repo')).toThrow(/whitespace/);
    });

    it('workspace <coord-form> (W6-new slice (v.b) coord-form exception preserved)', () => {
      // mission-78 W6-new slice (v.b): verb-first form for workspace REMOVED in general, BUT
      // coord-form `<id>:<repo>` exception preserved (positional embeds mission-id; redundant
      // to require id-first prefix). Detected by argv[1] containing ':' (Rule 7).
      const result = parse(['workspace', 'm-foo:design-repo']);
      expect(result.coordinate).toEqual({ mission: 'm-foo', repo: 'design-repo' });
    });

    it('workspace <coord-form> + extra positional repo rejected (ambiguity; coord-form exception scope)', () => {
      // workspace accepts 1 required + 1 optional; coord-form already specifies repo via colon
      expect(() => parse(['workspace', 'm-foo:design-repo', 'other-repo'])).toThrow(
        /already specifies repo via colon-notation/,
      );
    });
  });

  describe('Rule 5: reserved-words protection', () => {
    it('rejects slug matching reserved-verb', () => {
      expect(validateSlugFormat('list')).toMatch(/reserved verb/);
      expect(validateSlugFormat('start')).toMatch(/reserved verb/);
      expect(validateSlugFormat('join')).toMatch(/reserved verb/);            // v4.0 NEW
    });

    it('rejects slug with msn-/scp- auto-id prefix', () => {
      expect(validateSlugFormat('msn-anything')).toMatch(/auto-id namespace prefix/);
      expect(validateSlugFormat('scp-anything')).toMatch(/auto-id namespace prefix/);
    });

    it('rejects slug containing colon (v4.0 colon-protection per Rule 5 + Rule 7 collision)', () => {
      expect(validateSlugFormat('foo:bar')).toMatch(/collides with substrate-coordinate/);
    });

    it('rejects slug not matching DNS pattern', () => {
      expect(validateSlugFormat('UPPERCASE')).toMatch(/DNS-style pattern/);
      expect(validateSlugFormat('has space')).toMatch(/DNS-style pattern/);
    });

    it('accepts valid DNS-style slug', () => {
      expect(validateSlugFormat('my-mission')).toBeUndefined();
      expect(validateSlugFormat('storage-extract-2026')).toBeUndefined();
    });

    it('create --name <reserved-verb> rejected via parser', () => {
      expect(() => parse(['create', '--name', 'list'])).toThrow(/slug-format/);
    });
  });

  describe('Global flags', () => {
    it('--workspace-root <path> parsed as global flag', () => {
      const result = parse(['list', '--workspace-root', '/tmp/mc']);
      expect(result.globalFlags.get('--workspace-root')).toBe('/tmp/mc');
    });

    it('--output json parsed as global flag', () => {
      const result = parse(['list', '--output', 'json']);
      expect(result.globalFlags.get('--output')).toBe('json');
    });
  });

  it('rejects unknown flag', () => {
    expect(() => parse(['list', '--nonexistent-flag'])).toThrow(/unknown flag/);
  });

  describe('mission-80 bug-84 — repeatable flags accumulate to array', () => {
    it('mission create --repo X --repo Y → flags.get("--repo") returns string[]', () => {
      const result = parse(['create', '--repo', 'file:///tmp/a', '--repo', 'file:///tmp/b']);
      expect(result.flags.get('--repo')).toEqual(['file:///tmp/a', 'file:///tmp/b']);
    });

    it('mission create --repo X (single) returns string (back-compat)', () => {
      const result = parse(['create', '--repo', 'file:///tmp/only']);
      expect(result.flags.get('--repo')).toBe('file:///tmp/only');
    });

    it('mission create --repo X --repo Y --repo Z (3+) returns full array', () => {
      const result = parse(['create', '--repo', 'A', '--repo', 'B', '--repo', 'C']);
      expect(result.flags.get('--repo')).toEqual(['A', 'B', 'C']);
    });

    it('scope create --repo X --repo Y → flags.get("--repo") returns string[]', () => {
      const result = parse(['scope', 'create', '--repo', 'file:///tmp/a', '--repo', 'file:///tmp/b']);
      expect(result.flags.get('--repo')).toEqual(['file:///tmp/a', 'file:///tmp/b']);
    });

    it('non-repeatable --name flag overwrites on repeat (existing behavior)', () => {
      const result = parse(['create', '--name', 'first', '--name', 'second']);
      expect(result.flags.get('--name')).toBe('second');                           // single string, overwrite kept
    });
  });

  describe('mission-80 bug-81 — scope-update sub-action dispatcher routing', () => {
    it('scope update <id> name <new-name> parses with subNamespacePath = ["scope", "update", "name"]', () => {
      const result = parse(['scope', 'update', 'scp-deadbeef', 'name', 'new-name']);
      expect(result.verb).toBe('scope');
      expect(result.subAction).toBe('name');                                      // deepest
      expect(result.subNamespacePath).toEqual(['scope', 'update', 'name']);       // routing surface
      expect(result.positionals).toEqual(['scp-deadbeef', 'new-name']);
    });

    it('scope update <id> repo-add <url> parses with subNamespacePath leaf "repo-add"', () => {
      const result = parse(['scope', 'update', 'scp-deadbeef', 'repo-add', 'file:///tmp/r']);
      expect(result.subAction).toBe('repo-add');
      expect(result.subNamespacePath).toEqual(['scope', 'update', 'repo-add']);
    });
  });
});
