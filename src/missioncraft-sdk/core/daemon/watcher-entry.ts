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

import { join } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';

import { updateLockfileState } from '../state-machine/lockfile-state.js';
import { Missioncraft } from '../missioncraft.js';
import { ReaderAutoCloseError } from '../../errors.js';
import { detectDaemonMode, detectReaderPullCadence, detectWriterPushCadence } from './daemon-mode-detect.js';

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

  // Mode-dispatch: detect reader-mode at boot. mission-78 W4-new slice (v) (Design v5.0 §2 row 4):
  // PRIMARY detection is `config.mission.readOnly === true` (v5.0 reader-mission: BRANCH-TRACKER
  // OR PERSISTENT-TRACKER). Pre-v5.0 v4.x detection via participant-role-lookup is RETAINED for
  // back-compat with v4.x missions through W4-new + W7-new (IsoEng removal). Both paths converge
  // on Loop B dispatch; v5.0 path uses new readerLoopBV5Tick (direct fetch+reset from source-
  // remote), v4.x path uses legacy readerLoopBTick (coord-mirror semantics).
  // Fix #10 (architect-dogfood-surfaced v1.2.0 BLOCKER): detection extracted into
  // detectDaemonMode helper using canonical missionConfigPath layout (was hardcoded incorrect
  // `<workspaceRoot>/config/<id>.yaml` missing `missions/` subdir).
  const detected = await detectDaemonMode(workspaceRoot, missionId, principalArg, COORD_POLL_DEFAULT_MS);
  const role = detected.role;
  const isV5Reader = detected.isV5Reader;

  // Reader-mode dispatch: Loop B setInterval timer-poll; SIGTERM/SIGINT handlers reused.
  // mission-78 W4-new slice (v): dispatch on isV5Reader → new readerLoopBV5Tick (Design v5.0
  // direct fetch+reset semantic); v4.x readerLoopBTick DELETED at slice (ii).
  // mission-78 W5-new slice (iv): pullCadence sourced from `detectReaderPullCadence` helper —
  // v5.0 missions prefer `pullIntervalSeconds` (default 30000ms); v4.x fallback to `coordPollMs`
  // (preserved through W7-new). Lifted from hardcoded `COORD_POLL_DEFAULT_MS` (5000ms) which
  // is now only used as detectDaemonMode's default-fallback for the v4.x participant-role path.
  if (role === 'reader') {
    let mcReader: Missioncraft;
    try {
      mcReader = new Missioncraft({ workspaceRoot, principal: principalArg });
    } catch {
      process.stderr.write(`watcher-entry: SDK bootstrap failed for reader-mode; daemon exiting\n`);
      process.exit(1);
    }
    const pullCadenceCfg = await detectReaderPullCadence(workspaceRoot, missionId);
    const loopBTimer = setInterval(() => {
      if (isV5Reader) {
        // v5.0 reader-mission (BRANCH-TRACKER or PERSISTENT-TRACKER): direct fetch+reset.
        // mission-78 W4-new slice (v.b): ReaderAutoCloseError signals writer-terminal detection
        // (BRANCH-TRACKER: writer config-gone OR lifecycle terminal). Path: atomic lifecycle
        // advance to 'abandoned' via readerAutoAbandon + SIGTERM-self. Other errors are tick-
        // transient (retry next tick).
        void mcReader.readerLoopBV5Tick(missionId).catch((err: unknown) => {
          if (err instanceof ReaderAutoCloseError) {
            void (async (): Promise<void> => {
              try { await mcReader.readerAutoAbandon(missionId, err.message); } catch { /* best-effort */ }
              clearInterval(loopBTimer);
              void readerShutdown('AUTO-CLOSE');
            })();
          }
          // Other errors: non-aborting; next tick retries
        });
      }
      // mission-78 W5-new slice (ii): v4.x readerLoopBTick (coord-mirror semantics) DELETED.
      // Reader-mode is v5.0-only via readerLoopBV5Tick (dispatched above on isV5Reader flag).
    }, pullCadenceCfg.intervalMs);
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

  // mission-78 W3-new extension Fix #6: subscribe to chokidar `add` + `unlink` + `change` events
  // (Flow B canonical operator-DX includes "create new file" + "delete file" workflows, not just
  // "modify existing file"). Pre-Fix-#6 only `change` was subscribed → operator's new-file-creation
  // workflow silently dropped (architect dogfood §C verification surfaced the gap).
  // `ignoreInitial: true` (line 143) already gates against commit-storming the initial clone-state;
  // post-`ready` add events fire only for OPERATOR-created files.
  const fireDebouncedCommit = (): void => {
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
          // mission-78 W5-new slice (ii): pushWipToCoordRemote DELETED (coord-remote primitive
          // removed per Design v5.0 §10.2). W5-new slice (iii) will add writer-daemon push-cadence
          // integration here: periodic `git push origin refs/heads/mission/<id>` per pushCadence
          // mission-config (default 'every-Ns' at 60s).
          // W6 slice (v) Director (Y): bundle-ops snapshot post daemon-commit (disk-failure recovery
          // substrate per §2.6.2 v0.4 §AAA). Capability-gated; best-effort; per-repo failure
          // non-aborting. Bundles land at <snapshotRoot>/<missionId>/<repoName>/<sha>.bundle.
          try {
            await mcSdk.snapshotWipBranches(missionId);
          } catch {
            // Snapshot failure non-aborting; recovery-from-disk-failure may degrade but
            // mission-branch local-state preserved + push-to-coord-remote already succeeded.
          }
        } catch {
          // Storage.list / identity.resolve failure → skip daemon-commit cycle
        }
      })();
    }, DEBOUNCE_MS);
  };

  watcher.on('change', fireDebouncedCommit);
  watcher.on('add', fireDebouncedCommit);
  watcher.on('unlink', fireDebouncedCommit);

  // mission-78 W5-new slice (ii): config-mtime-watch + propagateConfigToCoordRemote DELETED
  // (coord-remote primitive removed per Design v5.0 §10.2). Mission-config mutations are now
  // local-state-only at v1.2.0 standalone-capable; future Hub-coupling (idea-291) lands its own
  // propagation mechanism.
  let configWatcher: FSWatcher | undefined;
  let configDebounceTimer: NodeJS.Timeout | undefined;

  // mission-78 W5-new slice (iii): writer-daemon push-cadence integration per Design v5.0 §10.2.
  // Independent setInterval timer (β disposition thread-548 round 5) at pushIntervalSeconds
  // calling pushMissionBranchToUpstream — independent of chokidar debounce so reader-trackers
  // see writer's mission-branch on upstream within ≤pushIntervalSeconds (default 60s) regardless
  // of operator edit-activity. Gated OFF when pushCadence is 'on-complete-only' (only msn complete
  // pushes) or 'on-demand' (manual API-trigger; reserved for future surface). firstFireDelay =
  // pushIntervalSeconds (no immediate-fire on mission-start).
  //
  // Fire-and-forget detection: do NOT block main() on the YAML config-read here. Top-level await
  // on detectWriterPushCadence after `chokidar.watch` was triggering test-timing regressions
  // where the chokidar `ready` event firing got delayed past the test's 8s mission-branch-advance
  // window (v1.0.7-slice-iii-bug73 + W3-new e2e). Schedule the push-cadence setup via .then() so
  // main() returns immediately; chokidar's event-loop is unblocked.
  let pushCadenceTimer: NodeJS.Timeout | undefined;
  if (mcSdk) {
    void detectWriterPushCadence(workspaceRoot, missionId).then((pushCadenceCfg) => {
      if (pushCadenceCfg.enabled) {
        const intervalMs = pushCadenceCfg.intervalSeconds * 1000;
        pushCadenceTimer = setInterval(() => {
          void mcSdk.pushMissionBranchToUpstream(missionId).catch(() => {
            // Per-tick failure non-aborting (per-repo failures already swallowed inside the helper);
            // next tick retries. Idempotent no-op when mission-branch already up-to-date upstream.
          });
        }, intervalMs);
      }
    }).catch(() => {
      // Config-read failure → push-cadence stays disabled (matches detectWriterPushCadence
      // silent-default-on-error semantic; daemon continues with chokidar event-loop intact).
    });
  }

  // Extend shutdown to close config-watcher + clear its timer + clear push-cadence timer
  const originalShutdown = shutdown;
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
  const extendedShutdown = async (sig: string): Promise<void> => {
    if (configDebounceTimer) clearTimeout(configDebounceTimer);
    if (configWatcher) {
      try { await configWatcher.close(); } catch { /* best-effort */ }
    }
    if (pushCadenceTimer) clearInterval(pushCadenceTimer);
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
