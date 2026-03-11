import { resolveFsToolsOptions } from "./internal/options";
import { createFsEditTool } from "./tools/fs_edit";
import { createFsGlobTool } from "./tools/fs_glob";
import { createFsGrepTool } from "./tools/fs_grep";
import { createFsReadTool } from "./tools/fs_read";
import { createFsWriteTool } from "./tools/fs_write";
import type { FsToolSet, FsToolsOptions } from "./types";

export function createFsTools(options: FsToolsOptions): FsToolSet {
    const { namePrefix } = resolveFsToolsOptions(options);
    return {
        [`${namePrefix}_read`]: createFsReadTool(options),
        [`${namePrefix}_write`]: createFsWriteTool(options),
        [`${namePrefix}_edit`]: createFsEditTool(options),
        [`${namePrefix}_glob`]: createFsGlobTool(options),
        [`${namePrefix}_grep`]: createFsGrepTool(options),
    };
}
