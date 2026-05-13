# Scenario 02 — Read-Write Single-Repo Mission Workflow (Complete Flow)

**Demonstrates:** `create` → `start` → **transparent commit via daemon-watcher (Flow B canonical)** → `<id> complete` (squash + force-push to upstream main) → teardown. **Read-write boundary**: full `complete` flow against a writeable repo; demonstrates v5.0 Flow B canonical that **operator never types `git add` / `git commit` / `git branch` / `git push`** — the daemon handles all commit/branch mechanics transparently while operator-engineer just edits files.

**Status:** RE-RATIFIED at v1.2.0 (mission-78 W8-new slice (iii) Component C surgical update). Structure ratified; expected outputs to be regenerated at slice (vii) pre-publish wire-flow rehearsal against apnex/missioncraft-sandbox real upstream.

**Target version**: `@apnex/missioncraft@1.2.0` (v5.0 substrate-design simplification: Path D2 native-git + Flow B canonical + single-branch + hybrid CLI grammar + Fix #12 force-push complete-flow + reader-flavors).

**Target sandbox repo**: `apnex/missioncraft-sandbox` — architect-dogfood target throughout mission-78 W3-W7 architect-dogfood cycles; sandbox is real upstream with safe-to-force-reset main branch + write-access via local `gh` CLI.

---

## §0 v1.2.0 substrate-update — what's different from v1.0.x

Per [scenario 01 §0](01-readonly-single-repo.md#0-v120-substrate-update--whats-different-from-v10x): Path D2 native-git + Flow B canonical + hybrid CLI grammar three-class taxonomy + bare-id default-to-show + coord-remote primitive REMOVED + scenarios 03/04/05/06 forward-pointers.

**Scenario-02-specific v1.2.0 substrate updates**:

1. **Flow B canonical** (mission-78 W3-new single-branch): daemon commits direct to `mission/<id>` branch via chokidar Loop A debounce-detection + `commitToRef` bypass-INDEX semantic. The `wip/<id>` sidecar branch from v1.0.x is DROPPED.
2. **`pushCadence` config replaces v4.x coord-remote** (mission-78 W5-new slice ii per Design v5.0 §10.2): `'on-complete-only'` (default) → no upstream push during `start..complete` window; `'every-Ns'` → cadence-driven incremental push; `'on-demand'` → explicit-only.
3. **Fix #12 force-push complete-flow** (mission-78 W5-new): `<id> complete` squash-rewrites `mission/<id>` branch + force-pushes to upstream. Required when `pushCadence: 'every-Ns'` pre-pushed daemon-chain (squash-rewrite is non-FF vs upstream tip).
4. **Auto-close cascade** (mission-78 W4-new): when writer `complete`s, downstream BRANCH-TRACKER reader-missions detect writer-terminated via Loop B + cascade to `readonly-completed` per Design v5.0 §2 row 4.

---

## §1 Scope

This is the canonical operator-engineer workflow:
- 1 mission, 1 repo, 1 writer-participant (no multi-participant; that's scenario 04 v1.2.x candidate)
- HTTPS clone from a writeable repo (auth via local `gh` CLI OR git credential helper)
- Default pluggable providers (no operator-config customization)
- Local-only daemon-watcher with `pushCadence` config (default `'on-complete-only'` for single-participant; `'every-Ns'` cadence-driven for incremental push; `'on-demand'` explicit-only per Design v5.0 §10.2)
- **Demonstrates v5.0 Flow B canonical transparency**: engineer edits files in workspace as normal working-tree; daemon handles all git mechanics including stage + commit (operator does NOT type `git add` or `git commit`); `<id> complete` squash + force-push (Fix #12) to upstream main
- Full upstream-push teardown via `<id> complete` (`gh-cli` RemoteProvider opens PR if configured; `pure-git` mode pushes only)
- Mission-config preserved post-complete by default (no `--purge-config`)

**This scenario does NOT cover:**
- `--retain` workspace preservation post-complete/abandon (see §A flag-variants sub-section)
- `--purge-config` mission-config permanent removal (see §A flag-variants sub-section)
- Multi-repo missions (see scenario 03)
- Multi-participant join/leave with coord-remote (see scenario 04)
- Disk-failure recovery via bundle-ops restore (see scenario 04 durability sub-section)

---

## §2 Prerequisites

**Install** (global; one-time):
```bash
npm install -g @apnex/missioncraft
msn --version   # prints 1.2.0
msn version     # also shows substrate detection (git + gh CLI versions; Path D2 hard-depend)
```

**Shell-function init** (one-time per shell; required for `msn cd` per idea-269 v1.0.3 feature):
```bash
eval "$(msn shell-init bash)"   # OR: zsh / fish per shell
# Add to ~/.bashrc to persist across sessions
```

**Write-access requirements:**
- Target repo must allow PR-open from your principal-identity
- Either:
  - `gh auth status` succeeds (gh CLI authenticated), OR
  - Git credential helper configured with HTTPS token (e.g. `~/.git-credentials` populated)
- Target repo must NOT have branch-protection requiring co-approval if you intend to test auto-merge (or accept that PR will be left open for manual merge)

**Optional env-var** (for deterministic principal-id):
```bash
export MSN_PRINCIPAL_ID="<your-id>@<host>"
```

**Default workspace location:** `~/.missioncraft/` (per scenario 01).

---

## §3 Setup

Clean any prior state:
```bash
rm -rf ~/.missioncraft
```

Verify sandbox-repo write-access (do NOT proceed if this fails):
```bash
gh repo view <sandbox-org>/<sandbox-repo> --json viewerPermission --jq .viewerPermission
# Expected: "ADMIN" | "MAINTAIN" | "WRITE"
```

---

## §4 Workflow steps

### Step 1 — Bootstrap (assumed clean per §3)

```bash
msn help
```

Expected: full verb-list (post-bug-64 item 8 — `help` verb now first-class).

### Step 2 — Create mission against sandbox repo

```bash
msn create --name scenario-02-readwrite --repo https://github.com/<sandbox-org>/<sandbox-repo>.git
```

Expected: `<mission-id> scenario-02-readwrite` line; lifecycle `configured`. **Capture mission-id**:
```bash
MISSION_ID=<paste-id-here>
```

### Step 3 — Start mission (clone + daemon-spawn)

```bash
msn $MISSION_ID start                         # v1.2.0 id-first form
# OR via --start flag at create-time (W6-new slice iii sequential composition):
# msn create --name scenario-02-readwrite --repo https://... --start
```

Expected (post-bug-64 item 6 stdout):
```
started mission <id> ('scenario-02-readwrite'); workspace at ~/.missioncraft/missions/<id>/<sandbox-repo>; daemon-pid <pid>
```

### Step 4 — Jump into workspace (transparency-demo entry)

```bash
msn $MISSION_ID cd                            # v1.2.0 id-first form
# OR coord-form (preserved verb-first per W6-new exception):
# msn cd $MISSION_ID:<repo-name>
```

Operator is now `cd`'d into the workspace directory (per idea-269 `cd` verb + shell-init wrapper). Verify:
```bash
pwd                                              # should print workspace path
git status                                       # operator sees the standard git working-tree
git log --oneline -5                             # mission's base-branch commits visible
git branch -a | head -10                         # branches visible (mission/<id> direct under v5.0 single-branch; no wip/ sidecar per W3-new)
```

**Transparency point**: this is a normal git working-tree from operator-engineer's perspective. The daemon-watcher is running in the background (we'll observe its mechanics later) but operator interacts only with the workspace.

### Step 5 — First edit (operator types content; daemon handles commit)

Make a meaningful change. For demonstration, add a small file:

```bash
echo "scenario-02 transparency demo line 1" > scenario-02-trace.md
ls scenario-02-trace.md                          # confirms file written
```

**Key invariant** (Flow B canonical at v1.2.0): operator does NOT run `git add`, `git commit`, or `git branch`. The daemon detects the working-tree change via chokidar fs-watch + debounces + creates a commit automatically via `commitToRef` bypass-INDEX semantic to `mission/<id>` branch (v5.0 single-branch).

### Step 6 — Observe daemon's automatic commit (debounce window)

Default daemon debounce is ~3-5s. Wait:
```bash
sleep 10
git log --oneline --all -10
git branch -a | grep mission
```

Expected: a new commit on `mission/<mission-id>` branch with the change (v5.0 single-branch architecture; pre-v5.0 wip/<id> sidecar was DROPPED at W3-new). Operator's `main` branch HEAD has NOT moved (still at base; mission-branch is the staging branch for the eventual squash + force-push at `complete`).

**Transparency point #1**: operator never typed `git add` or `git commit`. The daemon did it.

### Step 7 — Second edit (multi-commit demonstration)

```bash
echo "transparency demo line 2 — second edit" >> scenario-02-trace.md
sleep 10
git log --oneline --all -10
```

Expected: 2 commits on the wip-branch now; operator never invoked git directly.

### Step 8 — Inspect mission state (operator-visible)

```bash
msn $MISSION_ID show                          # v1.2.0 id-first form
```

Expected:
- `lifecycleState: "in-progress"` (advanced from `started` via daemon-tick)
- Some operator-readable trace of daemon activity (precise schema TBD — may be in lockfile / daemon-state.yaml; not necessarily surfaced by `show`)

```bash
# Daemon health (post-bug-64 stdout exposed daemon-pid at start; can also re-source from lockfile):
DAEMON_PID=$(jq -r '.pid' ~/.missioncraft/locks/missions/$MISSION_ID.lock)
ps -p $DAEMON_PID                                # daemon alive
```

### Step 9 — Complete mission (substantive: squash + force-push to upstream main)

```bash
msn $MISSION_ID complete "scenario 02 transparency demo — added trace file"     # v1.2.0 id-first form
```

Performs the v1.2.0 complete-flow (Fix #12 force-push for post-push-cadence squash-rewrite per W5-new):
1. Final cadence-tick → mark `publishStatus: 'tick-fired'`
2. SIGTERM daemon-watcher (graceful with SIGKILL fallback)
3. Squash mission/<id> branch commits into single commit with operator-supplied message (commitToRef bypass-INDEX semantic; Fix #4)
4. Force-push squash-commit to upstream main (Fix #12; required when `pushCadence: 'every-Ns'` pre-pushed daemon-chain → squash-rewrite is non-FF vs upstream tip)
5. (`gh-cli` RemoteProvider) open PR from mission-branch → base-branch via `gh pr create`; (`pure-git` mode) push only — no PR opens
6. Atomic-write `publishStatus` + `publishMessage` (immutable post-publish per `feedback_test_assertion_too_permissive_regex.md` specific-state assertion)
7. Lifecycle atomic-advance to `'completed'`
8. Release mission-lock + repo-locks
9. Auto-close cascade: any downstream BRANCH-TRACKER reader-mission detects writer-terminated via Loop B fetch + cascades to `readonly-completed` per Design v5.0 §2 row 4

Expected (post-bug-64 item 6+7 stdout extension to `complete`):
```
completed mission <id> ('scenario-02-readwrite'); upstream main → <squashed-commit-sha>
# (or with gh-cli RemoteProvider: + 'PR opened: https://github.com/<sandbox-org>/<sandbox-repo>/pull/<N>')
```

### Step 10 — Verify PR opened on remote

```bash
gh pr view <pr-url-from-step-9> --json url,title,headRefName,baseRefName,state,author
```

Expected:
- `state: "OPEN"` (or `MERGED` if auto-merge wired)
- `title` matches the operator-supplied complete-message
- `headRefName` = mission-feature-branch
- `baseRefName` = `main`
- `author.login` matches operator's GitHub identity

```bash
# Verify base-branch (main) NOT touched directly
git ls-remote https://github.com/<sandbox-org>/<sandbox-repo>.git refs/heads/main
# Compare with pre-mission HEAD: should be unchanged unless PR was auto-merged separately
```

**Transparency point #2**: operator never typed `git push`, never opened a PR via `gh pr create`, never created a feature-branch name. All mechanics handled by `complete`.

### Step 11 — Verify mission terminal state

```bash
msn $MISSION_ID show                          # v1.2.0 id-first form
```

Expected:
- `lifecycleState: "completed"`
- `publishMessage: "scenario 02 transparency demo — added trace file"`
- `publishStatus: { <repo-name>: "succeeded" }` (W5-new specific-state assertion per `feedback_test_assertion_too_permissive_regex.md` calibration)
- `publishedRefs` array with upstream commit-sha (`pure-git` mode) OR `publishedPRs` array (`gh-cli` RemoteProvider mode)

### Step 12 — Teardown (workspace cleanup + lifecycle terminal)

By default, `complete` does NOT destroy the workspace (operator may want to inspect post-publish). Post-`completed`, `abandon` cannot transition (terminal-state per Design §2.5 state-restriction matrix). Operator must manually `rm -rf` the workspace:

```bash
rm -rf ~/.missioncraft/missions/$MISSION_ID/
```

OR use `complete --purge-config` at Step 9 to fold cleanup into the complete-action (see §A flag-variants).

### Step 13 — Verify cleanup

```bash
ls ~/.missioncraft/missions/$MISSION_ID/ 2>&1 || echo "✓ workspace removed"
ls ~/.missioncraft/config/$MISSION_ID.yaml                # config preserved (no --purge-config)
```

Expected:
- Workspace removed ✓
- Config preserved (operator can re-`start` to re-clone) ✓
- Daemon already SIGTERMed at Step 9 complete

---

## §A Flag-variants sub-section (`--retain` + `--purge-config`; v1.2.0 id-first form)

### A.1 `complete --purge-config`

```bash
msn $MISSION_ID complete "complete + purge" --purge-config       # v1.2.0 id-first form
```

Removes mission-config YAML at terminal state; operator cannot re-`start` later (full cleanup).

### A.2 `abandon --purge-config`

```bash
msn $MISSION_ID abandon "abandon + purge" --purge-config         # v1.2.0 id-first form
```

Same effect for abandon-flow.

### A.3 `start --retain`

```bash
msn $MISSION_ID start --retain                                    # v1.2.0 id-first form (no -f path; use create with -f)
# OR file-based (start verb-spec usageOverride per W6-new slice vi):
# msn start -f <path-to-config.yaml> --retain
```

Per CLI help (`msn start [--retain]`) — retains existing workspace contents at start-time rather than fresh-clone. Used for resume-after-disk-failure recovery scenarios (overlaps with bundle-ops restore via `mc.snapshotMissionBranches` + `mc.restoreFromSnapshot` per W6 slice v).

---

## §5 Cleanup (full scenario teardown)

```bash
rm -rf ~/.missioncraft
```

Removes all mission configs + remaining workspaces + lockfiles.

If you ran multiple scenarios + want to keep the sandbox repo clean for next run:
```bash
# At sandbox-repo: force-reset to clean state if branch-protection allows
gh api -X PATCH repos/<sandbox-org>/<sandbox-repo>/branches/main --field "protected=false" 2>/dev/null
git push --force-with-lease <sandbox-repo> <known-good-commit>:main
```

---

## §6 What this scenario covers vs doesn't

**Covers:**
- ✓ Basic CLI bootstrap (assumed clean from scenario 01 baseline)
- ✓ Mission create + start (v1.2.0 hybrid grammar id-first form + `--start` flag composition)
- ✓ `msn cd` quick-jump verb (per idea-269 + W6-new id-first form)
- ✓ **Transparent commit mechanics (v5.0 Flow B canonical)** — operator never runs `git add` / `git commit` / `git branch`
- ✓ Daemon-watcher debounce + commit-on-debounce cadence behavior (mission/<id> single-branch direct per W3-new)
- ✓ Multi-edit cadence demonstration
- ✓ `<id> complete` v1.2.0 publish-flow with squash + Fix #12 force-push to upstream main
- ✓ PR-state verification via `gh pr view` (`gh-cli` RemoteProvider mode); upstream commit-sha verification (`pure-git` mode)
- ✓ Mission terminal-state observation (publishStatus specific-state assertion per `feedback_test_assertion_too_permissive_regex.md`)
- ✓ Auto-close cascade demonstration (downstream BRANCH-TRACKER reader cascades to readonly-completed)
- ✓ Manual workspace cleanup post-complete
- ✓ Flag-variants (`--retain` / `--purge-config`) covered in §A

**Does NOT cover** (forward-pointers; v1.2.x candidates):
- Multi-repo missions (scenario 03 candidate)
- Reader-mission flavors (`msn join` BRANCH-TRACKER + `msn watch` PERSISTENT-TRACKER per Design v5.0 §2 row 4 — substantial rewrite of pre-v5.0 v4.x multi-participant model; scenario 04 candidate)
- Disk-failure bundle-ops recovery via `mc.snapshotMissionBranches` + `mc.restoreFromSnapshot` (scenario 04 durability sub-section candidate)
- Conflict-resolution during `complete` if base-branch moved during mission (engine-impl-specific)
- Auto-merge integration (operator must merge PR manually; auto-merge config is GitHub-side concern)

---

## §7 Companion scenarios (forward-pointers)

- **01-readonly-single-repo.md** — predecessor; read-only workflow without `complete` (v1.2.0 RE-RATIFIED)
- **03-multi-repo-mission.md** (v1.2.x candidate; not shipped at v1.2.0) — single mission spanning 2+ repos; coord-form path-switching
- **04-multi-participant-writer-reader.md** (v1.2.x candidate; SUBSTANTIAL REWRITE pending — v5.0 architecture supersedes v4.x multi-participant model) — reader-mission flavors `msn join <writer-mission-id>` BRANCH-TRACKER + `msn watch --repo --branch` PERSISTENT-TRACKER per Design v5.0 §2 row 4; reader-daemon Loop B v5.0 (direct fetch+reset from source-remote); auto-close cascade on writer-terminated; durability-mode sub-section covers disk-failure recovery via `mc.snapshotMissionBranches` + `mc.restoreFromSnapshot`

---

## §8 Execution log

**Status:** RE-RATIFIED at v1.2.0 (mission-78 W8-new slice (iii) Component C surgical update; commands updated to W6-new id-first form; coord-remote refs replaced with `pushCadence` semantics per Design v5.0 §10.2; `pushWipToCoordRemote` no-op refs replaced with `pushCadence: 'on-complete-only'` default; v1.2.0 substrate-update §0 added with Path D2 + Flow B + hybrid grammar + reader-flavors cross-refs; Fix #12 force-push complete-flow documented; auto-close cascade documented; scenario 04 future SUBSTANTIAL REWRITE per v5.0 architecture noted). FULL EXECUTION RE-RATIFICATION pending pre-publish wire-flow rehearsal (W8-new slice (vii)). Architect-dogfood at mission-78 W3-W7 cycles already exercised this scenario's substrate end-to-end at apnex/missioncraft-sandbox.

**Status (legacy):** DRAFT
**Target version:** `@apnex/missioncraft@1.0.3` (post-v1.0.3 patch cycle)
**Target sandbox repo:** `<TBD with Director>` — placeholder pending decision
**Outputs:** conjectural; will be filled during ratification execution

Ratification gates (architect-side):
1. v1.0.3 ships + scenario 01 re-ratified (output deltas captured)
2. Target sandbox repo confirmed + write-access verified
3. Scenario 02 execution end-to-end against v1.0.3 + sandbox repo
4. Outputs captured + step expectations corrected against actual behavior
5. Status flips: DRAFT → RATIFIED

**Open questions for ratification execution**:
- Q1: What does `msn show` reveal during in-progress state for daemon-state? (Step 8)
- Q2: Does workspace `HEAD` go to detached or to a per-mission integration-branch during `start()`? (Step 4)
- Q3: What's the exact wip-branch naming convention? (Step 6)
- Q4: Does `complete` push to a feature-branch named after mission-id, mission-name, or something else? (Step 9)
- Q5: Does `complete` use `gh pr create` (requires gh CLI) or GitHub API directly (requires token only)? (Step 9)

These will be resolved during ratification by reading actual SDK behavior + capturing outputs.

— Lily (architect; agent-40903c59)
