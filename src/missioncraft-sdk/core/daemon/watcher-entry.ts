// watcher-entry.ts — daemon-watcher process entry-point (Design v4.9 §2.6.5; W4.4 slice (i)).
//
// Invoked via `node <path>/watcher-entry.js <missionId> <workspaceRoot> [<principal>]` from
// spawnDaemonWatcher. Mode-dispatched at boot:
//   - Writer-mode (default; principal absent OR principal == owning-writer): chokidar Loop A
//     fs-watch on per-repo workspaces; debounce → wip-commit + push-to-coord-remote +
//     config-mutation-propagation via mtime-watch.
//   - Reader-mode (principal present + matches reader participant): Loop B setInterval timer-poll
//     wrapping `git fetch --tags coord-remote` via cached `.coord-mirror/` git-dir; ref-detection
//     fans out to cascade-terminated / cascade-config-update / applyReaderRefUpdate per W5c
//     MEDIUM-R8.1.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';

import { updateLockfileState } from '../state-machine/lockfile-state.js';
import { Missioncraft } from '../missioncraft.js';
import { parseMissionConfig } from '../yaml-transform.js';

const DEBOUNCE_MS = 1000;        // 1s default; configurable via mission.stateDurability.wipCadenceMs in slice (ii)
const HEARTBEAT_MS = 60_000;     // 60s lockfile-TTL extension cadence
const COORD_POLL_DEFAULT_MS = 5_000;     // W5c reader-daemon Loop B default (configurable via mission.stateDurability.coordPollMs)

