import { processLatest } from "../episode/processLatest.js";
import { readSourceOverrides } from "../config/sourceOverrides.js";
import {
  defaultCorpusDataDirectory,
  defaultSourceOverridesPath,
  defaultWorkDirectory
} from "./paths.js";

type ProcessLatestCliOptions = {
  count: number;
  dataDirectory?: string;
  workDirectory?: string;
  refreshSources: boolean;
  retryFailed: boolean;
  force: boolean;
  forceScriptRefresh: boolean;
  scriptConcurrency?: number;
  ytDlpPath?: string;
  pythonPath?: string;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options === "help") {
    printHelp();
    return;
  }

  const result = await processLatest({
    count: options.count,
    dataDirectory: options.dataDirectory ?? (await defaultCorpusDataDirectory()),
    workDirectory: options.workDirectory ?? (await defaultWorkDirectory()),
    sourceOverrides: await readSourceOverrides(await defaultSourceOverridesPath()),
    refreshSources: options.refreshSources,
    retryFailed: options.retryFailed,
    force: options.force,
    forceScriptRefresh: options.forceScriptRefresh,
    scriptConcurrency: options.scriptConcurrency,
    ytDlpPath: options.ytDlpPath,
    pythonPath: options.pythonPath
  });

  console.log(
    `${result.refreshedSources ? "Refreshed sources and selected" : "Selected"} latest ${result.selectedEpisodes.length} script-covered episodes: ${result.selectedEpisodes.join(", ")}`
  );

  for (const episodeResult of result.processed) {
    const details =
      episodeResult.status === "failed"
        ? `failed: ${episodeResult.message ?? "unknown error"}`
        : `${episodeResult.status}; segments: ${episodeResult.segments ?? 0}; low confidence: ${episodeResult.lowConfidenceCount ?? 0}; unmatched: ${episodeResult.unmatchedCount ?? 0}` +
          (episodeResult.averageConfidence === undefined
            ? ""
            : `; average confidence: ${episodeResult.averageConfidence.toFixed(3)}`);
    console.log(`ep.${episodeResult.episode}: ${details}`);
  }
}

function parseArgs(args: string[]): ProcessLatestCliOptions | "help" {
  const options: ProcessLatestCliOptions = {
    count: 10,
    refreshSources: true,
    retryFailed: false,
    force: false,
    forceScriptRefresh: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      return "help";
    }

    if (arg === "--count") {
      options.count = readPositiveIntegerArg(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--data-dir") {
      options.dataDirectory = readValueArg(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--work-dir") {
      options.workDirectory = readValueArg(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--script-concurrency") {
      options.scriptConcurrency = readPositiveIntegerArg(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--yt-dlp") {
      options.ytDlpPath = readValueArg(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--python") {
      options.pythonPath = readValueArg(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--no-refresh-sources") {
      options.refreshSources = false;
      continue;
    }

    if (arg === "--retry-failed") {
      options.retryFailed = true;
      continue;
    }

    if (arg === "--force") {
      options.force = true;
      continue;
    }

    if (arg === "--force-script-refresh") {
      options.forceScriptRefresh = true;
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

function readPositiveIntegerArg(args: string[], index: number, name: string): number {
  const value = Number.parseInt(readValueArg(args, index, name), 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} requires a positive integer`);
  }

  return value;
}

function printHelp(): void {
  console.log(`Usage: pnpm --filter @4989/corpus-pipeline process-latest -- [options]

Options:
  --count <n>              Number of latest script-covered episodes to process. Default: 10.
  --data-dir <path>        Directory containing corpus source and output JSON.
  --work-dir <path>        Working directory for cached metadata, captions, and scripts.
  --script-concurrency <n> Number of script pages to fetch in parallel during source refresh.
  --yt-dlp <path>          yt-dlp executable path.
  --python <path>          Python executable with SudachiPy and a Sudachi dictionary installed.
  --no-refresh-sources     Use the existing manifest instead of refreshing sources first.
  --retry-failed           Include failed manifest entries in the latest processable set.
  --force                  Redownload per-episode sources and regenerate alignments.
  --force-script-refresh   Refetch script pages during source refresh.
  -h, --help               Show this help.
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`process-latest failed: ${message}`);
  process.exitCode = 1;
});
