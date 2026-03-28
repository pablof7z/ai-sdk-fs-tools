import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsEditTool } from "../tools/fs_edit";
import { createFsReadTool } from "../tools/fs_read";
import { cleanupTempDir, createTempDir, expectErrorText, writeTextFile } from "./helpers";

describe("createFsEditTool", () => {
    let workingDirectory: string;
    beforeEach(async () => {
        workingDirectory = await createTempDir("ai-sdk-fs-tools-edit-");
    });

    afterEach(async () => {
        await cleanupTempDir(workingDirectory);
    });

    it("edits a unique match", async () => {
        const filePath = join(workingDirectory, "file.txt");
        await writeTextFile(filePath, "hello world");
        const fsRead = createFsReadTool({ workingDirectory });
        const fsEdit = createFsEditTool({ workingDirectory });

        // Must read before editing
        await fsRead.execute({ path: filePath, description: "read file" });

        const result = await fsEdit.execute({
            path: filePath,
            description: "edit file",
            old_string: "world",
            new_string: "there",
        });

        expect(result).toContain("Successfully replaced 1 occurrence");
        await expect(readFile(filePath, "utf8")).resolves.toBe("hello there");
    });

    it("returns error-text when old_string is missing", async () => {
        const filePath = join(workingDirectory, "file.txt");
        await writeTextFile(filePath, "hello world");
        const fsRead = createFsReadTool({ workingDirectory });
        const fsEdit = createFsEditTool({ workingDirectory });

        await fsRead.execute({ path: filePath, description: "read file" });

        const result = await fsEdit.execute({
            path: filePath,
            description: "edit file",
            old_string: "missing",
            new_string: "there",
        });

        expect(expectErrorText(result).text).toContain("old_string not found");
    });

    it("requires a unique match unless replace_all is true", async () => {
        const filePath = join(workingDirectory, "file.txt");
        await writeTextFile(filePath, "hello\nhello\nhello");
        const fsRead = createFsReadTool({ workingDirectory });
        const fsEdit = createFsEditTool({ workingDirectory });

        await fsRead.execute({ path: filePath, description: "read file" });

        const uniqueResult = await fsEdit.execute({
            path: filePath,
            description: "edit file",
            old_string: "hello",
            new_string: "hi",
        });

        // Re-read before second edit attempt
        await fsRead.execute({ path: filePath, description: "read file" });

        const replaceAllResult = await fsEdit.execute({
            path: filePath,
            description: "edit file",
            old_string: "hello",
            new_string: "hi",
            replace_all: true,
        });

        expect(expectErrorText(uniqueResult).text).toContain("multiple times");
        expect(replaceAllResult).toContain("Successfully replaced 3 occurrence");
        await expect(readFile(filePath, "utf8")).resolves.toBe("hi\nhi\nhi");
    });

    it("beforeExecute can block edits", async () => {
        const protectedDirectory = join(workingDirectory, "reports");
        const filePath = join(protectedDirectory, "report.txt");
        await writeTextFile(filePath, "report");
        const fsEdit = createFsEditTool({
            workingDirectory,
            beforeExecute: (_toolName, input) => {
                const path = input.path as string | undefined;
                if (path?.startsWith(protectedDirectory)) {
                    throw new Error("Edits to reports directory are blocked");
                }
            },
        });

        const result = await fsEdit.execute({
            path: filePath,
            description: "edit protected file",
            old_string: "report",
            new_string: "updated",
        });

        expect(expectErrorText(result).text).toContain("Edits to reports directory are blocked");
    });

    describe("concurrency protection", () => {
        it("rejects edit without prior read", async () => {
            const filePath = join(workingDirectory, "file.txt");
            await writeTextFile(filePath, "hello world");
            const fsEdit = createFsEditTool({ workingDirectory });

            const result = await fsEdit.execute({
                path: filePath,
                description: "edit file",
                old_string: "world",
                new_string: "there",
            });

            expect(expectErrorText(result).text).toContain("must be read with fs_read before editing");
        });

        it("detects concurrent modification", async () => {
            const filePath = join(workingDirectory, "file.txt");
            await writeTextFile(filePath, "hello world");
            const fsRead = createFsReadTool({ workingDirectory });
            const fsEdit = createFsEditTool({ workingDirectory });

            // Read the file
            await fsRead.execute({ path: filePath, description: "read file" });

            // Simulate external modification
            await writeTextFile(filePath, "modified externally");

            const result = await fsEdit.execute({
                path: filePath,
                description: "edit file",
                old_string: "hello",
                new_string: "hi",
            });

            expect(expectErrorText(result).text).toContain("modified since last read");
        });

        it("allows consecutive edits by same agent", async () => {
            const filePath = join(workingDirectory, "file.txt");
            await writeTextFile(filePath, "hello world");
            const fsRead = createFsReadTool({ workingDirectory, agentId: "agent1" });
            const fsEdit = createFsEditTool({ workingDirectory, agentId: "agent1" });

            await fsRead.execute({ path: filePath, description: "read file" });

            // First edit succeeds
            const result1 = await fsEdit.execute({
                path: filePath,
                description: "edit file",
                old_string: "world",
                new_string: "there",
            });
            expect(result1).toContain("Successfully replaced");

            // Second edit succeeds without re-read (same agent)
            const result2 = await fsEdit.execute({
                path: filePath,
                description: "edit file",
                old_string: "there",
                new_string: "universe",
            });
            expect(result2).toContain("Successfully replaced");
            await expect(readFile(filePath, "utf8")).resolves.toBe("hello universe");
        });

        it("blocks edit by different agent after first agent edits", async () => {
            const filePath = join(workingDirectory, "file.txt");
            await writeTextFile(filePath, "hello world");
            const fsRead1 = createFsReadTool({ workingDirectory, agentId: "agent1" });
            const fsRead2 = createFsReadTool({ workingDirectory, agentId: "agent2" });
            const fsEdit1 = createFsEditTool({ workingDirectory, agentId: "agent1" });
            const fsEdit2 = createFsEditTool({ workingDirectory, agentId: "agent2" });

            // Both agents read the file
            await fsRead1.execute({ path: filePath, description: "read file" });
            await fsRead2.execute({ path: filePath, description: "read file" });

            // Agent1 edits successfully
            const result1 = await fsEdit1.execute({
                path: filePath,
                description: "edit file",
                old_string: "world",
                new_string: "there",
            });
            expect(result1).toContain("Successfully replaced");

            // Agent2's edit fails - file was modified since their read
            const result2 = await fsEdit2.execute({
                path: filePath,
                description: "edit file",
                old_string: "there",
                new_string: "universe",
            });
            expect(expectErrorText(result2).text).toContain("modified since last read");
        });
    });
});
