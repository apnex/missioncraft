// v1.0.4 idea-274 — per-verb help renderer.
//
// Reads the VerbArgSpec data-structure for a given verb-path and produces formatted help text.
// Output format per architect-spec at thread-533:
//
//   usage: msn <verb-path> [args] [--flags]
//
//   <shortDesc>
//
//   <longDesc>
//
//   Arguments:
//     <arg>    <description>
//
//   Flags:
//     --flag <val>    <description>
//
//   Examples:
//     <cmd>    # <comment>
//
//   See also: <ref>; <ref>
//
// Sub-verbs are also enumerated when the spec has a subActions map.

import { VERB_SPECS, type VerbArgSpec, GLOBAL_FLAGS } from './arg-spec.js';

/**
 * Walk the arg-spec tree by a verb-path. Returns the leaf VerbArgSpec, or undefined if path invalid.
 * E.g., resolveSpec(['update', 'repo-add']) returns the repo-add sub-action spec.
 */
export function resolveSpec(verbPath: readonly string[]): VerbArgSpec | undefined {
  if (verbPath.length === 0) return undefined;
  let spec: VerbArgSpec | undefined = VERB_SPECS[verbPath[0]];
  for (let i = 1; i < verbPath.length && spec !== undefined; i++) {
    spec = spec.subActions?.[verbPath[i]];
  }
  return spec;
}

/** Render per-verb help for a given verb-path. */
export function renderVerbHelp(verbPath: readonly string[]): string {
  const spec = resolveSpec(verbPath);
  if (!spec) {
    return `error: unknown verb-path: 'msn ${verbPath.join(' ')}'\n\nhint: run 'msn help' for the full verb list`;
  }
  const shortDesc = spec.shortDesc ?? spec.description ?? '';
  const lines: string[] = [];

  // Usage line
  const usage = spec.usageOverride ?? buildUsageLine(verbPath, spec);
  lines.push(`usage: ${usage}`);
  lines.push('');

  // Short description
  if (shortDesc) {
    lines.push(shortDesc);
    lines.push('');
  }

  // Long description (paragraph)
  if (spec.longDesc) {
    lines.push(spec.longDesc);
    lines.push('');
  }

  // Arguments section (when argLabels provided)
  if (spec.argLabels && spec.argLabels.length > 0) {
    lines.push('Arguments:');
    const width = Math.max(...spec.argLabels.map((a) => a.label.length));
    for (const arg of spec.argLabels) {
      lines.push(`  ${arg.label.padEnd(width)}  ${arg.description}`);
    }
    lines.push('');
  }

  // Sub-verbs section (when spec has subActions)
  if (spec.subActions) {
    lines.push('Sub-verbs:');
    const subNames = Object.keys(spec.subActions);
    const width = Math.max(...subNames.map((n) => n.length));
    for (const subName of subNames) {
      const subSpec = spec.subActions[subName];
      const subDesc = subSpec.shortDesc ?? subSpec.description ?? '';
      lines.push(`  ${subName.padEnd(width)}  ${subDesc}`);
    }
    lines.push('');
  }

  // Flags section
  if (spec.flags.length > 0) {
    lines.push('Flags:');
    const flagStrs = spec.flags.map((f) => f.takesValue ? `${f.name} <val>` : f.name);
    const width = Math.max(...flagStrs.map((s) => s.length));
    for (let i = 0; i < spec.flags.length; i++) {
      const flag = spec.flags[i];
      const flagStr = flagStrs[i];
      lines.push(`  ${flagStr.padEnd(width)}  ${flag.description ?? ''}`);
    }
    lines.push('');
  }

  // Global flags section (only at top-level help; per-verb help omits to reduce noise)
  if (verbPath.length === 1 && spec.flags.length === 0 && !spec.subActions) {
    // Show global flags only when no per-verb flags + no sub-actions (verb has nothing else to show)
    lines.push('Global flags (apply to all verbs):');
    const flagStrs = GLOBAL_FLAGS.map((f) => `${f.name} <val>`);
    const width = Math.max(...flagStrs.map((s) => s.length));
    for (let i = 0; i < GLOBAL_FLAGS.length; i++) {
      lines.push(`  ${flagStrs[i].padEnd(width)}  ${GLOBAL_FLAGS[i].description ?? ''}`);
    }
    lines.push('');
  }

  // Examples section
  if (spec.examples && spec.examples.length > 0) {
    lines.push('Examples:');
    const cmds = spec.examples.map((e) => e.cmd);
    const width = Math.max(...cmds.map((c) => c.length));
    for (const ex of spec.examples) {
      const comment = ex.comment ? `  # ${ex.comment}` : '';
      lines.push(`  ${ex.cmd.padEnd(width)}${comment}`);
    }
    lines.push('');
  }

  // See-also section
  if (spec.seeAlso && spec.seeAlso.length > 0) {
    lines.push(`See also: ${spec.seeAlso.join(', ')}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/** Build the default usage-line for a verb-path + spec. */
function buildUsageLine(verbPath: readonly string[], spec: VerbArgSpec): string {
  const parts = ['msn', ...verbPath];
  // argLabels (required positionals)
  if (spec.argLabels) {
    for (const arg of spec.argLabels) {
      parts.push(arg.label);
    }
  }
  // Verb-specific flags (short-form, only the names)
  for (const flag of spec.flags) {
    if (flag.required) {
      parts.push(flag.takesValue ? `${flag.name} <val>` : flag.name);
    } else {
      parts.push(`[${flag.takesValue ? `${flag.name} <val>` : flag.name}]`);
    }
  }
  return parts.join(' ');
}
