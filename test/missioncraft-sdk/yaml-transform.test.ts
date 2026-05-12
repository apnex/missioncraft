import { describe, expect, it } from 'vitest';
import {
  kebabToCamelObject,
  camelToKebabObject,
  parseMissionConfig,
  serializeMissionConfig,
  ConfigValidationError,
} from '@apnex/missioncraft';

describe('YAML wire-format ↔ TS canonical transform — W3 smoke-tests', () => {
  describe('kebabToCamelObject', () => {
    it('transforms top-level keys', () => {
      const result = kebabToCamelObject({ 'mission-id': 'msn-1', 'wip-cadence-ms': 30000 });
      expect(result).toEqual({ missionId: 'msn-1', wipCadenceMs: 30000 });
    });

    it('recurses through nested objects', () => {
      const result = kebabToCamelObject({
        'state-durability': { 'wip-cadence-ms': 30000, 'snapshot-cadence-ms': 5000 },
      });
      expect(result).toEqual({
        stateDurability: { wipCadenceMs: 30000, snapshotCadenceMs: 5000 },
      });
    });

    it('preserves Tags Record-keys per MINOR-R2.2', () => {
      const result = kebabToCamelObject({
        tags: { 'correlation-id': 'ois-2026-05-08', 'team-name': 'apnex' },
      });
      expect(result).toEqual({
        tags: { 'correlation-id': 'ois-2026-05-08', 'team-name': 'apnex' },
      });
    });

    it('preserves workspace-root-by-principal Record-keys per v4.4 MEDIUM-R1.7', () => {
      const result = kebabToCamelObject({
        defaults: { 'workspace-root-by-principal': { 'lily@apnex': '/path1', 'greg@apnex': '/path2' } },
      });
      expect(result).toEqual({
        defaults: { workspaceRootByPrincipal: { 'lily@apnex': '/path1', 'greg@apnex': '/path2' } },
      });
    });

    it('passes scalars + arrays through unchanged', () => {
      expect(kebabToCamelObject('plain-string-value')).toBe('plain-string-value');
      expect(kebabToCamelObject(42)).toBe(42);
      expect(kebabToCamelObject([1, 2, 3])).toEqual([1, 2, 3]);
    });
  });

  describe('camelToKebabObject (inverse)', () => {
    it('round-trips kebab → camel → kebab', () => {
      const original = {
        'mission-id': 'msn-1',
        'state-durability': { 'wip-cadence-ms': 30000 },
        tags: { 'correlation-id': 'ois-x' },
      };
      const camel = kebabToCamelObject(original);
      const kebab = camelToKebabObject(camel);
      expect(kebab).toEqual(original);
    });
  });

  describe('parseMissionConfig (full pipeline)', () => {
    const validYaml = `
mission-config-schema-version: 2
mission:
  id: msn-a1b2c3d4
  lifecycle-state: configured
  created-at: 2026-05-10T12:00:00Z
repos:
  - url: https://github.com/example/repo
`;

    it('parses valid kebab-case YAML to camelCase TS object', () => {
      const result = parseMissionConfig(validYaml);
      expect(result.missionConfigSchemaVersion).toBe(2);
      expect(result.mission.id).toBe('msn-a1b2c3d4');
      expect(result.mission.lifecycleState).toBe('configured');
      expect(result.repos).toHaveLength(1);
      expect(result.repos[0].url).toBe('https://github.com/example/repo');
    });

    it('throws ConfigValidationError on YAML syntax error', () => {
      expect(() => parseMissionConfig('mission:\n  id: [invalid: yaml')).toThrow(ConfigValidationError);
    });

    it('throws ConfigValidationError on schema-validation failure', () => {
      expect(() =>
        parseMissionConfig(`
mission-config-schema-version: 2
mission:
  id: NOT_VALID_FORMAT
  created-at: 2026-05-10T12:00:00Z
repos: []
`),
      ).toThrow(ConfigValidationError);
    });
  });

  describe('serializeMissionConfig (round-trip)', () => {
    it('serializes camelCase TS object to kebab-case YAML; round-trip parseable', () => {
      const original = `
mission-config-schema-version: 2
mission:
  id: msn-a1b2c3d4
  lifecycle-state: configured
  created-at: 2026-05-10T12:00:00Z
  tags:
    correlation-id: ois-x
repos:
  - url: https://github.com/example/repo
`;
      const parsed = parseMissionConfig(original);
      const serialized = serializeMissionConfig(parsed);
      const reParsed = parseMissionConfig(serialized);
      expect(reParsed.mission.id).toBe(parsed.mission.id);
      expect(reParsed.mission.lifecycleState).toBe(parsed.mission.lifecycleState);
      expect(reParsed.mission.tags?.['correlation-id']).toBe('ois-x');
      expect(reParsed.repos[0].url).toBe(parsed.repos[0].url);
    });
  });
});
