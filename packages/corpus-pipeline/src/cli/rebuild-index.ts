import { buildStaticIndex } from "../index/buildStaticIndex.js";
import { defaultCorpusDataDirectory } from "./paths.js";

type RebuildIndexCliOptions = {
  dataDirectory?: string;
  allowEmpty?: boolean;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options === "help") {
    printHelp();
    return;
  }

  const result = await buildStaticIndex({
    dataDirectory: options.dataDirectory ?? (await defaultCorpusDataDirectory()),
    allowEmpty: options.allowEmpty ?? false
  });

  console.log(`Rebuilt static index in ${result.dataDirectory}`);
  console.log(`alignments: ${result.alignmentCount}`);
  console.log(`episodes: ${result.episodeCount}`);
  console.log(`segments: ${result.segmentCount}`);
  console.log(`lemmas: ${result.lemmaCount}`);
  console.log(`surfaces: ${result.surfaceCount}`);
  console.log(`surface-to-lemmas: ${result.surfaceToLemmaCount}`);
}

function parseArgs(args: string[]): RebuildIndexCliOptions | "help" {
  const options: RebuildIndexCliOptions = {};

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

    if (arg === "--allow-empty") {
      options.allowEmpty = true;
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

function printHelp(): void {
  console.log(`Usage: pnpm --filter @4989/corpus-pipeline rebuild-index -- [options]

Options:
  --data-dir <path>  Directory containing alignments and source metadata.
  --allow-empty      Permit rebuilding an empty index when alignments/ is missing.
  -h, --help         Show this help.
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`rebuild-index failed: ${message}`);
  process.exitCode = 1;
});
