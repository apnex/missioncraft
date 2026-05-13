// v1.0.5 bug-67 — error-message cleanup + validation regression tests.

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from '../../src/missioncraft-cli/grammar/parser.js';

const binPath = join(process.cwd(), 'dist', 'missioncraft-cli', 'bin.js');

function runMsn(args: string[], wsRoot?: string): SpawnSyncReturns<string> {
  const fullArgs = wsRoot ? [...args, '--workspace-root', wsRoot] : args;
  return spawnSync(process.execPath, [binPath, ...fullArgs], { encoding: 'utf8', timeout: 10000 });
}

describe('v1.0.5 bug-67 item 1 — strip SDK class-name + method-path prefixes (W6-new id-first migration)', () => {
  it('mission-not-found error does NOT leak "Missioncraft.start:" prefix (id-first form)', () => {
    // mission-78 W6-new slice (v.b): legacy `msn start <slug>` verb-first REMOVED; id-first
    // canonical. Slugs no longer parseable directly (operator runs `msn list` to find id).
    // Test uses fake msn-id to trigger not-found path through id-first form parsing.
    const wsRoot = mkdtempSync(join(tmpdir(), 'msn-bug67-i1-'));
    try {
      const result = runMsn(['msn-deadbeef', 'start'], wsRoot);
      expect(result.status).not.toBe(0);
      expect(result.stderr).not.toMatch(/Missioncraft\.\w+/);
      expect(result.stderr).not.toMatch(/MissionStateError:/);
      expect(result.stderr).toMatch(/mission 'msn-deadbeef' not found/);
    } finally {
      rmSync(wsRoot, { recursive: true, force: true });
    }
  });
});

describe('v1.0.5 bug-67 item 2 — hint suffix on name-not-found (W6-new id-first migration)', () => {
  it('mission-not-found appends `hint: run msn list ...` (id-first form)', () => {
    // mission-78 W6-new slice (v.b): use fake msn-id to trigger not-found via id-first parsing
    const wsRoot = mkdtempSync(join(tmpdir(), 'msn-bug67-i2-'));
    try {
      const result = runMsn(['msn-deadbeef', 'show'], wsRoot);
      expect(result.stderr).toMatch(/mission 'msn-deadbeef' not found/);
      expect(result.stderr).toMatch(/hint: run 'msn list' to see available missions/);
    } finally {
      rmSync(wsRoot, { recursive: true, force: true });
    }
  });

  it('scope-not-found appends `hint: run msn scope list ...`', () => {
    const wsRoot = mkdtempSync(join(tmpdir(), 'msn-bug67-i2b-'));
    try {
      const result = runMsn(['scope', 'show', 'absent-scope'], wsRoot);
      expect(result.stderr).toMatch(/scope 'absent-scope' not found/);
      expect(result.stderr).toMatch(/hint: run 'msn scope list' to see available scopes/);
    } finally {
      rmSync(wsRoot, { recursive: true, force: true });
    }
  });
});

describe('v1.0.5 bug-67 item 3 — missing-arg reports correct positional (W6-new slice (v.b) id-first migration)', () => {
  it("id-first 'msn <id> abandon' (no message) reports 'requires <message>'", () => {
    // mission-78 W6-new slice (v.b): legacy `abandon <id>` verb-first REMOVED; id-first canonical.
    // `abandon` argLabels: [<id|name>, <message>]; with id provided via missionRef-prepend,
    // missing positional is <message>.
    expect(() => parse(['msn-12345678', 'abandon'])).toThrow(/'abandon' requires <message>/);
  });

  it("id-first 'msn <id> complete' (no message) reports 'requires <message>' similarly", () => {
    expect(() => parse(['msn-12345678', 'complete'])).toThrow(/'complete' requires <message>/);
  });

  it("verb-first 'msn abandon' (no args) REJECTED at slice (v.b) — id-first form required", () => {
    // mission-78 W6-new slice (v.b): bare `msn abandon` (no missionRef + no positionals) →
    // id-first-form-required error replaces legacy 'requires <id|name>' error
    expect(() => parse(['abandon'])).toThrow(/requires id-first form/);
  });
});

describe('v1.0.5 bug-67 item 4 — input validation', () => {
  it("'msn list --status badstate' rejects with valid-enum hint", () => {
    const wsRoot = mkdtempSync(join(tmpdir(), 'msn-bug67-i4a-'));
    try {
      const result = runMsn(['list', '--status', 'badstate'], wsRoot);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/'--status badstate' is not a valid lifecycle state/);
      expect(result.stderr).toMatch(/Valid: created, configured, in-progress, started, completed, abandoned/);
    } finally {
      rmSync(wsRoot, { recursive: true, force: true });
    }
  });

  it("'msn config get bogus-key' rejects with valid-keys hint", () => {
    const wsRoot = mkdtempSync(join(tmpdir(), 'msn-bug67-i4b-'));
    try {
      const result = runMsn(['config', 'get', 'bogus-key'], wsRoot);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/'config' key 'bogus-key' is not recognized/);
      expect(result.stderr).toMatch(/Valid keys: wip-cadence-ms/);
    } finally {
      rmSync(wsRoot, { recursive: true, force: true });
    }
  });

  it("'msn create --repo not-a-url' rejects with parse hint", () => {
    const wsRoot = mkdtempSync(join(tmpdir(), 'msn-bug67-i4c-'));
    try {
      const result = runMsn(['create', '--repo', 'not-a-url'], wsRoot);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/'--repo not-a-url' is not a parseable URL/);
    } finally {
      rmSync(wsRoot, { recursive: true, force: true });
    }
  });

  it("'msn create --repo file:///tmp/valid' accepts (no validation error)", () => {
    const wsRoot = mkdtempSync(join(tmpdir(), 'msn-bug67-i4d-'));
    try {
      const result = runMsn(['create', '--repo', 'file:///tmp/test-repo'], wsRoot);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
    } finally {
      rmSync(wsRoot, { recursive: true, force: true });
    }
  });
});
