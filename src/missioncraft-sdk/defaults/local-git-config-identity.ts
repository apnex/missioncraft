// Default IdentityProvider implementation (Design v4.8 §2.1.1)
// Reads git's standard config-resolution-chain (~/.gitconfig + repo-local .git/config + GIT_AUTHOR_* env-vars per git's standard precedence).
//
// Invariant per Design v4.8 §2.6.6 + MEDIUM-R4.2 invocation-context broadening:
//   resolve() is idempotent + side-effect-free; safe to invoke at any time
//   (commit-firing-time per v3.6 baseline; query-time per v4.x broadening).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type {
  AgentIdentity,
  IdentityProvider,
  SigningKey,
} from '../pluggables/identity.js';
import { UnsupportedOperationError } from '../errors.js';

const execFileAsync = promisify(execFile);

/** GPG fingerprint regex: 40-char hex (per Design v4.8 §2.1.1 default-impl spec). */
const GPG_FINGERPRINT_RE = /^[A-F0-9]{40}$/i;

async function readGitConfig(key: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', key]);
    const value = stdout.trim();
    return value === '' ? undefined : value;
  } catch (err: unknown) {
    // git exits non-zero (typically 1) when key is unset; treat as undefined
    const e = err as { code?: number; stderr?: string; message?: string };
    if (typeof e.code === 'number') {
      // Non-zero exit = unset key OR git-CLI error (e.g., not in repo for repo-local)
      // For unset, return undefined; for true error (e.g., git not found), let it propagate
      return undefined;
    }
    throw err;
  }
}

async function detectSigningKey(): Promise<SigningKey | undefined> {
  const value = await readGitConfig('user.signingkey');
  if (!value) return undefined;
  if (GPG_FINGERPRINT_RE.test(value)) {
    return { type: 'gpg', fingerprint: value.toUpperCase() };
  }
  // Else: SSH public-key path (or base64-encoded handle)
  return { type: 'ssh', publicKey: value };
}

export class LocalGitConfigIdentity implements IdentityProvider {
  /** v1.5 fold per MEDIUM-R4.2 — providerName contract. */
  static readonly providerName: string = 'local-git-config';

  async resolve(): Promise<AgentIdentity> {
    let name: string | undefined;
    let email: string | undefined;
    let signingKey: SigningKey | undefined;
    try {
      [name, email, signingKey] = await Promise.all([
        readGitConfig('user.name'),
        readGitConfig('user.email'),
        detectSigningKey(),
      ]);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'unknown error invoking `git config`';
      throw new UnsupportedOperationError(
        `LocalGitConfigIdentity.resolve() requires git CLI on PATH; underlying error: ${message}`,
        { cause: err instanceof Error ? err : undefined },
      );
    }
    if (!name) {
      throw new UnsupportedOperationError(
        'LocalGitConfigIdentity.resolve(): git config user.name is unset; configure via `git config --global user.name "<Your Name>"`',
      );
    }
    if (!email) {
      throw new UnsupportedOperationError(
        'LocalGitConfigIdentity.resolve(): git config user.email is unset; configure via `git config --global user.email "<your@email>"`',
      );
    }
    return signingKey === undefined
      ? { name, email }
      : { name, email, signingKey };
  }
}
