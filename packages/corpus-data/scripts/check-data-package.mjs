import { access } from "node:fs/promises";

await access(new URL("../data/.gitkeep", import.meta.url));
