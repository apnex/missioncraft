// v1.0.4 slice (i) — idea-274 per-verb help renderer + multi-syntax dispatch regression tests.
//
// Architect-spec at thread-533: per-verb help dispatched via three syntactic paths producing
// identical output:
//   <verb-path> --help
//   <verb-path> -h
//   help <verb-path>
//
// Per-verb help format includes: usage line, shortDesc, longDesc (if present), Arguments section,
// Flags section, Sub-verbs section (if subActions), Examples section, See-also section.

import { describe, expect, it } from 'vitest';
import { parse } from '../../src/missioncraft-cli/grammar/parser.js';
import { renderVerbHelp, resolveSpec } from '../../src/missioncraft-cli/grammar/help-renderer.js';

describe('v1.0.4 slice (i) — idea-274 per-verb help multi-syntax dispatch', () => {
  it('--help flag at any verb depth: parser returns verb=--help + subNamespacePath populated', () => {
    expect(parse(['show', '--help']).subNamespacePath).toEqual(['show']);
    expect(parse(['update', 'repo-add', '--help']).subNamespacePath).toEqual(['update', 'repo-add']);
    expect(parse(['scope', 'create', '--help']).subNamespacePath).toEqual(['scope', 'create']);
    expect(parse(['scope', 'update', 'repo-add', '--help']).subNamespacePath).toEqual([
      'scope',
      'update',
      'repo-add',
    ]);
  });

  it('-h short-form flag also triggers per-verb help', () => {
    expect(parse(['show', '-h']).subNamespacePath).toEqual(['show']);
    expect(parse(['update', '-h']).subNamespacePath).toEqual(['update']);
  });

  it('help <verb-path> prefix-form: parser returns verb=--help + subNamespacePath populated', () => {
    expect(parse(['help', 'show']).subNamespacePath).toEqual(['show']);
    expect(parse(['help', 'update', 'repo-add']).subNamespacePath).toEqual(['update', 'repo-add']);
    expect(parse(['help', 'scope', 'create']).subNamespacePath).toEqual(['scope', 'create']);
  });

  it('bare msn / msn help / msn --help all produce empty subNamespacePath (global help)', () => {
    expect(parse([]).subNamespacePath).toEqual([]);
    expect(parse(['help']).subNamespacePath).toEqual([]);
    expect(parse(['--help']).subNamespacePath).toEqual([]);
  });

  it('msn version aliases to --version', () => {
    expect(parse(['version']).verb).toBe('--version');
  });
});

describe('v1.0.4 slice (i) — resolveSpec walks the arg-spec tree', () => {
  it('resolves top-level verbs', () => {
    expect(resolveSpec(['show'])?.shortDesc).toMatch(/Show mission details/);
    expect(resolveSpec(['start'])?.shortDesc).toMatch(/Realize a configured mission/);
    expect(resolveSpec(['create'])?.shortDesc).toMatch(/Scaffold a new mission/);
  });

  it('resolves nested sub-actions', () => {
    expect(resolveSpec(['update', 'repo-add'])?.shortDesc).toMatch(/Add a repo to a mission/);
    expect(resolveSpec(['scope', 'create'])?.shortDesc).toMatch(/Create a new scope/);
    expect(resolveSpec(['scope', 'update', 'repo-add'])?.shortDesc).toMatch(/Add a repo to a scope/);
    expect(resolveSpec(['config', 'get'])?.shortDesc).toMatch(/Read an operator-config/);
  });

  it('returns undefined for unknown verb-paths', () => {
    expect(resolveSpec(['nonexistent'])).toBeUndefined();
    expect(resolveSpec(['show', 'fake-sub'])).toBeUndefined();
  });
});

describe('v1.0.4 slice (i) — renderVerbHelp output format', () => {
  it('renders complete help with all sections for substantive verbs', () => {
    const help = renderVerbHelp(['show']);
    expect(help).toMatch(/^usage: msn show/m);
    expect(help).toMatch(/Show mission details by id or name/);
    expect(help).toMatch(/Detail view \(kubectl-describe style\)/);
    expect(help).toMatch(/^Arguments:$/m);
    expect(help).toMatch(/<id\|name>\s+Mission identifier or name/);
    expect(help).toMatch(/^Flags:$/m);
    expect(help).toMatch(/--repos/);
    expect(help).toMatch(/^Examples:$/m);
    expect(help).toMatch(/^See also: list, workspace$/m);
  });

  it('renders Sub-verbs section for verbs with subActions', () => {
    const help = renderVerbHelp(['scope']);
    expect(help).toMatch(/^Sub-verbs:$/m);
    expect(help).toMatch(/create\s+Create a new scope/);
    expect(help).toMatch(/list\s+List all scopes/);
    expect(help).toMatch(/show\s+Show scope details/);
    expect(help).toMatch(/update\s+Mutate scope fields/);
    expect(help).toMatch(/delete\s+Delete a scope/);
  });

  it('renders sub-action-level help for nested paths', () => {
    const help = renderVerbHelp(['update', 'repo-add']);
    expect(help).toMatch(/^usage: msn update repo-add/m);
    expect(help).toMatch(/Add a repo to a mission/);
    expect(help).toMatch(/<file\|url>\s+Repo URL/);
  });

  it('renders error stub for unknown verb-path', () => {
    const help = renderVerbHelp(['nonexistent']);
    expect(help).toMatch(/unknown verb-path/);
    expect(help).toMatch(/run 'msn help' for the full verb list/);
  });

  it('usage-line override is honored when present', () => {
    const help = renderVerbHelp(['start']);
    expect(help).toMatch(/^usage: msn start <id\|name> \| -f <path> \[--retain\]$/m);
  });
});
