import { describe, it, expect } from 'vitest';
import {
  MissioncraftError,
  LockTimeoutError,
  StorageAllocationError,
  RemoteAuthError,
  ApprovalDeniedError,
  MissionStateError,
  WorkspaceConflictError,
  ConfigValidationError,
  UnsupportedOperationError,
  NetworkRetryExhaustedError,
} from '@apnex/missioncraft';

describe('Error class hierarchy — W1 smoke-tests', () => {
  // Per F18 v0.3 §BB — 10 classes; flat hierarchy under MissioncraftError base; no multi-level inheritance.
  const subclasses = [
    LockTimeoutError,
    StorageAllocationError,
    RemoteAuthError,
    ApprovalDeniedError,
    MissionStateError,
    WorkspaceConflictError,
    ConfigValidationError,
    UnsupportedOperationError,
    NetworkRetryExhaustedError,
  ];

  it('all 9 subclasses extend MissioncraftError directly (flat hierarchy)', () => {
    for (const Cls of subclasses) {
      const err = new Cls('test');
      expect(err).toBeInstanceOf(MissioncraftError);
      expect(err).toBeInstanceOf(Error);
      // Direct extension — Object.getPrototypeOf(Cls) === MissioncraftError (no intermediate class)
      expect(Object.getPrototypeOf(Cls)).toBe(MissioncraftError);
    }
  });

  it('all 9 subclasses set distinct .name property for typed-handling', () => {
    const names = new Set<string>();
    for (const Cls of subclasses) {
      const err = new Cls('test');
      expect(err.name).toBe(Cls.name);
      names.add(err.name);
    }
    expect(names.size).toBe(subclasses.length);
  });

  it('MissioncraftError base preserves message + supports cause via ErrorOptions', () => {
    const cause = new Error('underlying');
    const err = new MissioncraftError('wrapped', { cause });
    expect(err.message).toBe('wrapped');
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('MissioncraftError');
  });

  it('subclass instanceof checks discriminate (catch-all + typed-handling pattern)', () => {
    const lockErr: unknown = new LockTimeoutError('lock waitMs exceeded');
    expect(lockErr instanceof LockTimeoutError).toBe(true);
    expect(lockErr instanceof MissioncraftError).toBe(true);
    expect(lockErr instanceof StorageAllocationError).toBe(false);
  });
});
