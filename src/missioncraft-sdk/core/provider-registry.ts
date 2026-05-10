// PROVIDER_REGISTRY string-name dispatch (Design v4.8 §2.3.1 v1.3 fold per HIGH-R3.1 — closed registry at v1).
//
// Mission-config YAML specifies pluggables by string-name (e.g., `identity.provider: 'gh-cli'`).
// When mission-config overrides SDK-constructor's instance-injection (per precedence chain), engine instantiates from string-name.
//
// 6 canonical names per v1.5 fold MEDIUM-R4.2 + HIGH-R4.1:
//   identity:  'local-git-config'
//   approval:  'trust-all'
//   storage:   'local-filesystem'
//   gitEngine: 'isomorphic-git'
//   remote:    'pure-git', 'gh-cli'
//
// Closed registry at v1 (NOT exported; not extensible at v1). 3rd-party providers via SDK-constructor INSTANCE injection only.
// v2.x can open the registry via `Missioncraft.registerProvider('my-custom', factory)` if 3rd-party-string-name demand emerges (additive).
// Strict-1.0 commits the closed-registry-at-v1 model + the canonical string-names for built-in providers.

import type {
  ApprovalPolicy,
  GitEngine,
  IdentityProvider,
  RemoteProvider,
  StorageProvider,
} from '../pluggables/index.js';
import { ConfigValidationError } from '../errors.js';

import { LocalGitConfigIdentity } from '../defaults/local-git-config-identity.js';
import { TrustAllPolicy } from '../defaults/trust-all-policy.js';
import {
  LocalFilesystemStorage,
  type LocalFilesystemStorageOptions,
} from '../defaults/local-filesystem-storage.js';
import { IsomorphicGitEngine } from '../defaults/isomorphic-git-engine.js';
import { PureGitRemoteProvider } from '../providers/pure-git-remote-provider.js';
import {
  GitHubRemoteProvider,
  type GitHubRemoteProviderOptions,
} from '../providers/github-remote-provider.js';

/** Pluggable categories per Design v4.8 §2.3.1 PROVIDER_REGISTRY. */
export type PluggableCategory = 'identity' | 'approval' | 'storage' | 'gitEngine' | 'remote';

/**
 * Internal factory map (NOT a public extensibility surface at v1).
 *
 * Storage + remote factories accept config objects (LocalFilesystemStorageOptions / GitHubRemoteProviderOptions).
 * Other factories take no config (constructor is parameter-less for v1 default impls).
 */
const PROVIDER_REGISTRY = {
  identity: {
    'local-git-config': () => new LocalGitConfigIdentity(),
  },
  approval: {
    'trust-all': () => new TrustAllPolicy(),
  },
  storage: {
    'local-filesystem': (config?: LocalFilesystemStorageOptions) =>
      new LocalFilesystemStorage(config),
  },
  gitEngine: {
    'isomorphic-git': () => new IsomorphicGitEngine(),
  },
  remote: {
    'pure-git': () => new PureGitRemoteProvider(),
    'gh-cli': (config?: GitHubRemoteProviderOptions) => new GitHubRemoteProvider(config),
  },
} as const;

type RegistryReturn<C extends PluggableCategory> = C extends 'identity'
  ? IdentityProvider
  : C extends 'approval'
    ? ApprovalPolicy
    : C extends 'storage'
      ? StorageProvider
      : C extends 'gitEngine'
        ? GitEngine
        : C extends 'remote'
          ? RemoteProvider
          : never;

/**
 * Instantiate a default pluggable by category + string-name.
 *
 * Throws ConfigValidationError if the (category, providerName) pair isn't registered.
 *
 * 3rd-party providers MUST be injected via SDK-constructor INSTANCE only at v1
 * (mission-config string-name CANNOT reference custom providers); v2.x can open the registry additive.
 *
 * @param category - Pluggable category ('identity' | 'approval' | 'storage' | 'gitEngine' | 'remote')
 * @param providerName - Canonical string-name (e.g., 'local-git-config', 'gh-cli')
 * @param config - Optional config (only relevant for storage + remote factories)
 */
export function instantiateProvider<C extends PluggableCategory>(
  category: C,
  providerName: string,
  config?: unknown,
): RegistryReturn<C> {
  const factories = PROVIDER_REGISTRY[category] as Record<string, (cfg?: unknown) => unknown>;
  if (!Object.prototype.hasOwnProperty.call(factories, providerName)) {
    throw new ConfigValidationError(
      `PROVIDER_REGISTRY: unknown provider '${providerName}' for category '${category}'; built-in providers at v1: ${Object.keys(factories).map((k) => `'${k}'`).join(', ')}. 3rd-party providers MUST be injected via SDK-constructor INSTANCE; v2.x may open the registry.`,
    );
  }
  return factories[providerName](config) as RegistryReturn<C>;
}

/**
 * Enumerate registered provider-names for a category.
 * Useful for operator-DX (e.g., CLI `msn config providers --list identity`).
 */
export function listProviderNames(category: PluggableCategory): readonly string[] {
  return Object.keys(PROVIDER_REGISTRY[category]);
}
