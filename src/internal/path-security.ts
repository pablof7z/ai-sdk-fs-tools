import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import type { ResolvedFsToolsOptions } from "./options";

function safeRealpathSync(path: string): string | null {
    try {
        return realpathSync(path);
    } catch {
        return null;
    }
}

export function normalizePath(inputPath: string): string {
    return normalize(resolve(inputPath));
}

function resolveRealPath(inputPath: string): string {
    const normalized = normalizePath(inputPath);

    if (existsSync(normalized)) {
        return safeRealpathSync(normalized) ?? normalized;
    }

    const parentDir = dirname(normalized);
    const filename = normalized.slice(parentDir.length + 1);

    if (existsSync(parentDir)) {
        const realParent = safeRealpathSync(parentDir);
        return realParent ? join(realParent, filename) : normalized;
    }

    let currentPath = parentDir;
    const suffix: string[] = [filename];

    while (currentPath && currentPath !== dirname(currentPath)) {
        const parent = dirname(currentPath);
        suffix.unshift(currentPath.slice(parent.length + 1));
        currentPath = parent;

        if (existsSync(currentPath)) {
            const realAncestor = safeRealpathSync(currentPath);
            return realAncestor ? join(realAncestor, ...suffix) : normalized;
        }
    }

    return normalized;
}

export function isPathWithinDirectory(inputPath: string, directory: string): boolean {
    const realPath = resolveRealPath(inputPath);
    const realDir = resolveRealPath(directory);
    const relativePath = relative(realDir, realPath);

    return !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

export function isPathAccessible(
    inputPath: string,
    options: ResolvedFsToolsOptions,
    allowOutsideWorkingDirectory: boolean = false,
): boolean {
    if (allowOutsideWorkingDirectory) {
        return true;
    }

    const allowedRoots = [options.workingDirectory, ...options.allowedRoots];
    return allowedRoots.some((root) => isPathWithinDirectory(inputPath, root));
}

export function isProtectedWritePath(
    inputPath: string,
    options: ResolvedFsToolsOptions,
): boolean {
    return options.protectedWriteRoots.some((root) => isPathWithinDirectory(inputPath, root));
}

export function buildOutsideRootMessage(
    inputPath: string,
    options: ResolvedFsToolsOptions,
): string {
    const roots = [options.workingDirectory, ...options.allowedRoots];
    const rootList = roots.join(", ");
    return `Path "${inputPath}" is outside the configured roots (${rootList}). Retry with allowOutsideWorkingDirectory: true if this is intentional.`;
}

export function buildProtectedWriteMessage(
    inputPath: string,
): string {
    return `Path "${inputPath}" is within a protectedWriteRoots boundary and cannot be modified by fs_write or fs_edit.`;
}
