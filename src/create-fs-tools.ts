import { createFsEditTool } from "./tools/fs_edit";
import { createFsGlobTool } from "./tools/fs_glob";
import { createFsGrepTool } from "./tools/fs_grep";
import { createFsReadTool } from "./tools/fs_read";
import { createFsWriteTool } from "./tools/fs_write";
import type { FsToolSet, FsToolsOptions } from "./types";

export function createFsTools(options: FsToolsOptions): FsToolSet {
    return {
        fs_read: createFsReadTool(options),
        fs_write: createFsWriteTool(options),
        fs_edit: createFsEditTool(options),
        fs_glob: createFsGlobTool(options),
        fs_grep: createFsGrepTool(options),
    };
}
