// v1.0.6 slice (vi) — bug-72 CLI flag wiring + per-verb help inclusion.
//
// Architect spec: per-verb help update (idea-274 arg-spec). Verify --purge-workspace is in the
// complete verb's flag list + grammar parser recognizes it.

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { parse } from '../../src/missioncraft-cli/grammar/parser.js';
import { renderVerbHelp } from '../../src/missioncraft-cli/grammar/help-renderer.js';

const CLI_BIN = join(__dirname, '..', '..', 'dist', 'missioncraft-cli', 'bin.js');

describe('v1.0.6 slice (vi) — bug-72 --purge-workspace flag on msn complete', () => {
  it('parser recognizes --purge-workspace on complete (id-first form per W6-new slice (v.b))', () => {
    // mission-78 W6-new slice (v.b): legacy `complete <slug> <msg>` verb-first form REMOVED;
    // id-first canonical (slug-via-verb-first dropped; operator looks up id via msn list)
    const result = parse(['msn-12345678', 'complete', 'ship-msg', '--purge-workspace']);
    expect(result.verb).toBe('complete');
    expect(result.flags.has('--purge-workspace')).toBe(true);
  });

  it('parser recognizes --purge-workspace combined with --purge-config (id-first form)', () => {
    const result = parse(['msn-12345678', 'complete', 'ship-msg', '--purge-workspace', '--purge-config']);
    expect(result.flags.has('--purge-workspace')).toBe(true);
    expect(result.flags.has('--purge-config')).toBe(true);
  });

  it('per-verb help for `complete` documents --purge-workspace flag', () => {
    const help = renderVerbHelp(['complete']);
    expect(help).toContain('--purge-workspace');
    expect(help).toMatch(/preserve.*forensic-history/i);
  });

  it('`msn help complete` includes --purge-workspace in flag list (CLI roundtrip)', () => {
    const result = spawnSync('node', [CLI_BIN, 'help', 'complete'], {
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--purge-workspace');
  });
});
