import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";
import { tool } from "ai";
import { z } from "zod";
import { createErrorText } from "../internal/errors";
import { resolveFsToolsOptions } from "../internal/options";
import type { ResolvedFsToolsOptions } from "../internal/options";
import {
    buildOutsideRootMessage,
    isPathAccessible,
} from "../internal/path-security";
import type {
    ErrorTextResult,
    FsGrepInput,
    FsTool,
    FsToolsOptions,
    GrepOutputMode,
} from "../types";

const execFileAsync = promisify(execFile);
const MAX_CONTENT_SIZE = 50_000;
const COMMAND_MAX_BUFFER = 10 * 1024 * 1024;

function buildGrepInputSchema(resolvedOptions: ResolvedFsToolsOptions) {
    const baseFields = {
        pattern: z.string().describe("Regex pattern to search for."),
        description: z.string().optional().describe("Human-readable reason for the search."),
        path: z.string().optional().describe("Absolute file or directory to search within."),
        output_mode: z
            .enum(["files_with_matches", "content", "count"])
            .optional()
            .describe("Output mode. Defaults to files_with_matches."),
        glob: z.string().optional().describe("Glob filter for files."),
        type: z.string().optional().describe("Ripgrep file type filter."),
        "-i": z.boolean().optional().describe("Case-insensitive search."),
        "-n": z.boolean().optional().describe("Show line numbers in content mode."),
        "-A": z.number().int().optional().describe("Lines of trailing context in content mode."),
        "-B": z.number().int().optional().describe("Lines of leading context in content mode."),
        "-C": z.number().int().optional().describe("Lines of surrounding context in content mode."),
        multiline: z.boolean().optional().describe("Enable multiline matches."),
        head_limit: z.number().int().optional().describe("Maximum number of results. Use 0 for unlimited."),
        offset: z.number().int().optional().describe("Skip the first N results."),
    };

    if (resolvedOptions.strictContainment) {
        return z.object(baseFields);
    }

    return z.object({
        ...baseFields,
        allowOutsideWorkingDirectory: z
            .boolean()
            .optional()
            .describe("Set to true to search outside the configured roots."),
    });
}

let ripgrepAvailability: Promise<boolean> | undefined;

async function isRipgrepAvailable(): Promise<boolean> {
    if (!ripgrepAvailability) {
        ripgrepAvailability = execFileAsync("rg", ["--version"])
            .then(() => true)
            .catch(() => false);
    }

    return ripgrepAvailability;
}

function buildRipgrepArgs(input: FsGrepInput, searchPath: string): string[] {
    const args: string[] = [];
    const outputMode = input.output_mode ?? "files_with_matches";

    if (outputMode === "files_with_matches") {
        args.push("-l");
    } else if (outputMode === "count") {
        args.push("-c");
    }

    if (outputMode === "content" && input["-n"] !== false) {
        args.push("-n");
    }

    if (input["-i"]) {
        args.push("-i");
    }

    if (input.multiline) {
        args.push("-U", "--multiline-dotall");
    }

    if (outputMode === "content") {
        if ((input["-C"] ?? 0) > 0) {
            args.push("-C", String(input["-C"]));
        } else {
            if ((input["-A"] ?? 0) > 0) {
                args.push("-A", String(input["-A"]));
            }
            if ((input["-B"] ?? 0) > 0) {
                args.push("-B", String(input["-B"]));
            }
        }
    }

    if (input.type) {
        args.push("--type", input.type);
    }

    if (input.glob) {
        args.push("--glob", input.glob);
    }

    args.push("--glob", "!node_modules");
    args.push("--glob", "!.git");
    args.push("--glob", "!dist");
    args.push("--glob", "!build");
    args.push("--glob", "!.next");
    args.push("--glob", "!coverage");
    args.push("--", input.pattern, searchPath);

    return args;
}

