import { resolve } from "node:path";
import type { FsToolsOptions } from "../types";

export interface ResolvedAgentsMdOptions {
    projectRoot: string;
}

export interface ResolvedFsToolsOptions extends Omit<FsToolsOptions, "agentsMd"> {
    workingDirectory: string;
    allowedRoots: string[];
    namePrefix: string;
    strictContainment: boolean;
    agentsMd: false | ResolvedAgentsMdOptions;
}

function uniqueResolvedPaths(paths: string[]): string[] {
    const unique = new Set<string>();

    for (const path of paths) {
        unique.add(resolve(path));
    }

    return Array.from(unique);
}

export function resolveFsToolsOptions(options: FsToolsOptions): ResolvedFsToolsOptions {
    const workingDirectory = resolve(options.workingDirectory);
    const allowedRoots = uniqueResolvedPaths(options.allowedRoots ?? []);
    const agentsMd = options.agentsMd === false
        ? false
        : {
            projectRoot: resolve(options.agentsMd?.projectRoot ?? workingDirectory),
        };

    return {
        ...options,
        workingDirectory,
        allowedRoots,
        namePrefix: options.namePrefix ?? "fs",
        strictContainment: options.strictContainment ?? false,
        agentsMd,
    };
}
