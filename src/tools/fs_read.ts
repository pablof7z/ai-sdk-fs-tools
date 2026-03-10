import { readdir, readFile, stat } from "node:fs/promises";
import { tool } from "ai";
import { z } from "zod";
import {
    createAgentsMdResolver,
    createAgentsMdVisibilityTracker,
    getAgentsMdReminderForPath,
} from "../internal/agents-md";
import {
    createErrorText,
    formatUnknownError,
    getFsErrorDescription,
    isExpectedFsError,
    isExpectedNotFoundError,
} from "../internal/errors";
import { resolveFsToolsOptions } from "../internal/options";
import {
    buildOutsideRootMessage,
    isPathAccessible,
} from "../internal/path-security";
import type { ErrorTextResult, FsReadInput, FsTool, FsToolsOptions } from "../types";

const DEFAULT_LINE_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;

const fsReadInputSchema = z.object({
    path: z.string().optional().describe("Absolute path to the file or directory to read."),
    tool: z.string().optional().describe("Caller-defined tool result identifier to load via loadToolResult."),
    description: z.string().optional().describe("Human-readable reason for the read."),
    offset: z.number().int().optional().describe("1-based line number to start from."),
    limit: z.number().int().optional().describe(`Maximum number of lines to read. Defaults to ${DEFAULT_LINE_LIMIT}.`),
    allowOutsideWorkingDirectory: z
        .boolean()
        .optional()
        .describe("Set to true to read outside the configured roots."),
    prompt: z.string().optional().describe("Optional analysis prompt processed through analyzeContent."),
});

interface ReadPathResult {
    content: string;
    isTruncated: boolean;
}

async function executePathRead(
    path: string,
    input: FsReadInput,
    options: ReturnType<typeof resolveFsToolsOptions>,
): Promise<ReadPathResult | ErrorTextResult> {
    if (!path.startsWith("/")) {
        return createErrorText(`Path must be absolute. Received: ${path}`);
    }

    if (!isPathAccessible(path, options, input.allowOutsideWorkingDirectory)) {
        return createErrorText(buildOutsideRootMessage(path, options));
    }

    const startLine = input.offset ?? 1;
    if (startLine < 1) {
        return createErrorText("offset must be at least 1");
    }

    const effectiveLimit = input.limit ?? DEFAULT_LINE_LIMIT;
    if (effectiveLimit < 1) {
        return createErrorText("limit must be at least 1");
    }

    const fileStats = await stat(path);
    if (fileStats.isDirectory()) {
        const entries = (await readdir(path)).sort((left, right) => left.localeCompare(right));
        const listing = entries.map((entry) => `  - ${entry}`).join("\n");
        return {
            content: `Directory listing for ${path}:\n${listing}\n\nTo read a specific file, pass its absolute path.`,
            isTruncated: false,
        };
    }

    const rawContent = await readFile(path, "utf8");
    const lines = rawContent.split("\n");
    const totalLines = lines.length;
    const startIndex = startLine - 1;

    if (startIndex >= totalLines) {
        return createErrorText(
            `File has ${totalLines} line(s), but offset ${startLine} was requested.`,
        );
    }

    const endIndex = Math.min(startIndex + effectiveLimit, totalLines);
    const selectedLines = lines.slice(startIndex, endIndex);
    const numberedLines = selectedLines
        .map((line, index) => {
            const lineNumber = (startIndex + index + 1).toString().padStart(6);
            const truncatedLine = line.length > MAX_LINE_LENGTH
                ? `${line.slice(0, MAX_LINE_LENGTH)}...`
                : line;
            return `${lineNumber}\t${truncatedLine}`;
        })
        .join("\n");

    if (endIndex < totalLines) {
        const remainingLines = totalLines - endIndex;
        return {
            content:
                `${numberedLines}\n\n` +
                `[Showing lines ${startLine}-${endIndex} of ${totalLines}. ` +
                `${remainingLines} more lines available. Use offset=${endIndex + 1} to continue.]`,
            isTruncated: true,
        };
    }

    return {
        content: numberedLines,
        isTruncated: false,
    };
}

