// v1.0.6 slice (iii) — bug-68 progress callback fires pre-FSM-validation.
//
// Fix: FSM pre-flight (lifecycle-state validation) is the FIRST statement in abandon() /
// complete() / start() — BEFORE any onProgress callback fires.
//
// Idempotent rule: progress events represent ACTIVE work; no progress emitted for rejected actions.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Missioncraft, MissionStateError } from '@apnex/missioncraft';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-v106-iii-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

/** Helper: persist a mission YAML at the given lifecycle-state, bypassing SDK flows. */
async function persistMissionAtState(
  workspaceRoot: string,
  id: string,
  lifecycleState: string,
): Promise<void> {
  const missionsDir = join(workspaceRoot, 'config', 'missions');
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

describe('v1.0.6 slice (iii) — bug-68 FSM pre-flight before progress callback', () => {
  it('abandon on terminal-state mission throws WITHOUT firing onProgress', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const id = 'msn-abadabad';
    await persistMissionAtState(tempRoot, id, 'completed');

    const events: { phase: string }[] = [];
    await expect(
      mc.abandon(id, 'late abandon', { onProgress: (e) => events.push(e) }),
    ).rejects.toThrow(/requires lifecycle 'in-progress' or 'started'/);
    expect(events).toEqual([]);
  });

  it('complete on terminal-state mission throws WITHOUT firing onProgress', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const id = 'msn-deadbeef';
    await persistMissionAtState(tempRoot, id, 'abandoned');

    const events: { phase: string }[] = [];
    await expect(
      mc.complete(id, 'late complete', { onProgress: (e) => events.push(e) }),
    ).rejects.toThrow(/requires lifecycle 'in-progress' or 'started'/);
    expect(events).toEqual([]);
  });

  it('complete on configured-state mission throws WITHOUT firing onProgress', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const id = 'msn-cafebabe';
    await persistMissionAtState(tempRoot, id, 'configured');

    const events: { phase: string }[] = [];
    await expect(
      mc.complete(id, 'too soon', { onProgress: (e) => events.push(e) }),
    ).rejects.toThrow(/requires lifecycle 'in-progress' or 'started'/);
    expect(events).toEqual([]);
  });

  it('start on non-configured-state mission throws WITHOUT firing onProgress', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const id = 'msn-feedface';
    await persistMissionAtState(tempRoot, id, 'created');

    const events: { phase: string }[] = [];
    await expect(
      mc.start(id, { onProgress: (e) => events.push(e) }),
    ).rejects.toThrow(/requires lifecycle 'configured'/);
    expect(events).toEqual([]);
  });

  it('start on completed-state mission throws WITHOUT firing onProgress', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const id = 'msn-baddcafe';
    await persistMissionAtState(tempRoot, id, 'completed');

    const events: { phase: string }[] = [];
    await expect(
      mc.start(id, { onProgress: (e) => events.push(e) }),
    ).rejects.toThrow(/requires lifecycle 'configured'/);
    expect(events).toEqual([]);
  });
});
