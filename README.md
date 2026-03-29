# ai-sdk-fs-tools

Portable filesystem tools for the Vercel AI SDK. The package exposes `fs_read`, `fs_write`, `fs_edit`, `fs_glob`, and `fs_grep` as reusable tool factories, with optional `AGENTS.md` reminder injection for `fs_read`.

## Status

The source repository lives at [pablof7z/ai-sdk-fs-tools](https://github.com/pablof7z/ai-sdk-fs-tools).

Install from npm:

```bash
pnpm add ai-sdk-fs-tools
```

## Features

- Shared sandbox config for all tools: `workingDirectory` and `allowedRoots`
- Symlink-safe root containment checks
- `fs_read` support for file reads, directory listings, tool-result hooks, and optional analysis hooks
- Built-in hierarchical `AGENTS.md` reminders appended as `<system-reminder>` blocks
- `fs_glob` and `fs_grep` pagination with sensible exclusion defaults
- Expected failures returned as `{ type: "error-text", text: string }`

## Usage

### Bundle all tools

```ts
import { createFsTools } from "ai-sdk-fs-tools";
import { generateText, stepCountIs } from "ai";

const tools = createFsTools({
  workingDirectory: "/workspace/project",
  allowedRoots: ["/workspace/shared"],
  agentsMd: {
    projectRoot: "/workspace/project",
  },
  loadToolResult: async (id) => lookupSavedToolOutput(id),
  analyzeContent: async ({ content, prompt, source }) =>
    analyzeReadContent({ content, prompt, source }),
});

const result = await generateText({
  model,
  prompt: "Inspect the repo and summarize the build config.",
  tools,
  stopWhen: stepCountIs(8),
});
```

### Use individual factories

```ts
import { createFsReadTool, createFsWriteTool } from "ai-sdk-fs-tools";

const fs_read = createFsReadTool({
  workingDirectory: "/workspace/project",
  agentsMd: {
    projectRoot: "/workspace/project",
  },
});

const fs_write = createFsWriteTool({
  workingDirectory: "/workspace/project",
});
```

For a runnable hierarchical `AGENTS.md` example, see [`examples/modular-calculator/`](./examples/modular-calculator/).

## API

### `createFsTools(options)`

Returns:

```ts
{
  fs_read,
  fs_write,
  fs_edit,
  fs_glob,
  fs_grep,
}
```

### Shared options

```ts
type FsToolsOptions = {
  workingDirectory: string;
  allowedRoots?: string[];
  agentsMd?: false | {
    projectRoot?: string;
  };
  loadToolResult?: (id: string) => Promise<string>;
  analyzeContent?: (args: {
    content: string;
    source: string;
    prompt: string;
  }) => Promise<string>;
};
```

### `fs_read`

- Accepts exactly one of `path` or `tool`
- `path` must be absolute
- Returns numbered file content or a directory listing
- Defaults to 250 lines per read; use `offset` and `limit` to page through larger files
- Appends hierarchical `AGENTS.md` reminders by default
- Disable reminders with `agentsMd: false`
- `prompt` requires `analyzeContent`
- `tool` requires `loadToolResult`

### `fs_write` and `fs_edit`

- Respect `allowedRoots`
- Can opt out with `allowOutsideWorkingDirectory: true`

#### Concurrency Protection

Both `fs_edit` and `fs_write` enforce read-before-write semantics with per-agent tracking:

- **`fs_edit`**: Always requires a prior `fs_read` of the file. Detects if the file was modified since the last read.
- **`fs_write`**: Requires prior `fs_read` only when overwriting existing files. New files can be created freely.

**Per-agent tracking**: Set `agentId` in options to enable multi-agent safety. Each agent maintains its own view of file state:

```ts
// Agent 1's tools
const tools1 = createFsTools({ workingDirectory: "/project", agentId: "agent-1" });

// Agent 2's tools  
const tools2 = createFsTools({ workingDirectory: "/project", agentId: "agent-2" });
```

After a successful write, the same agent can continue editing without re-reading. However, if another agent modified the file, edits will fail until the file is re-read.

### `fs_glob`

- Uses Node's native glob support
- Excludes `node_modules`, `.git`, `dist`, `build`, `.next`, and `coverage`
- Applies `offset` and `head_limit` during traversal instead of collecting every match first
- Returns paths relative to `workingDirectory`

### `fs_grep`

- Uses `rg` when available, with `grep` fallback
- Supports `files_with_matches`, `content`, and `count`
- Stops reading once it has enough results for the requested page when `head_limit` is set
- Falls back to file-list output when content exceeds the output budget

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## License

MIT
