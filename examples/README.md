# Examples

This directory contains usage-oriented examples for `ai-sdk-fs-tools`.

## Available examples

- [nested-agents](./nested-agents)
  Runnable example with nested `AGENTS.md` files and a real `fs_read` call against `examples/nested-agents/file/path/example.txt`.

## Nested agents output

Run:

```bash
pnpm example:nested-agents
```

Output:

```text
     1  This is the example file read by examples/nested-agents/index.ts.
     2  It exists to demonstrate hierarchical AGENTS.md reminders in fs_read output.
     3
<system-reminder>
# AGENTS.md from file

# Nested file rules

- Read examples as plain text.
- Show the reminder block after file contents.

# AGENTS.md from (project root)

# Example root rules

- Explain output briefly.
- Keep examples easy to inspect.
</system-reminder>
```
