// Per-field state-restriction matrix (Design v4.8 §2.4.1 v3.1 fold per HIGH-3 + v4.0 multi-participant extension per MEDIUM-R1.5).
//
// Each MissionMutation.kind has its own state-restriction across the 6 writer-side lifecycle-states.
// Per §2.4.1: terminal states (completed/abandoned) reject most field-updates; set-hub-id is the lone exception (informational-only).
// Reader-side states (joined/reading/readonly-completed/leaving) reject ALL mutations per HIGH-R2.3 (read-only participant).

import type { MissionMutation, MissionStatePhase } from '../mission-types.js';

const WRITER_STATES: readonly MissionStatePhase[] = [
  'created',
  'configured',
  'started',
  'in-progress',
  'completed',
  'abandoned',
];

const PRE_START: readonly MissionStatePhase[] = ['created', 'configured'];
const TERMINAL: readonly MissionStatePhase[] = ['completed', 'abandoned'];

/**
 * Returns null if mutation is allowed in currentState; returns error-message string if rejected.
 *
 * Per Design v4.8 §2.4.1 per-field state-restriction matrix:
 * - add-repo: ✓ pre-start full-upsert; ✓ started/in-progress additive-only; ✗ terminal
 * - remove-repo: ✓ pre-start; ✗ post-start (refinement #3 atomicity)
 * - rename / set-description / set-tag / remove-tag: ✓ any pre-terminal state
 * - set-hub-id: ✓ ANY state including terminal (informational-only at v1)
 * - set-scope: ✓ pre-start ONLY (post-start scope.repos already snapshotted per §2.4.2)
 * - add-participant / remove-participant (v4.0 NEW): ✓ created/configured/started/in-progress; ✗ terminal
 * - set-coordination-remote (v4.0 NEW): ✓ pre-start ONLY (post-start orphans readers)
 *
 * Reader-side states reject ALL mutations (read-only participant per HIGH-R2.3).
 */
export function validateMutationAllowed(
  mutation: MissionMutation,
  currentState: MissionStatePhase,
): string | null {
  // Reader-side rejection (per HIGH-R2.3)
  if (!WRITER_STATES.includes(currentState)) {
    return `mutation '${mutation.kind}' rejected on reader-side state '${currentState}' (read-only participant per HIGH-R2.3)`;
  }
  switch (mutation.kind) {
    case 'add-repo':
      // pre-start full upsert OR post-start additive (per refinement #3)
      if (currentState === 'completed' || currentState === 'abandoned') {
        return `mutation 'add-repo' rejected on terminal state '${currentState}'`;
      }
      return null;
    case 'remove-repo':
      // pre-start only
      if (!PRE_START.includes(currentState)) {
        return `mutation 'remove-repo' rejected on '${currentState}' (pre-start only per refinement #3)`;
      }
      return null;
    case 'rename':
    case 'set-description':
    case 'set-tag':
    case 'remove-tag':
      // any pre-terminal state
      if (TERMINAL.includes(currentState)) {
        return `mutation '${mutation.kind}' rejected on terminal state '${currentState}'`;
      }
      return null;
    case 'set-hub-id':
      // any state INCLUDING terminal (informational-only at v1)
      return null;
    case 'set-scope':
      // pre-start only
      if (!PRE_START.includes(currentState)) {
        return `mutation 'set-scope' rejected on '${currentState}' (pre-start only; post-start scope.repos already snapshotted)`;
      }
      return null;
    case 'add-participant':
    case 'remove-participant':
      // created/configured/started/in-progress; ERROR on terminal
      if (TERMINAL.includes(currentState)) {
        return `mutation '${mutation.kind}' rejected on terminal state '${currentState}'`;
      }
      return null;
    case 'set-coordination-remote':
      // pre-start ONLY (post-start change orphans readers per §2.4.1 v4.x)
      if (!PRE_START.includes(currentState)) {
        return `mutation 'set-coordination-remote' rejected on '${currentState}' (pre-start only; post-start change would orphan readers)`;
      }
      return null;
    default: {
      // exhaustive check at type-level; runtime fallback
      const _exhaustive: never = mutation;
      void _exhaustive;
      return `unknown mutation kind: ${(mutation as { kind: string }).kind}`;
    }
  }
}
