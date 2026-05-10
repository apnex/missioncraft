// Missioncraft SDK class — primary contract surface (Design v4.8 §2.3.1).
//
// 16 methods total (v4.x consolidation per Refinement #7 + multi-participant additions per HIGH-R2.2):
// - 5 universal verbs (create / get / list / update / delete) — k8s-shape parameterized by ResourceType
// - 6 mission-specific verbs (start / apply / complete / abandon / tick / workspace)
// - 2 multi-participant verbs (join / leave) — v4.0 NEW per HIGH-R2.2
// - 2 operator-config (configGet / configSet)
// - 1 static (isPlatformSupported)
//
// W3 method-body discipline (per dispatch):
//   - create / get / list / configGet / configSet / static / update-validation: IMPLEMENTED FULLY
//   - start / apply / complete / abandon / tick / workspace: throw MissionStateError("not yet implemented; W4")
//   - join / leave: throw MissionStateError("not yet implemented; W5")

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';

import { stringify as yamlStringify } from 'yaml';

import {
  ConfigValidationError,
  MissionStateError,
  UnsupportedOperationError,
} from '../errors.js';
import type {
  ApprovalPolicy,
  GitEngine,
  IdentityProvider,
  RemoteProvider,
  StorageProvider,
} from '../pluggables/index.js';
import type { MissioncraftConfig } from './types.js';
import type {
  MissionConfig,
  MissionFilter,
  MissionHandle,
  MissionMutation,
  MissionRepoState,
  MissionState,
  MissionStatePhase,
} from './mission-types.js';
import type {
  ScopeConfig,
  ScopeFilter,
  ScopeHandle,
  ScopeMutation,
  ScopeState,
  ScopeStatePhase,
} from './scope-types.js';
import { instantiateProvider } from './provider-registry.js';
import { OperatorConfigSchema } from './operator-config-schema.js';
import { parseMissionConfig, serializeMissionConfig, kebabToCamelObject, camelToKebabObject } from './yaml-transform.js';
import { ScopeConfigSchema } from './scope-config-schema.js';

/** Pluggable resource-types. */
export type ResourceType = 'mission' | 'scope';

/** Per-resource type-map (Design v4.8 §2.3.1 v3.1 fold). */
export interface ResourceMap {
  mission: {
    handle: MissionHandle;
    state: MissionState;
    config: MissionConfig;
    filter: MissionFilter;
    createOpts: { name?: string; repo?: string | string[]; scope?: string };
    getOpts: { principal?: string };
    listOpts: { principal?: string };
    deletable: false;
    mutation: MissionMutation;
  };
  scope: {
    handle: ScopeHandle;
    state: ScopeState;
    config: ScopeConfig;
    filter: ScopeFilter;
    createOpts: { name?: string; description?: string; repo?: string | string[] };
    getOpts: { includeReferences?: boolean };
    listOpts: { includeReferences?: boolean };
    deletable: true;
    mutation: ScopeMutation;
  };
}

export type DeletableResource = {
  [K in ResourceType]: ResourceMap[K]['deletable'] extends true ? K : never;
}[ResourceType];

/** Generate canonical msn-<8-char-hex> mission-id (v1.2 fold per MEDIUM-1). */
function generateMissionId(): string {
  return `msn-${randomBytes(4).toString('hex')}`;
}

/** Generate canonical scp-<8-char-hex> scope-id. */
function generateScopeId(): string {
  return `scp-${randomBytes(4).toString('hex')}`;
}

function repoNameFromUrl(repoUrl: string): string {
  const stripped = repoUrl.replace(/\/$/, '').replace(/\.git$/, '');
  const idx = Math.max(stripped.lastIndexOf('/'), stripped.lastIndexOf(':'));
  const candidate = idx >= 0 ? stripped.slice(idx + 1) : stripped;
  return candidate.toLowerCase();
}

export class Missioncraft {
  // Pluggables (resolved from constructor opts OR PROVIDER_REGISTRY defaults)
  readonly identity: IdentityProvider;
  readonly approval: ApprovalPolicy;
  readonly storage: StorageProvider;
  readonly gitEngine: GitEngine;
  readonly remote?: RemoteProvider;