async function main(): Promise<void> {
  const [, , missionId, workspaceRoot, principalArg] = process.argv;
  if (!missionId || !workspaceRoot) {
    process.stderr.write(`usage: watcher-entry.js <missionId> <workspaceRoot> [<principal>]\n`);
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

  // Daemon-tick `'started' → 'in-progress'` advance per Design v4.9 §2.4.1 line 1505
  // state-machine table ("operator does work" = daemon-tick = THIS code-path). Closes the
  // W4.3 spot-fix gap where start() ends at 'started' transient state.
  // Routes through Missioncraft.daemonTickAdvance which calls _engineMutate to preserve
  // validate→apply→atomic-write abstraction discipline (slice ii spot-fix per architect
  // substrate-currency check; parallel to W4.3 spot-fix `adf7ba1`).
  try {
    const mcTick = new Missioncraft({ workspaceRoot });
    await mcTick.daemonTickAdvance(missionId);
  } catch {
    // Daemon-tick advance is best-effort; failure doesn't crash daemon
  }

  // W5c mode-dispatch: detect reader-mode at boot via per-principal role lookup against
  // mission-config participants. Reader-mode runs Loop B only (no Loop A wip-commit in v1;
  // tamper-detect-rollback is a deeper concern deferred to W5c follow-on).
  let role: 'writer' | 'reader' = 'writer';
  let coordPollMs = COORD_POLL_DEFAULT_MS;
  try {
    const configPath = join(workspaceRoot, 'config', `${missionId}.yaml`);
    if (existsSync(configPath)) {
      const cfgContent = await readFile(configPath, 'utf8');
      const cfg = parseMissionConfig(cfgContent, configPath, 'auto');
      if (principalArg) {
        const matched = cfg.mission.participants?.find((p) => p.principal === principalArg);
        if (matched && matched.role === 'reader') role = 'reader';
      }
      if (typeof cfg.stateDurability?.coordPollMs === 'number') {
        coordPollMs = cfg.stateDurability.coordPollMs;
      }
    }
  } catch {
    // Mode-detection failure → default writer-mode (legacy single-principal compat)
  }

  // Reader-mode dispatch: Loop B setInterval timer-poll; SIGTERM/SIGINT handlers reused.
  if (role === 'reader' && principalArg) {
    let mcReader: Missioncraft;
    try {
      mcReader = new Missioncraft({ workspaceRoot, principal: principalArg });
    } catch {
      process.stderr.write(`watcher-entry: SDK bootstrap failed for reader-mode; daemon exiting\n`);
      process.exit(1);
    }
    const loopBTimer = setInterval(() => {
      void mcReader.readerLoopBTick(missionId, principalArg).catch(() => {
        // Loop B tick failure non-aborting; next tick retries
      });
    }, coordPollMs);
    const readerShutdown = async (_sig: string): Promise<void> => {
      if (shutdownInProgress) return;
      shutdownInProgress = true;
      clearInterval(loopBTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      process.exit(0);
    };
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    process.on('SIGTERM', () => { void readerShutdown('SIGTERM'); });
    process.on('SIGINT', () => { void readerShutdown('SIGINT'); });
    return;        // reader-mode boots Loop B + heartbeat only; no Loop A / wip-commit / push / config-watcher
  }

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

  // Process-crash recovery (slice iii follow-on): auto-commit-on-debounce per Design v0.2 §B.1.
  // SDK-bootstrapped Missioncraft instance (mc) provides storage + gitEngine pluggable access.
  // mission-78 W3-new (Design v5.0 single-branch): daemon commits to `refs/heads/mission/<missionId>`
  // (was `refs/heads/wip/<missionId>` pre-v5.0); the wip-branch sidecar is dropped. HEAD points
  // symbolically at mission/<id>; commitToRef's bypass-HEAD bypass-INDEX semantic + update-ref to
  // the target branch advances mission/<id>'s tip — HEAD now resolves to the new commit; working
  // tree matches the just-committed tree exactly, so `git status` reports clean. This IS the
  // Flow B canonical operator-DX promise: operator never sees dirty working tree after a
  // debounce-tick (operator never runs git commands).
  let mcSdk: Missioncraft;
  try {
    mcSdk = new Missioncraft({ workspaceRoot });
  } catch {
    process.stderr.write(`watcher-entry: SDK bootstrap failed for wip-commit; daemon continues with no wip-cadence\n`);
    mcSdk = undefined as unknown as Missioncraft;
  }

  watcher.on('change', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void (async () => {
        if (!mcSdk) return;
        try {
          const handles = await mcSdk.storage.list(missionId);
          const identity = await mcSdk.identity.resolve();
          for (const handle of handles) {
            try {
              await mcSdk.gitEngine.commitToRef(handle, `refs/heads/mission/${missionId}`, {
                message: `[auto] daemon-commit ${new Date().toISOString()}`,
                author: identity,
                autoStage: true,
              });
            } catch {
              // Per-repo daemon-commit failure is non-aborting; daemon continues watching
            }
          }
          // W5b slice (ii) item #2: push-on-cadence-conditional to coord-remote.
          // SDK helper handles conditional gating (coordinationRemote set + reader participants
          // present) + per-repo refspec push + lastPushSuccessAt tracking via .daemon-state.yaml.
          // Best-effort: failure is non-aborting; daemon continues watching.
          try {
            await mcSdk.pushWipToCoordRemote(missionId);
          } catch {
            // coord-remote push failure non-aborting; per-repo retries via next debounce-cycle
          }
          // W6 slice (v) Director (Y): bundle-ops snapshot post wip-commit (disk-failure recovery
          // substrate per §2.6.2 v0.4 §AAA). Capability-gated; best-effort; per-repo failure
          // non-aborting. Bundles land at <snapshotRoot>/<missionId>/<repoName>/<sha>.bundle.
          try {
            await mcSdk.snapshotWipBranches(missionId);
          } catch {
            // Snapshot failure non-aborting; recovery-from-disk-failure may degrade but
            // wip-branch local-state preserved + push-to-coord-remote already succeeded.
          }
        } catch {
          // Storage.list / identity.resolve failure → skip wip-commit cycle
        }
      })();
    }, DEBOUNCE_MS);
  });

  // W5b slice (ii) item #4: config-mtime-watch — propagate non-participant config-mutation
  // to coord-remote per MINOR-R6.4. Watches `<workspaceRoot>/config/<missionId>.yaml` directly
  // (separate from per-repo workspace watcher which targets working-tree changes only).
  let configWatcher: FSWatcher | undefined;
  let configDebounceTimer: NodeJS.Timeout | undefined;
  if (mcSdk) {
    const configPath = join(workspaceRoot, 'config', `${missionId}.yaml`);
    configWatcher = chokidar.watch(configPath, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
    });
    configWatcher.on('change', () => {
      if (configDebounceTimer) clearTimeout(configDebounceTimer);
      configDebounceTimer = setTimeout(() => {
        configDebounceTimer = undefined;
        void mcSdk.propagateConfigToCoordRemote(missionId).catch(() => {
          // Propagation failure non-aborting; next mtime-touch retries
        });
      }, DEBOUNCE_MS);
    });
  }

  // Extend shutdown to close config-watcher + clear its timer
  const originalShutdown = shutdown;
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
  const extendedShutdown = async (sig: string): Promise<void> => {
    if (configDebounceTimer) clearTimeout(configDebounceTimer);
    if (configWatcher) {
      try { await configWatcher.close(); } catch { /* best-effort */ }
    }
    await originalShutdown(sig);
  };
  process.on('SIGTERM', () => { void extendedShutdown('SIGTERM'); });
  process.on('SIGINT', () => { void extendedShutdown('SIGINT'); });

  // Daemon process stays alive via active timers + watcher event-loop registrations;
  // exits only via SIGTERM/SIGINT signal-handler.
}

main().catch((err) => {
  process.stderr.write(`watcher-entry fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
