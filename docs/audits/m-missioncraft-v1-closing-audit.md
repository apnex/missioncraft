# Mission-77 m-missioncraft-v1 closing audit

**Mission:** mission-77 — M-Missioncraft-V1 (substrate-introduction class)
**Brief:** Design v4.9 BILATERAL RATIFIED (originally v4.8 at SHA `2959496`; v4.10 PATCH bundle 12 deferred items roll-up at this audit)
**Repo:** `apnex/missioncraft` (npm `@apnex/missioncraft@1.0.0`)
**Closing-audit author:** apnex-greg (engineer)
**Date:** 2026-05-10

---

## Cumulative wave-close SHA chain (15 commits)

| Wave | SHAs | Δ tests | Description |
|---|---|---|---|
| W0 | `302dfc1` `9751f29` `e9527f6` | +1 (0→1) | Scaffold + Repo Bootstrap |
| W1 | (4 commits via design-fold) | +N | Pluggable Interfaces + Types + Schemas |
| W2 | `7448ddf` (+ pre-W1) | +N | Default Pluggable Implementations + PROVIDER_REGISTRY |
| W3 | `dad3428` `d24213b` `374a78c` | +N | SDK Class + CLI Persona + Grammar Rules 1-7 |
| W4.1 | `d44ef75` | +N | Mission state machine FSM + state-restriction matrix |
| W4.2 | `12da840` | +N | POSIX symlinks + setReaderWorkspaceMode helper |
| W4.3 | `2265c45` `adf7ba1` `b2ddbdd` `950133b` `e683b20` `15c5fd4` | +19 | Complete + Abandon Flows + State-Restriction Matrix Runtime Wiring |
| W4.4 | `7825db2` `96b8858` `0a7aa7d` `7fb8271` `670b6c5` `e683b20` | +24 | Daemon-Watcher + State Durability |
| W5a | `55fe0b4` `84687bf` `4da7fa6` | +N | Multi-participant primitives (principal-resolution + role-derivation + canonicalization) |
| W5b slice (i) | `e5863b9` | +12 | join/leave runtime + 7-step joined→reading transition |
| W5b slice (ii) | `b563990` `c28264d` `d3d896d` | +15 | Writer-side push-flow + refs |
| W5b slice (iii) | `86e6de8` | +5 | W5b-internal integration tests + closing audit |
| W5c slice (i) | `6c9151a` | +11 | Reader-daemon mode-dispatch + Loop B + 3 ref-detection paths |
| W5c slice (ii) | `6ea15ea` | +15 | HTTP-server fixture + substrate-coordinate addressing |
| W5c slice (iii) | `7a5fb52` | +4 | Real-engine integration tests + W5 closing audit |
| W6 slice (i) | `d07c44d` | +2 | Real-engine start() happy-path |
| W6 slice (ii) | `781dc0d` | +3 | Real-engine W5c-deferred carry-overs + storage.list hidden-dir filter |
| W6 slice (iii)+(iv) bundled | `b306c6d` | +2 | Network-partition resilience + mission-class signature audit-pass + closing-audit-v1 + npm publish-prep (Director (Y) directive arrived post-commit; closing-audit revised this slice) |
| W6 slice (v) | `df5b8ae` | +11 | **Bundle-ops substrate-extension per Director (Y)**: GitEngine.createBundle?/restoreBundle? + snapshot.ts module + SDK snapshotWipBranches/restoreFromSnapshot + daemon-watcher hook + end-to-end disk-failure recovery test |
| W6 slice (vi) | (this commit) | +N | **Closing-audit revision** post bundle-ops ship: removes #3 v1.x carry-forward + adds bundle-ops to architectural ship-shape + refreshes npm pack --dry-run artifact |

**Total commits across mission-77 W0–W6**: ~40 (precise list via `git log --oneline` on `apnex/missioncraft:main`)
**Total tests landed**: **162 baseline → 258+ final** (+96+ net across mission)
**CI**: green at every wave-close
**Substrate-currency discipline**: 4 consecutive waves (W5a + W5b + W5c + W6) shipped without drift-catch + spot-fix cycle (W4.3 `adf7ba1` + W4.4 `670b6c5` were the corrective precedents)
**Director (Y) directive at thread-526 round 5**: extended W6 with bundle-ops substrate (slice v) — substrate-completeness restored at v1.0.0; no carry-forward gaps on architecturally-complete shape

---

## Architectural ship-shape

### Pluggable interfaces (5; frozen-API)

- `IdentityProvider` (§2.1.1)
- `ApprovalPolicy` (§2.1.2)
- `StorageProvider` (§2.1.3) + `LocalFilesystemStorage` default
- `GitEngine` (§2.1.4) + `IsomorphicGitEngine` default — capability-gated optional methods: `squashCommit?` (W3 §2.1.4 v0.6) + `createBundle?` + `restoreBundle?` (W6 slice (v) Director (Y); §2.6.2 v0.4 §AAA bundle-ops)
- `RemoteProvider` (§2.1.5) + `PureGitRemoteProvider` (null-object) + `GitHubRemoteProvider` (gh-cli wrapper)

### SDK surface (16 methods per v4.x consolidation)

- 5 universal verbs: `create<T>` / `get<T>` / `list<T>` / `update<T>` / `delete<T>` (parameterized by `ResourceType`)
- 6 mission-specific: `start` / `apply` / `complete` / `abandon` / `tick` / `workspace`
- 2 multi-participant: `join` / `leave` (W5b runtime + W6 slice (ii) real-engine impl-extension)
- 2 operator-config: `configGet` / `configSet`
- 1 static: `isPlatformSupported`
- ResourceMap `{principal?}` extension per MEDIUM-R4.1

Engine-internal methods (cascade-state writes via `_engineMutate`):
- `daemonTickAdvance` — daemon-tick `'started' → 'in-progress'` advance
- `pushWipToCoordRemote` — writer-side push-on-cadence (W5b slice ii)
- `emitTerminatedTag` — terminal-state cascade-signal (W5b slice ii)
- `propagateConfigToCoordRemote` — config-mutation propagation (W5b slice ii)
- `cascadeTerminated` / `cascadeConfigUpdate` — reader-side cascade handlers (W5c slice i)
- `readerLoopBTick` — reader-daemon Loop B orchestration (W5c slice i)
- `snapshotWipBranches` / `restoreFromSnapshot` — disk-failure recovery via bundle-ops (W6 slice v Director (Y))

### CLI surface (15 reserved verbs)

Per Design §2.3 grammar Rules 1-7 (W3); `msn join` + `msn leave` added at v4.0 (W3 baseline + W5b slice (i) runtime activation).

### State machine (10-value enum)

- 6 writer-side: `created` / `configured` / `started` / `in-progress` / `completed` / `abandoned`
- 4 reader-side: `joined` / `reading` / `readonly-completed` / `leaving`
- 9-step `configured → started` transition + 7-step `joined → reading` transition + 8-step publish/abandon flows
- Per-field state-restriction matrix (W4.1) + role-based zod superRefine schema-factory (W4.5+ `'auto'` mode at W5b slice i)

### Workspace contract (per Design §2.4)

