# Changesets

Changesets are how missioncraft tracks user-facing changes for release notes + version bumps. Per Strict-1.0 commitment (Design v4.8 §2.9.1 Q2=a), every PR with source-code changes MUST include a changeset.

## Usage

```bash
# Create a changeset for your changes
npx changeset

# Bump versions + generate CHANGELOG.md (maintainer-only)
npx changeset version

# Publish (CI-driven via release.yml on tag-push)
npx changeset publish
```

## CI gate

`.github/workflows/ci.yml` runs `npx changeset status --since=<base-branch>` on pull requests; PRs without a changeset fail CI.

## Changeset semantics

- **major**: breaking change to public API (Strict-1.0 — major bump = serious decision)
- **minor**: backward-compatible feature addition
- **patch**: bug-fix or internal change with no API impact
