# Examples

This directory contains usage-oriented examples for `ai-sdk-fs-tools`.

## Available examples

- [modular-calculator](./modular-calculator)
  Runnable example with a modular calculator app, multiple nested `AGENTS.md` files, and real `fs_read` calls against different source paths.

## Modular calculator output

Run:

```bash
pnpm example:modular-calculator
```

Output:

```text
=== src/operations/add.ts ===
     1	export function add(left: number, right: number): number {
     2	    return left + right;
     3	}
     4	
<system-reminder type="AGENTS.md">
<agents.md path="/src/operations">
# Operation modules

- Keep operation files pure and numeric only.
- Export one operation per file.
- Leave formatting to the UI layer.
</agents.md>

<agents.md path="/src">
# Source tree rules

- Shared calculator types live under `src/types.ts`.
- Keep modules focused and side-effect free.
- Prefer small named exports.
</agents.md>

<agents.md path="/">
# Modular calculator app

- The app is split into parser, operations, and UI modules.
- Run `pnpm test` before changing evaluation logic.
- Keep dependencies flowing from UI toward pure helpers.
</agents.md>
</system-reminder>

=== src/ui/render-display.ts ===
     1	export function renderDisplay(value: number): string {
     2	    return `Result: ${value}`;
     3	}
     4	
<system-reminder type="AGENTS.md">
<agents.md path="/src/ui">
# UI modules

- UI helpers format values and labels only.
- Do not perform arithmetic in `src/ui`.
- Keep rendering helpers stateless.
</agents.md>

<agents.md path="/src">
# Source tree rules

- Shared calculator types live under `src/types.ts`.
- Keep modules focused and side-effect free.
- Prefer small named exports.
</agents.md>

<agents.md path="/">
# Modular calculator app

- The app is split into parser, operations, and UI modules.
- Run `pnpm test` before changing evaluation logic.
- Keep dependencies flowing from UI toward pure helpers.
</agents.md>
</system-reminder>
```
