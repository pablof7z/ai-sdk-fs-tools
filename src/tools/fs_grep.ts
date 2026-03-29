import { execFile, spawn } from "node:child_process";
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

function parseContentLine(
    line: string,
): { path: string; lineNumber: string; separator: string; contentSeparator: string; content: string } | null {
    const match = /^(.+?)([:\-])(\d+)([:\-])(.*)$/.exec(line);
    if (!match) {
        return null;
    }

    return {
        path: match[1],
        separator: match[2],
        lineNumber: match[3],
        contentSeparator: match[4],
        content: match[5],
    };
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
    maxLines?: number,
): Promise<{ lines: string[]; truncated: boolean }> {
    return await new Promise((resolve, reject) => {
        const child = spawn(executable, args, {
            cwd,
            stdio: ["ignore", "pipe", "pipe"],
        });
        const lines: string[] = [];
        let truncated = false;
        let stoppedEarly = false;
        let stdoutBuffer = "";
        let stderr = "";
        let settled = false;

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");

        const finish = (result: { lines: string[]; truncated: boolean }) => {
            if (settled) {
                return;
            }
            settled = true;
            resolve(result);
        };

        const fail = (error: Error) => {
            if (settled) {
                return;
            }
            settled = true;
            reject(error);
        };

        const stopEarly = () => {
            if (stoppedEarly || settled) {
                return;
            }
            stoppedEarly = true;
            truncated = true;
            child.kill("SIGTERM");
        };

        const pushLine = (line: string) => {
            if (!line) {
                return;
            }

            lines.push(line);
            if (maxLines !== undefined && lines.length >= maxLines) {
                stopEarly();
            }
        };

        const flushStdout = (final: boolean) => {
            while (!settled) {
                const newlineIndex = stdoutBuffer.indexOf("\n");
                if (newlineIndex === -1) {
                    break;
                }

                const rawLine = stdoutBuffer.slice(0, newlineIndex);
                stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
                pushLine(rawLine.replace(/\r$/, ""));
            }

            if (final && !settled && stdoutBuffer.length > 0) {
                pushLine(stdoutBuffer.replace(/\r$/, ""));
                stdoutBuffer = "";
            }
        };

        child.stdout.on("data", (chunk: string) => {
            stdoutBuffer += chunk;
            flushStdout(false);
        });

        child.stderr.on("data", (chunk: string) => {
            stderr += chunk;
        });

        child.on("error", (error) => {
            if (stoppedEarly) {
                finish({ lines, truncated: true });
                return;
            }

            fail(new Error(`Failed to run ${executable}: ${error.message}`));
        });

        child.on("close", (code, signal) => {
            flushStdout(true);

            if (stoppedEarly) {
                finish({ lines, truncated: true });
                return;
            }

            if (code === 0) {
                finish({ lines, truncated });
                return;
            }

            if (code === 1) {
                finish({ lines: [], truncated: false });
                return;
            }

            const detail = stderr.trim() || `${executable} exited with code ${code}${signal ? ` (${signal})` : ""}`;
            fail(new Error(detail));
        });
    });
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
            const countMatch = /^(.+):(\d+)$/.exec(line);
            if (countMatch) {
                return `${relative(workingDirectory, countMatch[1])}:${countMatch[2]}`;
            }
            return line;
        }

        const parsed = parseContentLine(line);
        if (!parsed) {
            return line;
        }

        const relativePath = relative(workingDirectory, parsed.path);
        return `${relativePath}${parsed.separator}${parsed.lineNumber}${parsed.contentSeparator}${parsed.content}`;
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
                const maxLines = headLimit === 0 ? undefined : offset + headLimit + 1;
                const searchResult = await runSearchCommand(
                    executable,
                    args,
                    resolvedOptions.workingDirectory,
                    maxLines,
                );

                if (searchResult.lines.length === 0) {
                    return `No matches found for pattern: ${input.pattern}`;
                }

                const processedLines = relativizeGrepOutput(
                    searchResult.lines,
                    resolvedOptions.workingDirectory,
                    outputMode,
                );
                const paginatedLines = applyPagination(processedLines, offset, headLimit);
                const joined = paginatedLines.join("\n");

                if (outputMode === "content") {
                    const sizeInBytes = Buffer.byteLength(joined, "utf8");
                    if (sizeInBytes > MAX_CONTENT_SIZE) {
                        const fallbackResult = await runSearchCommand(
                            executable,
                            hasRipgrep
                                ? buildRipgrepArgs({ ...input, output_mode: "files_with_matches" }, searchPath)
                                : buildGrepFallbackArgs({ ...input, output_mode: "files_with_matches" }, searchPath),
                            resolvedOptions.workingDirectory,
                            maxLines,
                        );
                        const filePaths = relativizeGrepOutput(
                            fallbackResult.lines,
                            resolvedOptions.workingDirectory,
                            "files_with_matches",
                        );
                        const paginatedFilePaths = applyPagination(filePaths, offset, headLimit);
                        const prefix =
                            "Content output would exceed the size limit.\n" +
                            "Returning matching files instead:\n\n";
                        const availableSpace = MAX_CONTENT_SIZE - Buffer.byteLength(prefix, "utf8") - 200;
                        const hasMoreFiles = fallbackResult.truncated;
                        const { truncated, originalLength } = truncateToMaxSize(
                            paginatedFilePaths.join("\n"),
                            availableSpace,
                        );
                        const note = hasMoreFiles || originalLength > availableSpace
                            ? `\n\n[Truncated: additional matching files omitted]`
                            : "";
                        return `${prefix}${truncated}${note}`;
                    }
                }

                if (searchResult.truncated) {
                    return `${joined}\n\n[Truncated: showing ${paginatedLines.length} results after offset; additional results omitted]`;
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