export function createFsReadTool(options: FsToolsOptions): FsTool<FsReadInput, string | ErrorTextResult> {
    const resolvedOptions = resolveFsToolsOptions(options);
    const agentsMdResolver = createAgentsMdResolver(resolvedOptions.agentsMd.filename);
    const visibilityTracker = createAgentsMdVisibilityTracker();

    const toolInstance = tool({
        description:
            `Read a file, directory, or caller-defined tool result. File reads include line numbers, ` +
            `default to ${DEFAULT_LINE_LIMIT} lines, and truncate lines over ${MAX_LINE_LENGTH} characters. ` +
            `Paths must be absolute. Reading outside the configured roots requires allowOutsideWorkingDirectory: true.`,
        inputSchema: fsReadInputSchema,
        execute: async (input: FsReadInput) => {
            const description = input.description?.trim();
            if (!description) {
                return createErrorText("description is required");
            }

            if (Boolean(input.path) === Boolean(input.tool)) {
                return createErrorText("Provide exactly one of 'path' or 'tool'.");
            }

            const target = input.tool ? `tool result ${input.tool}` : input.path ?? "(missing path)";

            try {
                let content: string;
                let source: string;

                if (input.tool) {
                    if (!resolvedOptions.loadToolResult) {
                        return createErrorText(
                            "The 'tool' parameter requires a loadToolResult hook in createFsReadTool().",
                        );
                    }

                    try {
                        content = await resolvedOptions.loadToolResult(input.tool);
                    } catch (error) {
                        return createErrorText(formatUnknownError(error));
                    }
                    source = `tool result ${input.tool}`;
                } else {
                    const pathReadResult = await executePathRead(input.path!, input, resolvedOptions);
                    if (typeof pathReadResult === "object" && "type" in pathReadResult) {
                        return pathReadResult;
                    }

                    content = pathReadResult.content;
                    source = input.path!;

                    if (resolvedOptions.agentsMd.enabled) {
                        const reminder = await getAgentsMdReminderForPath({
                            targetPath: input.path!,
                            projectRoot: resolvedOptions.agentsMd.projectRoot,
                            isTruncated: pathReadResult.isTruncated,
                            resolver: agentsMdResolver,
                            visibilityTracker,
                        });

                        if (reminder.hasReminder) {
                            content += reminder.content;
                        }
                    }
                }

                if (input.prompt) {
                    if (!resolvedOptions.analyzeContent) {
                        return createErrorText(
                            "The 'prompt' parameter requires an analyzeContent hook in createFsReadTool().",
                        );
                    }

                    try {
                        return await resolvedOptions.analyzeContent({
                            content,
                            source,
                            prompt: input.prompt,
                        });
                    } catch (error) {
                        return `[Analysis failed: ${formatUnknownError(error)}]\n\n${content}`;
                    }
                }

                return content;
            } catch (error) {
                if (isExpectedFsError(error)) {
                    return createErrorText(`${getFsErrorDescription(error.code)}: ${target}`);
                }

                if (isExpectedNotFoundError(error)) {
                    return createErrorText(formatUnknownError(error));
                }

                throw new Error(`Failed to read ${target}: ${formatUnknownError(error)}`, {
                    cause: error,
                });
            }
        },
    });

    Object.defineProperty(toolInstance, "getHumanReadableContent", {
        value: ({ path, tool: toolId, description, prompt }: FsReadInput) => {
            const action = prompt ? "Analyzing" : "Reading";
            if (toolId) {
                return `${action} tool result ${toolId.slice(0, 16)}... (${description ?? "no description"})`;
            }
            return `${action} ${path} (${description ?? "no description"})`;
        },
        enumerable: false,
        configurable: true,
    });

    return toolInstance as FsTool<FsReadInput, string | ErrorTextResult>;
}