function buildGrepFallbackArgs(input: FsGrepInput, searchPath: string): string[] {
    const args = ["-r", "-E"];
    const outputMode = input.output_mode ?? "files_with_matches";

    if (outputMode === "files_with_matches") {
        args.push("-l");
    } else if (outputMode === "count") {
        args.push("-c");
    }

    if (outputMode === "content" && input["-n"] !== false) {
        args.push("-n");
    }

    if (input["-i"]) {
        args.push("-i");
    }

    if (outputMode === "content") {
        if ((input["-C"] ?? 0) > 0) {
            args.push("-C", String(input["-C"]));
        } else {
            if ((input["-A"] ?? 0) > 0) {
                args.push("-A", String(input["-A"]));
            }
            if ((input["-B"] ?? 0) > 0) {
                args.push("-B", String(input["-B"]));
            }
        }
    }

    if (input.glob) {
        args.push(`--include=${input.glob}`);
    }

    args.push("--exclude-dir=node_modules");
    args.push("--exclude-dir=.git");
    args.push("--exclude-dir=dist");
    args.push("--exclude-dir=build");
    args.push("--exclude-dir=.next");
    args.push("--exclude-dir=coverage");
    args.push("--binary-files=without-match");
    args.push(input.pattern);
    args.push(searchPath);

    return args;
}

function applyPagination<T>(items: T[], offset: number, limit: number): T[] {
    const sliced = items.slice(offset);
    return limit === 0 ? sliced : sliced.slice(0, limit);
}

function extractFilePathsFromContent(lines: string[]): string[] {
    const uniquePaths = new Set<string>();

    for (const line of lines) {
        const firstColon = line.indexOf(":");
        if (firstColon > 0) {
            uniquePaths.add(line.slice(0, firstColon));
        }
    }

    return Array.from(uniquePaths);
}

function truncateToMaxSize(text: string, maxBytes: number): { truncated: string; originalLength: number } {
    const originalLength = Buffer.byteLength(text, "utf8");
    if (originalLength <= maxBytes) {
        return { truncated: text, originalLength };
    }

    const lines = text.split("\n");
    let left = 0;
    let right = lines.length;
    let bestFit = 0;

    while (left <= right) {
        const middle = Math.floor((left + right) / 2);
        const candidate = lines.slice(0, middle).join("\n");
        if (Buffer.byteLength(candidate, "utf8") <= maxBytes) {
            bestFit = middle;
            left = middle + 1;
        } else {
            right = middle - 1;
        }
    }

    return {
        truncated: lines.slice(0, bestFit).join("\n"),
        originalLength,
    };
}

async function runSearchCommand(
    executable: "rg" | "grep",
    args: string[],
    cwd: string,
): Promise<string[]> {
    try {
        const { stdout } = await execFileAsync(executable, args, {
            cwd,
            timeout: 30_000,
            maxBuffer: COMMAND_MAX_BUFFER,
        });

        if (!stdout.trim()) {
            return [];
        }

        return stdout.trim().split("\n").filter(Boolean);
    } catch (error) {
        const errorCode = (error as { code?: number | string }).code;
        if (errorCode === 1) {
            return [];
        }
        throw error;
    }
}

function relativizeGrepOutput(
    lines: string[],
    workingDirectory: string,
    outputMode: GrepOutputMode,
): string[] {
    return lines.map((line) => {
        if (outputMode === "files_with_matches") {
            return relative(workingDirectory, line);
        }

        if (outputMode === "count") {
            const separatorIndex = line.lastIndexOf(":");
            if (separatorIndex > 0) {
                const filePath = line.slice(0, separatorIndex);
                const count = line.slice(separatorIndex + 1);
                return `${relative(workingDirectory, filePath)}:${count}`;
            }
            return line;
        }

        const prefix = `${workingDirectory}/`;
        return line.startsWith(prefix) ? line.slice(prefix.length) : line;
    });
}

