import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { URL } from "node:url";
import { promisify } from "node:util";

import { VideosSchema, type Video } from "@4989/corpus-types";

import type { EpisodeOverrides } from "../config/sourceOverrides.js";
import { parseEpisodeNumberFromTitle } from "./parseEpisode.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_YOUTUBE_CHANNEL_VIDEOS_URL = "https://www.youtube.com/@Utaco-wr4dx/videos";

const DEFAULT_YT_DLP_BUFFER_BYTES = 128 * 1024 * 1024;
const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

type RawYtDlpVideo = {
  id?: unknown;
  title?: unknown;
  url?: unknown;
  webpage_url?: unknown;
  duration?: unknown;
  timestamp?: unknown;
  upload_date?: unknown;
  release_timestamp?: unknown;
  availability?: unknown;
};

type RawYtDlpPlaylist = {
  entries?: unknown;
};

export type VideoReference = {
  youtubeId: string;
  title: string;
  url: string;
};

export type UnparsedVideoReport = VideoReference & {
  reason: string;
};

export type DuplicateEpisodeReport = {
  episode: number;
  videos: VideoReference[];
};

export type AppliedEpisodeOverrideReport = VideoReference & {
  parsedEpisode?: number;
  episode: number;
  reason: string;
};

export type StaleEpisodeOverrideReport = {
  youtubeId: string;
  episode: number;
  reason: string;
};

export type VideoEnumerationReport = {
  generatedAt: string;
  channelUrl: string;
  ytDlpVersion?: string;
  totalVideos: number;
  parsedPodcastVideos: number;
  appliedEpisodeOverrides: AppliedEpisodeOverrideReport[];
  staleEpisodeOverrides: StaleEpisodeOverrideReport[];
  unparsedVideos: UnparsedVideoReport[];
  duplicateEpisodes: DuplicateEpisodeReport[];
  episodeRange?: {
    min: number;
    max: number;
  };
  missingEpisodesInRange: number[];
};

export type ListVideosOptions = {
  channelUrl?: string;
  dataDirectory: string;
  episodeOverrides?: EpisodeOverrides;
  ytDlpPath?: string;
};

export type ListVideosResult = {
  videos: Video[];
  report: VideoEnumerationReport;
  videosPath: string;
  reportPath: string;
};

export async function listVideos(options: ListVideosOptions): Promise<ListVideosResult> {
  const channelUrl = options.channelUrl ?? DEFAULT_YOUTUBE_CHANNEL_VIDEOS_URL;
  const ytDlpPath = options.ytDlpPath ?? "yt-dlp";
  const dataDirectory = resolve(options.dataDirectory);

  await mkdir(dataDirectory, { recursive: true });

  const rawPlaylist = await fetchPlaylist({ channelUrl, ytDlpPath });

  const episodeOverrides = options.episodeOverrides ?? {};
  const videos = normalizePlaylist(rawPlaylist, { episodeOverrides });
  const validatedVideos = VideosSchema.parse(videos);
  const report = buildVideoEnumerationReport({
    channelUrl,
    generatedAt: new Date().toISOString(),
    videos: validatedVideos,
    episodeOverrides,
    ytDlpVersion: await getYtDlpVersion(ytDlpPath)
  });

  const videosPath = resolve(dataDirectory, "videos.json");
  const reportPath = resolve(dataDirectory, "video-enumeration-report.json");

  await writeStableJson(videosPath, validatedVideos);
  await writeStableReportJson(reportPath, report);

  return {
    videos: validatedVideos,
    report,
    videosPath,
    reportPath
  };
}

