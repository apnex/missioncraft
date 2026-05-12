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
      missionConfigSchemaVersion: 2 as const,
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

    // mission-78 W5-new slice (ii): F-V4.2 conditional-validation (coordinationRemote required
    // IFF participants[reader]) REMOVED — coordinationRemote field DELETED per Design v5.0 §10.2.
    // Reader-mission validation now via v5.0 reader-flavor fields (sourceMissionId OR
    // sourceRemote+sourceBranch) per W4-new slice (i).

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

    // ─── mission-78 W4-new (Design v5.0 §2 row 4 + §12 no-backward-compat) ───

    it('REFUSES schema-v1 configs at parse (no backward-compat per Design v5.0 §12)', () => {
      expect(() =>
        MissionConfigSchema.parse({ ...baseValid, missionConfigSchemaVersion: 1 }),
      ).toThrow();
    });

    it('schema-v2: accepts writer-mission without source* fields', () => {
      // writer-mission (readOnly undefined; no source* fields) — minimal v5.0 baseline
      expect(() => MissionConfigSchema.parse(baseValid)).not.toThrow();
    });

    it('schema-v2: writer-mission with readOnly: true is rejected (writers must not have readOnly:true)', () => {
      expect(() =>
        MissionConfigSchema.parse({
          ...baseValid,
          mission: { ...baseValid.mission, readOnly: true },
        }),
      ).toThrow(/MUST specify EITHER sourceMissionId.*OR sourceRemote\+sourceBranch/);
    });

    it('schema-v2: writer-mission MUST NOT specify source* fields', () => {
      expect(() =>
        MissionConfigSchema.parse({
          ...baseValid,
          mission: { ...baseValid.mission, sourceMissionId: 'msn-deadbeef' },
        }),
      ).toThrow(/writer-mission.*MUST NOT specify source/);
    });

    it('schema-v2: reader-mission BRANCH-TRACKER accepts readOnly+sourceMissionId only', () => {
      const readerSchema = makeMissionConfigSchema('reader');
      expect(() =>
        readerSchema.parse({
          missionConfigSchemaVersion: 2,
          mission: {
            id: 'msn-a1b2c3d4',
            lifecycleState: 'reading',
            createdAt: '2026-05-10T12:00:00Z',
            readOnly: true,
            sourceMissionId: 'msn-deadbeef',
          },
          repos: [{ url: 'https://github.com/example/repo' }],
        }),
      ).not.toThrow();
    });

    it('schema-v2: reader-mission PERSISTENT-TRACKER accepts readOnly+sourceRemote+sourceBranch', () => {
      const readerSchema = makeMissionConfigSchema('reader');
      expect(() =>
        readerSchema.parse({
          missionConfigSchemaVersion: 2,
          mission: {
            id: 'msn-a1b2c3d4',
            lifecycleState: 'reading',
            createdAt: '2026-05-10T12:00:00Z',
            readOnly: true,
            sourceRemote: 'https://github.com/example/repo',
            sourceBranch: 'main',
          },
          repos: [{ url: 'https://github.com/example/repo' }],
        }),
      ).not.toThrow();
    });

    it('schema-v2: reader-mission REJECTS both BRANCH-TRACKER + PERSISTENT-TRACKER fields (mutually exclusive)', () => {
      const readerSchema = makeMissionConfigSchema('reader');
      expect(() =>
        readerSchema.parse({
          missionConfigSchemaVersion: 2,
          mission: {
            id: 'msn-a1b2c3d4',
            lifecycleState: 'reading',
            createdAt: '2026-05-10T12:00:00Z',
            readOnly: true,
            sourceMissionId: 'msn-deadbeef',
            sourceRemote: 'https://github.com/example/repo',
            sourceBranch: 'main',
          },
          repos: [{ url: 'https://github.com/example/repo' }],
        }),
      ).toThrow(/MUST be either BRANCH-TRACKER.*OR PERSISTENT-TRACKER.*both specified/);
    });

    it('schema-v2: reader-mission PERSISTENT-TRACKER REJECTS sourceRemote without sourceBranch (partial)', () => {
      const readerSchema = makeMissionConfigSchema('reader');
      expect(() =>
        readerSchema.parse({
          missionConfigSchemaVersion: 2,
          mission: {
            id: 'msn-a1b2c3d4',
            lifecycleState: 'reading',
            createdAt: '2026-05-10T12:00:00Z',
            readOnly: true,
            sourceRemote: 'https://github.com/example/repo',
          },
          repos: [{ url: 'https://github.com/example/repo' }],
        }),
      ).toThrow(/MUST specify BOTH sourceRemote AND sourceBranch/);
    });

    it('schema-v2: reader-mission with readOnly: true MUST specify at least one source', () => {
      const readerSchema = makeMissionConfigSchema('reader');
      expect(() =>
        readerSchema.parse({
          missionConfigSchemaVersion: 2,
          mission: {
            id: 'msn-a1b2c3d4',
            lifecycleState: 'reading',
            createdAt: '2026-05-10T12:00:00Z',
            readOnly: true,
          },
          repos: [{ url: 'https://github.com/example/repo' }],
        }),
      ).toThrow(/MUST specify EITHER sourceMissionId.*OR sourceRemote\+sourceBranch/);
    });

    it('schema-v2: sourceMissionId must match msn-<8hex> regex', () => {
      const readerSchema = makeMissionConfigSchema('reader');
      expect(() =>
        readerSchema.parse({
          missionConfigSchemaVersion: 2,
          mission: {
            id: 'msn-a1b2c3d4',
            lifecycleState: 'reading',
            createdAt: '2026-05-10T12:00:00Z',
            readOnly: true,
            sourceMissionId: 'not-a-valid-id',
          },
          repos: [{ url: 'https://github.com/example/repo' }],
        }),
      ).toThrow();
    });
  });

  describe('makeMissionConfigSchema(reader)', () => {
    it('accepts reader-side lifecycle-state in reader-role schema', () => {
      const readerSchema = makeMissionConfigSchema('reader');
      const result = readerSchema.parse({
        missionConfigSchemaVersion: 2,
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
          missionConfigSchemaVersion: 2,
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

  describe('MissionConfigSchema — W5-new slice (i): symmetric push/pull cadence (Design v5.0 §10.2 + §10.5)', () => {
    const baseValid = {
      missionConfigSchemaVersion: 2 as const,
      mission: {
        id: 'msn-a1b2c3d4',
        lifecycleState: 'configured' as const,
        createdAt: '2026-05-10T12:00:00Z',
      },
      repos: [{ url: 'https://github.com/example/repo' }],
    };

    it('accepts pushCadence + pushIntervalSeconds (writer-side cadence config)', () => {
      const result = MissionConfigSchema.parse({
        ...baseValid,
        stateDurability: {
          pushCadence: 'every-Ns',
          pushIntervalSeconds: 60,
        },
      });
      expect(result.stateDurability?.pushCadence).toBe('every-Ns');
      expect(result.stateDurability?.pushIntervalSeconds).toBe(60);
    });

    it('accepts pullCadence + pullIntervalSeconds (reader-side cadence config)', () => {
      const result = MissionConfigSchema.parse({
        ...baseValid,
        stateDurability: {
          pullCadence: 'every-Ns',
          pullIntervalSeconds: 30,
        },
      });
      expect(result.stateDurability?.pullCadence).toBe('every-Ns');
      expect(result.stateDurability?.pullIntervalSeconds).toBe(30);
    });

    it('accepts all three pushCadence enum values', () => {
      for (const cadence of ['on-complete-only', 'every-Ns', 'on-demand'] as const) {
        const result = MissionConfigSchema.parse({
          ...baseValid,
          stateDurability: { pushCadence: cadence },
        });
        expect(result.stateDurability?.pushCadence).toBe(cadence);
      }
    });

    it('accepts both pullCadence enum values', () => {
      for (const cadence of ['every-Ns', 'on-demand'] as const) {
        const result = MissionConfigSchema.parse({
          ...baseValid,
          stateDurability: { pullCadence: cadence },
        });
        expect(result.stateDurability?.pullCadence).toBe(cadence);
      }
    });

    it('rejects unknown pushCadence enum value', () => {
      expect(() =>
        MissionConfigSchema.parse({
          ...baseValid,
          stateDurability: { pushCadence: 'invalid-cadence' as unknown as 'every-Ns' },
        }),
      ).toThrow();
    });

    it('rejects unknown pullCadence enum value (writer-side push values not accepted)', () => {
      // 'on-complete-only' is push-only; pullCadence excludes it (catches accidental cross-contamination)
      expect(() =>
        MissionConfigSchema.parse({
          ...baseValid,
          stateDurability: { pullCadence: 'on-complete-only' as unknown as 'every-Ns' },
        }),
      ).toThrow();
    });

    it('rejects pushIntervalSeconds below minimum (10s)', () => {
      expect(() =>
        MissionConfigSchema.parse({
          ...baseValid,
          stateDurability: { pushIntervalSeconds: 5 },
        }),
      ).toThrow();
    });

    it('rejects pullIntervalSeconds below minimum (5s)', () => {
      expect(() =>
        MissionConfigSchema.parse({
          ...baseValid,
          stateDurability: { pullIntervalSeconds: 4 },
        }),
      ).toThrow();
    });

    it('accepts pushIntervalSeconds exactly at min (10s)', () => {
      const result = MissionConfigSchema.parse({
        ...baseValid,
        stateDurability: { pushIntervalSeconds: 10 },
      });
      expect(result.stateDurability?.pushIntervalSeconds).toBe(10);
    });

    it('accepts pullIntervalSeconds exactly at min (5s)', () => {
      const result = MissionConfigSchema.parse({
        ...baseValid,
        stateDurability: { pullIntervalSeconds: 5 },
      });
      expect(result.stateDurability?.pullIntervalSeconds).toBe(5);
    });

    it('rejects non-integer pushIntervalSeconds', () => {
      expect(() =>
        MissionConfigSchema.parse({
          ...baseValid,
          stateDurability: { pushIntervalSeconds: 60.5 },
        }),
      ).toThrow();
    });

    it('accepts both writer-side AND reader-side cadence fields together (parallel to wipCadenceMs+coordPollMs pattern)', () => {
      const result = MissionConfigSchema.parse({
        ...baseValid,
        stateDurability: {
          pushCadence: 'every-Ns',
          pushIntervalSeconds: 60,
          pullCadence: 'every-Ns',
          pullIntervalSeconds: 30,
        },
      });
      expect(result.stateDurability?.pushCadence).toBe('every-Ns');
      expect(result.stateDurability?.pullCadence).toBe('every-Ns');
    });

    it('cadence fields are optional (omitted yields undefined; substrate uses defaults)', () => {
      const result = MissionConfigSchema.parse(baseValid);
      expect(result.stateDurability?.pushCadence).toBeUndefined();
      expect(result.stateDurability?.pullCadence).toBeUndefined();
      expect(result.stateDurability?.pushIntervalSeconds).toBeUndefined();
      expect(result.stateDurability?.pullIntervalSeconds).toBeUndefined();
    });

    it('cadence fields coexist with v4.x coordPollMs (deprecation back-compat through W7-new)', () => {
      // SHAPE: legacy coordPollMs + new pullIntervalSeconds present together; schema accepts both.
      // Substrate at slice (iv) prefers pullIntervalSeconds for v5.0 missions; coordPollMs for v4.x.
      const result = MissionConfigSchema.parse({
        ...baseValid,
        stateDurability: {
          coordPollMs: 5000,
          pullCadence: 'every-Ns',
          pullIntervalSeconds: 30,
        },
      });
      expect(result.stateDurability?.coordPollMs).toBe(5000);
      expect(result.stateDurability?.pullIntervalSeconds).toBe(30);
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
