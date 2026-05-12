// v1.2.0 W4-new Fix #10 + #11 — Daemon-dispatch transparency-gate test.
//
// Architect-dogfood-surfaced v1.2.0 BLOCKER (thread-547 §B GAP-1): watcher-entry.ts mode-detection
// used WRONG config-path (`<workspaceRoot>/config/<id>.yaml`) → existsSync FALSE → reader-mode
// never activated → Loop B dead end-to-end. Synthetic SDK-direct tests passed (slice (v.b) +
// slice (vii)) because they exercise `Missioncraft.readerLoopBV5Tick(missionId)` directly,
// bypassing the daemon-watcher dispatch path. Calibration #74 candidate: dispatch-layer needs
// its own SHAPE-assertion test layer; siblings #67/#68 (synthetic-test-masking patterns) +
// #72 (transparency-gate-SHAPE discipline).
//
// Fix #10: detectDaemonMode helper uses canonical missionConfigPath layout (with `missions/`
// subdir). Fix #11 (this file): exercises detectDaemonMode + missionConfigPath against a fixture
// mission-config in proper layout; asserts reader-mode + isV5Reader flag activate (NOT no-op
// default writer-mode).
//
// SHAPE assertions per calibration #72: assert the specific dispatch outcome (role + isV5Reader
// + coordPollMs) — not just "no throw" or generic detection success.

import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Missioncraft } from '@apnex/missioncraft';
import {
  detectDaemonMode,
  missionConfigPath as daemonMissionConfigPath,
} from '../../src/missioncraft-sdk/core/daemon/daemon-mode-detect.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w4-fix10-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('v1.2.0 W4-new Fix #10 — daemon canonical missionConfigPath layout (calibration #74 candidate)', () => {
  it('daemonMissionConfigPath helper returns <workspaceRoot>/config/missions/<id>.yaml', () => {
    // SHAPE-1: canonical layout per v1.0.5 idea-271 + Missioncraft.missionConfigPath private helper
    const path = daemonMissionConfigPath('/test/root', 'msn-12345678');
    expect(path).toBe('/test/root/config/missions/msn-12345678.yaml');
  });

  it('daemonMissionConfigPath does NOT use the pre-Fix-#10 path (without missions/ subdir)', () => {
    // SHAPE-2: regression net — ensure the bug-shape (path WITHOUT `missions/` subdir) is
    // structurally absent. Pre-Fix-#10 path: `/test/root/config/msn-12345678.yaml` (missing
    // `missions/` subdir); Fix #10 path: `/test/root/config/missions/msn-12345678.yaml`.
    const path = daemonMissionConfigPath('/test/root', 'msn-12345678');
    expect(path).not.toBe('/test/root/config/msn-12345678.yaml');
    expect(path).toContain('/config/missions/');
  });
});

