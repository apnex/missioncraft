import { describe, it, expect } from 'vitest';
import {
  MissionConfigSchema,
  makeMissionConfigSchema,
  ScopeConfigSchema,
  OperatorConfigSchema,
  RepoSpecSchema,
  MissionParticipantSchema,
} from '@apnex/missioncraft';

describe('Zod schemas — W1 smoke-tests', () => {
  describe('RepoSpecSchema', () => {
    it('accepts minimal valid RepoSpec', () => {
      const result = RepoSpecSchema.parse({ url: 'https://github.com/example/repo' });
      expect(result.url).toBe('https://github.com/example/repo');
    });

    it('rejects name not matching DNS-style slug', () => {
      expect(() =>
        RepoSpecSchema.parse({ url: 'https://example.com/r', name: 'INVALID_UPPERCASE' }),
      ).toThrow();
    });
  });

  describe('MissionParticipantSchema', () => {
    it('accepts writer + reader roles; coerces addedAt to Date', () => {
      const result = MissionParticipantSchema.parse({
        principal: 'lily@apnex',
        role: 'writer',
        addedAt: '2026-05-10T12:00:00Z',
      });
      expect(result.role).toBe('writer');
      expect(result.addedAt).toBeInstanceOf(Date);
    });

    it('rejects invalid role', () => {
      expect(() =>
        MissionParticipantSchema.parse({
          principal: 'x@y',
          role: 'observer',
          addedAt: '2026-05-10T12:00:00Z',
        }),
      ).toThrow();
    });
  });

  describe('MissionConfigSchema (default writer-role)', () => {
    const baseValid = {
      missionConfigSchemaVersion: 1 as const,
      mission: {
        id: 'msn-a1b2c3d4',
        lifecycleState: 'configured' as const,
        createdAt: '2026-05-10T12:00:00Z',
      },
      repos: [{ url: 'https://github.com/example/repo' }],
    };

    it('accepts minimal v3.6-baseline writer-side config', () => {
      const result = MissionConfigSchema.parse(baseValid);
      expect(result.mission.lifecycleState).toBe('configured');
    });

    it('rejects reader-side lifecycle-state in default writer-role schema (v4.5 fold MEDIUM-R6.4)', () => {
      expect(() =>
        MissionConfigSchema.parse({ ...baseValid, mission: { ...baseValid.mission, lifecycleState: 'reading' } }),
      ).toThrow(/reader-side lifecycle-state/);
    });

    it('F-V4.2 conditional: rejects participants[reader] without coordinationRemote', () => {
      expect(() =>
        MissionConfigSchema.parse({
          ...baseValid,
          mission: {
            ...baseValid.mission,
            participants: [
              { principal: 'lily@apnex', role: 'writer', addedAt: '2026-05-10T12:00:00Z' },
              { principal: 'greg@apnex', role: 'reader', addedAt: '2026-05-10T12:05:00Z' },
            ],
          },
        }),
      ).toThrow(/coordinationRemote required/);
    });

    it('v1 exactly-1-writer: rejects 0 writers', () => {
      expect(() =>
        MissionConfigSchema.parse({
          ...baseValid,
          mission: {
            ...baseValid.mission,
            participants: [{ principal: 'greg@apnex', role: 'reader', addedAt: '2026-05-10T12:00:00Z' }],
            coordinationRemote: 'file:///tmp/coord.git',
          },
        }),
      ).toThrow(/exactly 1 writer/);
    });
  });

  describe('makeMissionConfigSchema(reader)', () => {
    it('accepts reader-side lifecycle-state in reader-role schema', () => {
      const readerSchema = makeMissionConfigSchema('reader');
      const result = readerSchema.parse({
        missionConfigSchemaVersion: 1,
        mission: {
          id: 'msn-a1b2c3d4',
          lifecycleState: 'reading',
          createdAt: '2026-05-10T12:00:00Z',
          participants: [
            { principal: 'lily@apnex', role: 'writer', addedAt: '2026-05-10T12:00:00Z' },
            { principal: 'greg@apnex', role: 'reader', addedAt: '2026-05-10T12:05:00Z' },
          ],
          coordinationRemote: 'file:///tmp/coord.git',
        },
        repos: [{ url: 'https://github.com/example/repo' }],
      });
      expect(result.mission.lifecycleState).toBe('reading');
    });

    it('rejects writer-side lifecycle-state in reader-role schema', () => {
      const readerSchema = makeMissionConfigSchema('reader');
      expect(() =>
        readerSchema.parse({
          missionConfigSchemaVersion: 1,
          mission: {
            id: 'msn-a1b2c3d4',
            lifecycleState: 'in-progress',
            createdAt: '2026-05-10T12:00:00Z',
          },
          repos: [{ url: 'https://github.com/example/repo' }],
        }),
      ).toThrow(/writer-side lifecycle-state/);
    });
  });

  describe('ScopeConfigSchema', () => {
    it('accepts minimal valid scope-config', () => {
      const result = ScopeConfigSchema.parse({
        scopeConfigSchemaVersion: 1,
        scope: {
          id: 'scp-7a9b2e1c',
          createdAt: '2026-05-10T12:00:00Z',
          updatedAt: '2026-05-10T12:00:00Z',
        },
        repos: [{ url: 'https://github.com/example/repo' }],
      });
      expect(result.scope.lifecycleState).toBe('created');
    });
  });

  describe('OperatorConfigSchema', () => {
    it('accepts v4.4 multi-principal extension (workspaceRootByPrincipal map)', () => {
      const result = OperatorConfigSchema.parse({
        operatorConfigSchemaVersion: 1,
        defaults: {
          workspaceRoot: '~/.missioncraft',
          workspaceRootByPrincipal: {
            'lily@apnex': '~/.missioncraft-lily/workspace',
            'greg@apnex': '~/.missioncraft-greg/workspace',
          },
        },
      });
      expect(result.defaults.workspaceRootByPrincipal?.['lily@apnex']).toBe(
        '~/.missioncraft-lily/workspace',
      );
    });
  });
});