export function normalizePlaylist(
  rawPlaylist: RawYtDlpPlaylist,
  options: { episodeOverrides?: EpisodeOverrides } = {}
): Video[] {
  const rawEntries = Array.isArray(rawPlaylist.entries) ? rawPlaylist.entries : [];
  const episodeOverrides = options.episodeOverrides ?? {};
  const videos = rawEntries.flatMap((rawEntry): Video[] => {
    if (!isRawVideo(rawEntry)) {
      return [];
    }

    const youtubeId = normalizeYoutubeId(rawEntry);
    const title = typeof rawEntry.title === "string" ? rawEntry.title.trim() : "";
    if (!youtubeId || !title) {
      return [];
    }

    const video: Video = {
      youtubeId,
      title,
      url: normalizeVideoUrl(rawEntry, youtubeId)
    };

    const parsedEpisode = parseEpisodeNumberFromTitle(title);
    const episode = episodeOverrides[youtubeId] ?? parsedEpisode;
    if (episode !== undefined) {
      video.episode = episode;
    }

    const publishedAt = normalizePublishedAt(rawEntry);
    if (publishedAt) {
      video.publishedAt = publishedAt;
    }

    const durationSeconds = normalizeDurationSeconds(rawEntry.duration);
    if (durationSeconds !== undefined) {
      video.durationSeconds = durationSeconds;
    }

    return [video];
  });

  return videos.sort(compareVideos);
}

export function buildVideoEnumerationReport(input: {
  channelUrl: string;
  generatedAt: string;
  videos: Video[];
  episodeOverrides?: EpisodeOverrides;
  ytDlpVersion?: string;
}): VideoEnumerationReport {
  const episodeOverrides = input.episodeOverrides ?? {};
  const parsedVideos = input.videos.filter((video) => video.episode !== undefined);
  const episodeNumbers = parsedVideos.map((video) => video.episode as number).sort((a, b) => a - b);
  const episodeRange =
    episodeNumbers.length > 0
      ? {
          min: episodeNumbers[0] as number,
          max: episodeNumbers[episodeNumbers.length - 1] as number
        }
      : undefined;

  const duplicateEpisodes = collectDuplicateEpisodes(parsedVideos);
  const missingEpisodesInRange =
    episodeRange === undefined
      ? []
      : collectMissingEpisodesInRange(new Set(episodeNumbers), episodeRange.min, episodeRange.max);

  const report: VideoEnumerationReport = {
    generatedAt: input.generatedAt,
    channelUrl: input.channelUrl,
    totalVideos: input.videos.length,
    parsedPodcastVideos: parsedVideos.length,
    appliedEpisodeOverrides: collectAppliedEpisodeOverrides(input.videos, episodeOverrides),
    staleEpisodeOverrides: collectStaleEpisodeOverrides(input.videos, episodeOverrides),
    unparsedVideos: input.videos
      .filter((video) => video.episode === undefined)
      .map((video) => ({
        ...toVideoReference(video),
        reason: "title-does-not-contain-episode-number"
      })),
    duplicateEpisodes,
    missingEpisodesInRange
  };

  if (input.ytDlpVersion) {
    report.ytDlpVersion = input.ytDlpVersion;
  }

  if (episodeRange) {
    report.episodeRange = episodeRange;
  }

  return report;
}

function isRawVideo(value: unknown): value is RawYtDlpVideo {
  return typeof value === "object" && value !== null;
}

function normalizeYoutubeId(rawVideo: RawYtDlpVideo): string | undefined {
  if (typeof rawVideo.id === "string" && rawVideo.id.trim()) {
    return normalizeYoutubeIdValue(rawVideo.id);
  }

  if (typeof rawVideo.url === "string") {
    return parseYoutubeIdFromUrl(rawVideo.url);
  }

  if (typeof rawVideo.webpage_url === "string") {
    return parseYoutubeIdFromUrl(rawVideo.webpage_url);
  }

  return undefined;
}

function normalizeVideoUrl(rawVideo: RawYtDlpVideo, youtubeId: string): string {
  if (typeof rawVideo.webpage_url === "string" && rawVideo.webpage_url.startsWith("http")) {
    return rawVideo.webpage_url;
  }

  if (typeof rawVideo.url === "string" && rawVideo.url.startsWith("http")) {
    return rawVideo.url;
  }

  return `https://www.youtube.com/watch?v=${youtubeId}`;
}