  // Constructor opts (preserved for runtime-introspection)
  readonly workspaceRoot: string;
  readonly principal?: string;

  constructor(config: Partial<MissioncraftConfig> = {}) {
    this.identity = config.identity ?? instantiateProvider('identity', 'local-git-config');
    this.approval = config.approval ?? instantiateProvider('approval', 'trust-all');
    this.workspaceRoot = resolve(
      (config.workspaceRoot ?? join(homedir(), '.missioncraft')).replace(/^~(?=$|\/|\\)/, homedir()),
    );
    this.storage = config.storage ?? instantiateProvider('storage', 'local-filesystem', { workspaceRoot: this.workspaceRoot });
    this.gitEngine = config.gitEngine ?? instantiateProvider('gitEngine', 'isomorphic-git');
    this.remote = config.remote;                       // optional; pure-git mode if undefined
    this.principal = config.principal;
  }

  // ─── Universal resource verbs (k8s-shape per Refinement #7) ───

  async create<T extends ResourceType>(
    type: T,
    opts?: ResourceMap[T]['createOpts'],
  ): Promise<ResourceMap[T]['handle']> {
    if (type === 'mission') {
      const handle = await this.createMission(opts as ResourceMap['mission']['createOpts']);
      return handle as ResourceMap[T]['handle'];
    }
    if (type === 'scope') {
      const handle = await this.createScope(opts as ResourceMap['scope']['createOpts']);
      return handle as ResourceMap[T]['handle'];
    }
    throw new ConfigValidationError(`Missioncraft.create: unknown resource-type '${type as string}'`);
  }

  async get<T extends ResourceType>(
    type: T,
    id: string,
    opts?: ResourceMap[T]['getOpts'],
  ): Promise<ResourceMap[T]['state']> {
    if (type === 'mission') {
      const principal = (opts as ResourceMap['mission']['getOpts'] | undefined)?.principal ?? this.principal;
      return this.getMission(id, principal) as Promise<ResourceMap[T]['state']>;
    }
    if (type === 'scope') {
      return this.getScope(id, opts as ResourceMap['scope']['getOpts'] | undefined) as Promise<ResourceMap[T]['state']>;
    }
    throw new ConfigValidationError(`Missioncraft.get: unknown resource-type '${type as string}'`);
  }

  async list<T extends ResourceType>(
    type: T,
    filter?: ResourceMap[T]['filter'],
    opts?: ResourceMap[T]['listOpts'],
  ): Promise<ResourceMap[T]['state'][]> {
    if (type === 'mission') {
      const principal = (opts as ResourceMap['mission']['listOpts'] | undefined)?.principal ?? this.principal;
      return this.listMissions(filter as MissionFilter | undefined, principal) as Promise<ResourceMap[T]['state'][]>;
    }
    if (type === 'scope') {
      return this.listScopes(filter as ScopeFilter | undefined, opts as ResourceMap['scope']['listOpts'] | undefined) as Promise<ResourceMap[T]['state'][]>;
    }
    throw new ConfigValidationError(`Missioncraft.list: unknown resource-type '${type as string}'`);
  }

  async update<T extends ResourceType>(
    type: T,
    id: string,
    mutation: ResourceMap[T]['mutation'],
  ): Promise<ResourceMap[T]['state']> {
    // W3 update-validation IMPLEMENTED: validate mutation discriminated-union shape; runtime state-restriction (per §2.4.1 matrix) deferred to W4
    if (type === 'mission') {
      const m = mutation as MissionMutation;
      if (typeof m !== 'object' || m === null || typeof m.kind !== 'string') {
        throw new ConfigValidationError(`Missioncraft.update('mission'): mutation must be a discriminated-union with 'kind' field`);
      }
      // W4: per-field state-restriction matrix dispatch + actual mutation
      throw new MissionStateError(
        `Missioncraft.update('mission', '${id}', kind: '${m.kind}'): mutation-shape validated; runtime per-field state-restriction matrix not yet implemented (W4)`,
      );
    }
    if (type === 'scope') {
      const m = mutation as ScopeMutation;
      if (typeof m !== 'object' || m === null || typeof m.kind !== 'string') {
        throw new ConfigValidationError(`Missioncraft.update('scope'): mutation must be a discriminated-union with 'kind' field`);
      }
      throw new MissionStateError(
        `Missioncraft.update('scope', '${id}', kind: '${m.kind}'): mutation-shape validated; runtime mutation-apply not yet implemented (W4)`,
      );
    }
    throw new ConfigValidationError(`Missioncraft.update: unknown resource-type '${type as string}'`);
  }

