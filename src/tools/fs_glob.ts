import { glob, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { createErrorText } from "../internal/errors";
import { resolveFsToolsOptions } from "../internal/options";
import {
    buildOutsideRootMessage,
    isPathAccessible,
    isPathWithinDirectory,
} from "../internal/path-security";
import type { ErrorTextResult, FsGlobInput, FsTool, FsToolsOptions } from "../types";

const DEFAULT_EXCLUDED_DIRECTORIES = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "coverage",
]);

const fsGlobInputSchema = z.object({
    pattern: z.string().describe("Glob pattern to match files."),
    description: z.string().optional().describe("Human-readable reason for the search."),
    path: z.string().optional().describe("Absolute directory to search within. Defaults to workingDirectory."),
    head_limit: z.number().int().optional().describe("Maximum number of results. Use 0 for unlimited."),
    offset: z.number().int().optional().describe("Skip the first N results."),
    allowOutsideWorkingDirectory: z
        .boolean()
        .optional()
        .describe("Set to true to search outside the configured roots."),
});

function shouldExcludeMatch(matchPath: string): boolean {
    return matchPath.split(sep).some((segment) => DEFAULT_EXCLUDED_DIRECTORIES.has(segment));
}

export function createFsGlobTool(options: FsToolsOptions): FsTool<FsGlobInput, string | ErrorTextResult> {
    const resolvedOptions = resolveFsToolsOptions(options);

    const toolInstance = tool({
        description:
            "Fast glob-based file search. Returns matching file paths relative to workingDirectory, sorted by most recently modified first.",
        inputSchema: fsGlobInputSchema,
        execute: async (input: FsGlobInput) => {
            const description = input.description?.trim();
            if (!description) {
                return createErrorText("description is required");
            }

            if (!input.pattern.trim()) {
                return createErrorText("pattern is required");
            }

            const searchPath = input.path ?? resolvedOptions.workingDirectory;
            if (!searchPath.startsWith("/")) {
                return createErrorText(`Path must be absolute. Received: ${searchPath}`);
            }

            if (!isPathAccessible(searchPath, resolvedOptions, input.allowOutsideWorkingDirectory)) {
                return createErrorText(buildOutsideRootMessage(searchPath, resolvedOptions));
            }

            const headLimit = input.head_limit ?? 100;
            const offset = input.offset ?? 0;
            if (headLimit < 0) {
                return createErrorText("head_limit must be 0 or greater");
            }
            if (offset < 0) {
                return createErrorText("offset must be 0 or greater");
            }

            const pathStats = await stat(searchPath).catch(() => null);
            if (!pathStats) {
                return createErrorText(`File or directory not found: ${searchPath}`);
            }
            if (!pathStats.isDirectory()) {
                return createErrorText(`fs_glob requires a directory path. Received file: ${searchPath}`);
            }

            const matches: Array<{ path: string; mtimeMs: number }> = [];

            try {
                for await (const match of glob(input.pattern, { cwd: searchPath })) {
                    if (shouldExcludeMatch(match)) {
                        continue;
                    }

                    const fullPath = resolve(searchPath, match);
                    if (!isPathWithinDirectory(fullPath, searchPath)) {
                        continue;
                    }

                    const matchStats = await stat(fullPath).catch(() => null);
                    if (!matchStats?.isFile()) {
                        continue;
                    }

                    matches.push({
                        path: relative(resolvedOptions.workingDirectory, fullPath),
                        mtimeMs: matchStats.mtimeMs,
                    });
                }
            } catch (error) {
                return createErrorText(
                    `Glob error for pattern "${input.pattern}": ${error instanceof Error ? error.message : String(error)}`,
                );
            }

            if (matches.length === 0) {
                return `No files found matching pattern: ${input.pattern}`;
            }

            matches.sort((left, right) => right.mtimeMs - left.mtimeMs);
            const paginatedMatches = matches
                .slice(offset)
                .slice(0, headLimit === 0 ? undefined : headLimit);
            const body = paginatedMatches.map((match) => match.path).join("\n");

            if (paginatedMatches.length < matches.length - offset) {
                return `${body}\n\n[Truncated: showing ${paginatedMatches.length} of ${matches.length - offset} files after offset]`;
            }

            return body;
        },
    });

    Object.defineProperty(toolInstance, "getHumanReadableContent", {
        value: ({ pattern, path, description }: FsGlobInput) => {
            const location = path ? ` in ${path}` : "";
            return `Finding files matching "${pattern}"${location} (${description ?? "no description"})`;
        },
        enumerable: false,
        configurable: true,
    });

    return toolInstance as FsTool<FsGlobInput, string | ErrorTextResult>;
}
