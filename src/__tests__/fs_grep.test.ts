import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsGrepTool } from "../tools/fs_grep";
import { cleanupTempDir, createTempDir, expectErrorText, writeTextFile } from "./helpers";

describe("createFsGrepTool", () => {
    let workingDirectory: string;
    let outsideDirectory: string;
    let allowedDirectory: string;

    beforeEach(async () => {
        workingDirectory = await createTempDir("ai-sdk-fs-tools-grep-");
        outsideDirectory = await createTempDir("ai-sdk-fs-tools-grep-outside-");
        allowedDirectory = await createTempDir("ai-sdk-fs-tools-grep-allowed-");
    });

    afterEach(async () => {
        await cleanupTempDir(workingDirectory);
        await cleanupTempDir(outsideDirectory);
        await cleanupTempDir(allowedDirectory);
    });

    it("returns matching file paths", async () => {
        await writeTextFile(join(workingDirectory, "src", "a.ts"), "const target = true;");
        await writeTextFile(join(workingDirectory, "src", "b.ts"), "const other = true;");
        const fsGrep = createFsGrepTool({ workingDirectory });

        const result = await fsGrep.execute({
            pattern: "target",
            description: "find target",
        });

        expect(result).toContain("src/a.ts");
        expect(result).not.toContain("src/b.ts");
    });

    it("supports content mode with line numbers", async () => {
        await writeTextFile(join(workingDirectory, "src", "a.ts"), "const target = true;");
        const fsGrep = createFsGrepTool({ workingDirectory });

        const result = await fsGrep.execute({
            pattern: "target",
            description: "content grep",
            output_mode: "content",
        });

        expect(result).toContain("src/a.ts:1:const target = true;");
    });

    it("supports count mode", async () => {
        await writeTextFile(join(workingDirectory, "src", "a.ts"), "target\ntarget\nother");
        const fsGrep = createFsGrepTool({ workingDirectory });

        const result = await fsGrep.execute({
            pattern: "target",
            description: "count grep",
            output_mode: "count",
        });

        expect(result).toContain("src/a.ts:2");
    });

    it("blocks searches outside the sandbox", async () => {
        await writeTextFile(join(outsideDirectory, "outside.ts"), "target");
        const fsGrep = createFsGrepTool({ workingDirectory });

        const result = await fsGrep.execute({
            pattern: "target",
            description: "grep outside",
            path: outsideDirectory,
        });

        expect(expectErrorText(result).text).toContain("outside the configured roots");
    });

    it("allows searches inside allowedRoots", async () => {
        await writeTextFile(join(allowedDirectory, "allowed.ts"), "target");
        const fsGrep = createFsGrepTool({
            workingDirectory,
            allowedRoots: [allowedDirectory],
        });

        const result = await fsGrep.execute({
            pattern: "target",
            description: "grep allowed",
            path: allowedDirectory,
        });

        expect(result).toContain("allowed.ts");
    });

    it("blocks symlink search roots that escape the sandbox", async () => {
        await mkdir(join(workingDirectory, "links"), { recursive: true });
        await symlink(outsideDirectory, join(workingDirectory, "links", "outside"));
        const fsGrep = createFsGrepTool({ workingDirectory });

        const result = await fsGrep.execute({
            pattern: "target",
            description: "grep via symlink",
            path: join(workingDirectory, "links", "outside"),
        });

        expect(expectErrorText(result).text).toContain("outside the configured roots");
    });
});
