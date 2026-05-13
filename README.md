# missioncraft

Focused work, without the git overhead.

`missioncraft` is a command-line tool that lets you work on a piece of code in a clone of a repo while a background daemon handles all the git mechanics — staging, committing, pushing — for you. When you're done, one command publishes your work back to the upstream repo as a clean, single commit. You never run `git add`, `git commit`, or `git push` yourself.

It's built for teams (human or AI) who want a clear lifecycle around units of work: start a mission, edit files in its isolated workspace, complete it. The tool tracks each mission as a first-class entity with its own branch, its own state, and its own published outcome.

## Why use it

- **No git ceremony.** Edit files; the daemon commits on a cadence and pushes for you. Save your attention for the work itself.
- **Clean upstream history.** A finished mission lands as one squashed commit on a dedicated branch — easy to review, easy to revert.
- **Multiple work streams in parallel.** Each mission has its own workspace and its own branch namespace; they don't step on each other.
- **Read-only observers built in.** Anyone with the upstream URL can tail your mission's branch in real time, or watch any long-lived branch like `main`.

## Install

```bash
npm install -g @apnex/missioncraft
```

Requirements: `git` and the GitHub CLI (`gh`) on your `PATH`. Check with:

```bash
msn version
```

### Optional — shell integration

Enable the `msn <id> cd` shortcut for jumping into a workspace. One-time setup in your shell rc-file:

```bash
eval "$(msn shell-init bash)"   # or zsh / fish
```

Without this, `cd $(msn <id> workspace)` works in any shell.

## Quick start

### Scenario 1 — Work on a focused task in a repo

You want to refactor a module in `example/widget`. You create a mission, edit files in its workspace, then publish your work as one commit on a dedicated branch.

```bash
msn create --name refactor-widget --repo https://github.com/example/widget
msn msn-<id> start
msn msn-<id> cd
# ... edit files in your editor ...
msn msn-<id> complete "refactor widget for v2 API"
```

The published commit is on a dedicated branch upstream. Open a PR from it when you're ready to merge.

If you change your mind, `msn msn-<id> abandon "<reason>"` stops the daemon and discards your work — nothing reaches upstream.

### Scenario 2 — Track someone else's in-progress mission (read-only)

A colleague is working on a mission. You want to follow along in real time as their daemon pushes updates — without write access and without interfering with their work.

```bash
msn join msn-<their-id>
msn msn-<your-id> start
msn msn-<your-id> cd
```

Files refresh as their daemon pushes. Your reader auto-closes when they `complete` or `abandon`.

### Scenario 3 — Watch a long-lived branch (e.g. `main`)

You want a local mirror of `main` on a repo, always current with upstream — useful for CI dashboards, multi-repo overviews, or always-fresh working copies.

```bash
msn watch --repo https://github.com/example/widget --branch main --name widget-main
msn msn-<id> start
msn msn-<id> cd
```

The daemon pulls upstream on a cadence (default every 30s). Run `msn msn-<id> abandon` when you're done.

### Scenario 4 — Reuse a repo bundle across missions

You keep starting missions against the same set of repos. Define them once as a **scope**, then reference the scope by name when you create missions.

```bash
# Define the bundle once
msn scope create --name platform \
  --repo https://github.com/example/widget \
  --repo https://github.com/example/widget-docs

# Every mission against the scope inherits its repos
msn create --name fix-typos --scope platform
msn msn-<id> start

# Jump into a specific repo's workspace (multi-repo missions select by repo-name)
msn msn-<id> cd widget         # or: msn msn-<id> cd widget-docs
# ... edit across both repos ...

msn msn-<id> complete "fix typos across platform docs"
```

Each repo in the scope gets its own workspace and its own published commit on its own mission branch. Scopes are reusable; missions are disposable.

## Core commands

| Command | What it does |
|---|---|
| `msn create --name <slug> --repo <url>` | Define a new read-write mission |
| `msn create --name <slug> --scope <name>` | Define a mission against a reusable scope |
| `msn join <writer-mission-id>` | Create a read-only mission that tracks another mission |
| `msn watch --repo <url> --branch <ref>` | Create a read-only mission that tracks a branch |
| `msn list` | List all missions on your machine |
| `msn <id> start` | Clone, spawn daemon, open workspace |
| `msn <id> show` (or just `msn <id>`) | Print mission details |
| `msn <id> workspace [<repo-name>]` | Print the workspace path (specify `<repo-name>` for multi-repo missions) |
| `msn <id> cd [<repo-name>]` | Jump into the workspace (requires `msn shell-init`; specify `<repo-name>` for multi-repo) |
| `msn <id> complete "<msg>"` | Publish work as a squashed commit; stop daemon |
| `msn <id> abandon "<msg>"` | Stop daemon without publishing |
| `msn scope create --name <slug> --repo <url>` | Define a reusable repo bundle |
| `msn scope list` | List scopes |
| `msn version` | Show `missioncraft`, `git`, and `gh` versions |
| `msn help` | Full grammar reference |
| `msn tree` | Tree view of all commands |

## Concepts

A **mission** is one unit of work. It has a name, an upstream repo (or several), a workspace on disk, a dedicated branch on the upstream, and a lifecycle (`configured` → `started` → `in-progress` → `completed` or `abandoned`).

A **workspace** is the directory on your filesystem where you edit files for a mission. Each mission gets its own; they don't share state.

A **scope** is a reusable bundle of repos and configuration. If you keep starting missions against the same set of repos, define them once as a scope and reference it by name when creating missions.

The **daemon** is a background process spawned by `msn <id> start`. It watches your workspace for file changes, commits them on a cadence, and pushes them to a mission-dedicated branch on upstream. You don't manage it directly — `start` spawns it, `complete`/`abandon` stops it.

## License

Apache 2.0
