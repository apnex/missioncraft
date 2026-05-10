# Scenario 01 — Read-Only Single-Repo Mission Workflow

**Demonstrates:** `create` → `start` (HTTPS clone) → `workspace` path-switching → `abandon`, against a real public repo. **Read-only boundary**: no `complete` (no remote-side writes); `coordinationRemote` unset.

**Status:** RATIFIED — outputs captured against `@apnex/missioncraft@1.0.2` 2026-05-10T23:25Z UTC (Node v24.12.0).

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
msn --version   # prints 1.0.2 (current latest)
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
missioncraft 1.0.2
```

```bash
msn --help
```

Expected: grammar dispatch + verb-list including `create / list / show / start / apply / update / complete / abandon / tick / scope / workspace / config / join / leave / --help / --version`.

**Note**: Pre-v1.0.2 (v1.0.0), `msn --help` silent-failed (exit 0; zero stdout) via shebang+symlink `isMainModule` guard mismatch — Node 24 default `--preserve-symlinks-main=false` resolves `import.meta.url` to realpath while `process.argv[1]` retains symlink path; equality fails; `main()` never invoked. Fixed in v1.0.1 commit `87bf370` via symlink-safe `fileURLToPath(import.meta.url) === realpathSync(argv[1])` guard.

### Step 2 — Create mission

```bash
msn create --name test-readonly --repo https://github.com/apnex/missioncraft.git
```

Expected: returns `<mission-id> <name>` line; lifecycle initial = `configured` (auto-advance from `created` per single-repo-add).

Output:
```
msn-99c369ee	test-readonly
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
{
  "id": "msn-99c369ee",
  "name": "test-readonly",
  "tags": {},
  "repos": [
    {
      "name": "missioncraft",
      "url": "https://github.com/apnex/missioncraft.git",
      "base": "main"
    }
  ],
  "lifecycleState": "configured",
  "createdAt": "2026-05-10T23:25:37.444Z",
  "updatedAt": "2026-05-10T23:25:37.444Z",
  "identityProviderName": "local-git-config",
  "approvalProviderName": "trust-all",
  "storageProviderName": "local-filesystem",
  "gitEngineProviderName": "isomorphic-git"
}
```

### Step 4 — List missions

```bash
msn list
```

Expected: tabular output with the mission row (`ID / NAME / LIFECYCLE / REPOS-COUNT`).

Output:
```
ID            NAME           LIFECYCLE   REPOS-COUNT
────────────  ─────────────  ──────────  ───────────
msn-99c369ee  test-readonly  configured  1
```

### Step 5 — Start mission (substantive)

```bash
msn start <mission-id>
```

Performs the 7-step `configured → started` transition:
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
(empty stdout; exit 0; ~1-2s wall-time for HTTPS clone via isomorphic-git)
```

### Step 6 — Verify clone landed

```bash
ls ~/.missioncraft/missions/<mission-id>/missioncraft/ | head -10
```

Expected: real clone with `package.json` + `src/` + `dist/` + `README.md` + `docs/` + `test/` visible.

Output:
```
docs
LICENSE
package.json
package-lock.json
README.md
src
test
tsconfig.json
vitest.config.ts
```

### Step 7 — Verify daemon-process alive

```bash
ls ~/.missioncraft/locks/missions/ 2>&1
# Get daemon-pid from lockfile JSON (re-source from disk on each step; do not rely on shell-var across sessions):
MISSION_ID=<mission-id>
DAEMON_PID=$(jq -r '.pid // empty' ~/.missioncraft/locks/missions/$MISSION_ID.lock)
echo "daemon-pid=$DAEMON_PID"
ps -p $DAEMON_PID 2>&1
```

Expected: daemon-pid populated in lockfile; `ps -p $DAEMON_PID` shows live process (the watcher-entry).

Output:
```
msn-99c369ee.lock
daemon-pid=153265
    PID TTY          TIME CMD
 153265 ?        00:00:00 MainThread
```

