// v1.0.6 slice (iv) — bug-69 FSM-rejection hint matrix.
//
// Extends the bin.ts main() catch-block: pattern-matches FSM error format
// `requires lifecycle '...' (current: '...')` and emits per-verb operator-actionable hint.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

let tempRoot: string;
const CLI_BIN = join(__dirname, '..', '..', 'dist', 'missioncraft-cli', 'bin.js');

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-v106-iv-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

async function persistMissionAtState(id: string, lifecycleState: string): Promise<void> {
  const missionsDir = join(tempRoot, 'config', 'missions');
  await mkdir(missionsDir, { recursive: true });
  const yaml = [
    `mission-config-schema-version: 2`,
    `mission:`,
    `  id: ${id}`,
    `  lifecycle-state: ${lifecycleState}`,
    `  created-at: ${new Date().toISOString()}`,
    `repos:`,
    `  - url: file:///tmp/svc`,
    `    name: svc`,
  ].join('\n');
  await writeFile(join(missionsDir, `${id}.yaml`), yaml, 'utf8');
}

function runCli(...args: string[]): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync('node', [CLI_BIN, ...args, '--workspace-root', tempRoot], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

describe('v1.0.6 slice (iv) — bug-69 FSM-rejection hint matrix', () => {
  it('abandon on terminal mission emits manual-rm hint', async () => {
    const id = 'msn-aaaaaaaa';
    await persistMissionAtState(id, 'completed');

    const { stderr, status } = runCli('abandon', id, 'late msg');
    expect(status).toBe(65);
    expect(stderr).toMatch(/requires lifecycle 'in-progress' or 'started'/);
    expect(stderr).toMatch(/hint: to remove config for an already-completed mission/);
    expect(stderr).toMatch(new RegExp(`~/\\.missioncraft/config/missions/${id}\\.yaml`));
    expect(stderr).toMatch(/'msn delete <id>' verb is on the v1\.0\.x roadmap/);
  });

  it('complete on terminal mission emits manual-rm hint', async () => {
    const id = 'msn-bbbbbbbb';
    await persistMissionAtState(id, 'abandoned');

    const { stderr, status } = runCli('complete', id, 'late msg');
    expect(status).toBe(65);
    expect(stderr).toMatch(/hint: to remove config for an already-abandoned mission/);
    expect(stderr).toMatch(new RegExp(`~/\\.missioncraft/config/missions/${id}\\.yaml`));
  });

  it('complete on configured mission emits start-first hint', async () => {
    const id = 'msn-cccccccc';
    await persistMissionAtState(id, 'configured');

    const { stderr, status } = runCli('complete', id, 'early');
    expect(status).toBe(65);
    expect(stderr).toMatch(new RegExp(`hint: run 'msn start ${id}' first to begin the mission`));
  });

  it('start on non-configured mission emits inspect-state hint', async () => {
    const id = 'msn-dddddddd';
    await persistMissionAtState(id, 'created');

    const { stderr, status } = runCli('start', id);
    expect(status).toBe(65);
    expect(stderr).toMatch(/requires lifecycle 'configured'/);
    expect(stderr).toMatch(new RegExp(`hint: run 'msn show ${id}' to inspect current lifecycle state`));
  });

  it('start on completed mission emits inspect-state hint', async () => {
    const id = 'msn-eeeeeeee';
    await persistMissionAtState(id, 'completed');

    const { stderr, status } = runCli('start', id);
    expect(status).toBe(65);
    expect(stderr).toMatch(new RegExp(`hint: run 'msn show ${id}' to inspect current lifecycle state`));
  });
});
