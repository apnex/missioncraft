// v1.2.0 W5-new slice (iv) — Reader-daemon Loop B pullCadence integration.
//
// Architect-disposition thread-548 round 7: lift hardcoded `coordPollMs` (5000ms) to v5.0
// `pullIntervalSeconds * 1000` (30000ms default) for v5.0 missions; v4.x continue reading
// `coordPollMs` through W7-new for back-compat. Sister-shape to slice (iii) detectWriterPushCadence.
//
// Per Design v5.0 §10.5 asymmetric defaults (push 60s + pull 30s — 2x readers-per-write rate;
// catches new pushes promptly).
//
// Tests at the daemon-dispatch layer per calibration #74 discipline (assert config-derivation
// invariants from daemon entry-point semantic, not just SDK-direct calls).

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Missioncraft } from '@apnex/missioncraft';
import { detectReaderPullCadence } from '../../src/missioncraft-sdk/core/daemon/daemon-mode-detect.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w5-iv-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('v1.2.0 W5-new slice (iv) — detectReaderPullCadence (daemon-dispatch layer; calibration #74)', () => {
  it('reader-mission with default config (no stateDurability) → intervalMs=30000 (v5.0 default 30s)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const reader = await mc.create('mission', {
      repo: 'https://github.com/example/upstream.git',
      readOnly: true,
      sourceRemote: 'https://github.com/example/upstream.git',
      sourceBranch: 'main',
    });

    const detected = await detectReaderPullCadence(tempRoot, reader.id);
    expect(detected.intervalMs).toBe(30000);
  });

  it('reader-mission with explicit pullIntervalSeconds=15 → intervalMs=15000', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const reader = await mc.create('mission', {
      repo: 'https://github.com/example/upstream.git',
      readOnly: true,
      sourceRemote: 'https://github.com/example/upstream.git',
      sourceBranch: 'main',
    });
    const configPath = join(tempRoot, 'config', 'missions', `${reader.id}.yaml`);
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(configPath, 'utf8');
    await writeFile(configPath, content + '\nstate-durability:\n  pull-interval-seconds: 15\n', 'utf8');

    const detected = await detectReaderPullCadence(tempRoot, reader.id);
    expect(detected.intervalMs).toBe(15000);
  });

  it('reader-mission with pullIntervalSeconds at min boundary (5s) → intervalMs=5000', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const reader = await mc.create('mission', {
      repo: 'https://github.com/example/upstream.git',
      readOnly: true,
      sourceRemote: 'https://github.com/example/upstream.git',
      sourceBranch: 'main',
    });
    const configPath = join(tempRoot, 'config', 'missions', `${reader.id}.yaml`);
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(configPath, 'utf8');
    await writeFile(configPath, content + '\nstate-durability:\n  pull-interval-seconds: 5\n', 'utf8');

    const detected = await detectReaderPullCadence(tempRoot, reader.id);
    expect(detected.intervalMs).toBe(5000);
  });

  it('v4.x mission with coordPollMs=10000 (no pullIntervalSeconds) → intervalMs=10000 (v4.x fallback)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writer = await mc.create('mission', { repo: 'https://github.com/example/repo.git' });
    const configPath = join(tempRoot, 'config', 'missions', `${writer.id}.yaml`);
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(configPath, 'utf8');
    await writeFile(configPath, content + '\nstate-durability:\n  coord-poll-ms: 10000\n', 'utf8');

    const detected = await detectReaderPullCadence(tempRoot, writer.id);
    expect(detected.intervalMs).toBe(10000);
  });

  it('mission with BOTH pullIntervalSeconds + coordPollMs → pullIntervalSeconds wins (v5.0 preference)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const reader = await mc.create('mission', {
      repo: 'https://github.com/example/upstream.git',
      readOnly: true,
      sourceRemote: 'https://github.com/example/upstream.git',
      sourceBranch: 'main',
    });
    const configPath = join(tempRoot, 'config', 'missions', `${reader.id}.yaml`);
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(configPath, 'utf8');
    await writeFile(
      configPath,
      content + '\nstate-durability:\n  coord-poll-ms: 5000\n  pull-interval-seconds: 20\n',
      'utf8',
    );

    const detected = await detectReaderPullCadence(tempRoot, reader.id);
    // v5.0 pullIntervalSeconds=20 → 20000ms wins over v4.x coordPollMs=5000ms
    expect(detected.intervalMs).toBe(20000);
  });

  it('non-existent mission → intervalMs=30000 (v5.0 default fallback)', async () => {
    const detected = await detectReaderPullCadence(tempRoot, 'msn-deadbeef');
    expect(detected.intervalMs).toBe(30000);
  });

  it('writer-mission with no state-durability → intervalMs=30000 (default; helper not role-conditional)', async () => {
    // Per architect-disposition: no enabled-gate; reader Loop B always-on. Helper returns
    // intervalMs regardless of role (writer-mission would never invoke this code-path in
    // practice since watcher-entry only calls this in reader-mode dispatch arm).
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writer = await mc.create('mission', { repo: 'https://github.com/example/repo.git' });
    const detected = await detectReaderPullCadence(tempRoot, writer.id);
    expect(detected.intervalMs).toBe(30000);
  });
});
