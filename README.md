# missioncraft

Sovereign git+workspace orchestration for multi-agent code coordination.

> **Engineer-git-less hypervisor framing** (per Design v4.8 §2.3.2 v3.0 Refinement #1): operators interact with missions via the `msn` CLI; the engine handles all git operations (commits, branches, pushes, PRs, cleanup) invisibly via `GitEngine` + `RemoteProvider` pluggables. Engineers edit code via filesystem tools only.

## Install

```
npm install @apnex/missioncraft
```

## CLI quick start (k8s-resource-shape per v3.0 Refinements)

```bash
# Create + configure a mission (flag-driven; declarative-config primitive)
msn create --name storage-extract
msn update storage-extract repo-add https://github.com/example/repo.git

# Start the mission (engine clones; allocates workspace; spawns daemon-watcher; acquires locks)
msn start storage-extract

# Engineer edits files inside the workspace via filesystem tools (no git CLI needed)
cd $(msn workspace storage-extract storage-provider)
# ... edit files ...

# Complete the mission (atomic PR-set publish-flow: per-repo squash + push + openPullRequest;
# release locks; destroy workspace; preserve config)
msn complete storage-extract "Refactor storage adapter for v2.0"
```

## Declarative quick start (single-call from manifest)

```bash
msn start -f mission-77.yaml      # full manifest: declares + starts in one call
```

## Library quick start (SDK-primary per v1.1 Refinement #4; v3.0 generic-verb shape per Refinement #7)

```typescript
import { Missioncraft } from '@apnex/missioncraft';

const mc = new Missioncraft({ /* defaults */ });

const handle = await mc.create('mission', { name: 'storage-extract' });
await mc.update('mission', handle.id, {
  kind: 'add-repo',
  repo: { url: 'https://github.com/example/repo.git' },
});
await mc.start(handle.id);
// ... edit files in the workspace ...
await mc.complete(handle.id, 'Refactor storage adapter for v2.0');
```

## License

Apache 2.0
