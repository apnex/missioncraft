// daemon-state.ts — `.daemon-state.yaml` engine-derived runtime-state (Design v4.9 §2.10 W5b
// MEDIUM-R3.3 + MEDIUM-R2.8/R1.9). Separate-file mechanism preserves mission-config atomic-write
// discipline — push-cadence telemetry mutates frequently and would invalidate config integrity if
// folded inline. NOT mission-config-persisted; engine-derived only (read into MissionState at
// projection-time).
//
// Path: <workspaceRoot>/missions/<missionId>/.daemon-state.yaml
//
// Schema (v0):
//   daemonStateSchemaVersion: 1
//   lastPushSuccessAt: ISO-timestamp                   # mission-level (any successful push)
//   perRepoLastPushAt: { <repoName>: ISO-timestamp }   # per-repo push-cadence telemetry

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { parse as yamlParse, stringify as yamlStringify } from 'yaml';

export interface DaemonState {
  readonly daemonStateSchemaVersion: 1;
  readonly lastPushSuccessAt?: string;                       // ISO-8601
  readonly perRepoLastPushAt?: Record<string, string>;       // repo-name → ISO-8601
}

export function daemonStatePath(workspaceRoot: string, missionId: string): string {
  return join(workspaceRoot, 'missions', missionId, '.daemon-state.yaml');
}

export async function readDaemonState(workspaceRoot: string, missionId: string): Promise<DaemonState | null> {
  const path = daemonStatePath(workspaceRoot, missionId);
  if (!existsSync(path)) return null;
  try {
    const content = await readFile(path, 'utf8');
    const parsed = yamlParse(content) as Partial<DaemonState> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      daemonStateSchemaVersion: 1,
      ...(parsed.lastPushSuccessAt !== undefined && { lastPushSuccessAt: parsed.lastPushSuccessAt }),
      ...(parsed.perRepoLastPushAt !== undefined && { perRepoLastPushAt: parsed.perRepoLastPushAt }),
    };
  } catch {
    return null;
  }
}

/** Atomic write-temp + rename per the same discipline as mission-config writes. */
export async function writeDaemonState(
  workspaceRoot: string,
  missionId: string,
  state: DaemonState,
): Promise<void> {
  const path = daemonStatePath(workspaceRoot, missionId);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, yamlStringify(state), 'utf8');
  await rename(tmp, path);
}

/**
 * Record a successful coord-remote push for `repoName` at `at`. Updates both mission-level
 * `lastPushSuccessAt` (any-repo-most-recent) and `perRepoLastPushAt[repoName]` atomically.
 */
export async function recordPushSuccess(
  workspaceRoot: string,
  missionId: string,
  repoName: string,
  at: Date = new Date(),
): Promise<void> {
  const iso = at.toISOString();
  const existing = await readDaemonState(workspaceRoot, missionId);
  const next: DaemonState = {
    daemonStateSchemaVersion: 1,
    lastPushSuccessAt: iso,
    perRepoLastPushAt: { ...(existing?.perRepoLastPushAt ?? {}), [repoName]: iso },
  };
  await writeDaemonState(workspaceRoot, missionId, next);
}
