import { describe, expect, it } from 'vitest';
import { nextState, isTerminal, isTransient, type LifecycleEvent } from '../../src/missioncraft-sdk/core/state-machine/lifecycle-state-machine.js';
import { validateMutationAllowed } from '../../src/missioncraft-sdk/core/state-machine/state-restriction-matrix.js';
import type { MissionMutation, MissionStatePhase } from '@apnex/missioncraft';

describe('Lifecycle FSM — W4.1 smoke-tests', () => {
  it('writer-side: created → configured → started → in-progress → completed', () => {
    expect(nextState('created', 'add-first-repo')).toBe('configured');
    expect(nextState('configured', 'start-begin')).toBe('started');
    expect(nextState('started', 'start-complete')).toBe('in-progress');
    expect(nextState('in-progress', 'complete-success')).toBe('completed');
  });

  it('writer-side: alternative path created → ... → abandoned', () => {
    expect(nextState('configured', 'start-begin')).toBe('started');
    expect(nextState('started', 'abandon-success')).toBe('abandoned');
  });

  it('writer-side back-transition: configured → created (remove-last-repo)', () => {
    expect(nextState('configured', 'remove-last-repo')).toBe('created');
  });

  it('reader-side: null → joined → reading → readonly-completed', () => {
    expect(nextState(null, 'join-begin')).toBe('joined');
    expect(nextState('joined', 'join-complete')).toBe('reading');
    expect(nextState('reading', 'writer-terminated')).toBe('readonly-completed');
  });

  it('reader-side leave: reading → leaving → terminal-removed (null)', () => {
    expect(nextState('reading', 'leave-begin')).toBe('leaving');
    expect(nextState('leaving', 'leave-complete')).toBeNull();      // terminal-removed
  });

  it('rejects illegal transitions (returns null)', () => {
    expect(nextState('completed', 'start-begin')).toBeNull();      // terminal can't start
    expect(nextState('created', 'complete-success')).toBeNull();    // can't skip configured/started
    expect(nextState('reading', 'start-begin')).toBeNull();         // reader-side can't enter writer-side flow
  });

  it('isTerminal()', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('abandoned')).toBe(true);
    expect(isTerminal('readonly-completed')).toBe(true);
    expect(isTerminal('in-progress')).toBe(false);
    expect(isTerminal('reading')).toBe(false);
  });

  it('isTransient()', () => {
    expect(isTransient('started')).toBe(true);
    expect(isTransient('joined')).toBe(true);
    expect(isTransient('leaving')).toBe(true);
    expect(isTransient('configured')).toBe(false);
    expect(isTransient('in-progress')).toBe(false);
  });
});

describe('State-restriction matrix — W4.1 smoke-tests', () => {
  // Type-helper for synthesizing test mutations
  const mut = (kind: MissionMutation['kind'], extras: Record<string, unknown> = {}): MissionMutation =>
    ({ kind, ...extras } as MissionMutation);

  it('add-repo: allowed pre-start + post-start; rejected on terminal', () => {
    const m = mut('add-repo', { repo: { url: 'https://example.com/r' } });
    expect(validateMutationAllowed(m, 'created')).toBeNull();
    expect(validateMutationAllowed(m, 'configured')).toBeNull();
    expect(validateMutationAllowed(m, 'in-progress')).toBeNull();
    expect(validateMutationAllowed(m, 'completed')).toMatch(/terminal state/);
    expect(validateMutationAllowed(m, 'abandoned')).toMatch(/terminal state/);
  });

  it('remove-repo: pre-start ONLY (refinement #3 atomicity)', () => {
    const m = mut('remove-repo', { repoName: 'foo' });
    expect(validateMutationAllowed(m, 'created')).toBeNull();
    expect(validateMutationAllowed(m, 'configured')).toBeNull();
    expect(validateMutationAllowed(m, 'started')).toMatch(/pre-start only/);
    expect(validateMutationAllowed(m, 'in-progress')).toMatch(/pre-start only/);
  });

  it('set-hub-id: allowed in ANY state INCLUDING terminal (informational-only)', () => {
    const m = mut('set-hub-id', { hubId: 'h-1' });
    for (const state of ['created', 'configured', 'started', 'in-progress', 'completed', 'abandoned'] as MissionStatePhase[]) {
      expect(validateMutationAllowed(m, state)).toBeNull();
    }
  });

  it('add-participant (v4.0): allowed mid-mission; rejected on terminal', () => {
    const m = mut('add-participant', { principal: 'x@y', role: 'reader' });
    expect(validateMutationAllowed(m, 'in-progress')).toBeNull();
    expect(validateMutationAllowed(m, 'completed')).toMatch(/terminal state/);
  });

  it('set-coordination-remote (v4.0): pre-start only (post-start orphans readers)', () => {
    const m = mut('set-coordination-remote', { remote: 'file:///x.git' });
    expect(validateMutationAllowed(m, 'configured')).toBeNull();
    expect(validateMutationAllowed(m, 'started')).toMatch(/pre-start only/);
    expect(validateMutationAllowed(m, 'in-progress')).toMatch(/pre-start only/);
  });

  it('reader-side state rejects ALL mutations (read-only participant per HIGH-R2.3)', () => {
    const mutations: MissionMutation['kind'][] = ['add-repo', 'remove-repo', 'rename', 'set-tag', 'set-hub-id', 'add-participant'];
    for (const kind of mutations) {
      const m = mut(kind, { repo: { url: 'https://example.com/r' }, repoName: 'x', newName: 'y', key: 'k', value: 'v', hubId: 'h', principal: 'p', role: 'reader' });
      const result = validateMutationAllowed(m, 'reading');
      expect(result).toMatch(/read-only participant/);
    }
  });
});
