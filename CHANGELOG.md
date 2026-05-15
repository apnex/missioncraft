# Changelog

All notable changes to `@apnex/missioncraft` are documented here.

This project follows [Semantic Versioning](https://semver.org/). Dates are in UTC.

## [1.2.4] — 2026-05-15

Bug-fix release.

### Fixed

- `msn <id> cd` and `msn <id> workspace` (no repo-name) now consistently resolve to the mission's workspace root, regardless of whether the mission has one repo or several. In 1.2.3 the multi-repo bare form went to the mission root but the single-repo bare form silently auto-selected the sole repo and dropped you into its subdirectory — same command, different level. They're now uniform: bare → mission root; pass a repo-name (or use the `<id>:<repo>` coordinate form) to address a specific repo.

## [1.2.3] — 2026-05-15

Bug-fix release — operator-experience sweep.

### Fixed

- `msn <id> abandon` now works on a mission that was never started. Previously a mission you'd created (with or without `--repo`) but not yet `msn start`-ed could not be abandoned — abandon only accepted already-running missions. It now cleanly tears down any not-yet-started mission and tells you it had no workspace or daemon to remove.
- `msn scope list` now prints a readable table by default — the same `ID / NAME / LIFECYCLE / REPOS-COUNT` shape as `msn list`. Previously it dumped raw JSON. Use `--output json` (or `yaml`) when you want machine-readable output.
- `msn <id> help` now shows only the verbs that apply to a specific mission (`show`, `start`, `complete`, `abandon`, `workspace`, `cd`, `update`), instead of dumping the entire CLI help.
- `msn <id> cd` and `msn <id> workspace` with no repo-name on a multi-repo mission now resolve to the mission's root directory (the folder containing each repo), instead of erroring. Passing a repo-name still selects that specific repo.
- `msn <id> cd` now works through the shell integration. The `msn shell-init` wrapper was not intercepting the `msn <id> cd` form, so the documented direct-cd feature didn't work even after `eval "$(msn shell-init bash)"`. It now does.
- Scopes and missions whose config file fails to load no longer vanish silently from `msn scope list` / `msn list` — you now get a `warning:` line naming the entity that couldn't be read. Relatedly, `msn create` / `msn scope create` now reject an invalid auto-derived repo name up front instead of writing a config that can't be read back.
- `msn help <verb>` followed by a flag (e.g. `msn help start --workspace-root /path`) now renders the verb help correctly, instead of reporting an "unknown verb-path" error.

## [1.2.2] — 2026-05-14

Bug-fix release.

### Fixed

- Read-only missions created with `msn watch` or `msn join` can now be cleanly stopped with `msn <id> abandon` — previously the command failed partway through and left the mission in a stuck state.
- `msn show` now reports an accurate publish status for missions published without a pull request (pure-git mode). Previously it always showed `pr-opened` even when no PR was opened; it now shows `pushed-no-pr`.
- `msn start` now gives a clear, actionable error when a workspace was left half-created by a previously failed start, instead of a confusing raw git error. The message tells you which directory to remove before retrying.
- The background daemon now reliably picks up file edits made in the first moments after `msn start`. Previously a brief startup window could miss the first edit until a later change triggered a combined commit.
- `msn scope update <id> <field>` now works for all scope fields (name, description, repos, tags). Previously it failed with an "unknown sub-verb" error.

### Added

- `msn create` and `msn scope create` now accept multiple `--repo` flags to set up multi-repo missions and scopes in a single command (e.g. `msn create --repo <url-a> --repo <url-b>`).
- `MSN_WORKSPACE_ROOT` environment variable — set a default workspace location once in your shell instead of passing `--workspace-root` on every command. Precedence: `--workspace-root` flag, then `MSN_WORKSPACE_ROOT`, then the default `~/.missioncraft`.

## [1.2.1] — 2026-05-14

Bug-fix release.

### Fixed

- Read-only missions that track another mission's branch (created with `msn join`) now refresh correctly and auto-close when the mission they track finishes.

## [1.2.0] — 2026-05-13

Substrate release.

### Changed

- missioncraft now drives `git` and the GitHub CLI (`gh`) directly. Both must be on your `PATH`; check with `msn version`.
- Each mission's work lands on a single dedicated branch — the daemon commits to it on a cadence and publishes it as one squashed commit when you run `msn complete`.
- Missions are independent of one another: each gets its own isolated workspace and branch namespace.

### Added

- Two ways to follow a mission read-only:
  - `msn join <mission-id>` — track another mission's branch and auto-close when it finishes.
  - `msn watch --repo <url> --branch <branch>` — tail any long-lived branch (such as `main`) in real time.
- Hybrid command grammar — both `msn <verb> <id>` and `msn <id> <verb>` forms are accepted for mission-targeted commands.

## [1.0.7] and earlier — 2026-05-11 to 2026-05-12

Initial releases. Core mission lifecycle: `create`, `start`, `complete`, `abandon`; the background commit/push daemon; scopes as reusable repo bundles; `msn version`, `msn tree`, `msn shell-init`, and the per-verb help system.

[1.2.2]: https://www.npmjs.com/package/@apnex/missioncraft/v/1.2.2
[1.2.1]: https://www.npmjs.com/package/@apnex/missioncraft/v/1.2.1
[1.2.0]: https://www.npmjs.com/package/@apnex/missioncraft/v/1.2.0
