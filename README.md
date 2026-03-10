# ai-sdk-fs-tools

Portable filesystem tools for the Vercel AI SDK. The package exposes `fs_read`, `fs_write`, `fs_edit`, `fs_glob`, and `fs_grep` as reusable tool factories, with optional `AGENTS.md` reminder injection for `fs_read`.

## Status

The repository is published on GitHub at [pablof7z/ai-sdk-fs-tools](https://github.com/pablof7z/ai-sdk-fs-tools).

This package is GitHub-published only for now. Install it directly from GitHub:

```bash
pnpm add github:pablof7z/ai-sdk-fs-tools
```

## Features

- Shared sandbox config for all tools: `workingDirectory`, `allowedRoots`, and `protectedWriteRoots`
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
  protectedWriteRoots: ["/workspace/project/reports"],
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
  protectedWriteRoots: ["/workspace/project/reports"],
});
```

For a concrete hierarchical `AGENTS.md` example, see [examples/hierarchical-fs-read-agents-md.md](./examples/hierarchical-fs-read-agents-md.md).

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
  protectedWriteRoots?: string[];
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
- Appends hierarchical `AGENTS.md` reminders by default
- Disable reminders with `agentsMd: false`
- `prompt` requires `analyzeContent`
- `tool` requires `loadToolResult`

### `fs_write` and `fs_edit`

- Respect `allowedRoots`
- Can opt out with `allowOutsideWorkingDirectory: true`
- Always block writes inside `protectedWriteRoots`

### `fs_glob`

- Uses Node's native glob support
- Excludes `node_modules`, `.git`, `dist`, `build`, `.next`, and `coverage`
- Returns paths relative to `workingDirectory`

### `fs_grep`

- Uses `rg` when available, with `grep` fallback
- Supports `files_with_matches`, `content`, and `count`
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