function normalizePublishedAt(rawVideo: RawYtDlpVideo): string | undefined {
  const timestamp =
    typeof rawVideo.timestamp === "number"
      ? rawVideo.timestamp
      : typeof rawVideo.release_timestamp === "number"
        ? rawVideo.release_timestamp
        : undefined;

  if (timestamp !== undefined && Number.isFinite(timestamp) && timestamp > 0) {
    return new Date(timestamp * 1000).toISOString();
  }

  if (typeof rawVideo.upload_date === "string") {
    const match = /^(\d{4})(\d{2})(\d{2})$/.exec(rawVideo.upload_date);
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`;
    }
  }

  return undefined;
}

function normalizeDurationSeconds(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return value;
}

function parseYoutubeIdFromUrl(value: string): string | undefined {
  const trimmedValue = value.trim();
  if (isYoutubeId(trimmedValue)) {
    return trimmedValue;
  }

  try {
    const parsedUrl = new URL(value);

    if (isYoutubeHost(parsedUrl.hostname)) {
      const videoId = parsedUrl.searchParams.get("v");
      if (videoId) {
        return normalizeYoutubeIdValue(videoId);
      }

      const [firstPathSegment, secondPathSegment] = parsedUrl.pathname
        .split("/")
        .filter(Boolean);
      if ((firstPathSegment === "shorts" || firstPathSegment === "embed") && secondPathSegment) {
        return normalizeYoutubeIdValue(secondPathSegment);
      }
    }

    if (parsedUrl.hostname === "youtu.be") {
      return normalizeYoutubeIdValue(basename(parsedUrl.pathname));
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function isYoutubeHost(hostname: string): boolean {
  return hostname === "youtube.com" || hostname.endsWith(".youtube.com");
}

function normalizeYoutubeIdValue(value: string): string | undefined {
  const trimmedValue = value.trim();
  return isYoutubeId(trimmedValue) ? trimmedValue : undefined;
}

function isYoutubeId(value: string): boolean {
  return YOUTUBE_ID_PATTERN.test(value);
}

function compareVideos(left: Video, right: Video): number {
  if (left.episode !== undefined && right.episode !== undefined) {
    return (
      left.episode - right.episode ||
      compareOptionalStrings(left.publishedAt, right.publishedAt) ||
      left.youtubeId.localeCompare(right.youtubeId)
    );
  }

  if (left.episode !== undefined) {
    return -1;
  }

  if (right.episode !== undefined) {
    return 1;
  }

  return (
    compareOptionalStrings(left.publishedAt, right.publishedAt) ||
    left.title.localeCompare(right.title) ||
    left.youtubeId.localeCompare(right.youtubeId)
  );
}

function compareOptionalStrings(left: string | undefined, right: string | undefined): number {
  if (left && right) {
    return left.localeCompare(right);
  }

  if (left) {
    return -1;
  }

  if (right) {
    return 1;
  }

  return 0;
}

function collectDuplicateEpisodes(videos: Video[]): DuplicateEpisodeReport[] {
  const videosByEpisode = new Map<number, Video[]>();

  for (const video of videos) {
    if (video.episode === undefined) {
      continue;
    }

    const episodeVideos = videosByEpisode.get(video.episode) ?? [];
    episodeVideos.push(video);
    videosByEpisode.set(video.episode, episodeVideos);
  }

  return [...videosByEpisode.entries()]
    .filter(([, episodeVideos]) => episodeVideos.length > 1)
    .sort(([leftEpisode], [rightEpisode]) => leftEpisode - rightEpisode)
    .map(([episode, episodeVideos]) => ({
      episode,
      videos: episodeVideos.map(toVideoReference)
    }));
}

function collectAppliedEpisodeOverrides(
  videos: Video[],
  episodeOverrides: EpisodeOverrides
): AppliedEpisodeOverrideReport[] {
  return inputOrderByYoutubeId(episodeOverrides)
    .flatMap(([youtubeId, episode]): AppliedEpisodeOverrideReport[] => {
      const video = videos.find((candidate) => candidate.youtubeId === youtubeId);
      if (!video) {
        return [];
      }

      const parsedEpisode = parseEpisodeNumberFromTitle(video.title);
      const report: AppliedEpisodeOverrideReport = {
        ...toVideoReference(video),
        episode,
        reason: "youtube-title-numbering-conflicts-with-video-description"
      };

      if (parsedEpisode !== undefined) {
        report.parsedEpisode = parsedEpisode;
      }

      return [report];
    });
}

function collectStaleEpisodeOverrides(
  videos: Video[],
  episodeOverrides: EpisodeOverrides
): StaleEpisodeOverrideReport[] {
  const videoIds = new Set(videos.map((video) => video.youtubeId));
  return inputOrderByYoutubeId(episodeOverrides)
    .filter(([youtubeId]) => !videoIds.has(youtubeId))
    .map(([youtubeId, episode]) => ({
      youtubeId,
      episode,
      reason: "video-not-found-in-enumeration"
    }));
}

function inputOrderByYoutubeId(episodeOverrides: EpisodeOverrides): [string, number][] {
  return Object.entries(episodeOverrides).sort(([leftId], [rightId]) =>
    leftId.localeCompare(rightId)
  );
}

function collectMissingEpisodesInRange(
  episodes: Set<number>,
  minEpisode: number,
  maxEpisode: number
): number[] {
  const missingEpisodes: number[] = [];

  for (let episode = minEpisode; episode <= maxEpisode; episode += 1) {
    if (!episodes.has(episode)) {
      missingEpisodes.push(episode);
    }
  }

  return missingEpisodes;
}

function toVideoReference(video: Video): VideoReference {
  return {
    youtubeId: video.youtubeId,
    title: video.title,
    url: video.url
  };
}

async function fetchPlaylist(input: {
  channelUrl: string;
  ytDlpPath: string;
}): Promise<RawYtDlpPlaylist> {
  const { stdout } = await execFileAsync(
    input.ytDlpPath,
    [
      "--ignore-config",
      "--no-warnings",
      "--extractor-args",
      "youtube:lang=ja",
      "--flat-playlist",
      "--dump-single-json",
      input.channelUrl
    ],
    {
      encoding: "utf8",
      maxBuffer: DEFAULT_YT_DLP_BUFFER_BYTES
    }
  );

  return JSON.parse(stdout) as RawYtDlpPlaylist;
}

async function getYtDlpVersion(ytDlpPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(ytDlpPath, ["--version"], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function writeStableJson(path: string, value: unknown): Promise<void> {
  const nextJson = `${JSON.stringify(value, null, 2)}\n`;
  try {
    const previousJson = await readFile(path, "utf8");
    if (previousJson === nextJson) {
      return;
    }
  } catch {
    // Missing files are written below.
  }

  await writeFile(path, nextJson, "utf8");
}

async function writeStableReportJson(
  path: string,
  report: VideoEnumerationReport
): Promise<void> {
  try {
    const previousReport = JSON.parse(await readFile(path, "utf8")) as VideoEnumerationReport;
    if (JSON.stringify(stripGeneratedAt(previousReport)) === JSON.stringify(stripGeneratedAt(report))) {
      report.generatedAt = previousReport.generatedAt;
    }
  } catch {
    // Missing or invalid previous reports should be replaced.
  }

  await writeStableJson(path, report);
}

function stripGeneratedAt(report: VideoEnumerationReport): Omit<VideoEnumerationReport, "generatedAt"> {
  const { generatedAt: _generatedAt, ...stableReport } = report;
  return stableReport;
}
