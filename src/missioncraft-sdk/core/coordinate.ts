// coordinate.ts — substrate-coordinate parser (SDK-level; sovereign-module compliant).
//
// Mirrors the CLI grammar's Rule 7 / Rule N coordinate-parser at the SDK level so SDK consumers
// (operators using `Missioncraft.workspace(idOrCoordinate)` resolution) don't depend on the CLI
// module. Per W3 sovereign-module split (Refinement #4): SDK + CLI are separately-importable.
//
// Format: `<mission-id>:<repo>[/<path>]` per Design v4.9 §2.3 Rule 7 + idea-265 + MEDIUM-R1.3.
// Whitespace inside coordinate rejected.

import { ConfigValidationError } from '../errors.js';

export interface SubstrateCoordinate {
  readonly mission: string;
  readonly repo?: string;
  readonly path?: string;
}

export function parseSubstrateCoordinate(positional: string): SubstrateCoordinate | undefined {
  if (!positional.includes(':')) return undefined;
  if (/\s/.test(positional)) {
    throw new ConfigValidationError(
      `substrate-coordinate parsing: whitespace inside coordinate '${positional}' is rejected`,
    );
  }
  const [mission, rest] = positional.split(':', 2);
  if (rest === undefined || rest === '') return { mission };
  const slashIdx = rest.indexOf('/');
  if (slashIdx === -1) return { mission, repo: rest };
  return {
    mission,
    repo: rest.slice(0, slashIdx),
    path: rest.slice(slashIdx + 1),
  };
}
