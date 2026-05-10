---
"@apnex/missioncraft": major
---

W0 scaffold: initial sovereign-module bootstrap per Design v4.8 BILATERAL RATIFIED §2.9.

- Sovereign-module layout: `src/missioncraft-sdk/` (PRIMARY contract surface) + `src/missioncraft-cli/` (`msn` binary)
- TypeScript ES2022 + ESM strict; `paths` field maps `@apnex/missioncraft` → SDK index for self-reference
- vitest test infrastructure + smoke-test verifying SDK exports
- GitHub Actions CI (ubuntu+macos × node 22+24 matrix) + release workflow (npm publish --provenance OIDC + TypeDoc deploy)
- Apache 2.0 license; engineer-git-less hypervisor framing in README

Strict-1.0 commitment: this is the v1.0.0 initial publish; major-bump signals "v1.x baseline established".

W1+ waves implement actual SDK + CLI surface (Missioncraft class + 5 pluggables + resource types + zod schemas + verb-handlers).
