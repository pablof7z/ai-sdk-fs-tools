import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsReadTool } from "../tools/fs_read";
import { createFsWriteTool } from "../tools/fs_write";
import { cleanupTempDir, createTempDir, expectErrorText } from "./helpers";

describe("createFsWriteTool", () => {
    let workingDirectory: string;
    let outsideDirectory: string;
    let allowedDirectory: string;
    beforeEach(async () => {
        workingDirectory = await createTempDir("ai-sdk-fs-tools-write-");
        outsideDirectory = await createTempDir("ai-sdk-fs-tools-write-outside-");
        allowedDirectory = await createTempDir("ai-sdk-fs-tools-write-allowed-");
    });

    afterEach(async () => {
        await cleanupTempDir(workingDirectory);
        await cleanupTempDir(outsideDirectory);
        await cleanupTempDir(allowedDirectory);
    });

    it("writes files inside the working directory", async () => {
        const filePath = join(workingDirectory, "src", "index.ts");
        const fsWrite = createFsWriteTool({ workingDirectory });

        const result = await fsWrite.execute({
            path: filePath,
            content: "export const ok = true;",
            description: "create source file",
        });

        expect(result).toContain("Successfully wrote");
        await expect(readFile(filePath, "utf8")).resolves.toBe("export const ok = true;");
    });

    it("blocks writes outside the sandbox by default", async () => {
        const filePath = join(outsideDirectory, "secret.txt");
        const fsWrite = createFsWriteTool({ workingDirectory });

        const result = await fsWrite.execute({
            path: filePath,
            content: "secret",
            description: "write outside",
        });

        expect(expectErrorText(result).text).toContain("outside the configured roots");
    });

    it("allows writes inside allowedRoots", async () => {
        const filePath = join(allowedDirectory, "allowed.txt");
        const fsWrite = createFsWriteTool({
            workingDirectory,
            allowedRoots: [allowedDirectory],
        });

        const result = await fsWrite.execute({
            path: filePath,
            content: "allowed",
            description: "write allowed",
        });

        expect(result).toContain("Successfully wrote");
        await expect(readFile(filePath, "utf8")).resolves.toBe("allowed");
    });

    it("beforeExecute can block writes", async () => {
        const protectedDirectory = join(workingDirectory, "reports");
        await mkdir(protectedDirectory, { recursive: true });
        const filePath = join(protectedDirectory, "report.md");
        const fsWrite = createFsWriteTool({
            workingDirectory,
            beforeExecute: (_toolName, input) => {
                const path = input.path as string | undefined;
                if (path?.startsWith(protectedDirectory)) {
                    throw new Error("Writes to reports directory are blocked");
                }
            },
        });

        const result = await fsWrite.execute({
            path: filePath,
            content: "report",
            description: "write report",
        });

        expect(expectErrorText(result).text).toContain("Writes to reports directory are blocked");
    });

    it("blocks write attempts through symlink escapes", async () => {
        await mkdir(join(workingDirectory, "links"), { recursive: true });
        await symlink(outsideDirectory, join(workingDirectory, "links", "outside"));
        const fsWrite = createFsWriteTool({ workingDirectory });

        const result = await fsWrite.execute({
            path: join(workingDirectory, "links", "outside", "secret.txt"),
            content: "escape",
            description: "attempt symlink escape",
        });

        expect(expectErrorText(result).text).toContain("outside the configured roots");
    });

    describe("concurrency protection", () => {
        it("allows writing new files without prior read", async () => {
            const filePath = join(workingDirectory, "new-file.txt");
            const fsWrite = createFsWriteTool({ workingDirectory });

            const result = await fsWrite.execute({
                path: filePath,
                content: "new content",
                description: "create new file",
            });

            expect(result).toContain("Successfully wrote");
        });

        it("rejects overwriting existing files without prior read", async () => {
            const filePath = join(workingDirectory, "existing.txt");
            await writeFile(filePath, "original", "utf8");
            const fsWrite = createFsWriteTool({ workingDirectory });

            const result = await fsWrite.execute({
                path: filePath,
                content: "overwrite",
                description: "overwrite existing file",
            });

            expect(expectErrorText(result).text).toContain("must be read with fs_read before overwriting");
        });

        it("allows overwriting after read", async () => {
            const filePath = join(workingDirectory, "existing.txt");
            await writeFile(filePath, "original", "utf8");
            const fsRead = createFsReadTool({ workingDirectory });
            const fsWrite = createFsWriteTool({ workingDirectory });

            await fsRead.execute({ path: filePath, description: "read file" });

            const result = await fsWrite.execute({
                path: filePath,
                content: "overwrite",
                description: "overwrite existing file",
            });

            expect(result).toContain("Successfully wrote");
        });

        it("allows consecutive writes by same agent", async () => {
            const filePath = join(workingDirectory, "existing.txt");
            await writeFile(filePath, "original", "utf8");
            const fsRead = createFsReadTool({ workingDirectory, agentId: "agent1" });
            const fsWrite = createFsWriteTool({ workingDirectory, agentId: "agent1" });

            await fsRead.execute({ path: filePath, description: "read file" });

            // First write succeeds
            const result1 = await fsWrite.execute({
                path: filePath,
                content: "first write",
                description: "first overwrite",
            });
            expect(result1).toContain("Successfully wrote");

            // Second write succeeds without re-read (same agent)
            const result2 = await fsWrite.execute({
                path: filePath,
                content: "second write",
                description: "second overwrite",
            });
            expect(result2).toContain("Successfully wrote");
            await expect(readFile(filePath, "utf8")).resolves.toBe("second write");
        });

        it("blocks write by different agent after first agent writes", async () => {
            const filePath = join(workingDirectory, "existing.txt");
            await writeFile(filePath, "original", "utf8");
            const fsRead1 = createFsReadTool({ workingDirectory, agentId: "agent1" });
            const fsRead2 = createFsReadTool({ workingDirectory, agentId: "agent2" });
            const fsWrite1 = createFsWriteTool({ workingDirectory, agentId: "agent1" });
            const fsWrite2 = createFsWriteTool({ workingDirectory, agentId: "agent2" });

            // Both agents read the file
            await fsRead1.execute({ path: filePath, description: "read file" });
            await fsRead2.execute({ path: filePath, description: "read file" });

            // Agent1 writes successfully
            const result1 = await fsWrite1.execute({
                path: filePath,
                content: "agent1 content",
                description: "overwrite file",
            });
            expect(result1).toContain("Successfully wrote");

            // Agent2's write fails - file was modified since their read
            const result2 = await fsWrite2.execute({
                path: filePath,
                content: "agent2 content",
                description: "overwrite file",
            });
            expect(expectErrorText(result2).text).toContain("modified since last read");
        });
    });
});
