import { mkdir, writeFile } from "node:fs/promises";

await import("./check-data-package.mjs");

const distUrl = new URL("../dist/", import.meta.url);
await mkdir(distUrl, { recursive: true });
await writeFile(new URL(".gitkeep", distUrl), "");
