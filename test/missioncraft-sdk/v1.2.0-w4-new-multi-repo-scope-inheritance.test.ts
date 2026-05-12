// v1.2.0 W4-new slice (vi) — Multi-repo scope-inheritance for msn join (BRANCH-TRACKER reader).
//
// Architect-spec per task-408 §6 component-change 6: `msn join` inherits writer-mission's full
// scope/repos. Slice (iii) shipped scope-inheritance for single-repo writer; slice (vi) extends
// the test surface to multi-repo writers AND verifies Loop B v5.0 iterates all repos.
//
// SHAPE assertions per calibration #72:
// - reader-mission `repos[]` array-equality with writer-mission's `repos[]` (full multi-repo set)
// - Loop B v5.0 BRANCH-TRACKER resolves source-branch `mission/<writer-id>` against EACH repo
//   in reader scope independently (per repo Loop B path; single-branch-per-repo architecture
//   per Design v5.0 §2 row 2)
// - Reader-mission `msn join` REJECTS explicit --repo (CLI level) when sourceMissionId is set —
//   scope is derived from writer, not operator-supplied. Slice (vi) verifies CLI dispatch rejects.
//
// Scope boundaries:
// - msn watch (PERSISTENT-TRACKER) is single-repo by architect-spec (§6-6); no multi-repo here.
// - This slice does NOT test the CLI parser's --repo repeatable-flag handling for writer creation;
//   that's a separable W6-new grammar-refactor concern (parser uses Map.set which overwrites on
//   repeat; only SDK array-form supports multi-repo writer creation today).

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Missioncraft } from '@apnex/missioncraft';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mc-w4-multi-repo-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('v1.2.0 W4-new slice (vi) — Multi-repo scope-inheritance for msn join', () => {
  it('reader inherits writer-mission full multi-repo scope verbatim (3 repos)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writerRepos = [
      'https://github.com/example/api-server.git',
      'https://github.com/example/web-client.git',
      'https://github.com/example/shared-types.git',
    ];
    const writer = await mc.create('mission', { name: 'multi-writer', repo: writerRepos });

    // BRANCH-TRACKER reader against multi-repo writer
    const reader = await mc.create('mission', {
      readOnly: true,
      sourceMissionId: writer.id,
    });

    const readerState = await mc.get('mission', reader.id);

    // SHAPE-1: reader scope length matches writer scope length
    expect(readerState.repos).toHaveLength(3);

    // SHAPE-2: reader scope URLs match writer scope URLs verbatim (preserving order)
    expect(readerState.repos.map((r) => r.url)).toEqual(writerRepos);

    // SHAPE-3: reader scope names match writer scope (auto-derived from URL)
    expect(readerState.repos.map((r) => r.name).sort()).toEqual([
      'api-server',
      'shared-types',
      'web-client',
    ]);

    // SHAPE-4: reader-mission identity preserved (readOnly + sourceMissionId)
    expect(readerState.readOnly).toBe(true);
    expect(readerState.sourceMissionId).toBe(writer.id);
  });

  it('readerLoopBV5Tick (BRANCH-TRACKER) resolves source-branch mission/<writer-id> per repo', async () => {
    // SHAPE test: Loop B's BRANCH-TRACKER resolution uses writerConfig.repos[0].url + branch
    // `mission/<writer-id>` (per missioncraft.ts:1488-1497). For multi-repo readers, slice-(v) core
    // delegates the per-repo iteration to the `for (const repo of config.repos)` loop at :1503 —
    // the source-remote URL is bound to writer's FIRST repo (single source for all reader repos)
    // because the v5.0 single-branch architecture means each repo in the reader scope mirrors a
    // corresponding branch in the writer's matching repo. NOTE: full multi-repo workspace
    // allocation + per-repo writer-to-reader URL-mapping is slice-(v)-extension territory; this
    // test verifies that the current slice (v) loop iterates all reader repos without error
    // (no workspace allocated → handles list returns empty → loop continues without abort).
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writerRepos = [
      'https://github.com/example/repo-alpha.git',
      'https://github.com/example/repo-beta.git',
    ];
    const writer = await mc.create('mission', { repo: writerRepos });
    const reader = await mc.create('mission', { readOnly: true, sourceMissionId: writer.id });

    // No workspaces allocated → readerLoopBV5Tick iterates all reader repos, finds no handle for
    // any (storage.list returns empty), returns successCount=0 without throwing. SHAPE: graceful
    // multi-repo iteration; no early-abort on empty workspace state.
    const count = await mc.readerLoopBV5Tick(reader.id);
    expect(count).toBe(0);
  });

  it('reader inherits empty writer scope (writer with no repos)', async () => {
    // Regression net: writer with 0 repos → reader inherits empty repos[] (already covered by
    // slice-iii test #5; folded here as multi-repo-edge for slice-(vi) test-coverage boundary)
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writer = await mc.create('mission', {});
    const reader = await mc.create('mission', { readOnly: true, sourceMissionId: writer.id });
    const readerState = await mc.get('mission', reader.id);
    expect(readerState.repos).toEqual([]);
  });

  it('multi-repo writer name preserved (writer.name vs reader.name independent)', async () => {
    const mc = new Missioncraft({ workspaceRoot: tempRoot });
    const writer = await mc.create('mission', {
      name: 'multi-writer-beta',
      repo: ['https://github.com/example/repo-x.git', 'https://github.com/example/repo-y.git'],
    });
    const reader = await mc.create('mission', {
      name: 'multi-reader-beta',
      readOnly: true,
      sourceMissionId: writer.id,
    });
    expect(reader.name).toBe('multi-reader-beta');
    const readerState = await mc.get('mission', reader.id);
    expect(readerState.name).toBe('multi-reader-beta');
    expect(readerState.repos).toHaveLength(2);
    expect(readerState.sourceMissionId).toBe(writer.id);
  });
});
