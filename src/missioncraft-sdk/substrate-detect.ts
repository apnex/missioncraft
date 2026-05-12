// Substrate dependency detection (Path D2 per idea-284; v1.0.8 NEW).
//
// Director directive 2026-05-12: "Let's hard depend on git and gh binaries. Let's make
// missioncraft detect these automatically, and show the current git and gh binary versions
// additionally in the 'msn version' output. Arguments become a robust code structuring exercise.
// Clean and simple."
//
// Discipline: argv-only (`execFile` not `exec`) per `feedback_operator_never_runs_git_commands.md`
// + bug-75 calibration. Caches result per-process (module-level); `refreshSubstrate()` clears
// for long-lived consumers that need a fresh check.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Substrate-detection result: per-binary version-or-null + the friendly error message
 * when missing. SDK consumers can decide how strict to be (throw vs. continue with reduced
 * capability); the CLI's `msn version` surfaces both states. */
export interface SubstrateDetection {
  readonly git: string | null;             // e.g. "2.43.0"; null if not found
  readonly gh: string | null;              // e.g. "2.42.0"; null if not found
  /** Friendly install-hint strings, keyed by binary name; populated for missing entries only. */
  readonly missing: Record<string, string>;
}

let cached: SubstrateDetection | undefined;

const INSTALL_HINTS: Record<string, string> = {
  git: "install: brew install git  /  apt install git  /  https://gitforwindows.org/",
  gh: "install: brew install gh  /  apt install gh  /  https://cli.github.com/",
};

/** Run `<bin> --version` and parse the leading semver-ish token. Returns null if the binary
 * is missing or exits non-zero. Network/permission errors also return null (treat as missing). */
async function probeBinary(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(bin, ['--version'], { timeout: 5000 });
    // git: "git version 2.43.0\n"
    // gh:  "gh version 2.42.0 (2025-...)\n..."
    const match = /(\d+\.\d+(?:\.\d+)?)/.exec(stdout);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** Detect substrate dependencies (git + gh). Cached per-process; subsequent calls return the
 * cached result. Use `refreshSubstrate()` to force re-probe. */
export async function detectSubstrate(): Promise<SubstrateDetection> {
  if (cached) return cached;
  const [git, gh] = await Promise.all([probeBinary('git'), probeBinary('gh')]);
  const missing: Record<string, string> = {};
  if (git === null) missing.git = INSTALL_HINTS.git;
  if (gh === null) missing.gh = INSTALL_HINTS.gh;
  cached = { git, gh, missing };
  return cached;
}

/** Clear the per-process cache. Long-lived SDK consumers (e.g., daemon processes) that need a
 * fresh re-probe after operator-installs-missing-binary should call this. */
export function refreshSubstrate(): void {
  cached = undefined;
}

/** Strict variant: throw a friendly error if any required substrate binary is missing.
 * The CLI's `msn version` uses the non-throwing `detectSubstrate()` directly (to surface both
 * found + missing entries); operator-paths that REQUIRE the binary call this. */
export async function requireSubstrate(...required: ('git' | 'gh')[]): Promise<SubstrateDetection> {
  const detection = await detectSubstrate();
  const missingRequired = required.filter((bin) => detection[bin] === null);
  if (missingRequired.length > 0) {
    const lines = [
      `error: required binary${missingRequired.length > 1 ? 's' : ''} not found on PATH: ${missingRequired.join(', ')}`,
      '',
      'Missioncraft requires the following CLI tools as substrate:',
      ...missingRequired.map((bin) => `  - ${bin}: ${INSTALL_HINTS[bin]}`),
    ];
    throw new Error(lines.join('\n'));
  }
  return detection;
}
