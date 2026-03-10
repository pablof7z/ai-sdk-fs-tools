# Hierarchical `fs_read` with `AGENTS.md`

This example shows what the model sees in the `fs_read` tool result when:

- `agentsMd` is enabled by default
- the project root has an `AGENTS.md`
- a nested directory also has its own `AGENTS.md`
- the agent reads a file inside that nested directory

## Example project layout

```text
/workspace/project
├── AGENTS.md
└── src
    ├── AGENTS.md
    └── feature.ts
```

### `/workspace/project/AGENTS.md`

```md
# Root rules

- Use pnpm.
- Keep changes small.
```

### `/workspace/project/src/AGENTS.md`

```md
# src rules

- Prefer named exports.
- Keep utilities pure.
```

### `/workspace/project/src/feature.ts`

```ts
export const featureFlag = true;
```

## Tool setup

```ts
import { createFsReadTool } from "ai-sdk-fs-tools";

const fs_read = createFsReadTool({
  workingDirectory: "/workspace/project",
  agentsMd: {
    projectRoot: "/workspace/project",
  },
});
```

## Tool call

```ts
await fs_read.execute({
  path: "/workspace/project/src/feature.ts",
  description: "inspect feature module",
});
```

## Tool result seen by the model

````text
     1	export const featureFlag = true;

<system-reminder>
# AGENTS.md from src

# src rules

- Prefer named exports.
- Keep utilities pure.

# AGENTS.md from (project root)

# Root rules

- Use pnpm.
- Keep changes small.
</system-reminder>
````

## Notes

- The nested `src/AGENTS.md` appears before the root `AGENTS.md`.
- The reminder is appended to the normal `fs_read` output.
- Once the same `AGENTS.md` files have already been shown in a non-truncated read, later reads will not repeat them.
- Set `agentsMd: false` when creating the tool to disable this behavior entirely.
