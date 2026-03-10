import type { Tool as CoreTool } from "ai";

export interface AgentsMdOptions {
    enabled?: boolean;
    projectRoot?: string;
    filename?: string;
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
    protectedWriteRoots?: string[];
    agentsMd?: AgentsMdOptions;
    loadToolResult?: LoadToolResultHook;
    analyzeContent?: AnalyzeContentHook;
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
    getHumanReadableContent?: (args: TInput) => string;
};

export interface FsToolSet {
    fs_read: FsTool<FsReadInput, string | ErrorTextResult>;
    fs_write: FsTool<FsWriteInput, string | ErrorTextResult>;
    fs_edit: FsTool<FsEditInput, string | ErrorTextResult>;
    fs_glob: FsTool<FsGlobInput, string | ErrorTextResult>;
    fs_grep: FsTool<FsGrepInput, string | ErrorTextResult>;
}
