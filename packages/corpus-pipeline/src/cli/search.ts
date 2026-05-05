import { resolve } from "node:path";

import { searchCorpus, type SearchMode } from "../search/searchCorpus.js";
import { defaultCorpusDataDirectory } from "./paths.js";

type SearchCliOptions = {
  query?: string;
  dataDirectory?: string;
  mode?: SearchMode;
  limit?: number;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options === "help") {
    printHelp();
    return;
  }

  if (!options.query) {
    throw new Error("Search query is required");
  }

  const result = await searchCorpus({
    dataDirectory: resolve(options.dataDirectory ?? (await defaultCorpusDataDirectory())),
    query: options.query,
    mode: options.mode,
    limit: options.limit
  });

  console.log(
    `Search: ${result.normalizedQuery} (${formatSearched(result.searched)}, ${result.totalSegmentIds} result${result.totalSegmentIds === 1 ? "" : "s"}, showing ${result.hits.length})`
  );

  if (result.hits.length === 0) {
    return;
  }

  result.hits.forEach((hit, index) => {
    console.log("");
    console.log(`${index + 1}. ep.${hit.episode} ${hit.timestamp} ${hit.title}`);
    console.log(`   ${hit.text}`);
    console.log(`   ${hit.youtubeTimestampUrl}`);
  });
}

function parseArgs(args: string[]): SearchCliOptions | "help" {
  const options: SearchCliOptions = {};
  const queryParts: string[] = [];

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

    if (arg === "--mode") {
      options.mode = readModeArg(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--limit") {
      options.limit = readPositiveIntegerArg(args, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    queryParts.push(arg);
  }

  options.query = queryParts.join(" ");
  return options;
}

function readValueArg(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value`);
  }

  return value;
}

function readPositiveIntegerArg(args: string[], index: number, name: string): number {
  const value = Number.parseInt(readValueArg(args, index, name), 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} requires a positive integer`);
  }

  return value;
}

function readModeArg(args: string[], index: number, name: string): SearchMode {
  const value = readValueArg(args, index, name);
  if (value !== "auto" && value !== "lemma" && value !== "surface") {
    throw new Error(`${name} must be one of: auto, lemma, surface`);
  }

  return value;
}

function formatSearched(searched: { kind: string; key: string }[]): string {
  return searched.map((lookup) => `${lookup.kind}:${lookup.key}`).join(", ");
}

function printHelp(): void {
  console.log(`Usage: pnpm --filter @4989/corpus-pipeline search -- <query> [options]

Options:
  --mode <mode>      Search mode: auto, lemma, or surface. Defaults to auto.
  --limit <n>        Maximum number of hydrated results to print. Defaults to 20.
  --data-dir <path>  Corpus data directory. Defaults to packages/corpus-data/data.
  -h, --help         Show this help.
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`search failed: ${message}`);
  process.exitCode = 1;
});
