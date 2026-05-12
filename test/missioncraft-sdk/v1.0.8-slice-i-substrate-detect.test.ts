// v1.0.8 slice (i) — idea-284 substrate dependency detection (git + gh binaries).
//
// Path D2: missioncraft hard-depends on git + gh CLI binaries. SDK detects them at init
// + caches per-process; CLI's `msn version` surfaces the detection result; strict consumers
// can call `requireSubstrate()` to fail-fast with friendly install-hints.

import { describe, expect, it, beforeEach } from 'vitest';

import {
  detectSubstrate,
  refreshSubstrate,
  requireSubstrate,
} from '@apnex/missioncraft';

beforeEach(() => {
  // Each test starts with a clean cache so probe paths are exercised.
  refreshSubstrate();
});

describe('v1.0.8 slice (i) — substrate-detect (idea-284)', () => {
  it('detectSubstrate returns version strings for git + gh on CI/dev machines that have both', async () => {
    const detection = await detectSubstrate();
    // git is universally available on dev + CI machines; gh on dev/CI for this repo (devDep usage).
    expect(detection.git).not.toBeNull();
    expect(detection.git).toMatch(/^\d+\.\d+(?:\.\d+)?$/);
    // gh may be missing on barebones CI; assert format if present, accept null if not.
    if (detection.gh !== null) {
      expect(detection.gh).toMatch(/^\d+\.\d+(?:\.\d+)?$/);
    }
  });

  it('detectSubstrate caches result across calls (same object identity)', async () => {
    const a = await detectSubstrate();
    const b = await detectSubstrate();
    expect(a).toBe(b);                               // cached: same reference
  });

  it('refreshSubstrate clears the cache; subsequent call re-probes', async () => {
    const a = await detectSubstrate();
    refreshSubstrate();
    const b = await detectSubstrate();
    expect(a).not.toBe(b);                           // different objects post-refresh
    expect(b.git).toBe(a.git);                       // same value (binary hasn't changed)
  });

  it('missing[] records install-hints for any null-detected binary', async () => {
    const detection = await detectSubstrate();
    // Type contract: missing is keyed only on binaries that came back null.
    for (const key of Object.keys(detection.missing)) {
      expect(detection[key as 'git' | 'gh']).toBeNull();
      expect(detection.missing[key]).toContain('install:');
    }
  });

  it('requireSubstrate("git") resolves when git is present (CI/dev have it)', async () => {
    await expect(requireSubstrate('git')).resolves.toMatchObject({ git: expect.any(String) });
  });
});
