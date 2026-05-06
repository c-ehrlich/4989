import { constants } from "node:fs";
import { access, cp, mkdir, readdir, rm, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const appDirectory = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const repoRoot = resolve(appDirectory, "../..");
const sourceDataDirectory = resolve(repoRoot, "packages/corpus-data/data");
const publicDataDirectory = resolve(appDirectory, "public/data");

const mode = readMode(process.argv.slice(2));

await rm(publicDataDirectory, { recursive: true, force: true });
await mkdir(publicDataDirectory, { recursive: true });

await Promise.all([
  exposeFile("episodes.json"),
  exposeFile("videos.json"),
  exposeDirectory("segments"),
  exposeDirectory("index")
]);

function readMode(args) {
  const modeArg = args.find((arg) => arg.startsWith("--mode="));
  const value = modeArg?.slice("--mode=".length) ?? "link";
  if (value !== "copy" && value !== "link") {
    throw new Error(`Unsupported corpus asset mode: ${value}`);
  }

  return value;
}

async function exposeFile(relativePath) {
  const source = resolve(sourceDataDirectory, relativePath);
  const target = resolve(publicDataDirectory, relativePath);
  await access(source, constants.R_OK);
  await mkdir(dirname(target), { recursive: true });

  if (mode === "copy") {
    await cp(source, target);
    return;
  }

  await symlink(source, target);
}

async function exposeDirectory(relativePath) {
  const source = resolve(sourceDataDirectory, relativePath);
  const target = resolve(publicDataDirectory, relativePath);
  await access(source, constants.R_OK);
  await mkdir(dirname(target), { recursive: true });

  if (mode === "copy") {
    await cp(source, target, { recursive: true });
    return;
  }

  await symlink(source, target, "dir");
}

// Fail early if the index structure is incomplete.
await Promise.all([
  assertNonEmptyDirectory(resolve(publicDataDirectory, "segments")),
  assertNonEmptyDirectory(resolve(publicDataDirectory, "index/lemma-buckets")),
  assertNonEmptyDirectory(resolve(publicDataDirectory, "index/surface-buckets"))
]);

async function assertNonEmptyDirectory(directory) {
  const entries = await readdir(directory);
  if (entries.length === 0) {
    throw new Error(`Prepared corpus asset directory is empty: ${directory}`);
  }
}
