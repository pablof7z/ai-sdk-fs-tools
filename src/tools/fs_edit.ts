import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import {
    createErrorText,
    formatUnknownError,
    getFsErrorDescription,
    isExpectedFsError,
} from "../internal/errors";
import { resolveFsToolsOptions } from "../internal/options";
import type { ResolvedFsToolsOptions } from "../internal/options";
import {
    buildOutsideRootMessage,
    isPathAccessible,
} from "../internal/path-security";
import type { ErrorTextResult, FsEditInput, FsTool, FsToolsOptions } from "../types";

function buildEditInputSchema(resolvedOptions: ResolvedFsToolsOptions) {
    const baseFields = {
        path: z.string().describe("Absolute path to the file to edit."),
        description: z.string().optional().describe("Human-readable reason for the edit."),
        old_string: z.string().describe("Exact string to replace."),
        new_string: z.string().describe("Replacement string."),
        replace_all: z.boolean().optional().describe("Replace every occurrence instead of requiring a unique match."),
    };

    if (resolvedOptions.strictContainment) {
        return z.object(baseFields);
    }

    return z.object({
        ...baseFields,
        allowOutsideWorkingDirectory: z
            .boolean()
            .optional()
            .describe("Set to true to edit outside the configured roots."),
    });
}

export function createFsEditTool(options: FsToolsOptions): FsTool<FsEditInput, string | ErrorTextResult> {
    const resolvedOptions = resolveFsToolsOptions(options);
    const toolName = `${resolvedOptions.namePrefix}_edit`;

    const toolInstance = tool({
        description:
            resolvedOptions.descriptions?.edit ??
            "Perform exact string replacements in a file. When replace_all is false, old_string must match exactly once.",
        inputSchema: buildEditInputSchema(resolvedOptions),
        execute: async (input: FsEditInput) => {
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

            let effectivePath = input.path;
            if (resolvedOptions.strictContainment && !effectivePath.startsWith("/")) {
                effectivePath = resolve(resolvedOptions.workingDirectory, effectivePath);
            }

            if (!effectivePath.startsWith("/")) {
                return createErrorText(`Path must be absolute. Received: ${effectivePath}`);
            }

            if (input.old_string === input.new_string) {
                return createErrorText("old_string and new_string must be different");
            }

            const allowOutside = resolvedOptions.strictContainment ? false : input.allowOutsideWorkingDirectory;
            if (!isPathAccessible(effectivePath, resolvedOptions, allowOutside)) {
                return createErrorText(buildOutsideRootMessage(effectivePath, resolvedOptions));
            }

            try {
                const content = await readFile(effectivePath, "utf8");

                if (!content.includes(input.old_string)) {
                    return createErrorText(
                        `old_string not found in ${effectivePath}. Make sure you're using the exact string from the file.`,
                    );
                }

                let replacementCount = 0;
                let nextContent = content;

                if (input.replace_all) {
                    const escapedOldString = input.old_string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                    const matcher = new RegExp(escapedOldString, "g");
                    replacementCount = (content.match(matcher) ?? []).length;
                    nextContent = content.replace(matcher, input.new_string);
                } else {
                    const firstIndex = content.indexOf(input.old_string);
                    const lastIndex = content.lastIndexOf(input.old_string);

                    if (firstIndex !== lastIndex) {
                        return createErrorText(
                            `old_string appears multiple times in ${effectivePath}. Provide more surrounding context or set replace_all: true.`,
                        );
                    }

                    nextContent = content.replace(input.old_string, input.new_string);
                    replacementCount = 1;
                }

                await writeFile(effectivePath, nextContent, "utf8");
                return `Successfully replaced ${replacementCount} occurrence(s) in ${effectivePath}`;
            } catch (error) {
                if (isExpectedFsError(error)) {
                    return createErrorText(`${getFsErrorDescription(error.code)}: ${effectivePath}`);
                }

                throw new Error(`Failed to edit ${effectivePath}: ${formatUnknownError(error)}`, {
                    cause: error,
                });
            }
        },
    });

    return toolInstance as FsTool<FsEditInput, string | ErrorTextResult>;
}
