// Mission lifecycle FSM (Design v4.8 §2.4.1).
//
// Pure-function state-transition validator. Used by Missioncraft.update + Missioncraft.start/complete/abandon
// runtime to enforce the canonical state-machine + provide error-messaging on illegal transitions.

import type { MissionStatePhase } from '../mission-types.js';

/** Lifecycle events that drive state transitions. */
export type LifecycleEvent =
  // Writer-side (Design v4.8 §2.4.1)
  | 'add-first-repo'           // created → configured (auto on first add-repo per refinement #3)
  | 'remove-last-repo'         // configured → created (back-transition; pre-start only)
  | 'start-begin'              // configured → started (transient; daemon-spawn in flight)
  | 'start-complete'           // started → in-progress (atomic at 9-step Step 7 state-yaml-persist)
  | 'complete-success'         // in-progress → completed (terminal; atomic at publish-flow Step 3)
  | 'abandon-success'          // in-progress → abandoned (terminal; atomic at abandon-flow Step 6 per v3.6 MINOR-R6.1)
  // Reader-side (v4.0 NEW per HIGH-R2.3)
  | 'join-begin'               // (new) → joined (transient; reader 7-step Step 3.5 atomic-write per v4.5 MEDIUM-R6.3)
  | 'join-complete'            // joined → reading (atomic at reader 7-step Step 7 state-yaml-persist)
  | 'writer-terminated'        // reading → readonly-completed (cascade per HIGH-R2.3; refs/tags/missioncraft/<id>/terminated detection)
  | 'leave-begin'              // reading → leaving (transient; reader-side disengage)
  | 'leave-complete';          // leaving → terminal-removed

/**
 * Compute the next state given current + event. Returns null if transition is invalid.
 *
 * Pure function; no side-effects. Caller (Missioncraft class) atomically persists the result via storage.
 */
export function nextState(
  current: MissionStatePhase | null,
  event: LifecycleEvent,
): MissionStatePhase | null {
  switch (event) {
    case 'add-first-repo':
      if (current === 'created') return 'configured';
      return null;
    case 'remove-last-repo':
      if (current === 'configured') return 'created';
      return null;
    case 'start-begin':
      if (current === 'configured') return 'started';
      return null;
    case 'start-complete':
      if (current === 'started') return 'in-progress';
      return null;
    case 'complete-success':
      if (current === 'in-progress' || current === 'started') return 'completed';
      return null;
    case 'abandon-success':
      if (current === 'in-progress' || current === 'started') return 'abandoned';
      return null;
    case 'join-begin':
      if (current === null) return 'joined';
      return null;
    case 'join-complete':
      if (current === 'joined') return 'reading';
      return null;
    case 'writer-terminated':
      if (current === 'reading') return 'readonly-completed';
      return null;
    case 'leave-begin':
      if (current === 'reading') return 'leaving';
      return null;
    case 'leave-complete':
      if (current === 'leaving') return null;     // terminal-removed (no persistent state)
      return null;
    default: {
      const _exhaustive: never = event;
      void _exhaustive;
      return null;
    }
  }
}

/**
 * Returns true if state is terminal (no further transitions possible OR only set-hub-id allowed).
 * Per Design v4.8 §2.4.1 invariant: terminal states reject most field-updates per per-field state-restriction matrix.
 */
export function isTerminal(state: MissionStatePhase): boolean {
  return state === 'completed' || state === 'abandoned' || state === 'readonly-completed';
}

/**
 * Returns true if state is a transient transition state (held only briefly during multi-step transition).
 * Per Design v4.8 §2.4.1 — `started` (9-step writer-side) and `joined` (7-step reader-side) are transient.
 */
export function isTransient(state: MissionStatePhase): boolean {
  return state === 'started' || state === 'joined' || state === 'leaving';
}
