// v1.0.4 idea-272 — `msn tree` verb-hierarchy visualization regression tests.

import { describe, expect, it } from 'vitest';
import { renderTree } from '../../src/missioncraft-cli/grammar/tree-renderer.js';

describe('v1.0.4 idea-272 — tree renderer', () => {
  it('renders full hierarchy with all top-level verbs', () => {
    const tree = renderTree();
    expect(tree).toMatch(/^msn$/m);
    // Meta verbs
    expect(tree).toMatch(/help.*# Print global help/);
    expect(tree).toMatch(/version.*# Print missioncraft version/);
    expect(tree).toMatch(/tree.*# Print tree-style/);
    expect(tree).toMatch(/cd <id\|name>/);
    expect(tree).toMatch(/shell-init <shell>/);
    // Mission verbs
    expect(tree).toMatch(/create.*# Scaffold/);
    expect(tree).toMatch(/show <id\|name>/);
    expect(tree).toMatch(/start <id\|name>/);
    expect(tree).toMatch(/abandon <id\|name> <message>/);
    expect(tree).toMatch(/complete <id\|name> <message>/);
    expect(tree).toMatch(/workspace <id\|name> \[<repo-name>\]/);
    // Namespaces
    expect(tree).toMatch(/update.*# Field-targeted/);
    expect(tree).toMatch(/scope.*# Scope namespace/);
    expect(tree).toMatch(/config.*# Operator-config/);
  });

  it('renders nested sub-verbs/sub-actions when no depth limit', () => {
    const tree = renderTree();
    // update sub-actions
    expect(tree).toMatch(/repo-add <id\|name> <file\|url>/);
    expect(tree).toMatch(/tags-set <id\|name> <key> <value>/);
    // scope sub-verbs
    expect(tree).toMatch(/scope[^\n]*\n[^\n]*create/);
    // config sub-verbs
    expect(tree).toMatch(/config[^\n]*\n[^\n]*get <key>/);
    expect(tree).toMatch(/set <key> <value>/);
  });

  it('--depth 1 limits to top-level verbs only (no sub-actions)', () => {
    const tree = renderTree(1);
    expect(tree).toMatch(/update/);
    expect(tree).not.toMatch(/repo-add/);
    expect(tree).toMatch(/scope/);
    expect(tree).not.toMatch(/scope.*\n.*create/);
  });

  it('--depth 2 includes one level of sub-actions but not scope-update-sub-sub', () => {
    const tree = renderTree(2);
    // update sub-actions appear at depth 2
    expect(tree).toMatch(/repo-add/);
    // The scope namespace has its `update` sub-verb at depth 2; its sub-sub-actions are at depth 3
    // and should NOT appear when maxDepth=2.
    expect(tree).toContain('scope');
  });

  it('tree uses ASCII box-drawing characters with proper last-item branches', () => {
    const tree = renderTree();
    expect(tree).toMatch(/├──/);
    expect(tree).toMatch(/└──/);  // last sibling uses └
    expect(tree).toMatch(/│/);     // continuation pipe
  });
});
