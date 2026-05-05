import { readSourceOverrides } from "../config/sourceOverrides.js";
import { defaultCorpusDataDirectory, defaultSourceOverridesPath } from "./paths.js";
import { DEFAULT_YOUTUBE_CHANNEL_VIDEOS_URL, listVideos } from "../youtube/listVideos.js";

type ListVideosCliOptions = {
  channelUrl: string;
  dataDirectory?: string;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options === "help") {
    printHelp();
    return;
  }

  const result = await listVideos({
    channelUrl: options.channelUrl,
    dataDirectory: options.dataDirectory ?? (await defaultCorpusDataDirectory()),
    episodeOverrides: (await readSourceOverrides(await defaultSourceOverridesPath()))
      .youtubeEpisodeOverrides
  });

  console.log(`Wrote ${result.videos.length} videos to ${result.videosPath}`);
  console.log(`Wrote enumeration report to ${result.reportPath}`);
  console.log(
    `Parsed ${result.report.parsedPodcastVideos} podcast videos` +
      (result.report.episodeRange
        ? ` across ep.${result.report.episodeRange.min}-ep.${result.report.episodeRange.max}`
        : "")
  );

  if (result.report.duplicateEpisodes.length > 0) {
    console.log(`Duplicate episode numbers: ${result.report.duplicateEpisodes.length}`);
  }

  if (result.report.appliedEpisodeOverrides.length > 0) {
    console.log(`Applied episode overrides: ${result.report.appliedEpisodeOverrides.length}`);
  }

  if (result.report.unparsedVideos.length > 0) {
    console.log(`Unparsed videos: ${result.report.unparsedVideos.length}`);
  }
}

function parseArgs(args: string[]): ListVideosCliOptions | "help" {
  const options: ListVideosCliOptions = {
    channelUrl: DEFAULT_YOUTUBE_CHANNEL_VIDEOS_URL
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      return "help";
    }

    if (arg === "--channel-url") {
      options.channelUrl = readValueArg(args, index, arg);
      index += 1;
      continue;
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

function printHelp(): void {
  console.log(`Usage: pnpm --filter @4989/corpus-pipeline list-videos -- [options]

Options:
  --channel-url <url>  YouTube channel videos URL.
  --data-dir <path>    Directory for videos.json and video-enumeration-report.json.
  -h, --help           Show this help.
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`list-videos failed: ${message}`);
  process.exitCode = 1;
});
