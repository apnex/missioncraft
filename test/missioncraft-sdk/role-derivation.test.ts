// W5 slice (i) — role-derivation + coordinationRemote canonicalization unit tests.

import { describe, expect, it } from 'vitest';

import {
  deriveOwningPrincipalRole,
  canonicalizeCoordinationRemote,
} from '../../src/missioncraft-sdk/core/role-derivation.js';

describe('W5 slice (i) — deriveOwningPrincipalRole per HIGH-R1.2 partition-spec', () => {
  it("defaults to 'writer' when no workspaceRootByPrincipal map provided (v3.6-baseline compat)", () => {
    const result = deriveOwningPrincipalRole('/home/u/.missioncraft/config/msn-x.yaml', 'a@x');
    expect(result).toBe('writer');
  });

  it("defaults to 'writer' when no current-principal provided", () => {
    const result = deriveOwningPrincipalRole('/path/config/msn-x.yaml', undefined, { 'a@x': '/path' });
    expect(result).toBe('writer');
  });

  it("returns 'writer' when owning-principal == current-principal", () => {
    const result = deriveOwningPrincipalRole(
      '/principals/alice/config/msn-x.yaml',
      'alice@host',
      { 'alice@host': '/principals/alice', 'bob@host': '/principals/bob' },
    );
    expect(result).toBe('writer');
  });

  it("returns 'reader' when owning-principal != current-principal", () => {
    const result = deriveOwningPrincipalRole(
      '/principals/bob/config/msn-x.yaml',
      'alice@host',                                 // current is alice; owning is bob
      { 'alice@host': '/principals/alice', 'bob@host': '/principals/bob' },
    );
    expect(result).toBe('reader');
  });

  it("longest-prefix-match wins (handles nested workspace-roots)", () => {
    const result = deriveOwningPrincipalRole(
      '/data/principals/bob/nested/config/msn-x.yaml',
      'alice@host',
      {
        'alice@host': '/data',                                  // shorter prefix
        'bob@host': '/data/principals/bob/nested',              // longer; wins
      },
    );
    expect(result).toBe('reader');                            // bob owns; alice is reader
  });

  it("defaults to 'writer' when no workspace-root prefix matches", () => {
    const result = deriveOwningPrincipalRole(
      '/unrelated/path/msn-x.yaml',
      'alice@host',
      { 'alice@host': '/principals/alice' },
    );
    expect(result).toBe('writer');                            // legacy compat fallback
  });
});

describe('W5 slice (i) — canonicalizeCoordinationRemote', () => {
  it('strips trailing slash', () => {
    expect(canonicalizeCoordinationRemote('https://example.com/repo/')).toBe('https://example.com/repo');
  });

  it('lowercases scheme (RFC 3986 scheme is case-insensitive)', () => {
    expect(canonicalizeCoordinationRemote('HTTPS://example.com/repo')).toBe('https://example.com/repo');
    expect(canonicalizeCoordinationRemote('Git://host/repo.git')).toBe('git://host/repo.git');
    expect(canonicalizeCoordinationRemote('SSH://user@host/repo.git')).toBe('ssh://user@host/repo.git');
  });

  it('preserves path-case (path is case-sensitive on remote)', () => {
    expect(canonicalizeCoordinationRemote('https://Example.com/UpperPath')).toBe('https://Example.com/UpperPath');
  });

  it('trims whitespace', () => {
    expect(canonicalizeCoordinationRemote('  https://example.com/repo  ')).toBe('https://example.com/repo');
  });

  it('idempotent on already-canonical URL', () => {
    const canonical = 'https://example.com/repo';
    expect(canonicalizeCoordinationRemote(canonical)).toBe(canonical);
  });
});
