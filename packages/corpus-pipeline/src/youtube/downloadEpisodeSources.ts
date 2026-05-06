import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { promisify } from "node:util";

import { makeEpisodeKey } from "@4989/corpus-types";

const execFileAsync = promisify(execFile);
const DEFAULT_YT_DLP_BUFFER_BYTES = 128 * 1024 * 1024;

export type EpisodeSourcePaths = {
  videoMetadataPath: string;
  captionPath?: string;
};

export type DownloadEpisodeSourcesOptions = {
  episode: number;
  videoUrl: string;
  workDirectory: string;
  force?: boolean;
  requireCaption?: boolean;
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
    if (options.requireCaption ?? true) {
      throw new Error(`yt-dlp did not write expected caption file: ${captionPath}`);
    }

    return {
      videoMetadataPath
    };
  }

  return {
    videoMetadataPath,
    captionPath
  };
}

export async function downloadEpisodeAudio(options: DownloadEpisodeSourcesOptions): Promise<string> {
  const ytDlpPath = options.ytDlpPath ?? "yt-dlp";
  const episodeKey = makeEpisodeKey(options.episode);
  const audioDirectory = resolve(options.workDirectory, "audio");
  const outputTemplate = `${episodeKey}.%(ext)s`;
  const preferredAudioPath = resolve(audioDirectory, `${episodeKey}.m4a`);

  await mkdir(audioDirectory, { recursive: true });

  if (options.force) {
    await unlinkIfExists(preferredAudioPath);
  }

  if (!(await fileExists(preferredAudioPath))) {
    await execFileAsync(
      ytDlpPath,
      [
        "--ignore-config",
        "--extract-audio",
        "--audio-format",
        "m4a",
        "--paths",
        audioDirectory,
        "--output",
        outputTemplate,
        options.videoUrl
      ],
      {
        encoding: "utf8",
        maxBuffer: DEFAULT_YT_DLP_BUFFER_BYTES
      }
    );
  }

  if (await fileExists(preferredAudioPath)) {
    return preferredAudioPath;
  }

  const downloadedPath = await findDownloadedAudioPath(audioDirectory, episodeKey);
  if (!downloadedPath) {
    throw new Error(`yt-dlp did not write expected audio file: ${preferredAudioPath}`);
  }

  return downloadedPath;
}

async function findDownloadedAudioPath(
  directory: string,
  episodeKey: string
): Promise<string | undefined> {
  const entries = await readdir(directory);
  const candidates = entries
    .filter((entry) => entry.startsWith(`${episodeKey}.`) && isLikelyAudioExtension(entry))
    .sort();

  return candidates[0] === undefined ? undefined : resolve(directory, candidates[0]);
}

function isLikelyAudioExtension(path: string): boolean {
  return new Set([".m4a", ".mp3", ".opus", ".webm", ".wav"]).has(extname(path));
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
