// v1.0.4 bug-66 (slice iii) — ANSI color-palette module.
//
// TTY-aware color emit helpers honoring standard env-var conventions:
//   NO_COLOR=1     → always disable color output (https://no-color.org)
//   FORCE_COLOR=1  → always enable color output (useful for CI log capture with ANSI)
//   default        → auto-detect via process.stdout.isTTY
//
// No external `chalk` dep — raw ANSI escapes only. Single module is the substrate; all emit-sites
// (output-formatter header, bin.ts error/success, etc.) consume `colors.*` helpers below.

const CODES = {
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  green:  '\x1b[32m',
  reset:  '\x1b[0m',
} as const;

/**
 * Color-emit predicate. Honors NO_COLOR (disable), FORCE_COLOR (enable), else TTY-auto-detect.
 * Re-evaluated on every call so env-var changes mid-run (e.g., test-time mutation) take effect.
 */
export function shouldColor(): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '') return true;
  return process.stdout.isTTY === true;
}

function wrap(code: string, text: string): string {
  return shouldColor() ? `${code}${text}${CODES.reset}` : text;
}

export const colors = {
  /** Red — used for error messages. */
  error:   (s: string): string => wrap(CODES.red, s),
  /** Yellow — used for warnings + non-fatal hints. */
  warn:    (s: string): string => wrap(CODES.yellow, s),
  /** Cyan — used for informational lines (table headers, hints). */
  info:    (s: string): string => wrap(CODES.cyan, s),
  /** Green — used for success confirmations (start/abandon/complete lines). */
  success: (s: string): string => wrap(CODES.green, s),
  /** Cyan — used for table headers (alias for info; semantic distinction at call-site). */
  header:  (s: string): string => wrap(CODES.cyan, s),
};