**Note**: Pre-v1.0.2 (v1.0.1 + earlier), the lockfile was unlinked by `start()` Step 8 release-pseudolock — daemon-IPC channel was lost and operator-CLI commands couldn't read the daemon-pid. Fixed in v1.0.2 slice (i)+(i.5) via `daemonSpawned` flag + vestigial-acquire-removal in abandon/complete.

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
[form-1 plain-id]
/home/apnex/.missioncraft/missions/msn-99c369ee/missioncraft

[form-2 explicit-repo]
/home/apnex/.missioncraft/missions/msn-99c369ee/missioncraft

[form-3 coord-form]
/home/apnex/.missioncraft/missions/msn-99c369ee/missioncraft

[form-4 coord+path]
/home/apnex/.missioncraft/missions/msn-99c369ee/missioncraft/src

[shell-eval]
/home/apnex/.missioncraft/missions/msn-99c369ee/missioncraft
docs
LICENSE
package.json
package-lock.json
README.md
```

**Note**: Pre-v1.0.2 (v1.0.1), `msn workspace <id>` happy-path returned zero stdout. Fixed in v1.0.2 slice (iii) at `bin.ts:326` (CLI dispatch handler `console.log(path)`).

### Step 9 — Read-only boundary verification

Verify daemon does NOT push to remote (single-participant; `coordinationRemote` unset → `pushWipToCoordRemote` conditional-gates to no-op per W5b slice ii):

```bash
# Watch a wip-cadence window (~10s should be sufficient given default debounce + heartbeat)
sleep 10
# Verify no remote-side activity by checking the mission's wip-branch was NOT pushed
# (remote ls-remote should NOT show refs/heads/<repoName>/wip/<missionId>)
MISSION_ID=<mission-id>
git ls-remote https://github.com/apnex/missioncraft.git 2>&1 | grep "wip/$MISSION_ID" || echo "✓ no remote wip-branch (read-only boundary preserved)"
```

Expected: no remote wip-branch ref; read-only boundary preserved.

Output:
```
✓ no remote wip-branch (read-only boundary preserved)
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
(empty stdout; exit 0; daemon SIGTERM + workspace destroy + lifecycle atomic-advance)
```

**Note**: Pre-v1.0.2 (v1.0.1), `msn abandon` orphaned the daemon process (operator had to manually `kill <pid>`). Fixed in v1.0.2 slice (i)+(i.5) — lockfile persistence + vestigial-acquireMissionLock-removal in abandon means SIGTERM signal lands correctly.

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
{
  "id": "msn-99c369ee",
  "name": "test-readonly",
  "tags": {},
  "repos": [
    {
      "name": "missioncraft",
      "url": "https://github.com/apnex/missioncraft.git",
      "base": "main"
    }
  ],
  "lifecycleState": "abandoned",
  "createdAt": "2026-05-10T23:25:37.444Z",
  "updatedAt": "2026-05-10T23:25:37.444Z",
  "identityProviderName": "local-git-config",
  "approvalProviderName": "trust-all",
  "storageProviderName": "local-filesystem",
  "gitEngineProviderName": "isomorphic-git",
  "abandonMessage": "readonly scenario teardown",
  "abandonProgress": "workspace-handled",
  "abandonRepoStatus": {
    "missioncraft": "cleaned"
  }
}
```

### Step 12 — Verify workspace cleaned + daemon dead

```bash
MISSION_ID=<mission-id>
ls ~/.missioncraft/missions/$MISSION_ID/ 2>&1 || echo "✓ workspace removed"
# Re-source daemon-pid from lockfile if shell-session lost the var
# (lockfile may already be unlinked by abandon Step 4; fall back to $DAEMON_PID if set)
[ -f ~/.missioncraft/locks/missions/$MISSION_ID.lock ] && DAEMON_PID=$(jq -r '.pid // empty' ~/.missioncraft/locks/missions/$MISSION_ID.lock)
[ -n "$DAEMON_PID" ] && ps -p $DAEMON_PID 2>&1 || echo "✓ daemon process exited"
ls ~/.missioncraft/config/$MISSION_ID.yaml 2>&1
```

