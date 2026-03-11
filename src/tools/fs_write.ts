import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
import type { ErrorTextResult, FsTool, FsToolsOptions, FsWriteInput } from "../types";

function buildWriteInputSchema(resolvedOptions: ResolvedFsToolsOptions) {
    const baseFields = {
        path: z.string().describe("Absolute path to the file to write."),
        content: z.string().describe("Content to write to the file."),
        description: z.string().optional().describe("Human-readable reason for the write."),
    };

    if (resolvedOptions.strictContainment) {
        return z.object(baseFields);
    }

    return z.object({
        ...baseFields,
        allowOutsideWorkingDirectory: z
            .boolean()
            .optional()
            .describe("Set to true to write outside the configured roots."),
    });
}

export function createFsWriteTool(options: FsToolsOptions): FsTool<FsWriteInput, string | ErrorTextResult> {
    const resolvedOptions = resolveFsToolsOptions(options);
    const toolName = `${resolvedOptions.namePrefix}_write`;

    const toolInstance = tool({
        description:
            resolvedOptions.descriptions?.write ??
            "Write content to a file. Creates parent directories automatically and overwrites existing files.",
        inputSchema: buildWriteInputSchema(resolvedOptions),
        execute: async (input: FsWriteInput) => {
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

            const allowOutside = resolvedOptions.strictContainment ? false : input.allowOutsideWorkingDirectory;
            if (!isPathAccessible(effectivePath, resolvedOptions, allowOutside)) {
                return createErrorText(buildOutsideRootMessage(effectivePath, resolvedOptions));
            }

            try {
                await mkdir(dirname(effectivePath), { recursive: true });
                await writeFile(effectivePath, input.content, "utf8");
                return `Successfully wrote ${input.content.length} bytes to ${effectivePath}`;
            } catch (error) {
                if (isExpectedFsError(error)) {
                    return createErrorText(`${getFsErrorDescription(error.code)}: ${effectivePath}`);
                }

                throw new Error(`Failed to write ${effectivePath}: ${formatUnknownError(error)}`, {
                    cause: error,
                });
            }
        },
    });

    return toolInstance as FsTool<FsWriteInput, string | ErrorTextResult>;
}
