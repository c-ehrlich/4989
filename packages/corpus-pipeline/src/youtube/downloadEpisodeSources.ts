import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { makeEpisodeKey } from "@4989/corpus-types";

const execFileAsync = promisify(execFile);
const DEFAULT_YT_DLP_BUFFER_BYTES = 128 * 1024 * 1024;

export type EpisodeSourcePaths = {
  videoMetadataPath: string;
  captionPath: string;
};

export type DownloadEpisodeSourcesOptions = {
  episode: number;
  videoUrl: string;
  workDirectory: string;
  force?: boolean;
  ytDlpPath?: string;
};

export async function downloadEpisodeSources(
  options: DownloadEpisodeSourcesOptions
): Promise<EpisodeSourcePaths> {
  const ytDlpPath = options.ytDlpPath ?? "yt-dlp";
  const episodeKey = makeEpisodeKey(options.episode);
  const youtubeDirectory = resolve(options.workDirectory, "youtube");
  const captionsDirectory = resolve(options.workDirectory, "captions");
  const videoMetadataPath = resolve(youtubeDirectory, `${episodeKey}.info.json`);
  const captionPath = resolve(captionsDirectory, `${episodeKey}.ja-orig.json3`);

  await Promise.all([
    mkdir(youtubeDirectory, { recursive: true }),
    mkdir(captionsDirectory, { recursive: true })
  ]);

  if (options.force) {
    await Promise.all([unlinkIfExists(videoMetadataPath), unlinkIfExists(captionPath)]);
  }

  if (!(await fileExists(videoMetadataPath))) {
    await writeVideoMetadata({
      path: videoMetadataPath,
      videoUrl: options.videoUrl,
      ytDlpPath
    });
  }

  if (!(await fileExists(captionPath))) {
    await writeCaptionJson3({
      captionsDirectory,
      episodeKey,
      videoUrl: options.videoUrl,
      ytDlpPath
    });
  }

  if (!(await fileExists(captionPath))) {
    throw new Error(`yt-dlp did not write expected caption file: ${captionPath}`);
  }

  return {
    videoMetadataPath,
    captionPath
  };
}

async function writeVideoMetadata(input: {
  path: string;
  videoUrl: string;
  ytDlpPath: string;
}): Promise<void> {
  const { stdout } = await execFileAsync(
    input.ytDlpPath,
    ["--ignore-config", "--skip-download", "--dump-json", input.videoUrl],
    {
      encoding: "utf8",
      maxBuffer: DEFAULT_YT_DLP_BUFFER_BYTES
    }
  );

  JSON.parse(stdout);
  await writeFile(input.path, stdout.endsWith("\n") ? stdout : `${stdout}\n`, "utf8");
}

async function writeCaptionJson3(input: {
  captionsDirectory: string;
  episodeKey: string;
  videoUrl: string;
  ytDlpPath: string;
}): Promise<void> {
  await execFileAsync(
    input.ytDlpPath,
    [
      "--ignore-config",
      "--skip-download",
      "--write-auto-subs",
      "--sub-langs",
      "ja-orig",
      "--sub-format",
      "json3",
      "--paths",
      input.captionsDirectory,
      "--output",
      `${input.episodeKey}.%(ext)s`,
      input.videoUrl
    ],
    {
      encoding: "utf8",
      maxBuffer: DEFAULT_YT_DLP_BUFFER_BYTES
    }
  );
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Missing cache files do not need removal.
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

