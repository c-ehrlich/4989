import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export async function findRepoRoot(startDirectory = process.cwd()): Promise<string> {
  let currentDirectory = resolve(startDirectory);

  while (true) {
    try {
      await access(resolve(currentDirectory, "pnpm-workspace.yaml"));
      return currentDirectory;
    } catch {
      const parentDirectory = dirname(currentDirectory);
      if (parentDirectory === currentDirectory) {
        throw new Error(`Could not find repo root from ${startDirectory}`);
      }
      currentDirectory = parentDirectory;
    }
  }
}

export async function defaultCorpusDataDirectory(): Promise<string> {
  return resolve(await findRepoRoot(), "packages/corpus-data/data");
}

export async function defaultWorkDirectory(): Promise<string> {
  return resolve(await findRepoRoot(), ".work/4989");
}

export async function defaultSourceOverridesPath(): Promise<string> {
  return resolve(await findRepoRoot(), "packages/corpus-pipeline/config/source-overrides.json");
}