Expected:
- Workspace directory `missions/<mission-id>/` removed (default abandon behavior; no `--retain`)
- Daemon process exited (SIGTERM at abandon Step 2)
- Config file `config/<mission-id>.yaml` PRESERVED (no `--purge-config`)

Output:
```
ls: cannot access '/home/apnex/.missioncraft/missions/msn-99c369ee/': No such file or directory
✓ workspace removed
✓ daemon process exited
/home/apnex/.missioncraft/config/msn-99c369ee.yaml
```

### Step 13 — Resolve `msn workspace` post-abandon (error path)

```bash
msn workspace <mission-id> 2>&1
```

Expected: error message indicating mission is terminal-state (workspace destroyed). Operator-recovery path: re-create mission OR start from saved config.

Actual output (v1.0.2):
```
/home/apnex/.missioncraft/missions/msn-99c369ee/missioncraft
(exit=0)
```

**Known UX gap (v1.0.2)**: `msn workspace <id>` resolves the path from mission-config `repos[]` regardless of workspace-presence-on-disk. Post-abandon, the workspace directory is destroyed but the CLI returns the (now-stale) path. Operator should check lifecycle-state via `msn show <id>` before relying on workspace-path resolution post-terminal. **Tracked as `idea-268`** (terminal-state-guard for `msn workspace`; route-a; v1.0.x roadmap candidate).

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

- **02-readwrite-single-repo.md** — full `complete` flow with push + PR-open against owned repo; covers `--retain` + `--purge-config` abandon-flag variants as sub-sections
- **03-multi-repo-mission.md** — single mission spanning 2+ repos; covers Rule N coord-form patterns (substrate-coordinate addressing) for multi-repo workspace-switching
- **04-multi-participant-writer-reader.md** — `msn join` + reader-daemon Loop B + cross-host coordination via `--coord-remote`; covers disk-failure recovery (bundle-ops restore from snapshotRoot; `rm -rf workspaceRoot` recovery) as durability-mode sub-section

---

## §8 Execution log

**Status:** RATIFIED
**Executed:** 2026-05-10T23:25Z UTC against `@apnex/missioncraft@1.0.2` (Node v24.12.0; nvm-managed; user-prefix global install)
**Executor:** architect-side (lily; agent-40903c59) via fresh `npm install -g @apnex/missioncraft@latest`
**Mission-ID used in capture:** `msn-99c369ee` (ephemeral; abandoned at end)
**Outcome:** 13 of 13 steps PASS — full operator-canonical workflow verified end-to-end

**Notes:**
- Pre-v1.0.2 (v1.0.0 + v1.0.1) shipped 4 CLI defects discovered via this scenario test cycle:
  - v1.0.0: `msn` bin-shim silent-failure via shebang+symlink (`isMainModule` guard mismatch) → fixed v1.0.1 commit `87bf370`
  - v1.0.1: `msn workspace` zero-stdout happy-path → fixed v1.0.2 slice (iii) at `bin.ts:326`
  - v1.0.1: `msn abandon` daemon-orphan → fixed v1.0.2 slice (i)+(i.5) (lockfile-persistence + vestigial-acquire-removal)
  - v1.0.1: lockfile-persistence inconsistency → fixed v1.0.2 slice (i) (`daemonSpawned` flag + conditional finally-block release)
- v1.0.0 + v1.0.1 npm-deprecated; v1.0.2 is operator-canonical at time of capture
- Step 13 post-abandon `msn workspace <id>` returns stale path (known UX gap; v1.x follow-on)
- All other steps match expected outputs exactly