describe('v1.2.0 W4-new Fix #11 — daemon-dispatch mode-detection against canonical layout', () => {
  it('reader-mission with readOnly: true detected via canonical config layout → isV5Reader true', async () => {
    // Use the SDK to create a reader-mission so the on-disk layout matches what `msn watch` /
    // `msn join` produce in production (NOT a synthetic config written to the wrong path).
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const reader = await mc.create('mission', {
      repo: 'https://github.com/example/upstream.git',
      readOnly: true,
      sourceRemote: 'https://github.com/example/upstream.git',
      sourceBranch: 'main',
    });

    // Pre-Fix-#10: daemon would read `<workspaceRoot>/config/<missionId>.yaml` → FALSE existsSync
    // → silent-swallow → role='writer', isV5Reader=false. Loop B dispatch no-op.
    // Post-Fix-#10: detectDaemonMode reads canonical `<workspaceRoot>/config/missions/<id>.yaml`
    // → exists → parses → readOnly: true → role='reader', isV5Reader=true.
    const detected = await detectDaemonMode(tempRoot, reader.id, undefined, 5000);

    // SHAPE-1: role correctly detected as 'reader' (was 'writer' pre-Fix-#10)
    expect(detected.role).toBe('reader');
    // SHAPE-2: isV5Reader flag activates → Loop B dispatch will fire readerLoopBV5Tick
    // (was false pre-Fix-#10 → Loop B no-op silently)
    expect(detected.isV5Reader).toBe(true);
    // SHAPE-3: coordPollMs falls back to default when not specified in config
    expect(detected.coordPollMs).toBe(5000);
  });

  it('BRANCH-TRACKER reader (readOnly + sourceMissionId) detected via canonical layout', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writer = await mc.create('mission', { repo: 'https://github.com/example/repo.git' });
    const reader = await mc.create('mission', {
      readOnly: true,
      sourceMissionId: writer.id,
    });

    const detected = await detectDaemonMode(tempRoot, reader.id, undefined, 5000);
    expect(detected.role).toBe('reader');
    expect(detected.isV5Reader).toBe(true);
  });

  it('writer-mission (readOnly undefined) detected as writer-mode', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writer = await mc.create('mission', { repo: 'https://github.com/example/repo.git' });

    const detected = await detectDaemonMode(tempRoot, writer.id, undefined, 5000);

    // SHAPE-1: writer-mission stays writer-mode (regression net — Fix #10 must not flip writers)
    expect(detected.role).toBe('writer');
    expect(detected.isV5Reader).toBe(false);
  });

  it('non-existent mission falls back to default writer-mode (silent-swallow default)', async () => {
    const detected = await detectDaemonMode(tempRoot, 'msn-deadbeef', undefined, 5000);
    expect(detected.role).toBe('writer');
    expect(detected.isV5Reader).toBe(false);
    expect(detected.coordPollMs).toBe(5000);
  });

  it('mission-config in PRE-Fix-#10 path (without missions/ subdir) is NOT detected (regression net)', async () => {
    // Write a synthetic config at the PRE-Fix-#10 (wrong) path to verify detectDaemonMode does
    // NOT pick it up from there. If detection regresses to reading from `<workspaceRoot>/config/
    // <id>.yaml`, this test catches it.
    const wrongPath = join(tempRoot, 'config', `msn-12345678.yaml`);
    await mkdir(join(tempRoot, 'config'), { recursive: true });
    await writeFile(
      wrongPath,
      [
        'mission-config-schema-version: 2',
        'mission:',
        '  id: msn-12345678',
        '  lifecycle-state: joined',
        '  created-at: 2026-05-12T00:00:00Z',
        '  read-only: true',
        '  source-remote: https://github.com/example/upstream.git',
        '  source-branch: main',
        'repos:',
        '  - url: https://github.com/example/upstream.git',
        '    base: main',
        '    name: upstream',
        '',
      ].join('\n'),
      'utf8',
    );

    const detected = await detectDaemonMode(tempRoot, 'msn-12345678', undefined, 5000);

    // SHAPE: config at wrong path is INVISIBLE to detection → defaults to writer-mode
    // (asserts Fix #10 doesn't accidentally fall back to the old path on a miss).
    expect(detected.role).toBe('writer');
    expect(detected.isV5Reader).toBe(false);
  });

  it('reader-mission with custom coordPollMs in stateDurability override is honored', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const reader = await mc.create('mission', {
      repo: 'https://github.com/example/upstream.git',
      readOnly: true,
      sourceRemote: 'https://github.com/example/upstream.git',
      sourceBranch: 'main',
    });

    // Manually amend the config to add stateDurability.coordPollMs
    const configPath = daemonMissionConfigPath(tempRoot, reader.id);
    const { readFile } = await import('node:fs/promises');
    const existing = await readFile(configPath, 'utf8');
    await writeFile(configPath, existing + '\nstate-durability:\n  coord-poll-ms: 12345\n', 'utf8');

    const detected = await detectDaemonMode(tempRoot, reader.id, undefined, 5000);

    expect(detected.isV5Reader).toBe(true);
    expect(detected.coordPollMs).toBe(12345);
  });
});
