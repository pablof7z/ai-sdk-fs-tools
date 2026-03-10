import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFsReadTool } from "../../src/index";

const exampleRoot = fileURLToPath(new URL(".", import.meta.url));

async function readExample(relativePath: string) {
    const fsRead = createFsReadTool({
        workingDirectory: exampleRoot,
        agentsMd: {
            projectRoot: exampleRoot,
        },
    });

    const result = await fsRead.execute({
        path: join(exampleRoot, relativePath),
        description: `inspect ${relativePath}`,
    });

    console.log(`=== ${relativePath} ===`);
    console.log(String(result));
    console.log("");
}

async function main() {
    await readExample("src/operations/add.ts");
    await readExample("src/ui/render-display.ts");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
