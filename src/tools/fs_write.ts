import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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
import type { ErrorTextResult, FsTool, FsToolsOptions, FsWriteInput } from "../types";

const fsWriteInputSchema = z.object({
    path: z.string().describe("Absolute path to the file to write."),
    content: z.string().describe("Content to write to the file."),
    description: z.string().optional().describe("Human-readable reason for the write."),
    allowOutsideWorkingDirectory: z
        .boolean()
        .optional()
        .describe("Set to true to write outside the configured roots."),
});

export function createFsWriteTool(options: FsToolsOptions): FsTool<FsWriteInput, string | ErrorTextResult> {
    const resolvedOptions = resolveFsToolsOptions(options);

    const toolInstance = tool({
        description:
            "Write content to a file. Creates parent directories automatically, overwrites existing files, and blocks writes to protectedWriteRoots.",
        inputSchema: fsWriteInputSchema,
        execute: async (input: FsWriteInput) => {
            const description = input.description?.trim();
            if (!description) {
                return createErrorText("description is required");
            }

            if (!input.path.startsWith("/")) {
                return createErrorText(`Path must be absolute. Received: ${input.path}`);
            }

            if (isProtectedWritePath(input.path, resolvedOptions)) {
                return createErrorText(buildProtectedWriteMessage(input.path));
            }

            if (!isPathAccessible(input.path, resolvedOptions, input.allowOutsideWorkingDirectory)) {
                return createErrorText(buildOutsideRootMessage(input.path, resolvedOptions));
            }

            try {
                await mkdir(dirname(input.path), { recursive: true });
                await writeFile(input.path, input.content, "utf8");
                return `Successfully wrote ${input.content.length} bytes to ${input.path}`;
            } catch (error) {
                if (isExpectedFsError(error)) {
                    return createErrorText(`${getFsErrorDescription(error.code)}: ${input.path}`);
                }

                throw new Error(`Failed to write ${input.path}: ${formatUnknownError(error)}`, {
                    cause: error,
                });
            }
        },
    });

    Object.defineProperty(toolInstance, "getHumanReadableContent", {
        value: ({ path, description }: FsWriteInput) => `Writing ${path} (${description ?? "no description"})`,
        enumerable: false,
        configurable: true,
    });

    return toolInstance as FsTool<FsWriteInput, string | ErrorTextResult>;
}
