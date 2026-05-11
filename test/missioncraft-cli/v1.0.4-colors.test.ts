// v1.0.4 bug-66 slice (iii) — colors.ts module regression tests.
//
// Honors standard env-var conventions:
//   NO_COLOR     → always disable (https://no-color.org)
//   FORCE_COLOR  → always enable
//   default      → TTY auto-detect (process.stdout.isTTY)

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { colors, shouldColor } from '../../src/missioncraft-cli/colors.js';

const ENV_KEYS = ['NO_COLOR', 'FORCE_COLOR'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('v1.0.4 bug-66 (slice iii) — colors module', () => {
  it('FORCE_COLOR=1 enables color output regardless of TTY', () => {
    process.env.FORCE_COLOR = '1';
    expect(shouldColor()).toBe(true);
    expect(colors.error('boom')).toContain('\x1b[31m');
    expect(colors.error('boom')).toContain('\x1b[0m');
    expect(colors.success('ok')).toContain('\x1b[32m');
    expect(colors.warn('hmm')).toContain('\x1b[33m');
    expect(colors.info('fyi')).toContain('\x1b[36m');
    expect(colors.header('HDR')).toContain('\x1b[36m');
  });

  it('NO_COLOR=1 disables color output even when FORCE_COLOR is also set', () => {
    process.env.NO_COLOR = '1';
    process.env.FORCE_COLOR = '1';
    expect(shouldColor()).toBe(false);
    expect(colors.error('boom')).toBe('boom');
    expect(colors.success('ok')).toBe('ok');
  });

  it('no env vars + non-TTY (vitest worker is non-TTY): no color', () => {
    expect(shouldColor()).toBe(false);
    expect(colors.error('boom')).toBe('boom');
    expect(colors.header('HDR')).toBe('HDR');
  });

  it('reset code appears after every color-wrapped string (no terminal bleed)', () => {
    process.env.FORCE_COLOR = '1';
    expect(colors.error('a')).toBe('\x1b[31ma\x1b[0m');
    expect(colors.warn('a')).toBe('\x1b[33ma\x1b[0m');
    expect(colors.info('a')).toBe('\x1b[36ma\x1b[0m');
    expect(colors.success('a')).toBe('\x1b[32ma\x1b[0m');
    expect(colors.header('a')).toBe('\x1b[36ma\x1b[0m');
  });
});
