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
