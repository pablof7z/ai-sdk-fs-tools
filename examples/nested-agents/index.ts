import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFsReadTool } from "../../src/index";

const exampleRoot = fileURLToPath(new URL(".", import.meta.url));
const targetFile = join(exampleRoot, "file", "path", "example.txt");

async function main() {
    const fsRead = createFsReadTool({
        workingDirectory: exampleRoot,
        agentsMd: {
            projectRoot: exampleRoot,
        },
    });

    const result = await fsRead.execute({
        path: targetFile,
        description: "show nested AGENTS.md reminder output",
    });

    console.log(String(result));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
