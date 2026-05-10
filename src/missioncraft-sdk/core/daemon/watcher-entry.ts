// watcher-entry.ts — daemon-watcher process entry-point (Design v4.9 §2.6.5; W4.4 slice (i)).
//
// Invoked via `node <path>/watcher-entry.js <missionId> <workspaceRoot>` from spawnDaemonWatcher.
// Daemon discipline:
//   - Reads mission-config from <workspaceRoot>/config/<missionId>.yaml
//   - Sets up chokidar fs-watch on each repo workspace
//   - On debounce: commits to wip/<missionId> branch via gitEngine.commitToRef (slice ii enrichment)
//   - SIGTERM handler: graceful-shutdown (final flush + lockfile cleanup + exit 0)
//   - SIGINT handler: same as SIGTERM (CTRL-C compatibility for dev/test)
//
// W4.4 slice (i) MVP: minimal daemon loop with chokidar setup + SIGTERM handler. Real wip-commit
// on debounce + reader-mode rollback land in slice (i) follow-on commits OR slice (ii) graft.

import { join } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';

import { updateLockfileState } from '../state-machine/lockfile-state.js';

const DEBOUNCE_MS = 1000;        // 1s default; configurable via mission.stateDurability.wipCadenceMs in slice (ii)
const HEARTBEAT_MS = 60_000;     // 60s lockfile-TTL extension cadence

async function main(): Promise<void> {
  const [, , missionId, workspaceRoot] = process.argv;
  if (!missionId || !workspaceRoot) {
    process.stderr.write(`usage: watcher-entry.js <missionId> <workspaceRoot>\n`);
    process.exit(2);
  }

  const lockfilePath = join(workspaceRoot, 'locks', 'missions', `${missionId}.lock`);

  let shutdownInProgress = false;
  let debounceTimer: NodeJS.Timeout | undefined;
  let heartbeatTimer: NodeJS.Timeout | undefined;
  let watcher: FSWatcher | undefined;

  const shutdown = async (_signal: string): Promise<void> => {
    // SIGTERM contract per Design v4.9 §2.6.5: graceful shutdown of watcher + timers + exit 0.
    // Lockfile-cleanup is PARENT-CLI responsibility (parent invokes SIGTERM as part of
    // complete-flow Step 4 / abandon-flow Step 2; same parent-CLI then clears daemon-IPC
    // fields via updateLockfileState OR releases lock entirely via storage.releaseLock).
    // Daemon-side does NOT modify lockfile on shutdown to avoid race with parent's cleanup.
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    try {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (watcher) await watcher.close();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });

  // Heartbeat: extend daemon TTL every 60s (prevents stale-detection of running daemon)
  heartbeatTimer = setInterval(() => {
    void updateLockfileState(lockfilePath, {
      daemonExpiresAt: Date.now() + 86_400_000,        // 24h sliding-window
    });
  }, HEARTBEAT_MS);

  // chokidar fs-watch on per-mission workspaces
  // Read mission-config to discover repos + workspace paths
  const missionsDir = join(workspaceRoot, 'missions', missionId);

  // Function-form `ignored` predicate per v4.6 MEDIUM-R7.2 (.daemon-tx-active sentinel-file)
  watcher = chokidar.watch(missionsDir, {
    ignored: (path: string) => {
      // Skip paths under .git/ (engine-internal sync) + .daemon-tx-active sentinel
      if (path.includes('/.git/') || path.endsWith('/.git')) return true;
      if (path.endsWith('/.daemon-tx-active')) return true;
      return false;
    },
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
  });

  watcher.on('change', () => {
    // Debounced wip-commit (slice ii enriches with actual commitToRef invocation per Design §2.6.5)
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      // TODO slice (ii): invoke gitEngine.commitToRef(workspace, 'refs/heads/wip/<missionId>', ...)
      // for each repo workspace. Slice (i) MVP: just clear timer (debounce-fire marker).
      debounceTimer = undefined;
    }, DEBOUNCE_MS);
  });

  // Daemon process stays alive via active timers + watcher event-loop registrations;
  // exits only via SIGTERM/SIGINT signal-handler.
}

main().catch((err) => {
  process.stderr.write(`watcher-entry fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
