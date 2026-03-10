import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { isPathWithinDirectory } from "./path-security";

const AGENTS_MD_FILENAME = "AGENTS.md";

interface AgentsMdFile {
    path: string;
    directory: string;
    content: string;
}

interface AgentsMdVisibilityTracker {
    isVisible: (agentsMdPath: string) => boolean;
    markVisible: (agentsMdPath: string) => void;
}

export interface AgentsMdReminderContext {
    content: string;
    hasReminder: boolean;
}

export function createAgentsMdVisibilityTracker(): AgentsMdVisibilityTracker {
    const visiblePaths = new Set<string>();

    return {
        isVisible(agentsMdPath: string): boolean {
            return visiblePaths.has(resolve(agentsMdPath));
        },
        markVisible(agentsMdPath: string): void {
            visiblePaths.add(resolve(agentsMdPath));
        },
    };
}

export function createAgentsMdResolver() {
    const contentCache = new Map<string, string | null>();

    async function isDirectory(targetPath: string): Promise<boolean> {
        try {
            return (await stat(targetPath)).isDirectory();
        } catch {
            return false;
        }
    }

    async function readAgentsMdFile(absolutePath: string): Promise<string | null> {
        if (contentCache.has(absolutePath)) {
            return contentCache.get(absolutePath) ?? null;
        }

        try {
            if (!existsSync(absolutePath)) {
                contentCache.set(absolutePath, null);
                return null;
            }

            const content = await readFile(absolutePath, "utf8");
            contentCache.set(absolutePath, content);
            return content;
        } catch {
            contentCache.set(absolutePath, null);
            return null;
        }
    }

    async function findFiles(targetPath: string, projectRoot: string): Promise<AgentsMdFile[]> {
        const absoluteProjectRoot = resolve(projectRoot);
        const absoluteTargetPath = resolve(targetPath);

        if (!isPathWithinDirectory(absoluteTargetPath, absoluteProjectRoot) && absoluteTargetPath !== absoluteProjectRoot) {
            return [];
        }

        let currentDir = absoluteTargetPath;
        if (!(await isDirectory(absoluteTargetPath))) {
            currentDir = dirname(absoluteTargetPath);
        }

        const files: AgentsMdFile[] = [];
        const visited = new Set<string>();

        while (true) {
            if (visited.has(currentDir)) {
                break;
            }
            visited.add(currentDir);

            if (!isPathWithinDirectory(currentDir, absoluteProjectRoot) && currentDir !== absoluteProjectRoot) {
                break;
            }

            const agentsMdPath = join(currentDir, AGENTS_MD_FILENAME);
            const content = await readAgentsMdFile(agentsMdPath);
            if (content !== null) {
                files.push({
                    path: agentsMdPath,
                    directory: currentDir,
                    content,
                });
            }

            if (currentDir === absoluteProjectRoot) {
                break;
            }

            const parentDir = dirname(currentDir);
            if (parentDir === currentDir) {
                break;
            }
            currentDir = parentDir;
        }

        return files;
    }

    return {
        findFiles,
    };
}

function formatSystemReminder(files: AgentsMdFile[], projectRoot: string): string {
    if (files.length === 0) {
        return "";
    }

    const sections = [...files].reverse().map((file) => {
        const relativePath = relative(projectRoot, file.directory);
        const displayPath = relativePath ? `/${relativePath.replaceAll("\\", "/")}` : "/";
        return `<agents.md path="${displayPath}">\n${file.content.trim()}\n</agents.md>`;
    });

    return `\n<system-reminder type="AGENTS.md">\n${sections.join("\n\n")}\n</system-reminder>`;
}

export async function getAgentsMdReminderForPath(args: {
    targetPath: string;
    projectRoot: string;
    isTruncated: boolean;
    visibilityTracker: AgentsMdVisibilityTracker;
    resolver: ReturnType<typeof createAgentsMdResolver>;
}): Promise<AgentsMdReminderContext> {
    const files = await args.resolver.findFiles(args.targetPath, args.projectRoot);
    const newFiles = files.filter((file) => !args.visibilityTracker.isVisible(file.path));

    if (newFiles.length === 0) {
        return {
            content: "",
            hasReminder: false,
        };
    }

    if (!args.isTruncated) {
        for (const file of newFiles) {
            args.visibilityTracker.markVisible(file.path);
        }
    }

    return {
        content: formatSystemReminder(newFiles, args.projectRoot),
        hasReminder: true,
    };
}