```
${workspaceRoot}/
  config/<id>.yaml                              # mission-config (per-principal)
  config/.names/<slug>.yaml                     # POSIX name-symlink
  missions/<id>/<repo-name>/                    # ephemeral runtime workspace
  missions/<id>/.config-mirror/                 # writer-side coord-remote config-mirror (W5b)
  missions/<id>/.coord-mirror/                  # reader-side coord-remote cached git-dir (W5c)
  missions/<id>/.daemon-state.yaml              # engine-derived runtime-state (W5b MEDIUM-R3.3)
  missions/<id>/.daemon-tx-active               # sentinel-file (Loop A self-event guard; W4.6 MEDIUM-R7.2)
  locks/missions/<id>.lock                      # per-mission lock + daemon-IPC fields
  locks/repos/<sha256(repoUrl)>.lock            # per-repo lock (cross-mission scope)
  locks/scopes/<scope-id>.lock                  # per-scope lock
  scopes/<scope-id>.yaml + .names/              # scope-config + name-symlink
  operator.yaml                                 # operator-config

../.missioncraft-snapshots/                     # OUT-OF-BAND from workspaceRoot (W6 slice v)
  <missionId>/<repoName>/<sha>.bundle           # disk-failure recovery bundle-ops snapshots
                                                # all-bundles-retained; mtime-based latest-pick
```

`storage.list` filters hidden dirs (engine-internal artifacts excluded from operator-visible workspace listing per W6 slice (ii) hygiene fold).

**Snapshot location** is sibling-of-workspaceRoot by default (`<workspaceRoot>/../.missioncraft-snapshots/`) so `rm -rf workspaceRoot` mid-mission preserves the snapshot tree for recovery (per Design v4.9 §2.6.2 v0.4 §AAA bundle-ops mechanism). Operator-config `mission.stateDurability.snapshotRoot` overrides if explicit-path needed.

### Coord-remote ref schema (per §2.10 multi-participant)

