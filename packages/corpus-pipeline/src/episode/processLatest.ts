import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  BuildReportSchema,
  ManifestSchema,
  makeEpisodeKey,
  type BuildReport,
  type BuildReportEntry,
  type EpisodeStatus,
  type Manifest,
  type ManifestEntry
} from "@4989/corpus-types";

import {
  DEFAULT_SCRIPT_SITEMAP_URL,
  discoverScripts
} from "../scripts/discoverScripts.js";
import type { SourceOverrides } from "../config/sourceOverrides.js";
import {
  DEFAULT_YOUTUBE_CHANNEL_VIDEOS_URL,
  listVideos
} from "../youtube/listVideos.js";
import { buildManifest } from "../manifest/buildManifest.js";
import { processEpisode, type ProcessEpisodeResult } from "./processEpisode.js";

const DEFAULT_LATEST_COUNT = 10;

export type ProcessLatestOptions = {
  count?: number;
  dataDirectory: string;
  workDirectory: string;
  sourceOverrides?: SourceOverrides;
  refreshSources?: boolean;
  retryFailed?: boolean;
  force?: boolean;
  forceScriptRefresh?: boolean;
  channelUrl?: string;
  sitemapUrl?: string;
  scriptConcurrency?: number;
  ytDlpPath?: string;
  pythonPath?: string;
  asrPythonPath?: string;
  asrModel?: string;
  preferAsr?: boolean;
};

export type ProcessLatestEpisodeResult = {
  episode: number;
  status: "processed" | "low-confidence" | "skipped" | "failed";
  skipped: boolean;
  alignmentPath?: string;
  reportPath?: string;
  segments?: number;
  averageConfidence?: number;
  lowConfidenceCount?: number;
  unmatchedCount?: number;
  message?: string;
};

export type ProcessLatestResult = {
  selectedEpisodes: number[];
  processed: ProcessLatestEpisodeResult[];
  manifestPath: string;
  refreshedSources: boolean;
};

export async function processLatest(options: ProcessLatestOptions): Promise<ProcessLatestResult> {
  const dataDirectory = resolve(options.dataDirectory);
  const workDirectory = resolve(options.workDirectory);
  const count = options.count ?? DEFAULT_LATEST_COUNT;

  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new Error(`count must be a positive integer: ${count}`);
  }

  const manifest = await prepareManifest({
    dataDirectory,
    workDirectory,
    sourceOverrides: options.sourceOverrides,
    refreshSources: options.refreshSources ?? true,
    forceScriptRefresh: options.forceScriptRefresh,
    channelUrl: options.channelUrl,
    sitemapUrl: options.sitemapUrl,
    scriptConcurrency: options.scriptConcurrency,
    ytDlpPath: options.ytDlpPath
  });
  const selectedEntries = selectLatestProcessableEntries(manifest.episodes, {
    count,
    retryFailed: Boolean(options.retryFailed)
  });
  const processed: ProcessLatestEpisodeResult[] = [];

  for (const entry of selectedEntries) {
    processed.push(
      await processLatestEpisode({
        entry,
        dataDirectory,
        workDirectory,
        force: options.force,
        ytDlpPath: options.ytDlpPath,
        pythonPath: options.pythonPath,
        asrPythonPath: options.asrPythonPath,
        asrModel: options.asrModel,
        preferAsr:
          Boolean(options.preferAsr) ||
          Boolean(options.sourceOverrides?.preferredAsrEpisodes.includes(entry.episode))
      })
    );
  }

  return {
    selectedEpisodes: selectedEntries.map((entry) => entry.episode),
    processed,
    manifestPath: resolve(dataDirectory, "manifest.json"),
    refreshedSources: options.refreshSources ?? true
  };
}

