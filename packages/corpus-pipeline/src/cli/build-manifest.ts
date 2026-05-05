import { buildManifest } from "../manifest/buildManifest.js";
import { readSourceOverrides } from "../config/sourceOverrides.js";
import { defaultCorpusDataDirectory, defaultSourceOverridesPath } from "./paths.js";

type BuildManifestCliOptions = {
  dataDirectory?: string;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options === "help") {
    printHelp();
    return;
  }

  const result = await buildManifest({
    dataDirectory: options.dataDirectory ?? (await defaultCorpusDataDirectory()),
    sourceOverrides: await readSourceOverrides(await defaultSourceOverridesPath())
  });

  const counts = countStatuses(result.manifest.episodes.map((entry) => entry.status));

  console.log(`Wrote ${result.manifest.episodes.length} manifest entries to ${result.manifestPath}`);
  for (const [status, count] of counts.entries()) {
    console.log(`${status}: ${count}`);
  }
}

function parseArgs(args: string[]): BuildManifestCliOptions | "help" {
  const options: BuildManifestCliOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      return "help";
    }

    if (arg === "--data-dir") {
      options.dataDirectory = readValueArg(args, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function readValueArg(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value`);
  }

  return value;
}

function countStatuses(statuses: string[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const status of statuses) {
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  return new Map(Array.from(counts.entries()).sort(([left], [right]) => left.localeCompare(right)));
}

function printHelp(): void {
  console.log(`Usage: pnpm --filter @4989/corpus-pipeline build-manifest -- [options]

Options:
  --data-dir <path>  Directory containing videos.json and scripts.json.
  -h, --help         Show this help.
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`build-manifest failed: ${message}`);
  process.exitCode = 1;
});
