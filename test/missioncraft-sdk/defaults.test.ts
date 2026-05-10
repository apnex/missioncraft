import { describe, it, expect } from 'vitest';
import { TrustAllPolicy, LocalGitConfigIdentity, MissioncraftError } from '@apnex/missioncraft';

describe('Default impls — W2 smoke-tests', () => {
  describe('TrustAllPolicy', () => {
    it('exposes static providerName per v1.5 fold MEDIUM-R4.2', () => {
      expect(TrustAllPolicy.providerName).toBe('trust-all');
    });

    it('approves all proposed actions (default-permissive)', async () => {
      const policy = new TrustAllPolicy();
      const decision = await policy.decide({
        missionId: 'msn-test1234',
        repoUrl: 'https://example.com/r',
        branch: 'main',
        action: 'commit',
        metadata: {},
      });
      expect(decision.approved).toBe(true);
    });
  });

  describe('LocalGitConfigIdentity', () => {
    it('exposes static providerName per v1.5 fold MEDIUM-R4.2', () => {
      expect(LocalGitConfigIdentity.providerName).toBe('local-git-config');
    });

    it('resolve() returns AgentIdentity with name + email when git config is set', async () => {
      const identity = new LocalGitConfigIdentity();
      // CI has git config set via actions/checkout default; local dev runs require user.name + user.email
      const result = await identity.resolve();
      expect(typeof result.name).toBe('string');
      expect(typeof result.email).toBe('string');
      expect(result.name.length).toBeGreaterThan(0);
      expect(result.email.length).toBeGreaterThan(0);
      // signingKey is optional; when present, MUST match GPG fingerprint OR SSH path
      if (result.signingKey) {
        expect(['gpg', 'ssh']).toContain(result.signingKey.type);
      }
    });
  });

  describe('error class re-export sanity', () => {
    it('MissioncraftError is exported as base for catch-all', () => {
      const err = new MissioncraftError('test');
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('MissioncraftError');
    });
  });
});