  async delete<T extends DeletableResource>(type: T, id: string): Promise<void> {
    if (type === 'scope') {
      // W4: cascade-protection check (reject if any non-terminal mission references this scope)
      throw new MissionStateError(
        `Missioncraft.delete('scope', '${id}'): cascade-protection check + delete not yet implemented (W4)`,
      );
    }
    // Type-system narrows out 'mission' via DeletableResource; runtime guard for dynamic-invocation
    throw new MissionStateError(
      `Missioncraft.delete: 'mission' termination uses complete()/abandon() per Design v4.8 §2.4.1 — delete<T> type-narrowed out per HIGH-7`,
    );
  }

  // ─── Mission-specific verbs (W4-deferred for runtime ops) ───

  async start(_input: string | { config: MissionConfig }): Promise<MissionHandle> {
    throw new MissionStateError('Missioncraft.start: 9-step configured→started transition not yet implemented (W4)');
  }

  async apply(_config: MissionConfig): Promise<MissionState> {
    throw new MissionStateError('Missioncraft.apply: full-config-upsert not yet implemented (W4)');
  }

  async complete(id: string, message: string, _opts?: { purgeConfig?: boolean }): Promise<MissionState> {
    if (!message) throw new ConfigValidationError("Missioncraft.complete: message is required (per v3.0 Refinement #4)");
    void id;
    throw new MissionStateError('Missioncraft.complete: 8-step atomic PR-set publish-flow not yet implemented (W4)');
  }

  async abandon(id: string, message: string, _opts?: { purgeConfig?: boolean }): Promise<MissionState> {
    if (!message) throw new ConfigValidationError("Missioncraft.abandon: message is required (per v3.0 Refinement #4)");
    void id;
    throw new MissionStateError('Missioncraft.abandon: 8-step abandon-flow not yet implemented (W4)');
  }

  async tick(_id: string): Promise<{ wipCommitSha?: string; snapshotPath?: string }> {
    throw new MissionStateError('Missioncraft.tick: explicit cadence-tick not yet implemented (W4)');
  }

  async workspace(idOrCoordinate: string, _repoName?: string): Promise<string> {
    void idOrCoordinate;
    throw new MissionStateError('Missioncraft.workspace: workspace-path-resolution not yet implemented (W4)');
  }

  // ─── Multi-participant verbs (W5-deferred) ───

  async join(id: string, coordRemote: string, _principal?: string): Promise<MissionState> {
    if (!coordRemote) throw new ConfigValidationError("Missioncraft.join: coordRemote is required (reader-side bootstrap surface)");
    void id;
    throw new MissionStateError('Missioncraft.join: 7-step joined→reading transition not yet implemented (W5)');
  }

  async leave(_id: string, _opts?: { purgeWorkspace?: boolean }): Promise<void> {
    throw new MissionStateError('Missioncraft.leave: reader-side disengagement not yet implemented (W5)');
  }

  // ─── Operator-config (key-value namespace) ───

  async configGet(key: string): Promise<string | undefined> {
    const config = await this.loadOperatorConfig();
    return getNestedValue(config as Record<string, unknown>, key);
  }

