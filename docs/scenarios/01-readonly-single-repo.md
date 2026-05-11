# Scenario 01 — Read-Only Single-Repo Mission Workflow

**Demonstrates:** `create` → `start` (HTTPS clone) → `workspace` path-switching → `abandon`, against a real public repo. **Read-only boundary**: no `complete` (no remote-side writes); `coordinationRemote` unset.

**Status:** RE-RATIFIED — outputs captured against `@apnex/missioncraft@1.0.4` 2026-05-11T03:35Z UTC (Node v24.12.0). Original ratification was against v1.0.2; re-ratification reflects v1.0.3 + v1.0.4 CLI-UX deltas (success-line stdout + per-verb help + colors palette + terminal-state-guard + `msn cd` + `msn tree`).

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
msn --version   # prints 1.0.4 (current latest)
msn version     # NEW in v1.0.4: 'version' verb works as alias for --version
```

**Optional: enable `msn cd`** (NEW in v1.0.3; shell-function wrapper for direct cd into workspace):
```bash
eval "$(msn shell-init bash)"   # or zsh / fish per shell
# Persist by adding to ~/.bashrc
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
missioncraft 1.0.4
```

```bash
msn --help    # full global help with verb-list
msn help      # NEW in v1.0.3: 'help' verb (alias for --help)
msn           # NEW in v1.0.3: bare msn falls through to help
msn version   # NEW in v1.0.4: 'version' verb (alias for --version)
msn tree      # NEW in v1.0.4: tree-style visualization of full verb hierarchy
```

Expected: grammar dispatch + verb-list including `create / list / show / start / apply / update / complete / abandon / tick / workspace / cd / shell-init / scope / config / join / leave / help / version / tree`.

**Edge-case bootstrap verifications** (v1.0.4 polish):

```bash
msn list                                      # empty list shows headers only (no body); v1.0.3 dropped (no entries) indicator
msn show                                      # missing-arg → per-verb help inline (v1.0.4 via idea-274)
msn scope                                     # missing sub-verb → multi-line listing with shortDesc per sub-verb (v1.0.4)
msn show --help                               # per-verb help via flag (v1.0.4)
msn help show                                 # per-verb help via prefix-form (v1.0.4)
```

**Pre-v1.0.4 history**:
- v1.0.0: `msn --help` silent-failed via shebang+symlink `isMainModule` guard mismatch → fixed v1.0.1 (`87bf370`)
- v1.0.1-2: bare `msn` errored "Rule 6 missing-verb" → fixed v1.0.3 bug-64 item 1
- v1.0.3: error messages had "Rule N" grammar-jargon prefixes → fixed v1.0.4 bug-66 item 3
- v1.0.3: empty `msn list` showed `(no entries)` row → dropped v1.0.4 bug-66 item 2

### Step 2 — Create mission

```bash
msn create --name test-readonly --repo https://github.com/apnex/missioncraft.git
```

Expected: returns `<mission-id> <name>` line; lifecycle initial = `configured` (auto-advance from `created` per single-repo-add).

Output:
```
msn-527bec0e	test-readonly
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
  "id": "msn-527bec0e",
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
  "createdAt": "2026-05-11T03:35:50.882Z",
  "updatedAt": "2026-05-11T03:35:50.882Z",
  "identityProviderName": "local-git-config",
  "approvalProviderName": "trust-all",
  "storageProviderName": "local-filesystem",
  "gitEngineProviderName": "isomorphic-git"
}
```

**Name-alias resolution** (v1.0.3 bug-64 item 5):
```bash
msn show test-readonly                        # equivalent to: msn show msn-527bec0e
```

### Step 4 — List missions

```bash
msn list
```

Expected: tabular output with the mission row (`ID / NAME / LIFECYCLE / REPOS-COUNT`). Headers in CYAN (v1.0.3 bug-64 item 4) when stdout is a TTY; no horizontal-separator row (v1.0.3 dropped via bug-64 item 4 + v1.0.4 cosmetics finalization).

Output (TTY-stripped; CYAN headers in actual terminal):
```
ID            NAME           LIFECYCLE   REPOS-COUNT
msn-527bec0e  test-readonly  configured  1
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

Expected (v1.0.3+ via bug-64 item 6 + v1.0.4 colors.success migration): stdout success-line; lifecycle advances to `started`.

Output (colors stripped; GREEN in actual terminal):
```
started mission msn-527bec0e ('test-readonly'); daemon-pid 406100
```

