# Mission-78 m-missioncraft-d2-substrate closing audit

**Mission:** mission-78 — M-Missioncraft-D2-Substrate (substrate-replacement class)
**Brief:** Design v5.0 substrate-design simplification — Path D2 (native git CLI hard-depend) + Flow B canonical + single-branch architecture + independent missions + reader-flavors + push/pull cadence + hybrid CLI grammar + v4.x carry-forward surface sweep; ship `@apnex/missioncraft@1.2.0`
**Repo:** `apnex/missioncraft` (npm `@apnex/missioncraft@1.2.0`)
**Closing-audit author:** apnex-greg (engineer)
**Date:** 2026-05-13

---

## §1 Wave-close SHA chain (mission-78; 38+ commits across 10 waves)

| Wave | SHAs | Δ tests | Description |
|---|---|---|---|
| W0 | `580c38b` `6e7aef3` | +N | substrate-detect module (idea-284) + `msn version` extension (idea-285); thread-539 converged |
| W1 | `e65864e` `95d65b6` `32ef215` `dfb43d1` | +49 (393→442) | NativeGitEngine canonical build (Path D2): gitExec helper + 17 GitEngine contract methods (clone/branch/checkout/log/status/revparse + init/getCurrentBranch/tag/stage/commit/commitToRef/deleteBranch/fetch/push/pull/addRemote/removeRemote/listRemotes + merge/squashCommit/createBundle/restoreBundle) + PROVIDER_REGISTRY 'native-git' entry + full-contract integration test |
| W2 (W1-wave-close-extension) | `e31c1fd` `8dabd97` `312edd0` `a4453e9` | +N | gitEngineProviderName default → 'native-git' canonical-switch + 2 substrate-asymmetry fixes (Fix #1 + #2 storage.list hidden-dir filter) + Fix #3 commitToRef parent-linkage anchored to HEAD (BOTH engines; dogfood-surfaced thread-543) + Fix #4 squashCommit bypass-INDEX refactor |
| W3-new | `8cab0aa` + `32ca5a3` extension | +N | Single-branch refactor: daemon commits direct to `mission/<id>`; drop `wip/<id>` sidecar (Flow B canonical) + 4 substrate-fixes (Fix #6 + #7 + **Fix #8 BLOCKER** + #9 test-shape) |
| W4-new | `54e2c9a` `1893479` `351aca7` `2a6f0fc` `5ba2132` `714f70a` `0db1601` `d06d253` | +N | mission-config schema-v2 + reader-mission fields + parser-refuse-v1 + `msn watch` PERSISTENT-TRACKER + `msn join` REPURPOSED as BRANCH-TRACKER + reader-daemon Loop B v5.0 (fetch+reset) + multi-repo scope-inheritance + writer+reader bilateral transparency-gate + **Fix #10 + #11** (daemon canonical missionConfigPath layout + dispatch-layer transparency-gate) |
| W5-new | `4245f2c` `dacbd38` `0758200` `0a8b459` `eb13ab1` `166bad3` `36b6f62` | +N | schema-v2 extension: symmetric push/pull cadence + drop coord-remote code paths + writer-daemon push-cadence + reader-daemon pullCadence + end-to-end bilateral transparency-gate via cadence + **Fix #12 + #12.b BLOCKER** (complete() force-push for post-push-cadence squash-rewrite + pushWithRetry options-type extension) |
| W6-new | `5c81862` `cd86874` `f44a8af` `d480c70` `9f67881` `a7a77b8` `fa68da3` `5d0b725` | +77 (500→577) | Hybrid CLI verb grammar refactor (Design v5.0 §10.6 three-class taxonomy): scaffolding + id-first parser γ disposition + --start flag on creation-verbs + idempotent mc.start + slug-validation SDK-defense + DROP apply+tick verbs + REMOVE verb-first form for mission-targeted verbs (no-backward-compat) + HELP_TEXT/verb-docs reconciliation + end-to-end transparency-gate (36 SHAPE-assertion tests) |
| W7-new | `adf1c66` `1f3edfe` `e843f8a` `531476e` `2dd6637` | -18 (577→559) | IsoEng removal + v4.x carry-forward surface sweep: IsomorphicGitEngine provider deletion (538 LOC + isomorphic-git npm dep) + mc.join SDK deletion + msn leave CLI + mc.leave SDK + FSM leave-* events + 3 dead-code helpers + set-coordination-remote mutation-kind + update-verb-first PRESERVE disposition (calibration #73 mechanism-choice clearance) |
| W8-new | this wave | — | Closing-audit + memory/discipline-fold batch + scenario doc reconciliation + bug-disposition + version bump 1.0.7 → v1.2.0 + tag-push + npm publish + Director Release-gate + Phase 10 Retrospective |

**Total commits mission-78 W0–W7-new**: ~38 (precise list via `git log --oneline 580c38b..2dd6637`)
**Test-suite arc**: **393 baseline (post-mission-77) → 559 final** (+166 net; mostly W3-W6 substrate growth, W7-new pruned -18 pure v4.x cleanup)
**CI**: green at every wave-close
**Substrate-extension wire-flow gate ROI**: 3 BLOCKERS caught across W3-W5 substrate-class waves; 0 BLOCKERS at W6-new CLI-class + W7-new cleanup-class — three-tier risk-precedent CONFIRMED (substrate-rewrite > CLI-rewrite > cleanup-sweep)

---

## §2 Architectural ship-shape (v1.2.0 substrate)

### v5.0 substrate-design simplification — COMPLETE

Mission-78 closes the v4.x → v5.0 architectural transition per Director-direct disposition 2026-05-12 substrate-decision. v5.0 architecture:

1. **Path D2 native git substrate**: NativeGitEngine canonical (shells to `git` CLI via argv-only `execFile`); IsomorphicGitEngine REMOVED entirely (no alternate engine at v1.2.0); hard-depend on `git` + `gh` binaries with substrate-detect surfacing version-state in `msn version` output
2. **Flow B canonical**: operator does NOTHING git-related; daemon handles all git operations (commit-on-debounce + push-cadence)
3. **Single-branch architecture**: daemon commits direct to `mission/<id>`; `wip/<id>` sidecar branch dropped
4. **Independent missions**: `msn join` REPURPOSED as BRANCH-TRACKER reader-mission (coupled lifetime via writer-mission-id); v4.x multi-participant shared-mission semantics REMOVED
5. **Reader-flavors**: BRANCH-TRACKER (`msn join <writer-mission-id>`) + PERSISTENT-TRACKER (`msn watch --repo --branch`); both via `mc.create('mission', { readOnly: true, ... })` with reader-flavor fields
6. **Push/pull cadence**: symmetric writer-side `pushCadence` + reader-side `pullCadence` (config-driven; `on-complete-only` / `every-Ns` / `on-demand`)
7. **Force-push complete-flow**: Fix #12 — complete()'s squash-rewrite force-pushes upstream when push-cadence has pre-pushed daemon-chain
8. **Auto-close cascade**: reader-mission Loop B detects writer-terminated → readonly-completed cascade per Design v5.0 §2 row 4
9. **Hybrid CLI grammar**: three-class taxonomy (Class 1 GLOBAL verb-first / Class 2 CREATION verb-first with --start flag / Class 3 MISSION-TARGETED id-first) per Design v5.0 §10.6
10. **No backward-compat**: v4.x carry-forward surface swept (IsoEng + mc.join SDK + msn leave + mc.leave SDK + dead-code helpers + set-coordination-remote mutation-kind all DELETED)

### Pluggable interfaces (5; frozen-API since mission-77)

- `IdentityProvider` (§2.1.1) + `LocalGitConfigIdentity` default
- `ApprovalPolicy` (§2.1.2) + `TrustAllPolicy` default
- `StorageProvider` (§2.1.3) + `LocalFilesystemStorage` default
- `GitEngine` (§2.1.4) + **`NativeGitEngine` SOLE canonical** (IsomorphicGitEngine REMOVED at W7-new)
- `RemoteProvider` (§2.1.5) + `PureGitRemoteProvider` + `GitHubRemoteProvider` defaults

### PROVIDER_REGISTRY entries (v1.2.0 closed registry)

```
identity:  'local-git-config'
approval:  'trust-all'
storage:   'local-filesystem'
gitEngine: 'native-git'           // SOLE canonical (was 'isomorphic-git', 'native-git' at v1.0.x; IsoEng entry removed at W7-new)
remote:    'pure-git', 'gh-cli'
```

### Mission resource schema (k8s-shape; v1.2.0)

- `MissionStatePhase`: `'created' | 'configured' | 'started' | 'in-progress' | 'completed' | 'abandoned' | 'joined' | 'reading' | 'readonly-completed' | 'leaving'` (`'leaving'` retained as INERT-vestigial; W8-new full-removal candidate per architect §B round 3 + memory `feedback_compressed_lifecycle_preflight_currency_checks.md`)
- Reader-mission fields (v5.0 schema-v2): `readOnly: boolean` + `sourceMissionId` (BRANCH-TRACKER) | `sourceRemote` + `sourceBranch` (PERSISTENT-TRACKER) + `pullCadence`
- Writer-mission cadence: `pushCadence`
- Field DELETED at W5-new slice (ii): `coordinationRemote` (v4.x multi-participant coord-mirror primitive)

### CLI hybrid grammar three-class taxonomy

**Class 1 — GLOBAL VERBS** (verb-first; no mission target):
`list` / `version` / `help` / `config get|set` / `scope create|list|show|update|delete` / `tree` / `shell-init` / `cd` (when used without mission-id)

**Class 2 — CREATION VERBS** (verb-first; optional --start flag for sequential mc.create + mc.start composition):
`create --name --repo` / `join <writer-mission-id>` / `watch --repo --branch` (each with optional `--start`)

**Class 3 — MISSION-TARGETED VERBS** (id-first canonical: `msn <mission-id> <verb>`):
`show` / `start` / `complete` / `abandon` / `workspace` / `cd` / `update <sub-action>` (PRESERVED verb-first form per W7-new slice v structurally-required slug-resolution-via-verb-first invariant)

**Coord-form exception** (workspace/cd): `msn workspace <id>:<repo>` legacy form preserved because coord-form embeds the mission-id; detected by argv[1] containing `:` (Rule 7 substrate-coordinate).

### Operator-DX surface (v1.2.0)

```
$ msn version
missioncraft 1.2.0
git 2.42.0  (substrate: required)
gh   2.40.0 (substrate: required)

$ msn create --name alpha --repo https://github.com/x/y.git --start
msn-abc12345  alpha

$ msn msn-abc12345 show
... mission state ...

$ msn msn-abc12345 complete "ship feature X"
Pushed mission/msn-abc12345 → upstream main (squashed)
```

---

## §3 Substrate-extension wire-flow gate — empirical risk-precedent

Per `feedback_substrate_extension_wire_flow_integration_test.md` discipline + calibration #67/#68 (synthetic test masking) + #74 (daemon-dispatch transparency-gate) + #76 (3-layer compositional-gaps + tsc-strict + ship-verify-language).

**3 architect-dogfood cycles caught 3 BLOCKERS at substrate-class waves**:

| Wave | BLOCKER | Fix-extension | Root-cause |
|---|---|---|---|
| W3-new | Fix #8 | `32ca5a3` | squashCommit step-4 update-ref target was baseRef (main) instead of headRef (mission-branch) → orphan-squash on main; mission-branch shipped daemon-commits not squash. Pre-W3-new single-branch made mission-branch empty so symptom hidden; W3-new exposed the dormant defect per `feedback_new_code_path_exposes_dormant_defects.md`. |
| W4-new | Fix #10 | `d06d253` | detectDaemonMode used incorrect missionConfigPath layout (`<workspaceRoot>/config/<id>.yaml` missing `missions/` subdir); daemon-mode detection silently fell through to writer-mode for reader-missions. |
| W5-new | Fix #12 | `166bad3` + `36b6f62` | complete()'s pushWithRetry failed non-fast-forward because slice (iii) push-cadence had pre-pushed daemon-chain; squash-rewrite was non-FF vs upstream tip. Force-push required. Fix #12.b extended pushWithRetry options-type with `force?: boolean` (tsc-strict caught at slice ship; calibration #76 ship-verify-language-vs-execution surfaced here). |

**0 BLOCKERS at CLI-class W6-new** (8 slices); **0 BLOCKERS at cleanup-class W7-new** (5 slices).

**Three-tier risk-precedent CONFIRMED**:
- substrate-rewrite (changes mission-state-machine + daemon-loop + git-flow) → highest risk
- CLI-rewrite (changes operator-DX surface + parser + dispatch) → medium risk
- cleanup-sweep (deletes dead-code + comment-scrub + test-fixture migration) → lowest risk

This empirical pattern informs future-mission risk-scoring + per-slice surface cadence expectations.

---

## §4 Methodology calibrations (mission-78 contributions)

Calibrations #71 through #76 + 3-instance #73 inward-application pattern were filed during mission-78 execution. Ledger entries at `docs/calibrations.yaml`; query via `python3 scripts/calibrations/calibrations.py show <id>`.

| ID | Short-name | Source | Lesson |
|---|---|---|---|
| #71 | substrate-redesign-on-fix-class-recursion | Director-progressive-question during W3-W4-new arc | Fix-class-recursion at architectural level (3+ consecutive substrate-fixes without wave-close) is a SIGNAL for substrate-redesign, not another incremental fix; Director-progressive-question pattern collapses accidental complexity. v5.0 substrate-design simplification emerged from this signal. |
| #72 | SHAPE-assertions-over-exact-values | W4-new wire-flow integration tests | Pin contract shape (format + structure) not specific values; less brittle to substrate-tuning. Format-regex + structural-shape > hardcoded-hash for test assertions. |
| #73 | inward-application-of-directional-diagnostic | Architect-spec gaps W4-new + W6-new (3 instances) | Apply directional-vs-mechanism diagnostic to OWN spec-authorship (task descriptions, plannedTasks), not just engineer-surfaces. Sibling to #69 v2 outward-facing diagnostic. **3 instances captured during mission-78**: (i) W4-new slice (iv) Hub-policy deferral → idea-291; (ii) W6-new verb-first-removal scope-gap → slice (v.b) extension; (iii) W6-new update-exception structural-requirement → engineer-judgment exemption |
| #74 | daemon-dispatch-transparency-gate | W4-new Fix #11 | Test layer at the daemon-dispatch boundary catches mode-mis-routing that unit tests miss. Per-layer unit tests on synthetic input miss schema-strip / projection-skip; mission-completion gate must push actual wire payload through actual schema validation. |
| #75 | orphan-daemon-aware-test-cleanup | W4-W6 test-gate flakes | Test cleanup must `pkill -f "watcher-entry"` between full-suite runs; orphan daemons from prior test fail-mid leak state into subsequent tests. Discipline pattern: `pkill -f "watcher-entry.js msn-"` → re-run → 541/541 passes. |
| #76 | ship-verify-language-vs-execution | W5-new Fix #12.b | Commit-message claims must reflect actual command outputs; `npm run build clean` claim post-#12 didn't re-run tsc-strict + failed TS2353 because pushWithRetry options-type lacked `force?: boolean`. vitest+esbuild masked. 3-layer ship-verify required: build-gate (tsc-strict) + test-gate (vitest) + commit-message-claims-reflect-actual-command-execution discipline. |

### Calibration #73 inward-application 3-instance pattern (detail)

Sibling to #69 v2 outward-facing diagnostic (`feedback_verify_directional_vs_mechanism_before_routing_around.md`). #73 is inward-facing: architect applies directional-vs-mechanism rubric to OWN spec-authorship.

| Instance | Wave/Slice | Surface | Disposition |
|---|---|---|---|
| 1 | W4-new slice (iv) | Architect spec required Hub-policy deferral; directional decision (changes substrate-target-state definition) → file idea-291 + carry-forward to post-v1.2.0 | DEFERRAL via idea-291 |
| 2 | W6-new slice (v.b) | Architect spec REMOVED verb-first form for mission-targeted verbs; engineer-execution surfaced scope-gap (test fixtures + update-exception + coord-form-exception) → directional decision required scope extension | SLICE (v.b) EXTENSION |
| 3 | W6-new update-exception | Architect spec retained update verb-first as "during migration" carry-forward; engineer-execution discovered structurally-required (slug-resolution-via-verb-first invariant from (γ) parser disposition) → mechanism-choice not directional → preserve permanently per W7-new slice (v) | PERMANENT PRESERVE |

---

## §5 Bug summary

| Bug | Class | Surface | W8-new disposition |
|---|---|---|---|
| bug-77 | publishStatus vocabulary | `'pr-opened'` status emitted in pure-git mode (no PR; just push to upstream); misleading operator-DX | TBD W8-new slice (iv) engineer-judgment |
| bug-78 | msn-start workspace-exists | Pre-existing workspace dir blocks `msn start` clone-step with cryptic error; needs pre-clone existence check + clean error message | TBD W8-new slice (iv) engineer-judgment |
| bug-79 | chokidar startup-race | Operator file-edit immediately after `msn start` may not fire chokidar `'change'` event because watcher hasn't reached `ready`-event yet; minor; document workflow constraint OR post-`ready`-detection refactor | TBD W8-new slice (iv) engineer-judgment |
| bug-80 | update-name .names symlink refresh | `msn update <id> name <new-name>` updates mission YAML but does NOT refresh `.names/<slug>.yaml` symlink → subsequent slug-resolution using NEW name fails; workaround: canonical msn-<8hex> id | **fix-in-W8-new Component E.iv** per engineer-disposition (pre-disposed at thread-552 round 6 close_no_action; surgical-scope; composability with Component D update-verb surface touches) |

All 4 bugs are pre-existing (NOT introduced by mission-78 substrate-rewrite); surfaced during architect-dogfood cycles + bug-80 specifically uncovered by update-verb-first PRESERVE commitment exercising slug-resolution path.

---

## §6 Mission-arc retrospective

### Goals vs delivery

**Originally framed** (pre-Director-direct re-scope at thread-547): mission-78 was W3 bug-74 (post-success state-write ordering) + W4 IsomorphicGitEngine removal + W5 ship v1.1.0.

**Re-scoped at Director-direct 2026-05-12** substrate-decision: Path D2 native-git substrate + Flow B canonical + full v5.0 substrate-design simplification + skip v1.1.0 + ship v1.2.0 (single big release). vestigial dual-branch + multi-participant code never publishes.

**Delivered**: complete v4.x → v5.0 architectural transition across 8 waves; 38+ commits; 4 architect-dogfood cycles; 3 substrate BLOCKERS caught + corrected; 0 CLI/cleanup BLOCKERS; -1679 net LOC (W7-new v4.x carry-forward surface sweep); +166 net tests across mission (393 → 559); cumulative test-suite arc 467 (mission-77 ship) → 559 (mission-78 ship).

### Compressed-lifecycle pattern

Mission-78 was ratify-direct (no Survey or Phase 6 Preflight per architect's Director-direct authorization). Compressed-lifecycle preflight currency checks per `feedback_compressed_lifecycle_preflight_currency_checks.md` carried: Phase 6 verified anti-goal idea-refs + mission-config templates pre-wave.

### Round-budget posture

Cumulative round-budget usage across mission-78 coord-threads:

| Thread | Wave | Round usage | Outcome |
|---|---|---|---|
| thread-540 | W1 | N/15 | converged |
| thread-543 | W2 + extensions | N/15 | converged (formal close pending engineer-turn-permission) |
| thread-544 | W3-new | N/15 | converged |
| thread-547 | W4-new | 12/15 | converged with cascade |
| thread-548 | W5-new | N/15 | converged |
| thread-549 | W5-new push-cadence | N/15 | converged |
| thread-550 | W6-new (i)-(vi) | 15/15 | round-limit reached; spillover to 551 |
| thread-551 | W6-new (v.b)+(vi)+(vii) | 4/15 | converged with cascade |
| thread-552 | W7-new | 6/15 | converged with cascade |
| thread-553 | W8-new (this wave) | 1+/15 | active |

**Bilateral-converge cascade pattern** (architect create_task + engineer close_no_action stagedAction at terminal round): efficient transition-handoff between waves; each cascade spawns new coord-thread for next wave with sourceThreadId back-link.

### Discipline-folds applied during mission-78

- Pattern A direct-commit-to-main on apnex/* user-account (`feedback_apnex_repos_direct_commit_to_main.md`)
- Argv-only discipline (`feedback_node_execfile_error_formatter_visual_misleads_diagnosis.md`) — Path D2 core principle
- Per-slice surface cadence (`feedback_surface_cadence_per_slice_class.md`) — substantive substrate-extension slices need per-slice surface; cleanup-class can batch
- Combined ack-and-progress turn-discipline (`feedback_pattern_a_engineer_turn_discipline.md`) — no engineer-turn-burn on START SIGNAL or interim acks
- Calibration #72 SHAPE-assertions test-discipline
- Calibration #74 daemon-dispatch transparency-gate test-discipline
- Calibration #75 orphan-daemon-aware test cleanup
- Calibration #76 3-layer ship-verify (tsc-strict + npm test + commit-message-claims-reflect-actual)
- Build-gate + test-gate ship-verify MANDATORY pre-commit
- Ship-verify-language-vs-actual-execution discipline (commit-message claims)
- Bilateral audit thread round-budget discipline (`feedback_bilateral_audit_round_budget_discipline.md`) — skip ack-only courtesy rounds

---

## §7 v1.2.0 vs v1.0.x — architectural delta

### Breaking changes (v4.x → v5.0; no-backward-compat)

1. **CLI grammar**: mission-targeted verbs (show/start/complete/abandon/workspace/cd) REQUIRE id-first form `msn <id> <verb>`; verb-first form REMOVED. Operator-facing error directs to id-first form with msn-list hint.
2. **CLI verbs DROPPED**: `apply` (overlap with `msn create -f`); `tick` (was unimplemented); `leave` (v4.x multi-participant)
3. **SDK methods DELETED**: `mc.join(id, coordRemote, principal?)` (v4.x multi-participant); `mc.leave(id, opts)` (reader-side disengagement)
4. **SDK pluggables**: `IsomorphicGitEngine` class + re-export REMOVED; `NativeGitEngine` sole canonical
5. **Schema changes**:
   - REMOVED: `coordinationRemote` field (v4.x coord-remote primitive)
   - REMOVED: `set-coordination-remote` mutation-kind
   - ADDED: `readOnly` + `sourceMissionId` | `sourceRemote` + `sourceBranch` + `pullCadence` (reader-mission)
   - ADDED: `pushCadence` (writer-mission)
6. **npm dep**: `isomorphic-git` REMOVED (Path D2 hard-depend on `git` CLI binary instead)
7. **mission lifecycle**: `'leaving'` state retained as INERT-vestigial (legacy YAML-parse-tolerance); W8-new full-removal candidate

### Additive features

1. `msn join <writer-mission-id>` BRANCH-TRACKER reader-mission (Design v5.0 §2 row 4)
2. `msn watch --repo --branch` PERSISTENT-TRACKER reader-mission
3. `--start` flag on creation-verbs (sequential mc.create + mc.start composition)
4. Idempotent `mc.start` (W6-new slice iii)
5. Single-branch architecture (Flow B canonical; daemon commits direct to `mission/<id>`)
6. Symmetric push/pull cadence (`on-complete-only` / `every-Ns` / `on-demand`)
7. Force-push complete-flow (Fix #12)
8. Auto-close cascade (reader detects writer-terminated → readonly-completed)
9. NativeGitEngine + gitExec helper (Path D2 native git CLI substrate)
10. Bare-id default-to-show (`msn <id>` → `msn <id> show`)

### Version skip rationale

v1.1.0 vestigial code never publishes per Director-direct W2-extension re-scope: dual-branch architecture + multi-participant code paths from v1.1.0 wave-plan got replaced by v5.0 single-branch + independent-missions in W3-new. Single big v1.2.0 release reflects the architectural commit.

---

## §8 v1.x roadmap post-v1.2.0

### Post-v1.2.0 hotfix-roadmap

- bug-77/78/79/80 deferral-candidates (W8-new slice (iv) disposition; bug-80 pre-disposed to fix-in-W8-new)

### v1.2.x candidates

- idea-291: Hub-missioncraft integration end-to-end design (out-of-scope for v1.2.0; smart-attach + auto-discovery)
- idea-292: Hub thread-design review
- Forward-pointer ideas 287-290 (smart-attach + auto-discovery + operator-DX enrichments)
- `'leaving'` lifecycle-state full-removal (if no in-flight reader-mission YAMLs persist with this state across the v1.2.0 cut-over)

### v1.3+ candidates

- GitEngine contract extensions: `reset` / `diff` / `lsRemote` (post-mission-78 follow-on per (γ) disposition; deferred during mission-78)
- 3rd-party PROVIDER_REGISTRY extensibility (`Missioncraft.registerProvider`) if string-name-injection demand emerges (currently closed registry at v1; 3rd-party providers via SDK-constructor INSTANCE injection only)

---

## §9 Deprecation recommendation

`npm deprecate @apnex/missioncraft@1.0.x "v4.x multi-participant + IsomorphicGitEngine semantic; superseded by v1.2.0 v5.0 single-branch + Path D2 native-git substrate. Migration: drop coordinationRemote field + use msn join <writer-id> for BRANCH-TRACKER readers; replace IsomorphicGitEngine references with NativeGitEngine (sole canonical)."`

Cumulative deprecation history:
- v1.0.0-v1.0.5 deprecated during mission-77 (per §15.8 mission-77 closing audit)
- v1.0.6 deprecated post-v1.0.7 (scope-bound mission complete/abandon broken end-to-end; bug-73)
- v1.0.7 deprecated post-v1.2.0 ship (v4.x → v5.0 architectural transition; non-trivial migration)

---

## §10 Wave-by-wave retrospective notes

### W0 — substrate-detect + msn version extension

Foundation for Path D2: `git`/`gh` binary detection + version-show in `msn version` output. Argv-only discipline established at this wave (calibration #76 surfaced first instance: substrate-detect.ts initial impl used `child_process.exec(cmdString)`; switched to `execFile('git', argv, ...)` per Director-direct discipline).

### W1 — NativeGitEngine canonical build

4 slices: (i) gitExec helper + 6 foundational ops + slice-progression contract; (ii) 13 write-ops + lifecycle + remote-management + identity threading via env vars; (iii) advanced ops (merge / squashCommit / createBundle / restoreBundle); (iv) PROVIDER_REGISTRY entry + full-contract integration + W2 canonical-switch merge-parity verification.

Engineer-judgment moments: identity env-injection pattern at commit-firing-time (commitEnv helper) + commitToRef bypass-INDEX semantic via temp GIT_INDEX_FILE + push-impl default remote 'origin' when branch given without explicit remote (mid-slice bug surfaced + fixed).

### W2 — canonical-switch + Fix #3 + Fix #4

`gitEngineProviderName` default → 'native-git'; existing mission YAMLs with `'isomorphic-git'` continued to resolve via PROVIDER_REGISTRY (until W7-new removed the entry). Fix #3 + #4 surfaced via thread-543 architect-dogfood — both BOTH-engine substrate-defects (symmetric in NativeEng + IsoEng).

### W3-new — single-branch refactor + Fix #8 BLOCKER

Single-branch refactor: daemon commits direct to `mission/<id>`; drop `wip/<id>` sidecar. Fix #8 BLOCKER: squashCommit step-4 update-ref target was baseRef (main) instead of headRef (mission-branch) — dormant defect exposed by new code-path per `feedback_new_code_path_exposes_dormant_defects.md`.

### W4-new — reader-mission flavors + Fix #10 + #11

mission-config schema-v2 + reader-mission fields + `msn watch` PERSISTENT-TRACKER + `msn join` REPURPOSED as BRANCH-TRACKER + reader-daemon Loop B v5.0 (fetch+reset). Fix #10 + #11 surfaced via architect-dogfood: detectDaemonMode missionConfigPath layout + dispatch-layer transparency-gate.

Calibration #73 inward-application instance 1: slice (iv) Hub-policy deferral → idea-291.

### W5-new — push/pull cadence + Fix #12 BLOCKER

schema-v2 extension: symmetric `pushCadence` + `pullCadence` fields + writer-daemon push-cadence integration + reader-daemon Loop B pullCadence integration. Fix #12 BLOCKER: complete()'s pushWithRetry failed non-fast-forward because push-cadence had pre-pushed daemon-chain; force-push required. Fix #12.b: tsc-strict caught pushWithRetry options-type missing `force?: boolean` — calibration #76 ship-verify-language-vs-execution surfaced here (commit-message claimed "npm run build clean" but verification was NOT re-run).

### W6-new — hybrid CLI verb grammar

7+1 dev-slices spanning thread-550 (round-limit reached at 15/15) + thread-551 spillover (4/15 used). Hybrid grammar three-class taxonomy (Class 1 GLOBAL / Class 2 CREATION / Class 3 MISSION-TARGETED) per Design v5.0 §10.6. (γ) parser disposition: pattern-detect `msn-<8hex>` only at parse-time; dispatcher resolves slugs via mc.resolveMissionRef.

Calibration #73 inward-application instance 2: slice (v.b) verb-first-removal scope-gap extension. Instance 3: slice (v.b) update-exception structural-requirement → permanent PRESERVE at W7-new slice (v).

0 BLOCKERS at CLI-class — first wave with cleanup precedent confirmation.

### W7-new — IsoEng removal + v4.x carry-forward surface sweep

5 dev-slices (i+ii+iii batched + iv+v batched per Pattern A silent-batch ship-cadence): IsoEng provider deletion + mc.join SDK + msn leave/mc.leave + dead-code helpers + update-verb-first PRESERVE disposition fold. 0 BLOCKERS — cleanup-class lower-risk-than-substrate-waves + lower-risk-than-CLI-waves precedent CONFIRMED.

bug-80 filed during architect re-dogfood: PRE-EXISTING operator-DX gap (msn update <id> name <new> doesn't refresh .names/ symlink); NOT W7-new regression.

---

## §11 Closing recommendation

mission-78 is architecturally COMPLETE at apnex/missioncraft@2dd6637. Wave-arc delivers v5.0 substrate-design simplification end-to-end:

- Path D2 native-git substrate ✓
- Flow B canonical ✓
- Single-branch architecture ✓
- Independent missions ✓
- Reader-flavors (BRANCH-TRACKER + PERSISTENT-TRACKER) ✓
- Push/pull cadence ✓
- Force-push complete-flow ✓
- Auto-close cascade ✓
- Hybrid CLI grammar ✓
- v4.x carry-forward surface sweep ✓
- IsoEng removed ✓

**v1.2.0 ship-readiness gates remaining (W8-new):**

1. Memory + discipline-fold reconciliation batch (8 items) — Component D
2. Scenario doc reconciliation (Component C)
3. bug-77/78/79/80 disposition (engineer-judgment fix-now vs post-v1.2.0-hotfix)
4. Version bump 1.0.7 → v1.2.0 + lockfile
5. **Director Release-gate engagement** (architect-Director-bilateral; NOT waivable)
6. **Pre-publish wire-flow rehearsal protocol** (NOT waivable)
7. Tag-push v1.2.0 + release.yml npm publish
8. Wave-close + mission-78 lifecycle → 'completed'
9. Phase 10 Retrospective preparation

**Calibration carry-forward**:
- 3-tier risk-precedent (substrate > CLI > cleanup) — empirically confirmed across mission-78
- Calibration #73 inward-application 3-instance pattern — refined across W4-new + W6-new
- Calibration #76 ship-verify discipline working consistently — proven across W5-W7 arc
- Pattern A silent-batch ship-cadence — proven efficient for cleanup-class slices

---

— apnex-greg (engineer; agent-0d2c690e)
— Closing-audit doc shipped as W8-new slice (i) per mission-78 wave-close protocol; pending architect ratification + Director Release-gate engagement (slice vi) + tag-push + npm publish (slice viii)