export function createFsGrepTool(options: FsToolsOptions): FsTool<FsGrepInput, string | ErrorTextResult> {
    const resolvedOptions = resolveFsToolsOptions(options);
    const toolName = `${resolvedOptions.namePrefix}_grep`;

    const toolInstance = tool({
        description:
            resolvedOptions.descriptions?.grep ??
            "Search file contents with ripgrep, with grep as a fallback. Supports content, file-list, and count modes.",
        inputSchema: buildGrepInputSchema(resolvedOptions),
        execute: async (input: FsGrepInput) => {
            if (resolvedOptions.beforeExecute) {
                try {
                    resolvedOptions.beforeExecute(toolName, input as unknown as Record<string, unknown>);
                } catch (error) {
                    return createErrorText(error instanceof Error ? error.message : String(error));
                }
            }

            const description = input.description?.trim();
            if (!description) {
                return createErrorText("description is required");
            }

            if (!input.pattern.trim()) {
                return createErrorText("pattern is required");
            }

            let searchPath = input.path ?? resolvedOptions.workingDirectory;
            if (resolvedOptions.strictContainment && !searchPath.startsWith("/")) {
                searchPath = resolve(resolvedOptions.workingDirectory, searchPath);
            }

            if (!searchPath.startsWith("/")) {
                return createErrorText(`Path must be absolute. Received: ${searchPath}`);
            }

            const allowOutside = resolvedOptions.strictContainment ? false : input.allowOutsideWorkingDirectory;
            if (!isPathAccessible(searchPath, resolvedOptions, allowOutside)) {
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

            const outputMode = input.output_mode ?? "files_with_matches";
            const hasRipgrep = await isRipgrepAvailable();

            if (!hasRipgrep && input.multiline) {
                return createErrorText("multiline searches require ripgrep to be installed");
            }

            if (!hasRipgrep && input.type) {
                return createErrorText("type filters require ripgrep to be installed");
            }

            try {
                const executable = hasRipgrep ? "rg" : "grep";
                const args = hasRipgrep
                    ? buildRipgrepArgs(input, searchPath)
                    : buildGrepFallbackArgs(input, searchPath);

                let lines: string[];
                try {
                    lines = await runSearchCommand(executable, args, resolvedOptions.workingDirectory);
                } catch (error) {
                    if (
                        outputMode === "content" &&
                        error instanceof Error &&
                        error.message.includes("maxBuffer")
                    ) {
                        const fallbackLines = await runSearchCommand(
                            executable,
                            hasRipgrep
                                ? buildRipgrepArgs({ ...input, output_mode: "files_with_matches" }, searchPath)
                                : buildGrepFallbackArgs({ ...input, output_mode: "files_with_matches" }, searchPath),
                            resolvedOptions.workingDirectory,
                        );

                        const fallbackProcessed = relativizeGrepOutput(
                            fallbackLines,
                            resolvedOptions.workingDirectory,
                            "files_with_matches",
                        );
                        const paginatedFallback = applyPagination(fallbackProcessed, offset, headLimit);
                        const prefix =
                            "Content output would exceed the size limit.\n" +
                            "Returning matching files instead:\n\n";
                        const availableSpace = MAX_CONTENT_SIZE - Buffer.byteLength(prefix, "utf8") - 200;
                        const { truncated, originalLength } = truncateToMaxSize(
                            paginatedFallback.join("\n"),
                            availableSpace,
                        );
                        const note = originalLength > availableSpace
                            ? `\n\n[Output truncated to ${MAX_CONTENT_SIZE} bytes]`
                            : "";
                        return `${prefix}${truncated}${note}`;
                    }

                    throw error;
                }

                if (lines.length === 0) {
                    return `No matches found for pattern: ${input.pattern}`;
                }

                const processedLines = relativizeGrepOutput(
                    lines,
                    resolvedOptions.workingDirectory,
                    outputMode,
                );
                const paginatedLines = applyPagination(processedLines, offset, headLimit);
                const joined = paginatedLines.join("\n");

                if (outputMode === "content") {
                    const sizeInBytes = Buffer.byteLength(joined, "utf8");
                    if (sizeInBytes > MAX_CONTENT_SIZE) {
                        const filePaths = extractFilePathsFromContent(processedLines);
                        const paginatedFilePaths = applyPagination(filePaths, offset, headLimit);
                        const prefix =
                            "Content output would exceed the size limit.\n" +
                            "Returning matching files instead:\n\n";
                        const availableSpace = MAX_CONTENT_SIZE - Buffer.byteLength(prefix, "utf8") - 200;
                        const { truncated, originalLength } = truncateToMaxSize(
                            paginatedFilePaths.join("\n"),
                            availableSpace,
                        );
                        const note = originalLength > availableSpace
                            ? `\n\n[Output truncated to ${MAX_CONTENT_SIZE} bytes]`
                            : "";
                        return `${prefix}${truncated}${note}`;
                    }
                }

                if (paginatedLines.length < processedLines.length - offset) {
                    return `${joined}\n\n[Truncated: showing ${paginatedLines.length} of ${processedLines.length - offset} results after offset]`;
                }

                return joined;
            } catch (error) {
                return createErrorText(
                    `Grep error for pattern "${input.pattern}": ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        },
    });

    return toolInstance as FsTool<FsGrepInput, string | ErrorTextResult>;
}
