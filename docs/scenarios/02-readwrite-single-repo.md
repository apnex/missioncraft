# Scenario 02 — Read-Write Single-Repo Mission Workflow (Complete Flow)

**Demonstrates:** `create` → `start` → **transparent commit/branches via daemon-watcher** → `complete` (push + PR-open) → teardown. **Read-write boundary**: full `complete` flow against a writeable repo; demonstrates that **operator never types `git add` / `git commit` / `git branch` / `git push`** — the daemon handles all commit/branch mechanics transparently while operator-engineer just edits files.

**Status:** DRAFT — structure ratified; expected outputs conjectural until executed against `@apnex/missioncraft@1.0.3` + target sandbox repo. Ratification pending v1.0.3 ship + scenario re-execution.

**Target version**: `@apnex/missioncraft@1.0.3` (post-bug-64 UX polish; post-idea-267 daemon-orphan fix; post-idea-268 workspace terminal-state-guard; post-idea-269 `msn cd` verb).

**Target sandbox repo**: `<TBD with Director>` — placeholder; needs writeable target with PR-open capability + safe-to-pollute branch policy. Recommend creating `apnex/missioncraft-scenario-sandbox` as ephemeral throwaway with `main` branch + force-reset capability between scenario runs.

---

## §1 Scope

This is the canonical operator-engineer workflow:
- 1 mission, 1 repo, 1 writer-participant (no multi-participant; that's scenario 04)
- HTTPS clone from a writeable repo (auth via local `gh` CLI OR git credential helper)
- Default pluggable providers (no operator-config customization)
- Local-only daemon-watcher (no `coordinationRemote`; single-participant gating)
- **Demonstrates transparency**: engineer edits files in workspace as normal working-tree; daemon handles all git mechanics; `complete` publishes PR with squashed commit
- Full PR-open + (optional) auto-merge teardown via `complete`
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
msn --version   # prints 1.0.3
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
msn start $MISSION_ID
```

Expected (post-bug-64 item 6 stdout):
```
started mission <id> ('scenario-02-readwrite'); workspace at ~/.missioncraft/missions/<id>/<sandbox-repo>; daemon-pid <pid>
```

### Step 4 — Jump into workspace (transparency-demo entry)

```bash
msn cd $MISSION_ID
```

Operator is now `cd`'d into the workspace directory (post-idea-269 v1.0.3 `cd` verb). Verify:
```bash
pwd                                              # should print workspace path
git status                                       # operator sees the standard git working-tree
git log --oneline -5                             # mission's base-branch commits visible
git branch -a | head -10                         # branches visible (incl. any wip/ already?)
```

**Transparency point**: this is a normal git working-tree from operator-engineer's perspective. The daemon-watcher is running in the background (we'll observe its mechanics later) but operator interacts only with the workspace.

### Step 5 — First edit (operator types content; daemon handles commit)

Make a meaningful change. For demonstration, add a small file:

```bash
echo "scenario-02 transparency demo line 1" > scenario-02-trace.md
ls scenario-02-trace.md                          # confirms file written
```

**Key invariant**: operator does NOT run `git add`, `git commit`, or `git branch`. The daemon detects the working-tree change via chokidar fs-watch + debounces + creates a wip-commit automatically.

### Step 6 — Observe daemon's automatic wip-commit (debounce window)

Default daemon debounce is ~3-5s. Wait:
```bash
sleep 10
git log --oneline --all -10
git branch -a | grep wip
```

Expected: a new commit on a `wip/<mission-id>` (or similar; engine-impl-specific naming) branch with the change. Operator's `main` branch HEAD has NOT moved (still at base; the workspace `HEAD` may be detached or on a per-mission integration branch — engine-impl-specific).

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
msn show $MISSION_ID
```

Expected:
- `lifecycleState: "in-progress"` (advanced from `started` via daemon-tick)
- Some operator-readable trace of daemon activity (precise schema TBD — may be in lockfile / daemon-state.yaml; not necessarily surfaced by `show`)

```bash
# Daemon health (post-bug-64 stdout exposed daemon-pid at start; can also re-source from lockfile):
DAEMON_PID=$(jq -r '.pid' ~/.missioncraft/locks/missions/$MISSION_ID.lock)
ps -p $DAEMON_PID                                # daemon alive
```

### Step 9 — Complete mission (substantive: squash + push + PR-open)

```bash
msn complete $MISSION_ID "scenario 02 transparency demo — added trace file"
```

Performs the 8-step `in-progress → completed` transition (engine-impl-specific):
1. Final cadence-tick → mark `publishStatus: 'tick-fired'`
2. SIGTERM daemon-watcher (graceful with SIGKILL fallback)
3. Squash wip-commits into single commit with operator-supplied message
4. Push squash-commit to remote feature-branch (e.g., `mission/<mission-id>` or `<mission-name>`)
5. Open PR from feature-branch → base-branch via GitHub API (or `gh pr create`)
6. Atomic-write `publishedPRs` array + `publishMessage` (immutable post-publish)
7. Lifecycle atomic-advance to `'completed'`
8. Release mission-lock + repo-locks

Expected (post-bug-64 item 6+7 stdout extension to `complete`):
```
completed mission <id> ('scenario-02-readwrite'); PRs opened: <https://github.com/<sandbox-org>/<sandbox-repo>/pull/<N>>
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
msn show $MISSION_ID
```

Expected:
- `lifecycleState: "completed"`
- `publishMessage: "scenario 02 transparency demo — added trace file"`
- `publishedPRs: [{repoName, prUrl, prNumber}]`
- `publishStatus: "published"` (terminal)

### Step 12 — Teardown (workspace cleanup + lifecycle terminal)

By default, `complete` does NOT destroy the workspace (operator may want to inspect post-publish). To clean up:

```bash
msn abandon $MISSION_ID "scenario 02 teardown post-complete"
```

Wait — this is a state-transition question. Post-`completed`, can `abandon` be called? Per Design §2.5 state-restriction matrix, `completed` is terminal; `abandon` cannot transition from `completed`. Operator must manually `rm -rf` the workspace:

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

## §A Flag-variants sub-section (`--retain` + `--purge-config`)

### A.1 `complete --purge-config`

```bash
msn complete $MISSION_ID "complete + purge" --purge-config
```

Removes mission-config YAML at terminal state; operator cannot re-`start` later (full cleanup).

### A.2 `abandon --purge-config`

```bash
msn abandon $MISSION_ID "abandon + purge" --purge-config
```

Same effect for abandon-flow.

### A.3 `start --retain`

```bash
msn start $MISSION_ID -f <path-to-config.yaml> --retain
```

Per CLI help (`msn start [--retain]`) — retains existing workspace contents at start-time rather than fresh-clone. Used for resume-after-disk-failure recovery scenarios (overlaps with bundle-ops restore in scenario 04).

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
- ✓ Mission create + start (re-validated against v1.0.3 CLI-UX)
- ✓ `msn cd` quick-jump verb (post-idea-269)
- ✓ **Transparent commit mechanics** — operator never runs `git add` / `git commit` / `git branch`
- ✓ Daemon-watcher debounce + wip-commit cadence behavior visible
- ✓ Multi-edit cadence demonstration
- ✓ `msn complete` 8-step publish-flow with PR-open
- ✓ PR-state verification via `gh pr view`
- ✓ Mission terminal-state observation
- ✓ Manual workspace cleanup post-complete
- ✓ Flag-variants (`--retain` / `--purge-config`) covered in §A

**Does NOT cover:**
- Multi-repo missions (see scenario 03)
- Multi-participant `join`/`leave` with coord-remote (see scenario 04)
- Disk-failure bundle-ops recovery (see scenario 04 durability sub-section)
- Conflict-resolution during `complete` if base-branch moved during mission (engine-impl-specific; deferred to scenario 04 cross-host coordination)
- Auto-merge integration (operator must merge PR manually; auto-merge config is GitHub-side concern)

---

## §7 Companion scenarios (forward-pointers)

- **01-readonly-single-repo.md** — predecessor; read-only workflow without `complete`
- **03-multi-repo-mission.md** — single mission spanning 2+ repos; Rule N coord-form path-switching
- **04-multi-participant-writer-reader.md** — `msn join` + reader-daemon Loop B + cross-host coordination via `--coord-remote`; durability-mode sub-section covers disk-failure recovery

---

## §8 Execution log

**Status:** DRAFT
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