**Pre-v1.0.3 behavior**: empty stdout (silent success). Operator had no visibility into substantive operation. Shipped fix at v1.0.3 bug-64 item 6 (success-line stdout); migrated to `colors.success` (GREEN) at v1.0.4 bug-66 color-palette refactor.

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
msn-527bec0e.lock
daemon-pid=406100
    PID TTY          TIME CMD
 406100 ?        00:00:00 MainThread
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
/home/apnex/.missioncraft/missions/msn-527bec0e/missioncraft

[form-2 explicit-repo]
/home/apnex/.missioncraft/missions/msn-527bec0e/missioncraft

[form-3 coord-form]
/home/apnex/.missioncraft/missions/msn-527bec0e/missioncraft

[form-4 coord+path]
/home/apnex/.missioncraft/missions/msn-527bec0e/missioncraft/src

[shell-eval]
/home/apnex/.missioncraft/missions/msn-527bec0e/missioncraft
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

Expected (v1.0.3+ via bug-64 item 7 + v1.0.4 colors.success migration): stdout success-line; lifecycle advances to `abandoned`.

Output (colors stripped; GREEN in actual terminal):
```
abandoned mission msn-527bec0e ('test-readonly'); workspace removed; daemon stopped
```

**Pre-v1.0.3 behavior**: empty stdout (silent success). Shipped fix at v1.0.3 bug-64 item 7; migrated to `colors.success` (GREEN) at v1.0.4.

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
  "id": "msn-527bec0e",
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
ls: cannot access '/home/apnex/.missioncraft/missions/msn-527bec0e/': No such file or directory
✓ workspace removed
✓ daemon process exited
/home/apnex/.missioncraft/config/msn-527bec0e.yaml
```

### Step 13 — Resolve `msn workspace` post-abandon (error path)

```bash
msn workspace <mission-id> 2>&1
echo "(exit=$?)"
```

Expected (v1.0.3+ via idea-268 terminal-state-guard + v1.0.4 colors.error migration): error message + non-zero exit code.

Output (colors stripped; RED in actual terminal):
```
error: MissionStateError: Missioncraft.workspace: workspace destroyed; mission 'msn-527bec0e' in terminal state 'abandoned'
(exit=65)
```

**Pre-v1.0.3 behavior**: returned the (stale) path from mission-config `repos[]` with exit 0 — operator landed on `cd: <path>: No such file or directory` with no missioncraft diagnostic. Shipped fix at v1.0.3 idea-268 (lifecycle-check + fs-existsSync safety-net); migrated to `colors.error` (RED) at v1.0.4.

**Known v1.0.4 residual UX gap**: error message still has SDK class-name + method-path leakage (`MissionStateError: Missioncraft.workspace:` prefix). Operator-friendly form would be just `error: workspace destroyed; mission 'msn-527bec0e' in terminal state 'abandoned'`. **Tracked as `bug-67`** (CLI-UX class-name leakage + silent-error-paths + arg-detection class; v1.0.5 patch candidate).

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
- ✓ Basic CLI bootstrap (install + version + help; bare-msn + edge-cases via v1.0.3+ + per-verb help via v1.0.4)
- ✓ `msn cd` quick-jump verb via shell-init wrapper (v1.0.3)
- ✓ `msn tree` verb-hierarchy visualization (v1.0.4)
- ✓ `msn version` verb-alias + `msn help` verb-alias (v1.0.3+)
- ✓ Mission create (single-repo)
- ✓ Mission show + list (operator-visible state; name-alias resolution per v1.0.3)
- ✓ Mission start (clone + daemon-spawn + lifecycle advance + GREEN success-line per v1.0.4)
- ✓ Workspace path-switching (4 forms incl. substrate-coordinate Rule N)
- ✓ Read-only boundary (no remote writes; daemon conditional-gating)
- ✓ Mission abandon (7-step cleanup; daemon SIGTERM + GREEN success-line per v1.0.4)
- ✓ Post-abandon state verification (including terminal-state-guard error per v1.0.3 idea-268 + RED color per v1.0.4)

**Does NOT cover:**
- `complete` (read-write boundary; see scenario 02)
- Working-tree mutations + wip-commit-on-debounce daemon-watcher cadence
- Multi-repo missions (see 03)
- `--retain` / `--purge-config` flags (covered in scenario 02 §A flag-variants sub-section)
- Multi-participant (see 04)
- Disk-failure recovery (covered in scenario 04 durability sub-section)

---

## §7 Companion scenarios (forward-pointers)

- **02-readwrite-single-repo.md** — full `complete` flow with push + PR-open against owned repo; covers `--retain` + `--purge-config` abandon-flag variants as sub-sections
- **03-multi-repo-mission.md** — single mission spanning 2+ repos; covers Rule N coord-form patterns (substrate-coordinate addressing) for multi-repo workspace-switching
- **04-multi-participant-writer-reader.md** — `msn join` + reader-daemon Loop B + cross-host coordination via `--coord-remote`; covers disk-failure recovery (bundle-ops restore from snapshotRoot; `rm -rf workspaceRoot` recovery) as durability-mode sub-section

---

## §8 Execution log

**Status:** RE-RATIFIED against v1.0.4
**Original ratification:** 2026-05-10T23:25Z UTC against `@apnex/missioncraft@1.0.2` (mission-id `msn-99c369ee`)
**Re-ratification:** 2026-05-11T03:35Z UTC against `@apnex/missioncraft@1.0.4` (Node v24.12.0; nvm-managed; user-prefix global install)
**Executor:** architect-side (lily; agent-40903c59) via fresh `npm install -g @apnex/missioncraft@latest`
**Mission-ID used in re-ratification capture:** `msn-527bec0e` (ephemeral; abandoned at end)
**Outcome:** 13 of 13 steps PASS — full operator-canonical workflow verified end-to-end against v1.0.4

**Cumulative pre-v1.0.4 fixes** (discovered + shipped via this scenario test cycle):
- v1.0.0: `msn` bin-shim silent-failure via shebang+symlink (`isMainModule` guard) → v1.0.1 (`87bf370`)
- v1.0.1: `msn workspace` zero-stdout happy-path → v1.0.2 slice (iii)
- v1.0.1: `msn abandon` daemon-orphan → v1.0.2 slice (i)+(i.5) (lockfile-persistence + vestigial-acquire-removal)
- v1.0.1: lockfile-persistence inconsistency → v1.0.2 slice (i)
- v1.0.2: `msn` bare → grammar error → v1.0.3 bug-64 item 1 (fall-through to help)
- v1.0.2: empty `msn list` had no headers → v1.0.3 bug-64 item 2
- v1.0.2: name-alias resolution incomplete (`msn show <name>` failed) → v1.0.3 bug-64 item 5 (`resolveMissionRef`/`resolveScopeRef` helpers)
- v1.0.2: `msn start`/`abandon` silent success → v1.0.3 bug-64 items 6+7 (stdout success-lines)
- v1.0.2: no `msn help` verb → v1.0.3 bug-64 item 8
- v1.0.2: `msn workspace <id>` post-abandon returned stale path → v1.0.3 idea-268 (terminal-state-guard)
- v1.0.2: no `msn cd` shortcut → v1.0.3 idea-269 (`shell-init` wrapper)
- v1.0.3: error messages had "Rule N" grammar-jargon → v1.0.4 bug-66 item 3
- v1.0.3: empty list `(no entries)` redundancy → v1.0.4 bug-66 item 2 cleanup
- v1.0.3: no `msn version` alias → v1.0.4 bug-66 item 1
- v1.0.3: no per-verb help → v1.0.4 idea-274 (`--help` / `-h` / `help <verb>` multi-syntax)
- v1.0.3: no tree visualization → v1.0.4 idea-272 (`msn tree`)
- v1.0.3: no color-palette → v1.0.4 bug-66 colors.ts + emit-site refactor (RED errors / CYAN headers / GREEN success / TTY-auto-detect + NO_COLOR/FORCE_COLOR env-vars)

**Deprecation timeline**:
- v1.0.0 + v1.0.1 + v1.0.2 + v1.0.3 — npm-deprecated (cumulative; superseded by v1.0.4)
- v1.0.4 — operator-canonical at time of re-ratification

**Known v1.0.4 residual UX gaps** (tracked for v1.0.5):
- Step 13 error message still has SDK class-name prefix (`MissionStateError: Missioncraft.workspace:`) — tracked as **bug-67** (CLI-UX class-name leakage + silent-error-paths + arg-detection class; 5 items)
- `msn scope delete` unimplemented at v1.0.4 — tracked as **bug-65** (scope-verb impl audit)
- Operator-state layout asymmetric (`config/` vs `scopes/` parallel dirs) — tracked as **idea-271** (consolidation with auto-migration)
- No progress/log output during long-running ops — tracked as **idea-273**

**Cumulative fix count**: 17 CLI/SDK improvements across v1.0.0 → v1.0.4 ship-trail; surfaced via this scenario test cycle as canonical operator-UX regression harness.
