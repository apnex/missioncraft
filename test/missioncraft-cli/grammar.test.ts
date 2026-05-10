import { describe, expect, it } from 'vitest';
import { parse, parseCoordinate, validateSlugFormat } from '../../src/missioncraft-cli/grammar/parser.js';
import { ConfigValidationError } from '@apnex/missioncraft';

describe('CLI grammar parser — Rules 1-7 — W3 smoke-tests', () => {
  describe('Rule 1: reserved-verbs', () => {
    it('accepts all 15 reserved-verbs at v4.0', () => {
      const verbs = ['create', 'list', 'show', 'start', 'apply', 'update', 'complete', 'abandon', 'tick', 'scope', 'workspace', 'config', 'join', 'leave'];
      for (const v of verbs) {
        // Each verb without args may fail Rule 6 but Rule 1 dispatch should pass; catch ConfigValidationError text accordingly
        try {
          parse([v]);
        } catch (e) {
          // Should NOT be unknown-verb (Rule 1); Rule 6 missing-arg is expected for verbs requiring positionals
          expect((e as Error).message).not.toMatch(/Rule 1 unknown verb/);
        }
      }
    });

    it('rejects unknown verb', () => {
      expect(() => parse(['nonexistent-verb'])).toThrow(/Rule 1 unknown verb/);
    });

    it('handles --help and --version short-circuit', () => {
      const help = parse(['--help']);
      expect(help.verb).toBe('--help');
      const version = parse(['--version']);
      expect(version.verb).toBe('--version');
    });
  });

  describe('Rule 6: arg-count validation', () => {
    it('missing-verb: empty argv', () => {
      expect(() => parse([])).toThrow(/Rule 6 missing-verb/);
    });

    it('missing-arg: complete requires <id> + <message>', () => {
      expect(() => parse(['complete', 'msn-foo'])).toThrow(/Rule 6 missing-arg/);
    });

    it('extra-positional: list accepts 0 OR 1 (drill-down); rejects 2+', () => {
      expect(() => parse(['list', 'msn-foo', 'extra'])).toThrow(/Rule 6 extra-positional/);
    });

    it('valid: complete <id> "<message>"', () => {
      const result = parse(['complete', 'msn-foo', 'My commit message']);
      expect(result.verb).toBe('complete');
      expect(result.positionals).toEqual(['msn-foo', 'My commit message']);
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

  describe('Rule 6: disjunctive arg-shape (start)', () => {
    it('valid: start <id|name> (positional form)', () => {
      const result = parse(['start', 'msn-foo']);
      expect(result.positionals).toEqual(['msn-foo']);
    });

    it('valid: start -f <path> (flag form)', () => {
      const result = parse(['start', '-f', '/tmp/m.yaml']);
      expect(result.flags.get('-f')).toBe('/tmp/m.yaml');
      expect(result.positionals).toEqual([]);
    });

    it('mutually-exclusive: start -f <path> + extra positional rejected', () => {
      expect(() => parse(['start', '-f', '/tmp/m.yaml', 'msn-foo'])).toThrow(/Rule 6 mutually-exclusive/);
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
      expect(() => parse(['update', 'msn-foo', 'nonexistent', 'arg'])).toThrow(/Rule 2 unknown 'update' sub-action/);
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

    it('workspace m-foo:design-repo (coord-form)', () => {
      const result = parse(['workspace', 'm-foo:design-repo']);
      expect(result.coordinate).toEqual({ mission: 'm-foo', repo: 'design-repo' });
    });

    it('workspace m-foo:design-repo + extra positional repo rejected (ambiguity)', () => {
      // workspace accepts 1 required + 1 optional; coord-form already specifies repo via colon
      expect(() => parse(['workspace', 'm-foo:design-repo', 'other-repo'])).toThrow(
        /Rule 7 ambiguity/,
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
      expect(validateSlugFormat('foo:bar')).toMatch(/collides with Rule 7/);
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
      expect(() => parse(['create', '--name', 'list'])).toThrow(/Rule 5 slug-format/);
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
});
