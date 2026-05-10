// git-http-fixture.ts — test-only HTTP-server fixture (W5c slice (ii) per Q1 disposition).
//
// Wraps `node-git-server@1.0.0` as a per-test isolated Smart-HTTP git host. Pure-Node;
// test-time dev-dep only. Used by W5c slice (iii) real-engine integration tests + W6
// reuses for 5 W4.4-deferred items.
//
// Usage:
//   const fixture = await createGitHttpFixture(repoBaseDir);
//   // fixture.url + '/<repo-name>.git' is a clone-able coord-remote URL
//   await fixture.close();
//
// Architecture: node-git-server speaks Smart-HTTP protocol. `repoBaseDir` should contain
// already-init'd bare repos (e.g., `/tmp/mc-fixture/foo.git/`); `autoCreate: true` lets the
// server lazily create repos on first push. Listens on port 0 (OS-assigned free port).

import { mkdir } from 'node:fs/promises';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- node-git-server's
// CommonJS exports break ESM static import resolution; runtime require avoids the dual-mode dance.
import { Git } from 'node-git-server';

export interface GitHttpFixture {
  /** Base URL of the running server (e.g., `http://127.0.0.1:<port>`). */
  readonly url: string;
  /** Filesystem path where the server is hosting repos. */
  readonly repoBaseDir: string;
  /** Stop the server + release the port. Idempotent on already-closed. */
  readonly close: () => Promise<void>;
}

export async function createGitHttpFixture(
  repoBaseDir: string,
  options: { autoCreate?: boolean } = {},
): Promise<GitHttpFixture> {
  await mkdir(repoBaseDir, { recursive: true });
  const repos = new Git(repoBaseDir, {
    autoCreate: options.autoCreate ?? true,
  });

  // Listen on port 0; OS picks a free port. node-git-server's `listen` is callback-based;
  // wrap in a Promise that resolves once the underlying http server is bound + port is readable.
  await new Promise<void>((resolve, reject) => {
    try {
      repos.listen(0, undefined, () => resolve());
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });

  // After listen, repos.server is a Node http.Server with an address() method
  const addr = repos.server?.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('createGitHttpFixture: server.address() unavailable post-listen');
  }
  const url = `http://127.0.0.1:${addr.port}`;

  return {
    url,
    repoBaseDir,
    close: async () => {
      try { await repos.close(); } catch { /* idempotent */ }
    },
  };
}
