import {
  DEFAULT_SCRIPT_SITEMAP_URL,
  discoverScripts
} from "../scripts/discoverScripts.js";
import { defaultCorpusDataDirectory, defaultWorkDirectory } from "./paths.js";

type DiscoverScriptsCliOptions = {
  sitemapUrl: string;
  dataDirectory?: string;
  workDirectory?: string;
  force: boolean;
  limit?: number;
  concurrency?: number;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options === "help") {
    printHelp();
    return;
  }

  const result = await discoverScripts({
    sitemapUrl: options.sitemapUrl,
    dataDirectory: options.dataDirectory ?? (await defaultCorpusDataDirectory()),
    workDirectory: options.workDirectory ?? (await defaultWorkDirectory()),
    force: options.force,
    limit: options.limit,
    concurrency: options.concurrency,
    sampleOutput: options.limit !== undefined && options.dataDirectory === undefined
  });

  console.log(`Wrote ${result.scripts.length} scripts to ${result.scriptsPath}`);
  console.log(`Wrote discovery report to ${result.reportPath}`);
  console.log(
    `Parsed ${result.report.discoveredScripts} scripts` +
      (result.report.episodeRange
        ? ` across ep.${result.report.episodeRange.min}-ep.${result.report.episodeRange.max}`
        : "")
  );

  if (result.report.duplicateEpisodes.length > 0) {
    console.log(`Duplicate episode numbers: ${result.report.duplicateEpisodes.length}`);
  }

  if (result.report.duplicateUrlEpisodes.length > 0) {
    console.log(`Duplicate URL episode numbers: ${result.report.duplicateUrlEpisodes.length}`);
  }

  if (result.report.episodeMismatches.length > 0) {
    console.log(`Episode URL/title mismatches: ${result.report.episodeMismatches.length}`);
  }

  if (result.report.missingEpisodesInRange.length > 0) {
    console.log(`Missing episodes in script range: ${result.report.missingEpisodesInRange.length}`);
  }

  if (result.report.missingUrlEpisodesInRange.length > 0) {
    console.log(
      `Missing URL episodes in script range: ${result.report.missingUrlEpisodesInRange.length}`
    );
  }

  if (result.report.failedPages.length > 0) {
    console.log(`Failed pages: ${result.report.failedPages.length}`);
  }

  if (result.report.unparsedPages.length > 0) {
    console.log(`Unparsed pages: ${result.report.unparsedPages.length}`);
  }
}

function parseArgs(args: string[]): DiscoverScriptsCliOptions | "help" {
  const options: DiscoverScriptsCliOptions = {
    sitemapUrl: DEFAULT_SCRIPT_SITEMAP_URL,
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

    if (arg === "--sitemap-url") {
      options.sitemapUrl = readValueArg(args, index, arg);
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

    if (arg === "--limit") {
      options.limit = readPositiveIntegerArg(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--concurrency") {
      options.concurrency = readPositiveIntegerArg(args, index, arg);
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
  console.log(`Usage: pnpm --filter @4989/corpus-pipeline discover-scripts -- [options]

Options:
  --sitemap-url <url>  4989 blog post sitemap URL.
  --data-dir <path>    Directory for scripts.json and script-discovery-report.json.
  --work-dir <path>    Working directory for cached script HTML/text.
  --limit <count>      Parse only the first N sitemap entries after stable sorting.
                       Without --data-dir, writes scripts.sample.json and a sample report.
  --concurrency <n>    Number of script pages to fetch in parallel.
  --force              Refetch pages even when cached HTML exists.
  -h, --help           Show this help.
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`discover-scripts failed: ${message}`);
  process.exitCode = 1;
});