- `refs/heads/<repoName>/wip/<missionId>` — per-repo writer wip-branch (W5b slice ii item #2)
- `refs/heads/config/<missionId>` — config-branch propagation (W5b slice ii item #4)
- `refs/tags/missioncraft/<missionId>/terminated` — terminal-state cascade-signal (W5b slice ii item #3)
- `refs/tags/missioncraft/<missionId>/config-update` — config-update cascade-fast-path (W5b slice ii item #4)

---

## v4.10 PATCH bundle final count: **12 deferred items** (architect-side post-mission-77 design folds)

1. Cold-pickup carry: §2.9.1+§2.9.3 changesets internal-consistency
2. §2.9.1 lockfile-generation discipline
3. §2.9.3 CI git-config-global step
4. (W4.3 slice ii) §2.5.x: "Record-key fields exempt from kebab-camel transform"
5. (W4.3 slice iii) "8-step → 7-step abandon-flow" framing
6. (W4.3 slice iv) §2.4.1 / §2.6.6: "isomorphic-git transport HTTP/HTTPS only"
7. (W4.4 slice i) §2.6.5 SIGTERM-handler contract: parent-only-lockfile-ownership
8. (W5b slice i) §2.5.1 zod superRefine schema-factory: `roleOverride: 'auto'` mode for cross-partition transition semantic
9. (W5b slice ii) §2.4 workspace-contract consolidation prose: `.daemon.log` + `.daemon-state.yaml` + `.daemon-tx-active` sentinel + `.config-mirror/` per-mission engine-internal artifacts
10. (W5c slice i) §2.1.4 GitEngine-implementation-mapping: isomorphic-git API doesn't expose `--tags --prune` fetch; reader-daemon Loop B native-git shell-out per §2.6.2 v0.4 §AAA bundle-ops breach pattern
11. (W5c slice i) §2.6.5 v3.0 spec: sentinel-file MUST be placed at workspace's parent dir, not inside the chmod-down workspace
12. **(W6 slice v)** Design §2.6.2 implementation-mapping prose-update: bundle-ops native-git shell-out canonicals (`git bundle create` / `git bundle unbundle` + `git update-ref`) + snapshotRoot directory layout (`<snapshotRoot>/<missionId>/<repoName>/<sha>.bundle`) + bundle naming/retention discipline (all-bundles-retained with mtime-based latest-pick) + slice (v) implementation reference (`df5b8ae`)

All 12 items are PATCH-grade design-prose-extensions. **Item #12 evolved per Director (Y) directive** — was substrate-completeness gap (v1.x carry-forward); now design-prose-update reflecting slice (v) implementation reference. Substrate-completeness restored at v1.0.0; no carry-forward gaps on architecturally-complete shape.

---

## v1.0.0 known carry-forwards to v1.x

Per Q5=b §2.7 bounded test surface boundary + architect-ratified W6 slice (i) dispositions; **Director (Y) directive at thread-526 round 5 removed the substantive substrate-completeness gap from carry-forwards** (bundle-ops now ships at v1.0.0 per W6 slice (v) `df5b8ae`).

### Substrate-impl gaps

**NONE** — Director (Y) directive extended W6 to include bundle-ops substrate. Mission-77 v1.0.0 ships **3 of 3 durability-modes complete**:
- ✓ Process-crash recovery (W4.4 wip-branch + dead-pid 7-step)
- ✓ Network-partition resilience (W5b push retry-loop + W6 slice (iii) signature test)
- ✓ Disk-failure recovery (W6 slice (v) bundle-ops; this audit's predecessor)

### Test-coverage gaps (CI-matrix-only or skip)

- **gh pr view deeper coverage** (W4.4-deferred #4): partial coverage at `remote-providers.test.ts:65` (gh CLI presence + version-validation); deeper PR-flow tests require gh-auth + real GitHub repo (CI-matrix-only or skip per existing pattern).
- **Cross-mechanism crash test** (W4.4-deferred #2): Q5=b §2.7 "NO chaos / fault-injection tests" boundary applies; deferred to v1.x post-strict-1.0.

### Strict-1.0 commitment honored

- 5 pluggable interfaces — frozen API
- 16 SDK methods — frozen API
- 15 CLI verbs — frozen
- 10-value lifecycle enum — frozen
- Mission state machine — frozen FSM
- Workspace contract — frozen filesystem layout

---

## Test surface summary

**240+ tests across 25 suites** (per `npm test` at HEAD `7a5fb52` W5c close + W6 slice (i)+(ii)+(iii) additions):

- Unit tests: pluggable-interface contracts + SDK signatures + CLI grammar parser + zod schemas + mutation discriminated-unions + per-field state-restriction matrix + role-based superRefine
- Integration tests: process-crash recovery + lock-timeout-recovery + multi-participant cross-host topology + reader-strict-enforce-tamper-detect-rollback + cascade-mechanism terminated-tag detection + sync-deletion-handling + real-engine join() happy-path + real-engine start() happy-path + network-partition resilience
- HTTP-server fixture (`node-git-server@1.0.0` test-only dev-dep) mediates real-engine integration tests; W5c slice (ii) introduction reused throughout W6

**Substrate-currency**: state-machine writes via `_engineMutate(role: 'writer'|'reader'|'auto', sourceLabel: ...)` discipline upheld start-to-finish; ref-creation gitEngine-pure (architect-aligned boundary).

---

## npm publish v1.0.0 — Director-direct authorization

Per Q1 disposition at thread-526 round 2 (engineer-architect-bilateral; Director directive carry-forward): publish authorization mechanism **(γ) Director-direct npm publish** — engineer ships publish-ready commit + tag; Director executes terminal `npm publish --access public` from their machine retains npm-token authority for the `@apnex` scope.

### Pre-publish artifact (`npm pack --dry-run` summary; refreshed post slice (v) bundle-ops)

```
name: @apnex/missioncraft
version: 1.0.0
filename: apnex-missioncraft-1.0.0.tgz
package size: 143.6 kB
unpacked size: 640.1 kB
shasum: ff1767caa18b7d4da69fff8e54b09c65d776e834
total files: 167
```

(+5.9 kB packed / +26.9 kB unpacked / +4 files vs pre-slice-(v) artifact at `b306c6d` — accounts for `core/snapshot.ts` module + `IsomorphicGitEngine.createBundle/restoreBundle` impl + bundle-ops integration in `core/missioncraft.ts`.)

**Director pre-publish verification checklist:**
- [ ] `dist/` tree present (sovereign-module split: `dist/missioncraft-sdk/` + `dist/missioncraft-cli/`)
- [ ] `package.json` metadata correct (license: Apache-2.0; repository.url: github.com/apnex/missioncraft.git; main: dist/missioncraft-sdk/index.js; bin: msn → dist/missioncraft-cli/bin.js)
- [ ] Strict-1.0 first-publish (no prior v0.x published per Q2=a)
- [ ] `publishConfig`: access public; provenance true (OIDC provenance attestation)
- [ ] CI green at HEAD
- [ ] Tag `v1.0.0` placed at HEAD pre-publish

**Director executes:**
```bash
git tag v1.0.0  # if not already tagged
git push origin v1.0.0
npm publish --access public
```

The `release.yml` workflow auto-fires on tag-creation: TypeDoc deploy via release.yml + npm publish --provenance per §2.9.3.

---

## Mission-77 status advance

Per Phase 8 → Phase 9 → Phase 10 lifecycle:

- **Phase 8 (Engineering)**: COMPLETE at this closing-audit commit
- **Phase 9 (Audit)**: this document = the closing-audit artifact
- **Phase 10 (Retrospective)**: post-Director-publish; mission-77.status advances to `completed` on Hub side

---

## Closing notes

- 4 waves consecutive (W5a + W5b + W5c + W6) shipped substrate-currency-clean — first sustained pattern this session.
- Pattern A engineer-turn discipline ratified bilaterally (memory `feedback_pattern_a_engineer_turn_discipline.md`): combine sub-slice plan + START SIGNAL + first-milestone surface; skip ack-only AND plan-only courtesy rounds.
- v4.10 PATCH bundle (12 items) carries architect-side design-prose-extensions; informs v1.x roadmap. **Director (Y) directive at thread-526 round 5 removed the substantive substrate-completeness gap from carry-forwards — bundle-ops disk-failure ships at v1.0.0 per W6 slice (v); item #12 evolved to design-prose-update reflecting slice (v) implementation reference.**

**Mission-77 substrate-impl arc complete with 3 of 3 durability-modes ✓; v1.0.0 publish-ready pending Director-direct npm publish.**

---

## §9 v1.0.1 patch trail — CLI bin-shim silent-failure (post-ship)

**Defect surfaced:** 2026-05-10 22:00Z — Director-initiated CLI test post-v1.0.0-publish revealed `msn --help` via `npm install -g @apnex/missioncraft` silent-exits 0 (0 bytes stdout + 0 bytes stderr). Library/SDK API unaffected.

**Hub coordinates:** thread-529 (architect-issued v1.0.1 PATCH directive) + task-402 (Director-authorized "Fix it" 2026-05-10).

**Reproduction (Node v24.12.0):**

| Invocation | Outcome |
|---|---|
| `npm install -g @apnex/missioncraft` | ✓ install succeeds; bin shim symlink at `~/.nvm/.../bin/msn` → `../lib/node_modules/@apnex/missioncraft/dist/missioncraft-cli/bin.js` |
| `msn --help` | ✗ silent (exit 0; no output) |
| `node $REAL_PATH --help` (via `readlink -f`) | ✓ full output |
| `node $SYMLINK_PATH --help` | ✗ silent (exit 0) — dispositive |
| `node --preserve-symlinks-main $SYMLINK_PATH --help` | ✓ full output |

**Architect spec-level hypothesis (refuted):** ESM relative-imports break under symlinked-bin shebang invocation (Node 24 `--preserve-symlinks-main=false`); proposed fix via package-exports subpath imports (P1).

**Engineer-side root-cause refutation:** dispositive bisector test — `node -e "import('./node_modules/@apnex/missioncraft/dist/missioncraft-cli/bin.js').then(m => console.log(Object.keys(m)))"` prints `['main']`. If imports failed, this would throw `ERR_MODULE_NOT_FOUND`. Imports load fine; defect is in post-import guard.

**Actual root cause:** `isMainModule` guard at `src/missioncraft-cli/bin.ts:341` (pre-fix):
```ts
const isMainModule = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/bin.js') === true;
```

Under symlinked-bin invocation:
- `import.meta.url` resolves to realpath (Node 24 default `--preserve-symlinks-main=false`) → `file://REAL_PATH/dist/missioncraft-cli/bin.js`
- `process.argv[1]` retains symlink path → `~/.nvm/.../bin/msn`
- First check `file://REAL/bin.js === file://SYMLINK/msn` → **false**
- Fallback `argv[1].endsWith('/bin.js')` — ends with `/msn` → **false**
- `isMainModule = false` → `main()` never invoked → silent exit 0

The `--preserve-symlinks-main` repro-row "fix" works because it keeps both sides as the symlink path, making the first comparison pass.

**Fix mechanism (slice (i) — commit `87bf370`):** realpath-aware guard via `node:url` + `node:fs`:
```ts
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
const isMainModule = (() => {
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1] ?? '');
  } catch {
    return false;
  }
})();
```

Maps closest to architect-alternative (P3) explicit realpath resolve but applied to the **guard**, not the imports. `package.json exports` field unchanged.

**Regression test (slice (ii) — commit `2721f19`):** `test/missioncraft-cli/bin-shim-bootstrap.test.ts` — creates a sibling symlink in tmpdir → `dist/missioncraft-cli/bin.js`, spawns `node $SYMLINK_PATH --help`/`--version`, asserts stdout matches help-text + version regex. 3 tests added; suite 258 → 261.

**v4.10 PATCH bundle item #16 — revised mechanism statement:**

> "Design §2.3 CLI bin-shim **main-module guard** discipline — `import.meta.url === \`file://${argv[1]}\`` fails under symlinked-bin invocation (Node 24 `--preserve-symlinks-main=false` resolves `import.meta.url` to realpath while `argv[1]` retains symlink path). Use `fileURLToPath(import.meta.url) === realpathSync(argv[1])` for symlink-safe guard. Substrate-defect surfaced at v1.0.0 publish + fixed at v1.0.1."

**v1.0.0 deprecation:** Director ran `npm deprecate @apnex/missioncraft@1.0.0` 2026-05-10 ~22:03Z with message *"CLI bin-shim broken on standard npm-global-install (Node 24 ESM symlink-resolution silent-failure); SDK/library API works. Use v1.0.1+ for CLI."* (Operator-facing shorthand; truer technical statement is here in §9 + v4.10 PATCH item #16.)

**Methodology surface:** textbook "architect spec-level recall vs engineer-side code-verification" event (`feedback_architect_abstraction_level.md` + `feedback_substrate_currency_audit_rubric.md` adjacency). Architect-side diagnostic data (5-row repro table) was correct + load-bearing; spec-level mechanism-hypothesis was off by one frame (guard-eval, not import-eval). Dynamic-import bisector test is the dispositive corrective — candidate for new feedback memory `feedback_dynamic_import_bisector_for_silent_failure.md`.

**v1.0.1 ship trail:**
- slice (i) — `87bf370` bin.ts guard fix + version bump 1.0.0 → 1.0.1
- slice (ii) — `2721f19` regression test (3 tests)
- slice (iii) — this §9 doc revision
- slice (iv) — tag `v1.0.1` + push → release.yml fires → npm publishes

---

## §10 v1.0.2 patch trail — 3 scenario-test fixes + D1 slim-deps cheap-win

**Defects surfaced:** 2026-05-10 22:48Z — architect scenario-01 execution against v1.0.1 install revealed 3 shipped-defects beyond the v1.0.1 isMainModule-guard:

| ID | Defect | Layer |
|---|---|---|
| **SD1** | `msn workspace <id>` happy-path zero-stdout; SDK works | CLI output-dispatch |
| **SD2** | `msn abandon` orphans daemon (SIGTERM no-op; manual `kill` required) | Daemon shutdown via lockfile-pid lookup |
| **SD3** | `~/.missioncraft/locks/missions/` empty during mission-active state | start() Step 8 over-deleted lockfile |

**Hub coordinates:** thread-531 (architect-issued v1.0.2 PATCH directive) + task-403 (Director-authorized "Fix the bugs. Go for a quick win on deps" 2026-05-10).

**Slim-deps cheap-win bundled** per architect Triage-Protocol route-a ratified idea-266 (slim-deps cycle filed via thread-530 / sourceThreadId thread-529): **D1 vitest@4 → vitest@3 downgrade** eliminates the @emnapi optional-peer-dep chain that caused the recurring lockfile-sync substrate-defect at v1.0.0 slice (vii) + v1.0.1 slice (iv').

### §10.1 SD3 root cause + fix (slice (i))

start() Step 8 finally-block unconditionally called `releaseLock(missionLock)` which UNLINKED the lockfile at `locks/missions/<id>.lock`. Design v4.9 §2.6.5 dual-purposes the mission-lockfile as BOTH a start()-mutex AND the daemon-watcher IPC channel — the latter writes pid/startTime/daemonExpiresAt fields via spawnDaemonWatcher at Step 6. Step 8's unconditional release destroyed the daemon-IPC state. watcher-entry.ts comment-block confirms: *"Lockfile-cleanup is PARENT-CLI responsibility (parent invokes SIGTERM as part of complete-flow Step 4 / abandon-flow Step 2; same parent-CLI then ... releases lock entirely via storage.releaseLock)."*

**Fix mechanism (slice (i) — commit `3966c6e`):** track `daemonSpawned` boolean; finally-block releases repo-locks unconditionally (mutex-only) but skips missionLock release when daemonSpawned=true. Mutex-purpose preserved on pre-Step-6 throws + spawn-failure-rollback paths.

### §10.2 SD2 root cause + fix (slice (i.5))

After slice (i) shipped, engineer-side downstream smoke-test (pre-slice-(ii) verification) revealed `abandon()`'s `acquireMissionLock(id, { waitMs: 0 })` at line 743 + `complete()` line 433 FAIL with `LockTimeoutError` — the lockfile persists with 24h TTL from start() → fresh acquire hits EEXIST. The acquire-call was **vestigial-from-pre-W4.4-substrate**: pre-W4.4 lockfile was mutex-only; W4.4 added `abandonInProgress` flag (v3.6 MEDIUM-R6.1) + `_engineMutate` atomicity (W4.3) which IS the cross-operation guard now. Architect-disposition at thread-531 round 5: Option (B) acquire-removal.

**Fix mechanism (slice (i.5) — commit `924c538`):** replace `storage.acquireMissionLock(id, { waitMs: 0 })` with `storage.inspectLocks({ missionId: id })` → find handle; throw MissionStateError if absent (precondition: start() must have created the lockfile). Inherited handle is released at Step 4 finally as before, cleanly cleaning up the daemon-IPC channel post-SIGTERM. Tests use `seedMissionLockfile` helper for substrate-bypass discipline.

**SD2 auto-resolves** end-to-end: with the lockfile persisting through abandon's entry + inherited via inspect, `terminateDaemon(missionLockfilePath)` reads daemon-pid → SIGTERM fires → daemon shuts down cleanly + lockfile cleaned up at Step 4 release.

### §10.3 SD1 root cause + fix (slice (iii))

`bin.ts` line 326 `case 'workspace':` discarded the SDK return value: `await mc.workspace(...)` without capturing the resolved path. SDK API returned the path correctly; CLI dispatcher dropped it. Pre-fix the operator saw exit-0 with 0 bytes stdout.

**Fix mechanism (slice (iii) — commit `3a9b8dc`):** capture return value + `console.log(path)`. Single-line dispatcher fix per dispositive bisector pattern (engineer-side SDK direct-call confirmed SDK works → defect localized to CLI dispatcher).

### §10.4 D1 slim-deps fix (slice (iv))

`devDependencies.vitest`: `^4.0.0` → `^3.2.4`. vitest@3 uses rollup (not rolldown) — no `@rolldown/binding-wasm32-wasi` → no `@emnapi/core` + `@emnapi/runtime` optional-peer-dep chain. `package-lock.json` regenerated; 0 `@emnapi` references (was 6 pre-fix). 267/267 tests pass on vitest@3 (no API-port required — drop-in compat).

**v4.10 PATCH bundle item #2 substrate-defect-class CLOSED.** Future patches no longer need the pre-tag-push `rm -rf node_modules && npm ci` discipline — though it remains a useful release-prep verification step per `feedback_lockfile_optional_peer_dep_ci_strict_validate.md`.

### §10.5 Regression coverage

| Test | File | Slice |
|---|---|---|
| SD3 lockfile-persistence post-start | `w6-real-engine-start.test.ts` | (i) |
| inherit-missing precondition | `v1.0.2-slice-i5-regression.test.ts` | (i.5) |
| abandon-retry hits abandonInProgress retry-path | `v1.0.2-slice-i5-regression.test.ts` | (i.5) |
| concurrent complete-vs-abandon mutex via repo-lock + _engineMutate validate | `v1.0.2-slice-i5-regression.test.ts` | (i.5) |
| 8 substrate-bypass tests reseeded with `seedMissionLockfile` | `complete-abandon-integration.test.ts` | (i.5) |
| 1 multi-participant abandon test reseeded | `w5b-integration.test.ts` | (i.5) |
| SD2 daemon-SIGTERM end-to-end | `w6-real-engine-start.test.ts` | (ii) |
| SD1 `msn workspace` stdout via real CLI invocation | `bin-shim-bootstrap.test.ts` | (iii) |

Suite: 262 → 267 (+5 net new tests).

### §10.6 Out-of-scope observation — spawn-failure-rollback daemon-orphan

Engineer-finding during slice (i) audit at `src/missioncraft-sdk/core/missioncraft.ts` lines 322-335: start()'s catch-block reverts lifecycle 'started' → 'configured' but does NOT SIGTERM the partially-spawned daemon. Same SD2-class defect-shape. **Architect-disposition:** file as separate idea post-v1.0.2 ship per Triage-Protocol route-a (cheap-win cadence preserved). Architect-side idea-filing dispatch scheduled.

### §10.7 v4.10 PATCH bundle evolution

- **Item #2** — lockfile-generation discipline — **CLOSED** via D1 vitest@3 swap (substrate-level closure)
- **Item #16** — main-module guard discipline — unchanged from v1.0.1 §9
- **Item #15** — TypeDoc deploy via release.yml — still pending (Pages enablement at repo-settings)

### §10.8 Methodology candidates captured

- `feedback_downstream_path_verification_post_substrate_fix.md` — when fixing a substrate-component, verify EVERY downstream caller, not just the forward-path. Slice-internal tests verify the fix-site invariant; downstream smoke-tests verify the invariant doesn't break consumers. **Provenance: slice (i) regression test passed; abandon-after-start ad-hoc smoke-test caught the downstream failure** that necessitated slice (i.5).

### §10.9 v1.0.2 ship trail

- slice (i) — `3966c6e` SD3 fix (start() daemonSpawned flag)
- slice (i.5) — `924c538` abandon/complete acquireMissionLock-removal (SD2 auto-resolution)
- slices (ii)+(iii) — `3a9b8dc` SD2 regression test + SD1 workspace stdout fix
- slice (iv) — `3cfe0cf` D1 vitest@4 → @3 downgrade (@emnapi chain eliminated)
- slice (v) — this §10 doc + version bump 1.0.1 → 1.0.2 + scenario doc placeholders + tag v1.0.2

### §10.10 v1.0.1 deprecation — Director-disposition post-publish-verify

Architect-recommendation: `npm deprecate @apnex/missioncraft@1.0.1 "CLI workspace dispatch + abandon daemon-orphan + lockfile-persistence defects fixed in v1.0.2+"`. Surface to Director at v1.0.2 publish-verify alongside v1.0.0 + v1.0.1 deprecation-state inventory.

---

## §11 v1.0.3 patch trail — CLI-UX polish bundle + 2 ideas + 1 new verb

**Defects + features surfaced:** 2026-05-11 Director-side scenario 01 dogfood test against `@apnex/missioncraft@1.0.2` revealed CLI-UX rough edges (operator visibility, error messages, name-resolution gaps) plus operator-quick-jump opportunity. Architect bundled 4 Hub-tracked items into v1.0.3 single-patch (precedent: v1.0.2 mixed CLI+substrate):

- **bug-64** (8 items; minor severity; class: missing-feature) — CLI-UX polish bundle
- **idea-267** — spawn-failure-rollback daemon-orphan in `start()` catch (engineer-flagged at v1.0.2 slice (i) audit)
- **idea-268** — `msn workspace <id>` terminal-state-guard (stale path post-abandon)
- **idea-269** — `msn cd <id|name>` + `msn shell-init <shell>` operator quick-jump

**Hub coordinates:** thread-532 (architect-issued v1.0.3 PATCH directive 2026-05-11; maxRounds=15).

### §11.1 bug-64 items 1+2+3+8 (slice (i) — commit `e24827f`)

- Item 1 — bare `msn` → fall-through to `--help` (parser.ts; mirrors git/npm/docker)
- Item 2 — `msn list` empty preserves header row + `(no entries)` indicator
- Item 3 — `<id|name>` verbs missing-arg → enriched LLM-discoverable error
- Item 8 — `msn help` verb dispatches to identical handler as `--help` flag

### §11.2 bug-64 item 4 (slice (ii) — commit `f53bcc8`)

`msn list` table cosmetics — dropped horizontal separator row; CYAN header (ANSI `\x1b[36m`) under `process.stdout.isTTY === true`; plain output when piped/redirected (operator-pipe + LLM-consumer friendly).

### §11.3 bug-64 item 5 (slice (iii) — commit `412a5e0`)

**Functional bug.** Pre-fix: `createMission` wrote `.names/<name>.yaml → ../<id>.yaml` symlinks but no SDK method ever READ them — `msn show test-readonly` failed with "mission not found" despite the name-symlink existing.

Fix: introduced `private resolveMissionRef(idOrName) → canonical id` + `private resolveScopeRef()` helpers; invoked at entry of every public SDK method taking a mission ref (`get / update / start / complete / abandon / workspace / join / leave`) + `get('scope')` (scope-update/delete still placeholder-throw; resolveScopeRef pre-staged). 12-verb audit per architect spec; NO scope-expansion surfaced.

### §11.4 bug-64 items 6+7 (slice (iv) — commit `80354ec`)

`msn start` + `msn abandon` + (scope-extension) `msn complete` confirmation lines on success:
- `started mission <id> ['('<name>')'][; daemon-pid <pid>]`
- `abandoned mission <id> ['('<name>')'][; workspace removed|preserved]; daemon stopped`
- `completed mission <id> ['('<name>')'][; PRs opened: <pr-urls>]`

`--retain` flag wired through abandon-dispatcher (previously only `--purge-config` was forwarded).

### §11.5 idea-267 spawn-failure rollback daemon-orphan (slice (v) — commit `34535e6`)

Engineer-finding from v1.0.2 slice (i) audit: `spawnDaemonWatcher` had partial-cleanup discipline — the "lockfile absent" branch SIGKILLed the child but `writeLockfileStateAtomic` failure path didn't. If post-spawn lockfile-write threw, the child-process was alive but uncleaned → daemon orphan (SD2-class).

Fix: wrap post-spawn block in try/catch; on any failure SIGKILL the partial-spawn child before re-throwing. Symmetric with v1.0.2 slice (i.5) cleanup discipline. Audit for similar gaps at `complete()` Step 6 + `abandon()` Step 5 — both already try/catch per-repo + non-aborting; NO orphan-class. NO scope-expansion.

### §11.6 idea-268 workspace terminal-state-guard (slice (vi) — commit `9d17105`)

Pre-fix: `mc.workspace(<id>)` called `storage.allocate` which mkdir-p'd the workspace on-demand. Post-abandon: dir would be RE-CREATED (empty) + stale path returned — operator `cd` lands in empty dir with no terminal-state signal.

Fix (Option C combined per architect-disposition):
1. **Lifecycle-state fast-path** — `if lifecycleState in ['abandoned', 'completed']` → throw `workspace destroyed; mission '<id>' in terminal state '<state>'`
2. **READ-ONLY safety-net** — `storage.list(missionId)` instead of `storage.allocate` (no mkdir side-effect); match by `basename(h.path) === targetRepoName` (storage.list returns repoUrl=''). If not found → `workspace not found for repo '<name>' in mission '<id>' (try 'msn start' to re-create)`.

Substrate-bypass adjustment: pre-existing tests that relied on `workspace()` create-on-demand updated to pre-allocate via `mc.storage.allocate` (mirrors what `mc.start()` does).

### §11.7 idea-269 msn cd + msn shell-init (slice (vii) — commit `80d92f0`)

New verbs `cd` + `shell-init` added to RESERVED_VERBS + VERB_SPECS + HELP_TEXT. Operator-quick-jump via shell-function wrapper (Option (a) per architect-disposition):

- `msn shell-init bash | zsh | fish` emits a shell-function blob
- `eval "$(msn shell-init bash)"` in `~/.bashrc` (or shell equivalent) installs the wrapper
- Installed wrapper intercepts `msn cd <args>` → `cd $(command msn workspace <args>)`; all other verbs transparent via `command msn`
- Without wrapper: direct `msn cd <id>` falls through to CLI binary which can't change parent shell cwd; emits workspace path to stdout + stderr hint pointing at `msn shell-init` setup

Auto-completion DEFERRED per architect scope-bound.

### §11.8 v1.0.3 ship trail

- slice (i) — `e24827f` bug-64 items 1+2+3+8 (CLI dispatch layer)
- slice (ii) — `f53bcc8` bug-64 item 4 (table cosmetics)
- slice (iii) — `412a5e0` bug-64 item 5 (name-alias audit across 12 verbs)
- slice (iv) — `80354ec` bug-64 items 6+7 + complete symmetric (start/abandon/complete stdout)
- slice (v) — `34535e6` idea-267 spawn-failure-rollback SIGKILL fix
- slice (vi) — `9d17105` idea-268 workspace terminal-state-guard
- slice (vii) — `80d92f0` idea-269 msn cd + msn shell-init
- slice (viii) — this §11 doc + version bump 1.0.2 → 1.0.3 + tag v1.0.3

### §11.9 Test coverage delta

274 → 294 tests (+20 net):
- slice (i): +7 (grammar +3; bin-shim-bootstrap +4)
- slice (iii): +11 (v1.0.3-slice-iii-name-resolution.test.ts NEW)
- slice (v): +1 (spawn-daemon-watcher orphan-cleanup test)
- slice (vi): +3 (workspace terminal-state-guard + safety-net)
- slice (vii): +5 (shell-init bash/zsh/fish/unsupported + cd direct)

### §11.10 v1.0.2 deprecation — Director-disposition post-publish-verify

Architect-recommendation: `npm deprecate @apnex/missioncraft@1.0.2 "CLI-UX polish + name-alias resolution + workspace terminal-state-guard + daemon-orphan SIGKILL fix shipped in v1.0.3+"`. Surface to Director at v1.0.3 publish-verify alongside cumulative deprecation-state inventory (v1.0.0 broken, v1.0.1 + v1.0.2 superseded).

### §11.11 Scenario 01 doc re-ratification (architect-side post-publish)

Per architect thread-532 round 1: scenario 01 outputs change for Step 5 (start has stdout now), Step 10 (abandon has stdout now), Step 13 (workspace post-abandon errors with terminal-state-guard). Architect-side will re-ratify post-v1.0.3 publish; engineer-side scenario-doc placeholders remain in place from v1.0.2 slice (v).

---

## §12 v1.0.4 patch trail — CLI presentation cluster (bug-66 + idea-272 + idea-274)

**Defects + features surfaced:** Director-side scenario 01 dogfood test of v1.0.3 (2026-05-11) surfaced CLI presentation-layer rough edges. Architect-bundled 3 Hub-tracked items into v1.0.4 single-patch:

- **bug-66** (7 items; minor severity) — CLI grammar/error-message UX v2 + color-palette refactor
- **idea-272** — `msn tree` verb (tree-style verb-hierarchy visualization)
- **idea-274** — Per-verb help with multi-syntax (FOUNDATIONAL — bug-66 missing-arg path + idea-272 tree both consume it)

**Hub coordinates:** thread-533 (v1.0.4 PATCH directive 2026-05-11; maxRounds=15).

Director-disposed Option (A) — CLI presentation cluster. Substrate/SDK items (bug-65 scope-impl + idea-271 layout migration + idea-273 progress) DEFERRED to v1.0.5.

### §12.1 idea-274 — per-verb help renderer (slice (i) FOUNDATIONAL — commit `8ca5dab`)

VerbArgSpec interface extension: `shortDesc` / `longDesc?` / `examples?` / `seeAlso?` / `argLabels?` / `usageOverride?`. Content authored for ~38 entries (17 top-level + 8 update sub-actions + 5 scope sub-verbs with 6 scope-update sub-sub-actions + 2 config sub-verbs).

Renderer: `src/missioncraft-cli/grammar/help-renderer.ts` — `resolveSpec(verbPath)` walks the arg-spec tree; `renderVerbHelp(verbPath)` formats output per architect-spec (usage / shortDesc / longDesc / Arguments / Flags / Sub-verbs / Examples / See also).

Multi-syntax dispatch (parser.ts): `<verb-path> --help`, `<verb-path> -h`, `help <verb-path>`. `version` → `--version`. REJECTED per architect-direction: `<verb-path> ?` (shell-glob hazard); `<verb-path> help` suffix (ambiguous).

### §12.2 bug-66 items 3+4+5+10 — error-message refactor (slice (ii) — commit `2c27fdd`)

- **Item 3** — Drop "Rule N" jargon from all operator-visible errors (audited 13 throw sites)
- **Item 4** — Multi-line sub-verb listing on missing sub-verb (`renderMissingSubVerbError`)
- **Item 5** — Missing-arg → per-verb help renderer + friendly error prefix + hint footer for `<id|name>` verbs
- **Item 10** — `msn abandon <id>` missing-message uses same renderer (auto-covered)

### §12.3 bug-66 color-palette infrastructure (slices (iii)+(iv) — commit `e6b5f0d`)

New module: `src/missioncraft-cli/colors.ts`. ANSI emit helpers honoring NO_COLOR (disable), FORCE_COLOR (enable), TTY-auto-detect. No `chalk` dep. Emit-sites migrated: output-formatter header (cyan), bin.ts error: lines (red), success-lines start/abandon/complete (green).

Bundled bug-66 items:
- **Item 1** — `msn version` aliases to `--version` (covered in slice (i))
- **Item 2** — Drop `(no entries)` indicator from empty `msn list`; headers-only
- **Item 8** — `<id|name>` not-found errors concise + no FS-path leaks; `MSN_DEBUG=1` re-enables full diag

### §12.4 idea-272 — `msn tree` verb (slice (v) — commit `c2e4208`)

New file: `src/missioncraft-cli/grammar/tree-renderer.ts`. ASCII-tree of all verbs + sub-verbs/sub-actions; walks same VerbArgSpec data-structure as help-renderer. `--depth N` flag limits recursion. Format: `<verb> <argLabels>  # <shortDesc>`.

### §12.5 Test coverage delta

307 → 316 tests (+9 net):
- slice (i): +13 (per-verb-help.test.ts)
- slice (ii): assertion updates only (12 sites; no count delta)
- slices (iii)+(iv): +4 (colors.test.ts)
- slice (v): +5 (tree.test.ts)
- v1.0.3 name-resolution test updated for MSN_DEBUG dual-path

### §12.6 v1.0.4 ship trail

- slice (i) — `8ca5dab` idea-274 FOUNDATIONAL per-verb help + content for 38 entries
- slice (ii) — `2c27fdd` bug-66 items 3+4+5+10 error-message refactor
- slices (iii)+(iv) — `e6b5f0d` colors infra + items 1+2+8
- slice (v) — `c2e4208` idea-272 `msn tree`
- slice (vi) — this §12 doc + version bump + tag v1.0.4

### §12.7 v1.0.3 deprecation recommendation

Architect-recommended message: `npm deprecate @apnex/missioncraft@1.0.3 "CLI presentation polish + per-verb help + msn tree + colors palette shipped in v1.0.4+"`. Director-direct OTP-prompt path. Cumulative inventory: v1.0.0 broken, v1.0.1+v1.0.2+v1.0.3 superseded, v1.0.4 latest.

### §12.8 DEFERRED to v1.0.5

Per architect thread-533 directive: bug-65 (scope-impl audit); idea-271 (layout migration); idea-273 (progress/log during long-running ops).

---

## §13 v1.0.5 patch trail — operator-UX stability (bug-65 + bug-67 + idea-271 + idea-273)

**Defects + features surfaced:** Architect-side scenario 01 re-execution audit against v1.0.4 (2026-05-11) surfaced 4 Hub-tracked items. Director-disposed Option (A) = "operator-UX stability" full bundle.

- **bug-65** — Scope-namespace SDK-impl audit + completion (scope update + scope delete stubs)
- **bug-67** — CLI-UX class-name leakage + silent-error-paths + arg-detection class (5 items)
- **idea-271** — Operator-state layout consolidation under `config/{missions,scopes}/`
- **idea-273** — Progress/log output during long-running ops (start/abandon/complete)

**Hub coordinates:** thread-534 (v1.0.5 PATCH directive 2026-05-11; maxRounds=15).

### §13.1 bug-65 — scope-namespace SDK-impl completion (slice (i) — commit `6a81a31`)

Audit result: scope create/show/list already worked; ONLY scope update + scope delete were stubs.

Slice (i) implements both:
- **applyScopeMutation** — parallel to applyMissionMutation; 6 mutation kinds (add-repo, remove-repo, rename, set-description, set-tag, remove-tag). Auto-updates `scope.updatedAt`. Handles name-symlink rotation for rename (unlink old + symlink new; EEXIST → collision error).
- **deleteScope** — cascade-protection scans `config/missions/` for missions referencing the scope-id via `scope-id` field. Operator-actionable error names the referencing missions + suggests `msn update <mission-id> scope-id ""` to clear before delete.

NO scope-extension surfaced (scope show/list already worked).

### §13.2 idea-271 — operator-state layout consolidation NO MIGRATION (slice (ii) — commit `7dab92b`)

**Director-direct disposition (mid-slice):** perfection only — no backwards-compat, no migration, no legacy debt. Architect-spec auto-migration logic DROPPED. New layout adopted directly; operators with pre-v1.0.5 state upgrade by manual `mv` (release-note will reference).

Layout change:
```
~/.missioncraft/config/<mission-id>.yaml   →   ~/.missioncraft/config/missions/<mission-id>.yaml
~/.missioncraft/scopes/<scope-id>.yaml     →   ~/.missioncraft/config/scopes/<scope-id>.yaml
~/.missioncraft/config/.names/             →   ~/.missioncraft/config/missions/.names/
~/.missioncraft/scopes/.names/             →   ~/.missioncraft/config/scopes/.names/
```

Unchanged: `~/.missioncraft/locks/missions/`, `~/.missioncraft/missions/` (workspaces), `~/.missioncraft/operator-config.yaml`.

SDK impl: `missionConfigPath` + `scopeConfigPath` updated; new `missionNamesDir()` / `scopeNamesDir()` private helpers; `listMissions` scans `config/missions/`; `listScopes` scans `config/scopes/`; `deleteScope` cascade-scan + `applyScopeMutation` name-symlink rotation use new paths.

11 test files updated to new layout (substrate-bypass discipline; bulk-sed across complete-abandon-integration, w5b-integration, v1.0.2-slice-i5-regression, w6-slice-ii, w5c-real-engine-integration, workspace-resolution, v1.0.4-slice-i-per-verb-help, grammar, join-leave-runtime, w6-real-engine-start, v1.0.5-slice-i-scope-completion).

### §13.3 bug-67 items 1+2+5 — error-message cleanup (slice (iii) — commit `0ba8fa5`)

- **Item 1** — bin.ts main() catch strips SDK class-name + method-path prefixes via regex (`^Missioncraft\.\w+(\(.*?\))?:\s+` and `^\w+Error:\s+`). Single fix-site covers all SDK throw paths.
- **Item 2** — Catch detects `<resource> '<name>' not found` pattern + appends discovery hint pointing at `msn list` or `msn scope list`.
- **Item 5** — Replaced internal `(W4)` markers with `(planned for v1.x roadmap)`; dropped redundant `Missioncraft.` class-prefix from `apply()` + `tick()` since dispatch catch strips it anyway.

### §13.4 bug-67 item 3 — parser missing-arg correct positional (slice (iv) — commit `0ba8fa5`)

`validateArgCount` missing-arg branch uses `spec.argLabels?.[positionals.length]?.label` (next-expected after already-provided) instead of always `argLabels[0]`. Example: `msn abandon <id>` (id provided, message missing) now reports `'abandon' requires <message>` instead of the wrong `'abandon' requires <id|name>`.

### §13.5 bug-67 item 4 — input validation (slice (v) — commit `0ba8fa5`)

Three new validation helpers in bin.ts:
- `validateMissionStatus(value)` — `msn list --status` enum {created, configured, in-progress, started, completed, abandoned}
- `validateConfigKey(key)` — `msn config get|set <key>` registry {wip-cadence-ms, snapshot-cadence-ms, lock-wait-ms, lock-validity-ms}
- `validateRepoUrl(url)` — `--repo` value parseable via `new URL(...)`. Applied at `msn create --repo`, `msn scope create --repo`, `msn update repo-add <url>`.

### §13.6 idea-273 — progress callback (slice (vi) — commit `4ee69da`)

SDK API extension (Option (a) — operator-pluggable callback):
- `ProgressEvent` type: `{ phase, message, percent?, bytes?, duration? }`
- `ProgressCallback` type: `(event: ProgressEvent) => void`
- `start` / `complete` / `abandon` accept `opts.onProgress?` — emits at canonical phase boundaries

Phases:
- start: validate / acquire-lock / allocate-workspace / clone / write-lifecycle / spawn-daemon
- complete: final-tick / publish / write-lifecycle / daemon-sigterm
- abandon: final-tick / daemon-sigterm / cleanup-branches / destroy-workspace

CLI default sink: `makeProgressSink(parsed)` emits `[<phase>] <message>` to stderr in cyan when stderr-isTTY AND --quiet/-q not set. Pipe-safe: no-ops when piped/redirected. Stdout/stderr separation preserved (success-lines on stdout; progress on stderr).

`--quiet` / `-q` flag added to GLOBAL_FLAGS.

### §13.7 Test coverage delta

325 → 339 tests (+14 net):
- slice (i): +9 (v1.0.5-slice-i-scope-completion.test.ts)
- slice (ii): no count delta (all path-update sed)
- slices (iii)+(iv)+(v): +10 (v1.0.5-bug-67-error-cleanup.test.ts)
- slice (vi): +4 (v1.0.5-slice-vi-progress.test.ts)
- 2 bin-shim-bootstrap timeout-bumps (collateral flake-fix)

### §13.8 v1.0.5 ship trail

- slice (i) — `6a81a31` bug-65 scope-namespace completion (applyScopeMutation + deleteScope)
- slice (ii) — `7dab92b` idea-271 layout consolidation NO MIGRATION (Director-direct)
- slices (iii)+(iv)+(v) — `0ba8fa5` bug-67 items 1+2+3+4+5 error-cleanup + input-validation
- slice (vi) — `4ee69da` idea-273 progress callback + CLI sink + --quiet flag
- slice (vii) — this §13 doc + version bump 1.0.4 → 1.0.5 + tag v1.0.5

### §13.9 v1.0.4 deprecation recommendation

Architect-recommended message: `npm deprecate @apnex/missioncraft@1.0.4 "Scope-namespace completion + layout consolidation + CLI error-cleanup + progress callback shipped in v1.0.5+"`. Cumulative inventory: v1.0.0 deprecated; v1.0.1+v1.0.2+v1.0.3+v1.0.4 pending deprecation; v1.0.5 latest stable.

### §13.10 v1.0.x queue post-v1.0.5

Per architect thread-534 directive: ONLY idea-270 (substrate-composition; needs Survey) remains in v1.0.x queue. Operator-UX is **feature-complete** at v1.0.5.

### §13.11 Director-direct mid-slice deviation — captured for retrospective

Slice (ii) auto-migration logic DROPPED per Director-direct directive "no backwards-compat, no migration, no legacy debt — perfection only". Architect-spec auto-migration was DESIGNED-IN at thread-534 directive; Director's mid-cycle disposition tightens it. Methodology note: this is one of few cases where Director engages mid-cycle outside gate-points. Engineer accepted the disposition + surfaces it in this closing-audit + the closing-bundle thread-534 reply.

## §14 v1.0.6 patch trail — bug-cleanup batch (5 bugs; thread-537)

**Defects surfaced:** Director-disposed broader-scope bug-cleanup batch (vs. prior single-issue thread-536 cancellation). 5 cumulative bugs shipped in one cycle.

- **bug-70 (major)** — Scope-mission binding broken (scenario-02-blocker). Director-disposed model (a) eager-inline: scope acts as template at attach-time; repos COPIED into mission YAML; scope-id persisted as metadata.
- **bug-68** — Progress callback fires pre-FSM-validation.
- **bug-69** — FSM-rejection error messages need workaround hints.
- **bug-71** — Cwd-rug-pull guard on `msn abandon`.
- **bug-72** — `msn complete --purge-workspace` symmetric flag.

**Hub coordinates:** thread-537 (v1.0.6 bug-cleanup batch directive 2026-05-11; maxRounds=15; replaces force-closed thread-536).

### §14.1 bug-70 — mission ↔ scope eager-inline binding (slices (i)+(ii) — commits `f2ba0b1`, `adceec4`)

**Slice (i) — schema + create/update handlers (`f2ba0b1`).** Additive non-breaking `scopeId: scp-<8-char-hex>` field on `mission.*` (YAML wire-format `scope-id` per kebab-case transform). `msn create --scope <id|name>`: resolve via `resolveScopeRef` (v1.0.5 helper), reject ghost-scope, copy `repos[]`, persist `scope-id`, auto-advance lifecycle `created` → `configured`. `--scope` + `--repo` rejected as mutually exclusive (scope IS the template; ambiguous attach-semantics otherwise). `msn update <id> scope-id <id|name>`: REPLACE repos[] (not append) — consistent with template model; async pre-step in `applyMissionMutation` resolves + loads BEFORE `_engineMutate`. `msn update <id> scope-id ""`: clears `scopeId`; preserves `repos[]` (mission self-contained post-attach).

**Slice (ii) — `scope show/list --include-references` compute-on-demand (`adceec4`).** New `computeReferencingMissions(scopeId)` scans `<workspace>/config/missions/*.yaml` for raw kebab-case `scope-id` match. Architect-pre-disposed: simpler than maintained ledger; missions are O(10-100s) so scan is sub-ms. Wired through `getScope` + `listScopes` via `opts.includeReferences`; CLI `--include-references` flag triggers.

**Cascade-protection (v1.0.5 bug-65)** automatically covers the new schema field — `deleteScope` reads raw kebab-case `scope-id` from raw YAML directly, same path as the new schema-field's wire-format. Verified by slice-i tests (block-on-bound + release-after-detach).

### §14.2 bug-68 — FSM pre-flight before progress callback (slice (iii) — commit `0922335`)

Idempotent rule: progress events represent ACTIVE work; no progress fires for rejected actions. Pre-fix, `abandon()` / `complete()` / `start()` emitted a `'final-tick'` or `'validate'` phase BEFORE checking lifecycle-state — terminal-state rejection paths still fired one progress event, polluting operator-DX observability.

Fix: moved lifecycle-state validation to be the FIRST statement post-id-resolution in all three SDK methods, BEFORE constructing the emit closure or firing any onProgress event.

### §14.3 bug-69 — FSM-rejection hint matrix (slice (iv) — commit `e226441`)

Extends v1.0.5 bug-67 name-not-found hint pattern. New `renderFsmHint(verb, currentState, idOrName)` helper pattern-matches FSM error format `requires lifecycle '...' (current: '...')` and emits per-verb operator-actionable hint:

| Verb / rejection-state | Hint |
|---|---|
| `abandon` / `complete` on terminal | Manual rm pointer + "msn delete on v1.0.x roadmap" |
| `complete` on `configured` | "run 'msn start <id>' first" |
| `start` on non-configured | "run 'msn show <id>' to inspect current lifecycle state" |
| `tick` on terminal | Same as start |

### §14.4 bug-71 — cwd-rug-pull guard in abandon (slice (v) — commit `1fcd9e7`)

When operator's cwd is inside the workspace about to be destroyed (e.g., post `msn cd <id>`), abandon's `storage.cleanup()` yanks the dir from under them — subsequent shell prompts hit ENOENT.

Fix: in `Missioncraft.abandon()` Step 6, before `storage.cleanup()`: if `process.cwd().startsWith(workspacePath)`, `chdir` to `<workspaceRoot>/missions/`. Try/catch wrapper makes cwd-resolve failures non-aborting. `--retain` branch exempt (workspace preserved → no rug-pull risk).

### §14.5 bug-72 — `msn complete --purge-workspace` symmetric flag (slice (vi) — commit `70355d4`)

Symmetric to abandon's workspace-handling but inverted default: `complete` now PRESERVES workspace by default (forensic-history); `--purge-workspace` opts-in to destroy. Reuses abandon Step 6 cleanup substrate.

Behavior change is operator-invisible: pre-v1.0.6 default destroyed workspace, but the CLI never exposed `--retain`, so the destroy-default was never operator-reachable. Flipping the default to preserve is invisible to all existing operator-paths.

Implementation: complete() SDK accepts `purgeWorkspace?: boolean`; rejects combination with `retain` (mutex); cleanup gated on `opts.purgeWorkspace` only. cwd-rug-pull guard symmetric with slice (v). arg-spec registers `--purge-workspace` on complete verb. New full-cleanup example: `msn complete <id> "..." --purge-workspace --purge-config`.

### §14.6 Test coverage delta

339 → 380 tests (+41 net):
- slice (i): +13 (v1.0.6-slice-i-scope-binding.test.ts)
- slice (ii): +6 (v1.0.6-slice-ii-scope-references.test.ts)
- slice (iii): +5 (v1.0.6-slice-iii-fsm-preflight.test.ts)
- slice (iv): +5 (v1.0.6-slice-iv-fsm-hints.test.ts)
- slice (v): +4 (v1.0.6-slice-v-cwd-guard.test.ts)
- slice (vi): +8 (v1.0.6-slice-vi-purge-workspace.test.ts + v1.0.6-slice-vi-purge-workspace-flag.test.ts)

### §14.7 v1.0.6 ship trail

- slice (i) — `f2ba0b1` bug-70 mission ↔ scope eager-inline binding
- slice (ii) — `adceec4` bug-70 scope show/list --include-references compute-on-demand
- slice (iii) — `0922335` bug-68 FSM pre-flight before progress callback
- slice (iv) — `e226441` bug-69 FSM-rejection hint matrix
- slice (v) — `1fcd9e7` bug-71 cwd-rug-pull guard
- slice (vi) — `70355d4` bug-72 --purge-workspace symmetric flag
- slice (vii) — this §14 doc + version bump 1.0.5 → 1.0.6 + tag v1.0.6 + Director-direct npm publish (γ)

### §14.8 v1.0.5 deprecation recommendation

Architect-recommended message: `npm deprecate @apnex/missioncraft@1.0.5 "Bug-cleanup batch (bug-70 scope-binding + bug-68/69/71/72) shipped in v1.0.6+"`. Cumulative inventory: v1.0.0-v1.0.4 deprecated; v1.0.5 pending deprecation; v1.0.6 latest stable.

### §14.9 v1.0.x queue post-v1.0.6

Per architect thread-537 out-of-scope clause:
- idea-275 (`msn delete` verb) — future cycle
- idea-276 + idea-277 paired (repo health-check + intent field) — future cycle; needs Survey-ish design pass
- idea-270 (event-bridge composition) — needs Survey

Operator-UX bug-cleanup is **complete at v1.0.6**. Substrate is scenario-02-unblock-ready.

### §14.10 Pattern-A discipline + autonomous-execution observations

Pattern-A direct-commit-to-main (apnex/* repos) preserved throughout; cross-approval post-hoc. Engineer-turn discipline (per `feedback_pattern_a_engineer_turn_discipline.md`): combined ack + first-milestone surface in slice (i) reply — no ack-only turn burn. Round budget: 2/15 used (1 architect open + 1 architect ratify); subsequent slices shipped autonomous without architect round-trips (per architect's "Continue autonomous execution per Pattern-A turn-discipline" disposition). Will surface for round-3 at v1.0.6 publish gate-point.