  async configSet(key: string, value: string): Promise<void> {
    const operatorConfigPath = join(this.workspaceRoot, 'operator.yaml');
    let raw: Record<string, unknown> = {};
    if (existsSync(operatorConfigPath)) {
      const content = await readFile(operatorConfigPath, 'utf8');
      const parsed = (await import('yaml')).parse(content);
      raw = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } else {
      raw = { 'operator-config-schema-version': 1 };
    }
    setNestedValue(raw, key, value);
    // Validate via OperatorConfigSchema (kebab→camelCase pre-parse)
    const camelCased = kebabToCamelObject(raw);
    try {
      OperatorConfigSchema.parse(camelCased);
    } catch (err) {
      throw new ConfigValidationError(
        `Missioncraft.configSet('${key}', ...): OperatorConfigSchema validation failed — ${err instanceof Error ? err.message : 'unknown'}`,
        { cause: err instanceof Error ? err : undefined },
      );
    }
    // Atomic-write (write-temp + rename) per MEDIUM-11
    const tmp = `${operatorConfigPath}.${process.pid}.tmp`;
    await mkdir(this.workspaceRoot, { recursive: true });
    await writeFile(tmp, yamlStringify(raw), 'utf8');
    const { rename } = await import('node:fs/promises');
    await rename(tmp, operatorConfigPath);
  }

  // ─── Static helpers ───

  /**
   * v1.6 fold per MINOR-R5.3 — Adapter implementer uses at MCP-tool-list-time.
   * v1 supports Linux + macOS only (POSIX symlink + O_EXCL mechanism); Windows deferred per v1.5 fold MEDIUM-R4.1.
   */
  static isPlatformSupported(): boolean {
    return platform() !== 'win32';
  }

  // ─── Internal helpers (private; W3 implementations of universal verbs) ───

  private missionConfigPath(id: string): string {
    return join(this.workspaceRoot, 'config', `${id}.yaml`);
  }

  private scopeConfigPath(id: string): string {
    return join(this.workspaceRoot, 'scopes', `${id}.yaml`);
  }

