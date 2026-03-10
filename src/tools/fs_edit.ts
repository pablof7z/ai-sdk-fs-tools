import { readFile, writeFile } from "node:fs/promises";
import { tool } from "ai";
import { z } from "zod";
import {
    createErrorText,
    formatUnknownError,
    getFsErrorDescription,
    isExpectedFsError,
} from "../internal/errors";
import { resolveFsToolsOptions } from "../internal/options";
import {
    buildOutsideRootMessage,
    buildProtectedWriteMessage,
    isPathAccessible,
    isProtectedWritePath,
} from "../internal/path-security";
import type { ErrorTextResult, FsEditInput, FsTool, FsToolsOptions } from "../types";

const fsEditInputSchema = z.object({
    path: z.string().describe("Absolute path to the file to edit."),
    description: z.string().optional().describe("Human-readable reason for the edit."),
    old_string: z.string().describe("Exact string to replace."),
    new_string: z.string().describe("Replacement string."),
    replace_all: z.boolean().optional().describe("Replace every occurrence instead of requiring a unique match."),
    allowOutsideWorkingDirectory: z
        .boolean()
        .optional()
        .describe("Set to true to edit outside the configured roots."),
});

export function createFsEditTool(options: FsToolsOptions): FsTool<FsEditInput, string | ErrorTextResult> {
    const resolvedOptions = resolveFsToolsOptions(options);

    const toolInstance = tool({
        description:
            "Perform exact string replacements in a file. When replace_all is false, old_string must match exactly once.",
        inputSchema: fsEditInputSchema,
        execute: async (input: FsEditInput) => {
            const description = input.description?.trim();
            if (!description) {
                return createErrorText("description is required");
            }

            if (!input.path.startsWith("/")) {
                return createErrorText(`Path must be absolute. Received: ${input.path}`);
            }

            if (input.old_string === input.new_string) {
                return createErrorText("old_string and new_string must be different");
            }

            if (isProtectedWritePath(input.path, resolvedOptions)) {
                return createErrorText(buildProtectedWriteMessage(input.path));
            }

            if (!isPathAccessible(input.path, resolvedOptions, input.allowOutsideWorkingDirectory)) {
                return createErrorText(buildOutsideRootMessage(input.path, resolvedOptions));
            }

            try {
                const content = await readFile(input.path, "utf8");

                if (!content.includes(input.old_string)) {
                    return createErrorText(
                        `old_string was not found in ${input.path}. Provide an exact match from the file.`,
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
                            `old_string appears multiple times in ${input.path}. Provide more surrounding context or set replace_all: true.`,
                        );
                    }

                    nextContent = content.replace(input.old_string, input.new_string);
                    replacementCount = 1;
                }

                await writeFile(input.path, nextContent, "utf8");
                return `Successfully replaced ${replacementCount} occurrence(s) in ${input.path}`;
            } catch (error) {
                if (isExpectedFsError(error)) {
                    return createErrorText(`${getFsErrorDescription(error.code)}: ${input.path}`);
                }

                throw new Error(`Failed to edit ${input.path}: ${formatUnknownError(error)}`, {
                    cause: error,
                });
            }
        },
    });

    Object.defineProperty(toolInstance, "getHumanReadableContent", {
        value: ({ path, description }: FsEditInput) => `Editing ${path} (${description ?? "no description"})`,
        enumerable: false,
        configurable: true,
    });

    return toolInstance as FsTool<FsEditInput, string | ErrorTextResult>;
}
