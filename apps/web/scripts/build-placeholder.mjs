import { mkdir, writeFile } from "node:fs/promises";

const distUrl = new URL("../dist/", import.meta.url);
await mkdir(distUrl, { recursive: true });
await writeFile(new URL(".gitkeep", distUrl), "");
