# Changelog

All notable changes to `@apnex/missioncraft` are documented here.

This project follows [Semantic Versioning](https://semver.org/). Dates are in UTC.

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
