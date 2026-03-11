import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsTools } from "../index";
import { createFsReadTool } from "../tools/fs_read";
import { createFsWriteTool } from "../tools/fs_write";
import { cleanupTempDir, createTempDir } from "./helpers";

describe("createFsTools", () => {
    let workingDirectory: string;

    beforeEach(async () => {
        workingDirectory = await createTempDir("ai-sdk-fs-tools-bundle-");
    });

    afterEach(async () => {
        await cleanupTempDir(workingDirectory);
    });

    it("creates a working tools bundle", async () => {
        const tools = createFsTools({ workingDirectory });
        const filePath = join(workingDirectory, "notes.txt");

        const writeResult = await tools.fs_write.execute({
            path: filePath,
            content: "hello bundle",
            description: "write test file",
        });
        const readResult = await tools.fs_read.execute({
            path: filePath,
            description: "read test file",
        });
        const grepResult = await tools.fs_grep.execute({
            pattern: "bundle",
            description: "grep test file",
        });

        expect(writeResult).toContain("Successfully wrote");
        expect(readResult).toContain("hello bundle");
        expect(grepResult).toContain("notes.txt");
        expect(Object.keys(tools).sort()).toEqual([
            "fs_edit",
            "fs_glob",
            "fs_grep",
            "fs_read",
            "fs_write",
        ]);
    });

    describe("namePrefix", () => {
        it("uses custom prefix for tool keys", () => {
            const tools = createFsTools({ workingDirectory, namePrefix: "home_fs" });
            expect(Object.keys(tools).sort()).toEqual([
                "home_fs_edit",
                "home_fs_glob",
                "home_fs_grep",
                "home_fs_read",
                "home_fs_write",
            ]);
        });

        it("passes prefixed name to beforeExecute", async () => {
            const calledNames: string[] = [];
            const tools = createFsTools({
                workingDirectory,
                namePrefix: "home_fs",
                beforeExecute: (toolName) => {
                    calledNames.push(toolName);
                },
            });

            const filePath = join(workingDirectory, "test.txt");
            await tools.home_fs_write.execute({
                path: filePath,
                content: "hi",
                description: "test write",
            });
            await tools.home_fs_read.execute({
                path: filePath,
                description: "test read",
            });

            expect(calledNames).toEqual(["home_fs_write", "home_fs_read"]);
        });
    });

    describe("descriptions", () => {
        it("uses custom descriptions on tools", () => {
            const tools = createFsTools({
                workingDirectory,
                descriptions: {
                    read: "Custom read description",
                    write: "Custom write description",
                },
            });

            expect(tools.fs_read.description).toBe("Custom read description");
            expect(tools.fs_write.description).toBe("Custom write description");
        });

        it("falls back to default descriptions when not overridden", () => {
            const tools = createFsTools({
                workingDirectory,
                descriptions: {
                    read: "Custom read",
                },
            });

            expect(tools.fs_read.description).toBe("Custom read");
            expect(tools.fs_edit.description).toContain("exact string replacements");
        });
    });

    describe("strictContainment", () => {
        it("omits allowOutsideWorkingDirectory from schema", () => {
            const strictTools = createFsTools({
                workingDirectory,
                strictContainment: true,
            });
            const normalTools = createFsTools({ workingDirectory });

            for (const toolName of Object.keys(strictTools)) {
                const strictTool = strictTools[toolName] as any;
                const normalTool = normalTools[toolName] as any;

                // The AI SDK tool() stores the Zod schema on inputSchema
                const strictZod = strictTool.inputSchema ?? strictTool.parameters;
                const normalZod = normalTool.inputSchema ?? normalTool.parameters;

                // Check the Zod schema shape keys
                const strictKeys = Object.keys(strictZod?.shape ?? strictZod?.properties ?? {});
                const normalKeys = Object.keys(normalZod?.shape ?? normalZod?.properties ?? {});

                expect(strictKeys).not.toContain("allowOutsideWorkingDirectory");
                expect(normalKeys).toContain("allowOutsideWorkingDirectory");
            }
        });

        it("resolves relative paths against workingDirectory", async () => {
            const tools = createFsTools({
                workingDirectory,
                strictContainment: true,
            });

            const filePath = join(workingDirectory, "subdir", "file.txt");
            await tools.fs_write.execute({
                path: filePath,
                content: "strict test",
                description: "write for strict test",
            });

            const result = await tools.fs_read.execute({
                path: filePath,
                description: "read strict test",
            });

            expect(result).toContain("strict test");
        });

        it("blocks paths outside workingDirectory", async () => {
            const outsideDir = await createTempDir("ai-sdk-fs-tools-outside-");
            try {
                const tools = createFsTools({
                    workingDirectory,
                    strictContainment: true,
                });

                const result = await tools.fs_read.execute({
                    path: join(outsideDir, "secret.txt"),
                    description: "try to read outside",
                });

                expect(result).toHaveProperty("type", "error-text");
                const errorResult = result as { type: string; text: string };
                expect(errorResult.text).toContain("outside the configured roots");
                expect(errorResult.text).not.toContain("allowOutsideWorkingDirectory");
            } finally {
                await cleanupTempDir(outsideDir);
            }
        });

        it("blocks writes outside workingDirectory", async () => {
            const outsideDir = await createTempDir("ai-sdk-fs-tools-outside-");
            try {
                const tools = createFsTools({
                    workingDirectory,
                    strictContainment: true,
                });

                const result = await tools.fs_write.execute({
                    path: join(outsideDir, "hack.txt"),
                    content: "nope",
                    description: "try to write outside",
                });

                expect(result).toHaveProperty("type", "error-text");
                const errorResult = result as { type: string; text: string };
                expect(errorResult.text).toContain("outside the configured roots");
            } finally {
                await cleanupTempDir(outsideDir);
            }
        });

        it("allows individual tool creation with strictContainment", async () => {
            const readTool = createFsReadTool({
                workingDirectory,
                strictContainment: true,
            });
            const writeTool = createFsWriteTool({
                workingDirectory,
                strictContainment: true,
            });

            const filePath = join(workingDirectory, "individual.txt");
            await writeTool.execute({
                path: filePath,
                content: "individual strict test",
                description: "individual write",
            });

            const result = await readTool.execute({
                path: filePath,
                description: "individual read",
            });

            expect(result).toContain("individual strict test");
        });
    });
});
