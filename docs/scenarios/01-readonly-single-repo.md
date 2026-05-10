# Scenario 01 — Read-Only Single-Repo Mission Workflow

**Demonstrates:** `create` → `start` (HTTPS clone) → `workspace` path-switching → `abandon`, against a real public repo. **Read-only boundary**: no `complete` (no remote-side writes); `coordinationRemote` unset.

**Status:** DRAFT — outputs to be captured post-execution.

---

## §1 Scope

This is the simplest meaningful missioncraft workflow:
- 1 mission, 1 repo, 1 writer-participant
- HTTPS clone from a public repo (no auth needed for `start`; `complete` would need write-access and is out-of-scope here)
- Default pluggable providers (no operator-config customization)
- Local-only daemon-watcher (no `coordinationRemote`; daemon's `pushWipToCoordRemote` no-ops per single-participant gating)
- Clean teardown via `abandon` (no `--retain`; no `--purge-config`)

**This scenario does NOT cover:**
- Mutations to the cloned working-tree (no `cd <workspace>` + edit + wip-commit-on-debounce demonstration)
- `complete` (read-write boundary; see `02-readwrite-single-repo.md`)
- Multi-repo missions (see `03-multi-repo-mission.md`)
- `--retain` / `--purge-config` flags (see `04-abandon-with-retain-and-purge.md`)
- Multi-participant join/leave (see `05-multi-participant-writer-reader.md`)
- Disk-failure recovery (see `06-disk-failure-recovery.md`)

---

## §2 Prerequisites

**Install** (global; one-time):
```bash
npm install -g @apnex/missioncraft
```

Verify:
```bash
which msn       # resolves to global bin
msn --version   # prints 1.0.0
```

**Optional env-var** (for deterministic principal-id; falls back to `git config user.email` if unset):
```bash
export MSN_PRINCIPAL_ID="<your-id>@<host>"
```

**Remote-access requirements:**
- `git clone https://github.com/apnex/missioncraft.git` must work (public-read; no auth needed)
- No write-access required for this scenario

**Default workspace location:** `~/.missioncraft/` (operator-config `workspaceRoot` field; override via `MSN_WORKSPACE_ROOT` env-var OR `msn config set workspaceRoot <path>`)

---

## §3 Setup

Clean any prior state:

```bash
rm -rf ~/.missioncraft
```

---

## §4 Workflow steps

### Step 1 — Verify CLI bootstrap

```bash
msn --version
```

Expected:
```
<output to be captured post-execution>
```

```bash
msn --help
```

Expected: grammar dispatch + verb-list including `create / list / show / start / apply / update / complete / abandon / tick / scope / workspace / config / join / leave / --help / --version`.

### Step 2 — Create mission

```bash
msn create --name test-readonly --repo https://github.com/apnex/missioncraft.git
```

Expected: returns `<mission-id> <name>` line; lifecycle initial = `configured` (auto-advance from `created` per single-repo-add).

Output:
```
<to be captured>
```

### Step 3 — Show mission (pre-start)

```bash
msn show <mission-id>
```

Expected: JSON with:
- `id` matching create-step output
- `name: "test-readonly"`
- `repos` array with 1 entry (name + url + base)
- `lifecycleState: "configured"`
- 4 pluggable provider-names at defaults: `identityProviderName: "local-git-config"` + `approvalProviderName: "trust-all"` + `storageProviderName: "local-filesystem"` + `gitEngineProviderName: "isomorphic-git"`

Output:
```json
<to be captured>
```

### Step 4 — List missions

```bash
msn list
```

Expected: tabular output with the mission row (`ID / NAME / LIFECYCLE / REPOS-COUNT`).

Output:
```
<to be captured>
```

### Step 5 — Start mission (substantive)

```bash
msn start <mission-id>
```

Performs the 9-step `configured → started` transition:
1. Validate pre-state (lifecycle `configured` + ≥1 repo)
2. Acquire mission-lock + per-repo locks
3. Allocate workspace per repo via `LocalFilesystemStorage`
4. Clone via `IsomorphicGitEngine` (HTTPS to `github.com/apnex/missioncraft.git`)
5. Spawn daemon-watcher (writer-mode; no coord-remote → no push activity)
6. Atomic-write lifecycle `'started'` via `_engineMutate` (the transient transition state per Design §2.4.1)
7. Release transition-pseudolock

Expected: silent success (no stdout); lifecycle advances to `started`.

Output:
```
<to be captured>
```

### Step 6 — Verify clone landed

```bash
ls ~/.missioncraft/missions/<mission-id>/missioncraft/ | head -10
```

Expected: real clone with `package.json` + `src/` + `dist/` + `README.md` + `docs/` + `test/` visible.

Output:
```
<to be captured>
```

### Step 7 — Verify daemon-process alive

```bash
ls ~/.missioncraft/locks/missions/ 2>&1
# Get daemon-pid from lockfile JSON:
DAEMON_PID=$(cat ~/.missioncraft/locks/missions/<mission-id>.<principal>.lock | jq -r '.pid // empty')
echo "daemon-pid=$DAEMON_PID"
ps -p $DAEMON_PID 2>&1
```

Expected: daemon-pid populated in lockfile; `ps -p $DAEMON_PID` shows live `node` process (the watcher-entry).

Output:
```
<to be captured>
```

### Step 8 — Test `msn workspace` path-switching (4 forms)

```bash
# Form 1: plain-id (single-repo auto-pick)
msn workspace <mission-id>
```

Expected: prints `~/.missioncraft/missions/<mission-id>/missioncraft` to stdout.

```bash
# Form 2: explicit repo-name
msn workspace <mission-id> missioncraft
```

Expected: same path as form 1.

```bash
# Form 3: coord-form <id>:<repo> (Rule N parser; substrate-coordinate addressing)
msn workspace <mission-id>:missioncraft
```

Expected: same path as forms 1/2.

```bash
# Form 4: coord-form with path-suffix
msn workspace <mission-id>:missioncraft/src
```

Expected: path joined with `/src` → `~/.missioncraft/missions/<mission-id>/missioncraft/src`.

```bash
# Shell-eval pattern (canonical operator-UX)
cd $(msn workspace <mission-id>) && pwd && ls | head -5
```

Expected: `cd` succeeds; `pwd` matches workspace path; `ls` shows clone contents.

Outputs:
```
<to be captured>
```

### Step 9 — Read-only boundary verification

Verify daemon does NOT push to remote (single-participant; `coordinationRemote` unset → `pushWipToCoordRemote` conditional-gates to no-op per W5b slice ii):

```bash
# Watch a wip-cadence window (~10s should be sufficient given default debounce + heartbeat)
sleep 10
# Verify no remote-side activity by checking the mission's wip-branch was NOT pushed
# (remote ls-remote should NOT show refs/heads/<repoName>/wip/<missionId>)
git ls-remote https://github.com/apnex/missioncraft.git 2>&1 | grep "wip/$<mission-id>" || echo "✓ no remote wip-branch (read-only boundary preserved)"
```

Expected: no remote wip-branch ref; read-only boundary preserved.

Output:
```
<to be captured>
```

### Step 10 — Abandon mission

```bash
msn abandon <mission-id> "readonly scenario teardown"
```

Performs the 7-step abandon-flow:
1. Final cadence-tick → mark `abandonProgress: 'tick-fired'`
2. SIGTERM daemon-watcher (60s timeout + SIGKILL fallback) → mark `'daemon-killed'`
3. Atomic-write `abandonMessage` (lifecycle stays `'in-progress'` per v3.5 fold) → mark `'message-persisted'`
4. Release mission-lock + repo-locks → mark `'locks-released'`
5. Per-repo local-branch cleanup → mark `'branches-cleaned'`
6. Atomic single-lock-cycle: workspace destroy (no `--retain`) + atomic-write lifecycle `'abandoned'` + `abandonProgress: 'workspace-handled'`
7. (skipped — no `--purge-config`)

Expected: silent success; lifecycle advances to `abandoned`.

Output:
```
<to be captured>
```

### Step 11 — Show mission (post-abandon)

```bash
msn show <mission-id>
```

Expected: JSON shows:
- `lifecycleState: "abandoned"`
- `abandonMessage: "readonly scenario teardown"`
- `abandonProgress: "workspace-handled"` (terminal abandon-progress)

Output:
```json
<to be captured>
```

### Step 12 — Verify workspace cleaned + daemon dead

```bash
ls ~/.missioncraft/missions/<mission-id>/ 2>&1 || echo "✓ workspace removed"
ps -p $DAEMON_PID 2>&1 || echo "✓ daemon process exited"
ls ~/.missioncraft/config/<mission-id>.yaml 2>&1
```

Expected:
- Workspace directory `missions/<mission-id>/` removed (default abandon behavior; no `--retain`)
- Daemon process exited (SIGTERM at abandon Step 2)
- Config file `config/<mission-id>.yaml` PRESERVED (no `--purge-config`)

Output:
```
<to be captured>
```

### Step 13 — Resolve `msn workspace` post-abandon (error path)

```bash
msn workspace <mission-id> 2>&1
```

Expected: error message indicating mission is terminal-state (workspace destroyed). Operator-recovery path: re-create mission OR start from saved config.

Output:
```
<to be captured>
```

---

## §5 Cleanup (post-scenario teardown)

Optional full reset:

```bash
rm -rf ~/.missioncraft
```

Removes all mission configs + remaining workspaces + lockfiles.

---

## §6 What this scenario covers vs doesn't

**Covers:**
- ✓ Basic CLI bootstrap (install + version + help)
- ✓ Mission create (single-repo)
- ✓ Mission show + list (operator-visible state)
- ✓ Mission start (clone + daemon-spawn + lifecycle advance)
- ✓ Workspace path-switching (4 forms incl. substrate-coordinate Rule N)
- ✓ Read-only boundary (no remote writes; daemon conditional-gating)
- ✓ Mission abandon (7-step cleanup; daemon SIGTERM)
- ✓ Post-abandon state verification

**Does NOT cover:**
- `complete` (read-write boundary; see scenario 02)
- Working-tree mutations + wip-commit-on-debounce daemon-watcher cadence
- Multi-repo missions (see 03)
- `--retain` / `--purge-config` flags (see 04)
- Multi-participant (see 05)
- Disk-failure recovery (see 06)

---

## §7 Companion scenarios (forward-pointers)

- **02-readwrite-single-repo.md** — full `complete` flow with push + PR-open against owned repo
- **03-multi-repo-mission.md** — single mission spanning 2+ repos
- **04-abandon-with-retain-and-purge.md** — `--retain` workspace preservation + `--purge-config` permanent removal
- **05-multi-participant-writer-reader.md** — `msn join` + reader-daemon Loop B + cross-host coordination via `--coord-remote`
- **06-disk-failure-recovery.md** — bundle-ops restore from snapshotRoot (`rm -rf workspaceRoot` recovery)
- **07-substrate-coordinate-addressing.md** — Rule N coord-form patterns for multi-repo missions

---

## §8 Execution log

**Status:** PENDING (awaiting `msn` global install)
**Executed:** _<date/time>_
**Executor:** _<who ran it>_
**Outcome:** _<all-pass / per-step ✓-✗ table>_
**Notes:** _<deviations from expected; substrate-currency drifts surfaced>_