  private async createMission(opts: ResourceMap['mission']['createOpts'] = {}): Promise<MissionHandle> {
    const id = generateMissionId();
    const now = new Date();
    const repos = opts.repo
      ? (Array.isArray(opts.repo) ? opts.repo : [opts.repo]).map((url) => ({ url, name: repoNameFromUrl(url) }))
      : [];
    const config: MissionConfig = {
      missionConfigSchemaVersion: 1,
      mission: {
        id,
        ...(opts.name !== undefined && { name: opts.name }),
        lifecycleState: repos.length === 0 ? 'created' : 'configured',
        createdAt: now,
      },
      repos,
    };
    await mkdir(join(this.workspaceRoot, 'config'), { recursive: true });
    await writeFile(this.missionConfigPath(id), serializeMissionConfig(config), 'utf8');
    // Name-symlink scaffold (per §2.4 name-symlink scheme); operator-supplied --name only
    if (opts.name) {
      const namesDir = join(this.workspaceRoot, 'config', '.names');
      await mkdir(namesDir, { recursive: true });
      const symlinkPath = join(namesDir, `${opts.name}.yaml`);
      try {
        // POSIX O_EXCL via writeFile flag 'wx' on placeholder content; W4+ may switch to fs.symlink for true symlink semantic
        // For W3 simplicity: write a placeholder pointer-file (not a true symlink)
        await writeFile(symlinkPath, `# Name-symlink for mission ${id}\nid: ${id}\n`, { flag: 'wx', encoding: 'utf8' });
      } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'EEXIST') {
          // Cleanup the just-written config + throw name-collision
          try { await unlink(this.missionConfigPath(id)); } catch { /* swallow */ }
          throw new MissionStateError(`mission name '${opts.name}' already taken (per §2.4 name-uniqueness invariant per MEDIUM-R2.4)`);
        }
        throw err;
      }
    }
    const handle: MissionHandle = opts.name === undefined ? { id } : { id, name: opts.name };
    return handle;
  }

  private async createScope(opts: ResourceMap['scope']['createOpts'] = {}): Promise<ScopeHandle> {
    const id = generateScopeId();
    const now = new Date();
    const repos = opts.repo
      ? (Array.isArray(opts.repo) ? opts.repo : [opts.repo]).map((url) => ({ url, name: repoNameFromUrl(url) }))
      : [];
    const config: ScopeConfig = {
      scopeConfigSchemaVersion: 1,
      scope: {
        id,
        ...(opts.name !== undefined && { name: opts.name }),
        ...(opts.description !== undefined && { description: opts.description }),
        lifecycleState: 'created',
        createdAt: now,
        updatedAt: now,
      },
      repos,
    };
    await mkdir(join(this.workspaceRoot, 'scopes'), { recursive: true });
    const kebabed = camelToKebabObject(config);
    await writeFile(this.scopeConfigPath(id), yamlStringify(kebabed), 'utf8');
    const handle: ScopeHandle = opts.name === undefined ? { id } : { id, name: opts.name };
    return handle;
  }

  private async getMission(id: string, principal?: string): Promise<MissionState> {
    const path = this.missionConfigPath(id);
    if (!existsSync(path)) {
      throw new MissionStateError(`mission not found: '${id}' (no config at ${path})`);
    }
    const content = await readFile(path, 'utf8');
    const config = parseMissionConfig(content, path);
    return this.missionConfigToState(config, principal);
  }

  private async listMissions(filter?: MissionFilter, principal?: string): Promise<MissionState[]> {
    const dir = join(this.workspaceRoot, 'config');
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir);
    const states: MissionState[] = [];
    for (const name of entries) {
      if (!name.endsWith('.yaml') || name.startsWith('.')) continue;
      const id = name.slice(0, -5);
      try {
        const state = await this.getMission(id, principal);
        if (this.matchesMissionFilter(state, filter)) {
          states.push(state);
        }
      } catch {
        // skip configs that fail to parse (forensic-history; W4 may surface as warning)
      }
    }
    return states;
  }

  private matchesMissionFilter(state: MissionState, filter?: MissionFilter): boolean {
    if (!filter) return true;
    if (filter.status) {
      const allowed = Array.isArray(filter.status) ? filter.status : [filter.status];
      if (!allowed.includes(state.lifecycleState)) return false;
    }
    if (filter.name !== undefined && state.name !== filter.name) return false;
    if (filter.nameLike !== undefined) {
      const haystack = (state.name ?? '').toLowerCase();
      if (!haystack.includes(filter.nameLike.toLowerCase())) return false;
    }
    if (filter.hubId !== undefined && state.hubId !== filter.hubId) return false;
    if (filter.tags) {
      for (const [k, v] of Object.entries(filter.tags)) {
        if (state.tags[k] !== v) return false;
      }
    }
    return true;
  }

  private missionConfigToState(config: MissionConfig, principal?: string): MissionState {
    const m = config.mission;
    const repos: readonly MissionRepoState[] = config.repos.map((r) => {
      const role = principal && m.participants
        ? (m.participants.find((p) => p.principal === principal)?.role)
        : undefined;
      const base: MissionRepoState = {
        name: r.name ?? repoNameFromUrl(r.url),
        url: r.url,
        base: r.base ?? 'main',
        ...(r.branch !== undefined && { branch: r.branch }),
        ...(r.commitSha !== undefined && { commitSha: r.commitSha }),
        ...(role !== undefined && { role }),
      };
      return base;
    });
    return {
      id: m.id,
      ...(m.name !== undefined && { name: m.name }),
      ...(m.hubId !== undefined && { hubId: m.hubId }),
      ...(m.description !== undefined && { description: m.description }),
      tags: m.tags ?? {},
      repos,
      ...(m.participants !== undefined && { participants: m.participants }),
      ...(m.coordinationRemote !== undefined && { coordinationRemote: m.coordinationRemote }),
      lifecycleState: m.lifecycleState as MissionStatePhase,
      createdAt: m.createdAt,
      updatedAt: m.createdAt,                                                                // W4: mutate on transitions
      identityProviderName: extractProviderName(this.identity),
      approvalProviderName: extractProviderName(this.approval),
      storageProviderName: extractProviderName(this.storage),
      gitEngineProviderName: extractProviderName(this.gitEngine),
      ...(this.remote !== undefined && { remoteProviderName: extractProviderName(this.remote) }),
    };
  }

  private async getScope(id: string, _opts?: ResourceMap['scope']['getOpts']): Promise<ScopeState> {
    const path = this.scopeConfigPath(id);
    if (!existsSync(path)) {
      throw new MissionStateError(`scope not found: '${id}' (no config at ${path})`);
    }
    const content = await readFile(path, 'utf8');
    const yamlMod = await import('yaml');
    const raw = yamlMod.parse(content);
    const camel = kebabToCamelObject(raw);
    const config = ScopeConfigSchema.parse(camel);
    return {
      id: config.scope.id,
      ...(config.scope.name !== undefined && { name: config.scope.name }),
      ...(config.scope.description !== undefined && { description: config.scope.description }),
      tags: config.scope.tags ?? {},
      repos: config.repos,
      lifecycleState: config.scope.lifecycleState as ScopeStatePhase,
      createdAt: config.scope.createdAt,
      updatedAt: config.scope.updatedAt,
      referencedByMissions: [],                                                              // W4: cross-mission scan
    };
  }

  private async listScopes(filter?: ScopeFilter, _opts?: ResourceMap['scope']['listOpts']): Promise<ScopeState[]> {
    const dir = join(this.workspaceRoot, 'scopes');
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir);
    const states: ScopeState[] = [];
    for (const name of entries) {
      if (!name.endsWith('.yaml') || name.startsWith('.')) continue;
      const id = name.slice(0, -5);
      try {
        const state = await this.getScope(id);
        if (this.matchesScopeFilter(state, filter)) {
          states.push(state);
        }
      } catch {
        // skip
      }
    }
    return states;
  }

  private matchesScopeFilter(state: ScopeState, filter?: ScopeFilter): boolean {
    if (!filter) return true;
    if (filter.name !== undefined && state.name !== filter.name) return false;
    if (filter.nameLike !== undefined) {
      const haystack = (state.name ?? '').toLowerCase();
      if (!haystack.includes(filter.nameLike.toLowerCase())) return false;
    }
    if (filter.tags) {
      for (const [k, v] of Object.entries(filter.tags)) {
        if (state.tags[k] !== v) return false;
      }
    }
    return true;
  }

  private async loadOperatorConfig(): Promise<unknown> {
    const path = join(this.workspaceRoot, 'operator.yaml');
    if (!existsSync(path)) return undefined;
    const content = await readFile(path, 'utf8');
    const yamlMod = await import('yaml');
    const raw = yamlMod.parse(content);
    return kebabToCamelObject(raw);
  }
}

/** Extract `static readonly providerName` from a pluggable instance. */
function extractProviderName(pluggable: object): string {
  const cls = (pluggable.constructor as { providerName?: string });
  return cls.providerName ?? 'unknown';
}

/** Read nested value via dot-notation key (e.g., "defaults.workspaceRoot"). */
function getNestedValue(obj: Record<string, unknown>, key: string): string | undefined {
  if (!obj) return undefined;
  const parts = key.split('.');
  let cursor: unknown = obj;
  for (const p of parts) {
    if (cursor !== null && typeof cursor === 'object' && p in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  if (typeof cursor === 'string') return cursor;
  if (cursor === undefined || cursor === null) return undefined;
  return String(cursor);
}

/** Set nested value via dot-notation key (kebab-case keys preserved per Naming-convention contract). */
function setNestedValue(obj: Record<string, unknown>, key: string, value: string): void {
  const parts = key.split('.');
  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (typeof cursor[p] !== 'object' || cursor[p] === null) {
      cursor[p] = {};
    }
    cursor = cursor[p] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

// Use UnsupportedOperationError (re-exported for parser-side use; not invoked by Missioncraft methods directly at W3)
void UnsupportedOperationError;
