// YAML wire-format ↔ TypeScript canonical transform (Design v4.8 §2.5 Naming-convention contract per HIGH-4 + MEDIUM-R3.11 parse-site discipline).
//
// Property names: TypeScript camelCase ↔ YAML kebab-case (recursive through nested objects).
// Values: PRESERVED as-typed (kebab-case literal-strings preserved; NO transform on values — per MEDIUM-R2.7 + MINOR-R2.2).
// Tags exemption per MINOR-R2.2: `tags: Record<string, string>` keys are operator-supplied; PRESERVED as-is (no kebab→camelCase transform).
//
// Used by SDK class entry-points (start({config}) / apply(config)) + CLI helper (parseMissionConfigFromFile).
// Complements v4.5 schema-factory pattern (yaml-transform handles wire-format; schema-factory handles role-based state-validation).

import { parse as yamlParse, stringify as yamlStringify } from 'yaml';

import { MissionConfigSchema, makeMissionConfigSchema } from './mission-config-schema.js';
import type { MissionConfig } from './mission-types.js';
import { ConfigValidationError } from '../errors.js';
import { deriveOwningPrincipalRole } from './role-derivation.js';

/**
 * Field names whose VALUE is treated as Record<string, string> with operator-supplied keys.
 * Per MINOR-R2.2 — these Record-keys are NOT transformed (preserved as-is for cross-system correlation).
 */
const RECORD_KEY_PRESERVE_FIELDS = new Set<string>(['tags', 'workspace-root-by-principal', 'workspaceRootByPrincipal']);

function kebabToCamel(key: string): string {
  return key.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
}

function camelToKebab(key: string): string {
  return key.replace(/([A-Z])/g, '-$1').toLowerCase();
}

/**
 * Recursively transform object keys from kebab-case to camelCase.
 * Tags-style Record-key fields preserve their child keys per MINOR-R2.2.
 * Arrays + scalars passed through unchanged.
 */
export function kebabToCamelObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => kebabToCamelObject(v));
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const camelKey = kebabToCamel(key);
      if (RECORD_KEY_PRESERVE_FIELDS.has(camelKey) || RECORD_KEY_PRESERVE_FIELDS.has(key)) {
        // Preserve Record-keys as-is; values still recurse if nested objects (rare for Record<string, string>)
        if (val !== null && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
          // Shallow-preserve keys; recurse values for safety (Record<string, string> values are scalars; pass-through)
          const preserved: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
            preserved[k] = v;
          }
          result[camelKey] = preserved;
        } else {
          result[camelKey] = val;
        }
      } else {
        result[camelKey] = kebabToCamelObject(val);
      }
    }
    return result;
  }
  return value;
}

/**
 * Recursively transform object keys from camelCase to kebab-case (inverse of kebabToCamelObject).
 * Used at serialize-time for atomic-write to YAML wire-format.
 */
export function camelToKebabObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => camelToKebabObject(v));
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const kebabKey = camelToKebab(key);
      if (RECORD_KEY_PRESERVE_FIELDS.has(key) || RECORD_KEY_PRESERVE_FIELDS.has(kebabKey)) {
        // Preserve Record-keys
        if (val !== null && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
          const preserved: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
            preserved[k] = v;
          }
          result[kebabKey] = preserved;
        } else {
          result[kebabKey] = val;
        }
      } else {
        result[kebabKey] = camelToKebabObject(val);
      }
    }
    return result;
  }
  return value;
}

/**
 * Parse a YAML mission-config string into a typed MissionConfig.
 *
 * Pipeline per Design v4.8 §2.5 v1.2 fold per HIGH-4 + MEDIUM-R3.11:
 * 1. yaml.parse → raw object with kebab-case keys
 * 2. kebabToCamelObject → camelCase-keyed object (preserves Record-keys per MINOR-R2.2)
 * 3. MissionConfigSchema.parse → typed MissionConfig (with role-based superRefine validation per v4.5 fold MEDIUM-R6.4)
 *
 * If `configFilePath` provided, role is derived from file-path mapping per HIGH-R1.2 partition-spec
 * (writer's workspace if owning-OS-user matches; reader's otherwise). Without configFilePath,
 * defaults to writer-role (V3.6-baseline-compatible).
 *
 * Throws ConfigValidationError on parse-fail OR schema-validation-fail (with original zod issues as cause).
 */
export function parseMissionConfig(yamlString: string, configFilePath?: string): MissionConfig {
  let raw: unknown;
  try {
    raw = yamlParse(yamlString);
  } catch (err) {
    throw new ConfigValidationError(
      `parseMissionConfig: YAML parse-fail — ${err instanceof Error ? err.message : 'unknown'}`,
      { cause: err instanceof Error ? err : undefined },
    );
  }
  const camelCased = kebabToCamelObject(raw);
  const schema = configFilePath !== undefined
    ? makeMissionConfigSchema(deriveOwningPrincipalRole(configFilePath))
    : MissionConfigSchema;
  try {
    return schema.parse(camelCased) as MissionConfig;
  } catch (err) {
    throw new ConfigValidationError(
      `parseMissionConfig: schema-validation-fail — ${err instanceof Error ? err.message : 'unknown'}`,
      { cause: err instanceof Error ? err : undefined },
    );
  }
}

/**
 * Serialize a MissionConfig to YAML wire-format (kebab-case keys; preserves Record-keys per MINOR-R2.2).
 * Symmetric inverse of parseMissionConfig; round-trip-safe.
 */
export function serializeMissionConfig(config: MissionConfig): string {
  const kebabed = camelToKebabObject(config);
  return yamlStringify(kebabed);
}
