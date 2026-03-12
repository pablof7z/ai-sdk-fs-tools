import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    createAgentsMdResolver,
    createAgentsMdVisibilityTracker,
    getAgentsMdReminderForPath,
    getRootAgentsMdContent,
    hasRootAgentsMd,
} from "../agents-md";
import { cleanupTempDir, createTempDir, writeTextFile } from "./helpers";

describe("agents-md helpers", () => {
    let projectRoot: string;

    beforeEach(async () => {
        projectRoot = await createTempDir("ai-sdk-fs-tools-agents-md-");
    });

    afterEach(async () => {
        await cleanupTempDir(projectRoot);
    });

    it("reports whether the root AGENTS.md exists and returns its content", async () => {
        const resolver = createAgentsMdResolver();

        expect(await hasRootAgentsMd(projectRoot, resolver)).toBe(false);
        expect(await getRootAgentsMdContent(projectRoot, resolver)).toBeNull();

        await writeTextFile(join(projectRoot, "AGENTS.md"), "# Root rule");

        expect(await hasRootAgentsMd(projectRoot, resolver)).toBe(true);
        expect(await getRootAgentsMdContent(projectRoot, resolver)).toBe("# Root rule");
    });

    it("re-reads updated root AGENTS.md content instead of serving stale data", async () => {
        const resolver = createAgentsMdResolver();

        await writeTextFile(join(projectRoot, "AGENTS.md"), "# Root rule");
        expect(await getRootAgentsMdContent(projectRoot, resolver)).toBe("# Root rule");

        await writeTextFile(join(projectRoot, "AGENTS.md"), "# Updated rule");
        expect(await getRootAgentsMdContent(projectRoot, resolver)).toBe("# Updated rule");
    });

    it("returns included files when building a reminder for a path", async () => {
        await writeTextFile(join(projectRoot, "AGENTS.md"), "# Root rule");
        await writeTextFile(join(projectRoot, "src", "AGENTS.md"), "# Src rule");
        await writeTextFile(join(projectRoot, "src", "index.ts"), "export const x = 1;");

        const resolver = createAgentsMdResolver();
        const reminder = await getAgentsMdReminderForPath({
            targetPath: join(projectRoot, "src", "index.ts"),
            projectRoot,
            isTruncated: false,
            visibilityTracker: createAgentsMdVisibilityTracker(),
            resolver,
        });

        expect(reminder.hasReminder).toBe(true);
        expect(reminder.includedFiles).toHaveLength(2);
        expect(reminder.content).toContain('<system-reminder type="agents-md">');
        expect(reminder.content).toContain('<agents.md path="/src">');
        expect(reminder.content).toContain('<agents.md path="/">');
    });
});
