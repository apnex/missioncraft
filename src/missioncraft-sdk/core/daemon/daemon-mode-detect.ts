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
