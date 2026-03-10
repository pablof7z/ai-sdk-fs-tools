import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsTools } from "../index";
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
});
