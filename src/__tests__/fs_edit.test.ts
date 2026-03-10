import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsEditTool } from "../tools/fs_edit";
import { cleanupTempDir, createTempDir, expectErrorText, writeTextFile } from "./helpers";

describe("createFsEditTool", () => {
    let workingDirectory: string;
    let protectedDirectory: string;

    beforeEach(async () => {
        workingDirectory = await createTempDir("ai-sdk-fs-tools-edit-");
        protectedDirectory = join(workingDirectory, "reports");
    });

    afterEach(async () => {
        await cleanupTempDir(workingDirectory);
    });

    it("edits a unique match", async () => {
        const filePath = join(workingDirectory, "file.txt");
        await writeTextFile(filePath, "hello world");
        const fsEdit = createFsEditTool({ workingDirectory });

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
        const fsEdit = createFsEditTool({ workingDirectory });

        const result = await fsEdit.execute({
            path: filePath,
            description: "edit file",
            old_string: "missing",
            new_string: "there",
        });

        expect(expectErrorText(result).text).toContain("was not found");
    });

    it("requires a unique match unless replace_all is true", async () => {
        const filePath = join(workingDirectory, "file.txt");
        await writeTextFile(filePath, "hello\nhello\nhello");
        const fsEdit = createFsEditTool({ workingDirectory });

        const uniqueResult = await fsEdit.execute({
            path: filePath,
            description: "edit file",
            old_string: "hello",
            new_string: "hi",
        });
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

    it("blocks edits inside protectedWriteRoots", async () => {
        const filePath = join(protectedDirectory, "report.txt");
        await writeTextFile(filePath, "report");
        const fsEdit = createFsEditTool({
            workingDirectory,
            protectedWriteRoots: [protectedDirectory],
        });

        const result = await fsEdit.execute({
            path: filePath,
            description: "edit protected file",
            old_string: "report",
            new_string: "updated",
        });

        expect(expectErrorText(result).text).toContain("protectedWriteRoots");
    });
});
