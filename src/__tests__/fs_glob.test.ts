import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsGlobTool } from "../tools/fs_glob";
import { cleanupTempDir, createTempDir, expectErrorText, writeTextFile } from "./helpers";

describe("createFsGlobTool", () => {
    let workingDirectory: string;
    let outsideDirectory: string;
    let allowedDirectory: string;

    beforeEach(async () => {
        workingDirectory = await createTempDir("ai-sdk-fs-tools-glob-");
        outsideDirectory = await createTempDir("ai-sdk-fs-tools-glob-outside-");
        allowedDirectory = await createTempDir("ai-sdk-fs-tools-glob-allowed-");
    });

    afterEach(async () => {
        await cleanupTempDir(workingDirectory);
        await cleanupTempDir(outsideDirectory);
        await cleanupTempDir(allowedDirectory);
    });

    it("finds matching files and excludes node_modules", async () => {
        await writeTextFile(join(workingDirectory, "src", "a.ts"), "export const a = 1;");
        await writeTextFile(join(workingDirectory, "src", "b.ts"), "export const b = 2;");
        await writeTextFile(join(workingDirectory, "node_modules", "pkg", "ignored.ts"), "ignored");
        const fsGlob = createFsGlobTool({ workingDirectory });

        const result = await fsGlob.execute({
            pattern: "**/*.ts",
            description: "find TypeScript files",
        });

        expect(result).toContain("src/a.ts");
        expect(result).toContain("src/b.ts");
        expect(result).not.toContain("node_modules");
    });

    it("paginates results", async () => {
        await writeTextFile(join(workingDirectory, "src", "a.ts"), "a");
        await writeTextFile(join(workingDirectory, "src", "b.ts"), "b");
        await writeTextFile(join(workingDirectory, "src", "c.ts"), "c");
        const fsGlob = createFsGlobTool({ workingDirectory });

        const result = await fsGlob.execute({
            pattern: "**/*.ts",
            description: "paginate",
            offset: 1,
            head_limit: 1,
        });

        expect(String(result).split("\n")[0]).toMatch(/src\/[abc]\.ts/);
        expect(result).toContain("[Truncated:");
    });

    it("blocks searches outside the sandbox", async () => {
        await writeTextFile(join(outsideDirectory, "outside.ts"), "outside");
        const fsGlob = createFsGlobTool({ workingDirectory });

        const result = await fsGlob.execute({
            pattern: "**/*.ts",
            path: outsideDirectory,
            description: "glob outside",
        });

        expect(expectErrorText(result).text).toContain("outside the configured roots");
    });

    it("allows searches inside allowedRoots", async () => {
        await writeTextFile(join(allowedDirectory, "allowed.ts"), "allowed");
        const fsGlob = createFsGlobTool({
            workingDirectory,
            allowedRoots: [allowedDirectory],
        });

        const result = await fsGlob.execute({
            pattern: "**/*.ts",
            path: allowedDirectory,
            description: "glob allowed",
        });

        expect(result).toContain("../");
        expect(result).toContain("allowed.ts");
    });

    it("blocks symlink search roots that escape the sandbox", async () => {
        await mkdir(join(workingDirectory, "links"), { recursive: true });
        await symlink(outsideDirectory, join(workingDirectory, "links", "outside"));
        const fsGlob = createFsGlobTool({ workingDirectory });

        const result = await fsGlob.execute({
            pattern: "**/*.ts",
            path: join(workingDirectory, "links", "outside"),
            description: "glob via symlink",
        });

        expect(expectErrorText(result).text).toContain("outside the configured roots");
    });
});
