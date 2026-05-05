import { processEpisode } from "../episode/processEpisode.js";
import { defaultCorpusDataDirectory, defaultWorkDirectory } from "./paths.js";

type ProcessEpisodeCliOptions = {
  episode?: number;
  dataDirectory?: string;
  workDirectory?: string;
  force: boolean;
  ytDlpPath?: string;
  pythonPath?: string;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options === "help") {
    printHelp();
    return;
  }

  if (options.episode === undefined) {
    throw new Error("--episode is required");
  }

  const result = await processEpisode({
    episode: options.episode,
    dataDirectory: options.dataDirectory ?? (await defaultCorpusDataDirectory()),
    workDirectory: options.workDirectory ?? (await defaultWorkDirectory()),
    force: options.force,
    ytDlpPath: options.ytDlpPath,
    pythonPath: options.pythonPath
  });

  console.log(
    `${result.skipped ? "Skipped unchanged" : "Wrote"} ep.${options.episode} alignment to ${result.alignmentPath}`
  );
  console.log(
    `Segments: ${result.alignment.segments.length}; script units: ${result.scriptUnitCount}; low confidence: ${result.alignment.summary.lowConfidenceCount}; unmatched: ${result.alignment.summary.unmatchedCount}`
  );

  if (result.alignment.summary.averageConfidence !== undefined) {
    console.log(`Average confidence: ${result.alignment.summary.averageConfidence.toFixed(3)}`);
  }

  for (const issue of result.unmatchedIssues.slice(0, 10)) {
    console.log(
      `Unmatched script unit ${issue.scriptIndex}: ${issue.reason}${issue.confidence === undefined ? "" : ` (${issue.confidence.toFixed(3)})`} ${issue.text.slice(0, 80)}`
    );
  }
}

function parseArgs(args: string[]): ProcessEpisodeCliOptions | "help" {
  const options: ProcessEpisodeCliOptions = {
    force: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      return "help";
    }

    if (arg === "--episode") {
      options.episode = readPositiveIntegerArg(args, index, arg);
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

    if (arg === "--force") {
      options.force = true;
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
  console.log(`Usage: pnpm --filter @4989/corpus-pipeline process-episode -- --episode 367 [options]

Options:
  --episode <n>     Episode number to process.
  --data-dir <path> Directory containing manifest.json, videos.json, and scripts.json.
  --work-dir <path> Working directory for cached metadata and captions.
  --yt-dlp <path>   yt-dlp executable path.
  --python <path>   Python executable with SudachiPy and a Sudachi dictionary installed.
  --force           Redownload and regenerate even if cached sources are unchanged.
  -h, --help        Show this help.
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`process-episode failed: ${message}`);
  process.exitCode = 1;
});
