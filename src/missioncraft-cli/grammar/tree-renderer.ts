// v1.0.4 idea-272 — `msn tree` verb-hierarchy ASCII visualization.
//
// Walks the same VerbArgSpec data-structure as the per-verb help renderer (idea-274), producing
// a tree-style listing of all top-level verbs + their sub-verbs/sub-actions. Useful for operator-
// discovery + LLM-driven exploration.

import { VERB_SPECS, type VerbArgSpec, RESERVED_VERBS } from './arg-spec.js';

/** Render the full verb-hierarchy tree. `maxDepth` limits recursion (1 = top-level only). */
export function renderTree(maxDepth?: number): string {
  const lines: string[] = ['msn'];
  // Operator-relevant verbs (skip --help / --version since they're documented in `help` + `version` aliases)
  const topVerbs = (RESERVED_VERBS as readonly string[]).filter((v) => !v.startsWith('--'));
  // Order: meta verbs first (help/version/tree/shell-init/cd), then mission verbs, then namespaces
  const META = new Set(['help', 'version', 'tree', 'shell-init', 'cd']);
  const NAMESPACE = new Set(['update', 'scope', 'config']);
  const ordered = [
    ...topVerbs.filter((v) => META.has(v)),
    ...topVerbs.filter((v) => !META.has(v) && !NAMESPACE.has(v)),
    ...topVerbs.filter((v) => NAMESPACE.has(v)),
  ];

  for (let i = 0; i < ordered.length; i++) {
    const verb = ordered[i];
    const isLast = i === ordered.length - 1;
    const spec = VERB_SPECS[verb];
    if (!spec) continue;
    const branch = isLast ? '└──' : '├──';
    const childIndent = isLast ? '   ' : '│  ';
    lines.push(`${branch} ${formatVerbLine(verb, spec)}`);
    if (spec.subActions && (maxDepth === undefined || maxDepth > 1)) {
      const subNames = Object.keys(spec.subActions);
      for (let j = 0; j < subNames.length; j++) {
        const subName = subNames[j];
        const subSpec = spec.subActions[subName];
        const subIsLast = j === subNames.length - 1;
        const subBranch = subIsLast ? '└──' : '├──';
        const subChildIndent = subIsLast ? '   ' : '│  ';
        lines.push(`${childIndent}${subBranch} ${formatVerbLine(subName, subSpec)}`);
        // Third-level (e.g., `scope update <sub-action>`) when depth allows
        if (subSpec.subActions && (maxDepth === undefined || maxDepth > 2)) {
          const subSubNames = Object.keys(subSpec.subActions);
          for (let k = 0; k < subSubNames.length; k++) {
            const subSubName = subSubNames[k];
            const subSubSpec = subSpec.subActions[subSubName];
            const subSubIsLast = k === subSubNames.length - 1;
            const subSubBranch = subSubIsLast ? '└──' : '├──';
            lines.push(`${childIndent}${subChildIndent}${subSubBranch} ${formatVerbLine(subSubName, subSubSpec)}`);
          }
        }
      }
    }
  }
  return lines.join('\n');
}

/** Compact one-line representation: `<verb> [args]  # <shortDesc>`. */
function formatVerbLine(verb: string, spec: VerbArgSpec): string {
  const argsPart = spec.argLabels?.map((a) => a.label).join(' ') ?? '';
  const shortDesc = spec.shortDesc ?? spec.description ?? '';
  const left = argsPart ? `${verb} ${argsPart}` : verb;
  return shortDesc ? `${left.padEnd(40)} # ${shortDesc}` : left;
}
