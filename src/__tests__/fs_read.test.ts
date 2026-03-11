import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFsReadTool } from "../tools/fs_read";
import { cleanupTempDir, createTempDir, expectErrorText, writeTextFile } from "./helpers";

describe("createFsReadTool", () => {
    let workingDirectory: string;
    let outsideDirectory: string;
    let allowedDirectory: string;

    beforeEach(async () => {
        workingDirectory = await createTempDir("ai-sdk-fs-tools-read-");
        outsideDirectory = await createTempDir("ai-sdk-fs-tools-read-outside-");
        allowedDirectory = await createTempDir("ai-sdk-fs-tools-read-allowed-");
    });

    afterEach(async () => {
        await cleanupTempDir(workingDirectory);
        await cleanupTempDir(outsideDirectory);
        await cleanupTempDir(allowedDirectory);
    });

    it("reads files with line numbers", async () => {
        const filePath = join(workingDirectory, "src", "index.ts");
        await writeTextFile(filePath, "line 1\nline 2\nline 3");

        const fsRead = createFsReadTool({ workingDirectory });
        const result = await fsRead.execute({
            path: filePath,
            description: "inspect source file",
        });

        expect(result).toContain("1\tline 1");
        expect(result).toContain("2\tline 2");
        expect(result).toContain("3\tline 3");
    });

    it("reads directory listings", async () => {
        await writeTextFile(join(workingDirectory, "a.txt"), "a");
        await writeTextFile(join(workingDirectory, "b.txt"), "b");

        const fsRead = createFsReadTool({ workingDirectory });
        const result = await fsRead.execute({
            path: workingDirectory,
            description: "list directory",
        });

        expect(result).toContain("Directory listing");
        expect(result).toContain("a.txt");
        expect(result).toContain("b.txt");
    });

    it("blocks paths outside the sandbox by default", async () => {
        const filePath = join(outsideDirectory, "secret.txt");
        await writeTextFile(filePath, "secret");

        const fsRead = createFsReadTool({ workingDirectory });
        const result = await fsRead.execute({
            path: filePath,
            description: "read outside file",
        });

        expect(expectErrorText(result).text).toContain("outside the configured roots");
    });

    it("allows reads within allowedRoots", async () => {
        const filePath = join(allowedDirectory, "notes.txt");
        await writeTextFile(filePath, "allowed");

        const fsRead = createFsReadTool({
            workingDirectory,
            allowedRoots: [allowedDirectory],
        });
        const result = await fsRead.execute({
            path: filePath,
            description: "read allowed file",
        });

        expect(result).toContain("allowed");
    });

    it("blocks symlink escapes", async () => {
        const outsideFile = join(outsideDirectory, "secret.txt");
        await writeTextFile(outsideFile, "secret");
        await mkdir(join(workingDirectory, "links"), { recursive: true });
        await symlink(outsideDirectory, join(workingDirectory, "links", "outside"));

        const fsRead = createFsReadTool({ workingDirectory });
        const result = await fsRead.execute({
            path: join(workingDirectory, "links", "outside", "secret.txt"),
            description: "attempt symlink escape",
        });

        expect(expectErrorText(result).text).toContain("outside the configured roots");
    });

    it("supports tool-result hooks", async () => {
        const loadToolResult = vi.fn(async (id: string) => `tool:${id}`);
        const fsRead = createFsReadTool({
            workingDirectory,
            loadToolResult,
        });

        const result = await fsRead.execute({
            tool: "call-123",
            description: "read tool result",
        });

        expect(loadToolResult).toHaveBeenCalledWith("call-123");
        expect(result).toBe("tool:call-123");
    });

    it("returns error-text when tool-result hook is missing", async () => {
        const fsRead = createFsReadTool({ workingDirectory });
        const result = await fsRead.execute({
            tool: "call-123",
            description: "read tool result",
        });

        expect(expectErrorText(result).text).toContain("loadToolResult hook");
    });

    it("supports analysis hooks", async () => {
        const filePath = join(workingDirectory, "notes.txt");
        await writeTextFile(filePath, "Important context");
        const analyzeContent = vi.fn(async ({ content, source, prompt }) =>
            `prompt=${prompt}; source=${source}; content=${content.split("\n")[0]}`,
        );
        const fsRead = createFsReadTool({
            workingDirectory,
            analyzeContent,
        });

        const result = await fsRead.execute({
            path: filePath,
            description: "analyze notes",
            prompt: "summarize",
        });

        expect(analyzeContent).toHaveBeenCalledTimes(1);
        expect(result).toContain("prompt=summarize");
        expect(result).toContain(`source=${filePath}`);
    });

    it("returns error-text when analysis hook is missing", async () => {
        const filePath = join(workingDirectory, "notes.txt");
        await writeTextFile(filePath, "Important context");
        const fsRead = createFsReadTool({ workingDirectory });

        const result = await fsRead.execute({
            path: filePath,
            description: "analyze notes",
            prompt: "summarize",
        });

        expect(expectErrorText(result).text).toContain("analyzeContent hook");
    });

    it("requires exactly one of path or tool", async () => {
        const fsRead = createFsReadTool({ workingDirectory });
        const both = await fsRead.execute({
            path: join(workingDirectory, "file.txt"),
            tool: "call-123",
            description: "invalid request",
        });
        const neither = await fsRead.execute({
            description: "invalid request",
        });

        expect(expectErrorText(both).text).toContain("exactly one");
        expect(expectErrorText(neither).text).toContain("exactly one");
    });

    it("appends root AGENTS.md reminders", async () => {
        await writeTextFile(join(workingDirectory, "AGENTS.md"), "# Root rule");
        const filePath = join(workingDirectory, "src", "index.ts");
        await writeTextFile(filePath, "export const x = 1;");

        const fsRead = createFsReadTool({
            workingDirectory,
            agentsMd: {
                projectRoot: workingDirectory,
            },
        });
        const result = await fsRead.execute({
            path: filePath,
            description: "read source",
        });

        expect(result).toContain('<system-reminder type="agents-md">');
        expect(result).toContain('<agents.md path="/">');
        expect(result).toContain("# Root rule");
    });

    it("orders AGENTS.md reminders from general to specific and deduplicates after a full read", async () => {
        await writeTextFile(join(workingDirectory, "AGENTS.md"), "# Root rule");
        await writeTextFile(join(workingDirectory, "src", "AGENTS.md"), "# Src rule");
        const filePath = join(workingDirectory, "src", "feature.ts");
        await writeTextFile(filePath, "export const y = 2;");

        const fsRead = createFsReadTool({
            workingDirectory,
            agentsMd: {
                projectRoot: workingDirectory,
            },
        });

        const firstResult = await fsRead.execute({
            path: filePath,
            description: "first read",
        });
        const secondResult = await fsRead.execute({
            path: filePath,
            description: "second read",
        });

        const firstText = String(firstResult);
        expect(firstText.indexOf('<agents.md path="/">')).toBeLessThan(
            firstText.indexOf('<agents.md path="/src">'),
        );
        expect(firstText).toContain('<system-reminder type="agents-md">');
        expect(firstText).toContain('<agents.md path="/src">');

        expect(firstText).toContain('<agents.md path="/">');
        expect(firstText).toContain('<agents.md path="/src">');
        expect(firstText).toContain("# Src rule");
        expect(firstText).toContain("# Root rule");
        expect(String(secondResult)).not.toContain("<system-reminder>");
    });

    it("does not mark AGENTS.md reminders as visible when the read is truncated", async () => {
        await writeTextFile(join(workingDirectory, "AGENTS.md"), "# Root rule");
        const filePath = join(workingDirectory, "src", "big.ts");
        await writeTextFile(filePath, "line 1\nline 2\nline 3");

        const fsRead = createFsReadTool({
            workingDirectory,
            agentsMd: {
                projectRoot: workingDirectory,
            },
        });

        const firstResult = await fsRead.execute({
            path: filePath,
            description: "truncated read",
            limit: 1,
        });
        const secondResult = await fsRead.execute({
            path: filePath,
            description: "full read",
        });

        expect(String(firstResult)).toContain('<system-reminder type="agents-md">');
        expect(String(secondResult)).toContain('<system-reminder type="agents-md">');
    });

    it("disables AGENTS.md reminders when agentsMd is false", async () => {
        await writeTextFile(join(workingDirectory, "AGENTS.md"), "# Root rule");
        const filePath = join(workingDirectory, "src", "index.ts");
        await writeTextFile(filePath, "export const x = 1;");

        const fsRead = createFsReadTool({
            workingDirectory,
            agentsMd: false,
        });
        const result = await fsRead.execute({
            path: filePath,
            description: "read source",
        });

        expect(String(result)).not.toContain("<system-reminder>");
        expect(String(result)).not.toContain("# Root rule");
    });
});
