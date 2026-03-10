import type { ErrorTextResult } from "../types";

const EXPECTED_FS_ERROR_CODES = new Set([
    "EACCES",
    "EISDIR",
    "ENAMETOOLONG",
    "ENOENT",
    "ENOTDIR",
    "EPERM",
]);

export function createErrorText(text: string): ErrorTextResult {
    return { type: "error-text", text };
}

export function getFsErrorDescription(code: string | undefined): string {
    switch (code) {
        case "ENOENT":
            return "File or directory not found";
        case "EACCES":
            return "Permission denied";
        case "EISDIR":
            return "Expected a file but found a directory";
        case "ENOTDIR":
            return "Expected a directory but found a file";
        case "EPERM":
            return "Operation not permitted";
        case "ENAMETOOLONG":
            return "Path is too long";
        default:
            return "Filesystem error";
    }
}

export function isExpectedFsError(error: unknown): error is NodeJS.ErrnoException {
    const code = getNodeErrorCode(error);
    return code !== undefined && EXPECTED_FS_ERROR_CODES.has(code);
}

export function isExpectedNotFoundError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    const message = error.message.toLowerCase();
    return (
        message.includes("not found") ||
        message.includes("does not exist") ||
        message.includes("no such") ||
        message.includes("cannot find")
    );
}

export function getNodeErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== "object" || !("code" in error)) {
        return undefined;
    }

    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
}

export function formatUnknownError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
