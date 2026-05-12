// config-mirror.ts — per-mission config-branch git mirror (Design v4.9 §2.10 W5b MINOR-R6.2).
//
// Maintains a dedicated git repo at `<workspaceRoot>/missions/<missionId>/.config-mirror/` whose
// sole purpose is to track the mission-config YAML state on `refs/heads/config/<missionId>` branch.
// Pushed to coord-remote on each config-mutation; reader-daemon Loop B fetches this branch +
// applies config changes to reader's local config copy (Loop B detection lands W5c).
//
// Why dedicated mirror repo (not a branch in repo workspaces): coord-remote `refs/heads/config/<id>`
// is mission-scoped (NOT per-repo), so multiple repo workspaces racing to push the same ref would
// produce non-deterministic last-writer-wins behavior. Mirror repo keeps the propagation surface
// single-writer-per-mission.

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { GitEngine } from '../pluggables/git-engine.js';
import type { AgentIdentity } from '../pluggables/identity.js';
import type { WorkspaceHandle } from '../pluggables/storage.js';

export interface ConfigMirrorContext {
  readonly workspaceRoot: string;
  readonly missionId: string;
  readonly gitEngine: GitEngine;
  readonly identity: AgentIdentity;
}

export function configMirrorPath(workspaceRoot: string, missionId: string): string {
  return join(workspaceRoot, 'missions', missionId, '.config-mirror');
}

/** Synthesize a WorkspaceHandle pointing at the config-mirror dir (engine-internal use only). */
function configMirrorHandle(workspaceRoot: string, missionId: string): WorkspaceHandle {
  return {
    missionId,
    repoUrl: '',                                          // synthetic; mirror has no upstream-repo concept
    path: configMirrorPath(workspaceRoot, missionId),
  };
}

/** Ensure the config-mirror repo exists + is git-initialized. Idempotent. */
async function ensureMirrorInit(ctx: ConfigMirrorContext): Promise<WorkspaceHandle> {
  const path = configMirrorPath(ctx.workspaceRoot, ctx.missionId);
  await mkdir(path, { recursive: true });
  const handle = configMirrorHandle(ctx.workspaceRoot, ctx.missionId);
  // Engine.init is idempotent (both NativeGitEngine via `git init --quiet` AND IsomorphicGitEngine
  // re-init are safe to call multiple times); the existsSync gate is belt-and-braces.
  if (!existsSync(join(path, '.git'))) {
    await ctx.gitEngine.init(handle, { fs: undefined, identity: ctx.identity });
  }
  return handle;
}

/**
 * Stage the latest mission-config YAML into the config-mirror + commit to
 * `refs/heads/config/<missionId>` branch via commitToRef (no-INDEX-pollution per W2 §AA).
 * Returns the resulting commit-SHA.
 */
export async function commitConfigToMirror(
  ctx: ConfigMirrorContext,
  missionConfigPath: string,
): Promise<string> {
  if (!existsSync(missionConfigPath)) {
    throw new Error(`commitConfigToMirror: mission-config not found at '${missionConfigPath}'`);
  }
  const handle = await ensureMirrorInit(ctx);
  // Copy current mission-config YAML into mirror repo as `mission.yaml` (canonical filename)
  const mirrorConfigPath = join(handle.path, 'mission.yaml');
  await copyFile(missionConfigPath, mirrorConfigPath);
  // Commit to refs/heads/config/<missionId> via commitToRef (no HEAD-move; no INDEX-pollution)
  const ref = `refs/heads/config/${ctx.missionId}`;
  const sha = await ctx.gitEngine.commitToRef(handle, ref, {
    message: `[config] update ${new Date().toISOString()}`,
    author: ctx.identity,
    autoStage: true,
  });
  return sha;
}

/** Compute config-branch ref-name for a mission. */
export function configBranchRef(missionId: string): string {
  return `refs/heads/config/${missionId}`;
}

/** Compute config-update tag-name for a mission. */
export function configUpdateTagName(missionId: string): string {
  return `missioncraft/${missionId}/config-update`;
}

export function configUpdateTagRef(missionId: string): string {
  return `refs/tags/${configUpdateTagName(missionId)}`;
}

/** Read the last-propagated mission-config from the mirror (best-effort; null if absent). */
export async function readMirrorConfig(workspaceRoot: string, missionId: string): Promise<string | null> {
  const path = join(configMirrorPath(workspaceRoot, missionId), 'mission.yaml');
  if (!existsSync(path)) return null;
  return readFile(path, 'utf8');
}

/** Touch a sentinel file inside the mirror to record last-propagation timestamp. */
export async function recordPropagationTimestamp(
  workspaceRoot: string,
  missionId: string,
  at: Date = new Date(),
): Promise<void> {
  const sentinel = join(configMirrorPath(workspaceRoot, missionId), '.last-propagated-at');
  await mkdir(configMirrorPath(workspaceRoot, missionId), { recursive: true });
  await writeFile(sentinel, at.toISOString(), 'utf8');
}
