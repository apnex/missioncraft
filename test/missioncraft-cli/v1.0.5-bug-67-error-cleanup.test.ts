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

describe('v1.0.5 bug-67 item 1 — strip SDK class-name + method-path prefixes', () => {
  it('mission-not-found error does NOT leak "Missioncraft.start:" prefix', () => {
    const wsRoot = mkdtempSync(join(tmpdir(), 'msn-bug67-i1-'));
    try {
      const result = runMsn(['start', 'no-such-mission'], wsRoot);
      expect(result.status).not.toBe(0);
      expect(result.stderr).not.toMatch(/Missioncraft\.\w+/);
      expect(result.stderr).not.toMatch(/MissionStateError:/);
      expect(result.stderr).toMatch(/mission 'no-such-mission' not found/);
    } finally {
      rmSync(wsRoot, { recursive: true, force: true });
    }
  });
});

describe('v1.0.5 bug-67 item 2 — hint suffix on name-not-found', () => {
  it('mission-not-found appends `hint: run msn list ...`', () => {
    const wsRoot = mkdtempSync(join(tmpdir(), 'msn-bug67-i2-'));
    try {
      const result = runMsn(['show', 'absent-mission'], wsRoot);
      expect(result.stderr).toMatch(/mission 'absent-mission' not found/);
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

describe('v1.0.5 bug-67 item 3 — missing-arg reports correct positional', () => {
  it("'msn abandon <id>' (id provided, message missing) reports 'requires <message>'", () => {
    // `abandon` argLabels: [<id|name>, <message>]; with 1 positional provided, the missing
    // one is `<message>` (index 1), NOT `<id|name>` (index 0).
    expect(() => parse(['abandon', 'msn-foo'])).toThrow(/'abandon' requires <message>/);
  });

  it("'msn complete <id>' reports 'requires <message>' similarly", () => {
    expect(() => parse(['complete', 'msn-foo'])).toThrow(/'complete' requires <message>/);
  });

  it("'msn abandon' (no args) reports 'requires <id|name>' (first missing)", () => {
    expect(() => parse(['abandon'])).toThrow(/'abandon' requires <id\|name>/);
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
