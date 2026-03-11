import { mkdir, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});
