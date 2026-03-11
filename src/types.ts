import type { Tool as CoreTool } from "ai";

export type FsToolName = string;

export interface AgentsMdOptions {
    projectRoot?: string;
}

export interface AnalyzeContentArgs {
    content: string;
    source: string;
    prompt: string;
}

export type AnalyzeContentHook = (args: AnalyzeContentArgs) => Promise<string>;

export type LoadToolResultHook = (id: string) => Promise<string>;

export interface FsToolsOptions {
    workingDirectory: string;
    allowedRoots?: string[];
    namePrefix?: string;
    descriptions?: {
        read?: string;
        write?: string;
        edit?: string;
        glob?: string;
        grep?: string;
    };
    strictContainment?: boolean;
    agentsMd?: false | AgentsMdOptions;
    loadToolResult?: LoadToolResultHook;
    analyzeContent?: AnalyzeContentHook;
    beforeExecute?: (toolName: FsToolName, input: Record<string, unknown>) => void;
    formatOutsideRootsError?: (path: string, workingDirectory: string) => string;
}

export interface ErrorTextResult {
    type: "error-text";
    text: string;
}

export interface FsReadInput {
    path?: string;
    tool?: string;
    description?: string;
    offset?: number;
    limit?: number;
    allowOutsideWorkingDirectory?: boolean;
    prompt?: string;
}

export interface FsWriteInput {
    path: string;
    content: string;
    description?: string;
    allowOutsideWorkingDirectory?: boolean;
}

export interface FsEditInput {
    path: string;
    description?: string;
    old_string: string;
    new_string: string;
    replace_all?: boolean;
    allowOutsideWorkingDirectory?: boolean;
}

export interface FsGlobInput {
    pattern: string;
    description?: string;
    path?: string;
    head_limit?: number;
    offset?: number;
    allowOutsideWorkingDirectory?: boolean;
}

export type GrepOutputMode = "files_with_matches" | "content" | "count";

export interface FsGrepInput {
    pattern: string;
    description?: string;
    path?: string;
    output_mode?: GrepOutputMode;
    glob?: string;
    type?: string;
    "-i"?: boolean;
    "-n"?: boolean;
    "-A"?: number;
    "-B"?: number;
    "-C"?: number;
    multiline?: boolean;
    head_limit?: number;
    offset?: number;
    allowOutsideWorkingDirectory?: boolean;
}

export type FsTool<TInput = unknown, TOutput = unknown> = Omit<CoreTool<TInput, TOutput>, "execute"> & {
    execute: (input: TInput) => Promise<TOutput>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FsToolSet = Record<string, FsTool<any, string | ErrorTextResult>>;
