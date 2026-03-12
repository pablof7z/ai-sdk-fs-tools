import { readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { wrapInSystemReminder } from "ai-sdk-system-reminders";
import { isPathWithinDirectory } from "./path-security";

const AGENTS_MD_FILENAME = "AGENTS.md";

export const AGENTS_MD_REMINDER_TYPE = "agents-md";

export interface AgentsMdFile {
    path: string;
    directory: string;
    content: string;
}

export interface AgentsMdVisibilityTracker {
    isVisible: (agentsMdPath: string) => boolean;
    markVisible: (agentsMdPath: string) => void;
}

export interface AgentsMdReminderContext {
    content: string;
    hasReminder: boolean;
    includedFiles: AgentsMdFile[];
}

export interface AgentsMdResolver {
    findFiles: (targetPath: string, projectRoot: string) => Promise<AgentsMdFile[]>;
    hasRootAgentsMd: (projectRoot: string) => Promise<boolean>;
    getRootAgentsMdContent: (projectRoot: string) => Promise<string | null>;
    clearCache: () => void;
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

export function createAgentsMdResolver(): AgentsMdResolver {
    async function isDirectory(targetPath: string): Promise<boolean> {
        try {
            return (await stat(targetPath)).isDirectory();
        } catch {
            return false;
        }
    }

    async function readAgentsMdFile(absolutePath: string): Promise<string | null> {
        try {
            return await readFile(absolutePath, "utf8");
        } catch {
            return null;
        }
    }

    async function findFiles(targetPath: string, projectRoot: string): Promise<AgentsMdFile[]> {
        const absoluteProjectRoot = resolve(projectRoot);
        const absoluteTargetPath = resolve(targetPath);

        if (
            !isPathWithinDirectory(absoluteTargetPath, absoluteProjectRoot) &&
            absoluteTargetPath !== absoluteProjectRoot
        ) {
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

            if (
                !isPathWithinDirectory(currentDir, absoluteProjectRoot) &&
                currentDir !== absoluteProjectRoot
            ) {
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

    async function hasRootAgentsMd(projectRoot: string): Promise<boolean> {
        const content = await readAgentsMdFile(join(resolve(projectRoot), AGENTS_MD_FILENAME));
        return content !== null;
    }

    async function getRootAgentsMdContent(projectRoot: string): Promise<string | null> {
        return readAgentsMdFile(join(resolve(projectRoot), AGENTS_MD_FILENAME));
    }

    function clearCache(): void {
        // No-op retained for backwards compatibility with older callers.
    }

    return {
        findFiles,
        hasRootAgentsMd,
        getRootAgentsMdContent,
        clearCache,
    };
}

export function formatAgentsMdReminder(files: AgentsMdFile[], projectRoot: string): string {
    if (files.length === 0) {
        return "";
    }

    const sections = [...files].reverse().map((file) => {
        const relativePath = relative(projectRoot, file.directory);
        const displayPath = relativePath ? `/${relativePath.replaceAll("\\", "/")}` : "/";
        return `<agents.md path="${displayPath}">\n${file.content.trim()}\n</agents.md>`;
    });

    return `\n${wrapInSystemReminder({
        type: AGENTS_MD_REMINDER_TYPE,
        content: sections.join("\n\n"),
    })}`;
}

export async function getAgentsMdReminderForPath(args: {
    targetPath: string;
    projectRoot: string;
    isTruncated: boolean;
    visibilityTracker: AgentsMdVisibilityTracker;
    resolver: AgentsMdResolver;
}): Promise<AgentsMdReminderContext> {
    const files = await args.resolver.findFiles(args.targetPath, args.projectRoot);
    const newFiles = files.filter((file) => !args.visibilityTracker.isVisible(file.path));

    if (newFiles.length === 0) {
        return {
            content: "",
            hasReminder: false,
            includedFiles: [],
        };
    }

    if (!args.isTruncated) {
        for (const file of newFiles) {
            args.visibilityTracker.markVisible(file.path);
        }
    }

    return {
        content: formatAgentsMdReminder(newFiles, args.projectRoot),
        hasReminder: true,
        includedFiles: newFiles,
    };
}

export async function hasRootAgentsMd(
    projectRoot: string,
    resolver: AgentsMdResolver = createAgentsMdResolver()
): Promise<boolean> {
    return resolver.hasRootAgentsMd(projectRoot);
}

export async function getRootAgentsMdContent(
    projectRoot: string,
    resolver: AgentsMdResolver = createAgentsMdResolver()
): Promise<string | null> {
    return resolver.getRootAgentsMdContent(projectRoot);
}
