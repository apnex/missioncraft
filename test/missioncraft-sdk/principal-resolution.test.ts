// W5 slice (i) — principal-resolution 4-step precedence chain unit tests.

import { describe, expect, it } from 'vitest';

import { resolveCurrentPrincipal } from '../../src/missioncraft-sdk/core/principal-resolution.js';
import type { IdentityProvider } from '@apnex/missioncraft';

const mockIdentity = (email: string): IdentityProvider => ({
  async resolve() {
    return { name: 'Test', email };
  },
});

describe('W5 slice (i) — resolveCurrentPrincipal 4-step precedence', () => {
  it('Step 1: explicit arg wins over all', async () => {
    const result = await resolveCurrentPrincipal({
      explicitPrincipal: 'a@x',
      constructorPrincipal: 'b@x',
      envVar: 'c@x',
      identity: mockIdentity('d@x'),
    });
    expect(result).toBe('a@x');
  });

  it('Step 2: constructor wins when no explicit', async () => {
    const result = await resolveCurrentPrincipal({
      constructorPrincipal: 'b@x',
      envVar: 'c@x',
      identity: mockIdentity('d@x'),
    });
    expect(result).toBe('b@x');
  });

  it('Step 3: env-var wins when no explicit + no constructor', async () => {
    const result = await resolveCurrentPrincipal({
      envVar: 'c@x',
      identity: mockIdentity('d@x'),
    });
    expect(result).toBe('c@x');
  });

  it('Step 4: identity.resolve() wins as fallback', async () => {
    const result = await resolveCurrentPrincipal({
      identity: mockIdentity('d@x'),
    });
    expect(result).toBe('d@x');
  });

  it('throws when all 4 sources unset', async () => {
    await expect(resolveCurrentPrincipal({ envVar: undefined })).rejects.toThrow(/no principal source resolvable/);
  });
});