export function selectLatestProcessableEntries(
  entries: ManifestEntry[],
  options: { count: number; retryFailed?: boolean }
): ManifestEntry[] {
  const processableStatuses = new Set<EpisodeStatus>([
    "discovered",
    "processed",
    "low-confidence"
  ]);
  if (options.retryFailed) {
    processableStatuses.add("failed");
  }

  return entries
    .filter(
      (entry) =>
        entry.hasScript &&
        Boolean(entry.youtubeId) &&
        Boolean(entry.videoUrl) &&
        Boolean(entry.scriptUrl) &&
        processableStatuses.has(entry.status)
    )
    .sort((left, right) => right.episode - left.episode)
    .slice(0, options.count);
}

async function prepareManifest(input: {
  dataDirectory: string;
  workDirectory: string;
  sourceOverrides?: SourceOverrides;
  refreshSources: boolean;
  forceScriptRefresh?: boolean;
  channelUrl?: string;
  sitemapUrl?: string;
  scriptConcurrency?: number;
  ytDlpPath?: string;
}): Promise<Manifest> {
  if (input.refreshSources) {
    await listVideos({
      channelUrl: input.channelUrl ?? DEFAULT_YOUTUBE_CHANNEL_VIDEOS_URL,
      dataDirectory: input.dataDirectory,
      episodeOverrides: input.sourceOverrides?.youtubeEpisodeOverrides,
      ytDlpPath: input.ytDlpPath
    });
    await discoverScripts({
      sitemapUrl: input.sitemapUrl ?? DEFAULT_SCRIPT_SITEMAP_URL,
      dataDirectory: input.dataDirectory,
      workDirectory: input.workDirectory,
      force: input.forceScriptRefresh,
      concurrency: input.scriptConcurrency
    });

    return (
      await buildManifest({
        dataDirectory: input.dataDirectory,
        sourceOverrides: input.sourceOverrides
      })
    ).manifest;
  }

  return ManifestSchema.parse(await readJson(resolve(input.dataDirectory, "manifest.json")));
}

async function processLatestEpisode(input: {
  entry: ManifestEntry;
  dataDirectory: string;
  workDirectory: string;
  force?: boolean;
  ytDlpPath?: string;
  pythonPath?: string;
  asrPythonPath?: string;
  asrModel?: string;
  preferAsr?: boolean;
}): Promise<ProcessLatestEpisodeResult> {
  try {
    const result = await processEpisode({
      episode: input.entry.episode,
      dataDirectory: input.dataDirectory,
      workDirectory: input.workDirectory,
      force: input.force,
      ytDlpPath: input.ytDlpPath,
      pythonPath: input.pythonPath,
      asrPythonPath: input.asrPythonPath,
      asrModel: input.asrModel,
      preferAsr: input.preferAsr
    });

    return toLatestEpisodeResult(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await updateBuildReport(input.dataDirectory, makeEpisodeKey(input.entry.episode), {
      status: "failed",
      message
    });

    return {
      episode: input.entry.episode,
      status: "failed",
      skipped: false,
      message
    };
  }
}

function toLatestEpisodeResult(result: ProcessEpisodeResult): ProcessLatestEpisodeResult {
  const summary = result.alignment.summary;
  return {
    episode: result.alignment.episode,
    status: result.skipped
      ? "skipped"
      : summary.lowConfidenceCount > 0 || summary.unmatchedCount > 0
        ? "low-confidence"
        : "processed",
    skipped: result.skipped,
    alignmentPath: result.alignmentPath,
    reportPath: result.reportPath,
    segments: result.alignment.segments.length,
    averageConfidence: summary.averageConfidence,
    lowConfidenceCount: summary.lowConfidenceCount,
    unmatchedCount: summary.unmatchedCount
  };
}

async function updateBuildReport(
  dataDirectory: string,
  episodeKey: string,
  entry: BuildReportEntry
): Promise<void> {
  const reportPath = resolve(dataDirectory, "build-report.json");
  let report: BuildReport = {};

  try {
    report = BuildReportSchema.parse(await readJson(reportPath));
  } catch {
    report = {};
  }

  report[episodeKey] = entry;
  await writeStableJson(reportPath, BuildReportSchema.parse(report));
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
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
