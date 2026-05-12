// mission-78 W4-new Fix #10: daemon-side mode-detection helper (extracted for testability per
// Fix #11). Canonical mission-config path is `<workspaceRoot>/config/missions/<id>.yaml` (per
// v1.0.5 idea-271 layout consolidation; matches `Missioncraft.missionConfigPath` private helper).
//
// Pre-Fix-#10 watcher-entry hardcoded `<workspaceRoot>/config/<id>.yaml` (missing `missions/`
// subdir) → existsSync FALSE → catch-all silently swallowed → reader-mode never activated;
// Loop B dead end-to-end. Calibration #74 candidate: synthetic SDK-direct tests pass while
// daemon-dispatch path entirely broken — composes with calibrations #67/#68 (synthetic-test
// masking patterns) at the daemon-watcher layer.
//
// Extracted into a separate module so test files can import detectDaemonMode WITHOUT triggering
// the watcher-entry.ts top-level main() invocation (which calls process.exit on missing argv).

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseMissionConfig } from '../yaml-transform.js';

export interface DaemonModeDetectResult {
  readonly role: 'writer' | 'reader';
  readonly isV5Reader: boolean;
  readonly coordPollMs: number;
}

/** Canonical mission-config path matching `Missioncraft.missionConfigPath` (per v1.0.5 idea-271). */
export function missionConfigPath(workspaceRoot: string, missionId: string): string {
  return join(workspaceRoot, 'config', 'missions', `${missionId}.yaml`);
}

/**
 * Detect daemon-mode for a given mission. Returns dispatch-result with role + isV5Reader flag
 * + coordPollMs override. `existsSync` MISS (e.g., mission-config not present) yields default
 * writer-mode (parallel to pre-Fix-#10 silent-swallow behavior; intentional).
 *
 * v5.0 PRIMARY detection: `config.mission.readOnly === true`. v4.x LEGACY back-compat:
 * participant-role-lookup against `principalArg`. Both converge on Loop B dispatch via the
 * caller-side `isV5Reader` flag.
 */
export async function detectDaemonMode(
  workspaceRoot: string,
  missionId: string,
  principalArg: string | undefined,
  defaultCoordPollMs: number,
): Promise<DaemonModeDetectResult> {
  let role: 'writer' | 'reader' = 'writer';
  let isV5Reader = false;
  let coordPollMs = defaultCoordPollMs;
  try {
    // CANONICAL: `<workspaceRoot>/config/missions/<id>.yaml` (Fix #10; matches missionConfigPath)
    const configPath = missionConfigPath(workspaceRoot, missionId);
    if (existsSync(configPath)) {
      const cfgContent = await readFile(configPath, 'utf8');
      const cfg = parseMissionConfig(cfgContent, configPath, 'auto');
      // v5.0 PRIMARY: config.mission.readOnly === true (per Design v5.0 §2 row 4)
      if (cfg.mission.readOnly === true) {
        role = 'reader';
        isV5Reader = true;
      } else if (principalArg !== undefined) {
        // v4.x LEGACY: participant-role-lookup (back-compat; pre-v5.0 multi-participant missions)
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
  return { role, isV5Reader, coordPollMs };
}

/**
 * mission-78 W5-new slice (iii): writer-daemon push-cadence config detection (extracted for
 * testability per calibration #74 daemon-dispatch-layer discipline).
 *
 * Per Design v5.0 §10.2 + §10.5 + (β) disposition thread-548 round 5:
 * - `pushCadence: 'every-Ns'` (default; auto-push every pushIntervalSeconds via setInterval)
 * - `pushCadence: 'on-complete-only'` (auto-push OFF; only mc.complete pushes; v1.x behavior)
 * - `pushCadence: 'on-demand'` (auto-push OFF; manual API-trigger reserved for future surface)
 *
 * Defaults applied when fields absent: cadence='every-Ns'; intervalSeconds=60. Reader-mission
 * (readOnly === true) is push-cadence-IRRELEVANT (return enabled=false) — readers don't push.
 * Returns enabled=false when config absent (silent default; daemon never spawns push-cadence
 * timer in that case).
 */
export interface WriterPushCadenceDetectResult {
  /** True iff writer-mission with pushCadence resolving to 'every-Ns'. */
  readonly enabled: boolean;
  /** Resolved pushIntervalSeconds (only meaningful when enabled=true). */
  readonly intervalSeconds: number;
}

const DEFAULT_PUSH_INTERVAL_SECONDS = 60;
const DEFAULT_PUSH_CADENCE = 'every-Ns';

export async function detectWriterPushCadence(
  workspaceRoot: string,
  missionId: string,
): Promise<WriterPushCadenceDetectResult> {
  try {
    const configPath = missionConfigPath(workspaceRoot, missionId);
    if (!existsSync(configPath)) return { enabled: false, intervalSeconds: DEFAULT_PUSH_INTERVAL_SECONDS };
    const cfgContent = await readFile(configPath, 'utf8');
    const cfg = parseMissionConfig(cfgContent, configPath, 'auto');
    // Reader-mission has no mission-branch to push (Loop B fetches from upstream instead).
    if (cfg.mission.readOnly === true) return { enabled: false, intervalSeconds: DEFAULT_PUSH_INTERVAL_SECONDS };
    const cadence = cfg.stateDurability?.pushCadence ?? DEFAULT_PUSH_CADENCE;
    const intervalSeconds = cfg.stateDurability?.pushIntervalSeconds ?? DEFAULT_PUSH_INTERVAL_SECONDS;
    return {
      enabled: cadence === 'every-Ns',
      intervalSeconds,
    };
  } catch {
    // Config-read failure → default disabled (matches detectDaemonMode silent-swallow pattern)
    return { enabled: false, intervalSeconds: DEFAULT_PUSH_INTERVAL_SECONDS };
  }
}
