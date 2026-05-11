// Output formatter for CLI persona (Design v4.8 §2.3.2 — `--output` global flag: text/json/yaml).
// Used by command-handlers to format SDK return values for stdout.

import { stringify as yamlStringify } from 'yaml';

export type OutputFormat = 'text' | 'json' | 'yaml';

/**
 * Resolve OutputFormat from --output global flag (default 'text').
 * Throws if value isn't one of the 3 supported formats.
 */
export function resolveOutputFormat(globalFlags: ReadonlyMap<string, string | boolean>): OutputFormat {
  const raw = globalFlags.get('--output');
  if (raw === undefined) return 'text';
  if (raw === true) return 'text';                   // flag-only without value defaults to text
  if (raw === 'text' || raw === 'json' || raw === 'yaml') return raw;
  throw new Error(`Invalid --output value '${String(raw)}'; valid: text | json | yaml`);
}

/** Generic value → formatted string. */
export function formatValue(value: unknown, format: OutputFormat): string {
  if (format === 'json') {
    return JSON.stringify(value, dateReviver, 2);
  }
  if (format === 'yaml') {
    return yamlStringify(value);
  }
  // text format — minimal default; verb-handler may override with custom rendering
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';
  // fall-through to JSON for objects (text-mode complex-value default)
  return JSON.stringify(value, dateReviver, 2);
}

function dateReviver(_key: string, value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** Format a tabular list (e.g., for `msn list`). */
export function formatTable(
  rows: ReadonlyArray<Record<string, unknown>>,
  columns: readonly string[],
  format: OutputFormat,
): string {
  if (format === 'json' || format === 'yaml') {
    return formatValue(rows, format);
  }
  // text format — simple column-aligned table
  // bug-64 item 2: empty-state preserves header row (operator can see schema; mirrors `docker ps`)
  // bug-64 item 4: CYAN header (ANSI \x1b[36m) when stdout is a TTY; drop horizontal separator row;
  // plain output when piped/redirected (operator-pipe + LLM-consumer friendliness).
  const headerCells = columns.map((c) => c.toUpperCase());
  const dataCells = rows.map((r) => columns.map((c) => stringifyCell(r[c])));
  const widths = columns.map((_, ci) =>
    Math.max(headerCells[ci].length, ...dataCells.map((row) => row[ci].length)),
  );
  const pad = (cell: string, w: number): string => cell + ' '.repeat(Math.max(0, w - cell.length));
  const useTtyDecoration = process.stdout.isTTY === true;
  const headerLine = headerCells.map((h, ci) => pad(h, widths[ci])).join('  ');
  const lines: string[] = [];
  lines.push(useTtyDecoration ? `\x1b[36m${headerLine}\x1b[0m` : headerLine);
  if (dataCells.length === 0) {
    lines.push('(no entries)');
  } else {
    for (const row of dataCells) {
      lines.push(row.map((c, ci) => pad(c, widths[ci])).join('  '));
    }
  }
  return lines.join('\n');
}

function stringifyCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}
