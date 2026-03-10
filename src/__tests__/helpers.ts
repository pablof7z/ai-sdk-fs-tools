import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ErrorTextResult } from "../types";

export async function createTempDir(prefix: string): Promise<string> {
    return mkdtemp(join(tmpdir(), prefix));
}

export async function cleanupTempDir(path: string): Promise<void> {
    await rm(path, { recursive: true, force: true });
}

export async function writeTextFile(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
}

export function expectErrorText(result: unknown): ErrorTextResult {
    if (
        !result ||
        typeof result !== "object" ||
        !("type" in result) ||
        !("text" in result) ||
        result.type !== "error-text"
    ) {
        throw new Error(`Expected error-text result, received: ${JSON.stringify(result)}`);
    }

    return result as ErrorTextResult;
}
