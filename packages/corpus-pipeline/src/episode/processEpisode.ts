import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import {
  AlignmentSchema,
  BuildReportSchema,
  ManifestSchema,
  ScriptsSchema,
  VideosSchema,
  makeEpisodeKey,
  type Alignment,
  type BuildReport,
  type BuildReportEntry,
  type CorpusSegment,
  type ManifestEntry,
  type Script,
  type Video
} from "@4989/corpus-types";

import { alignCaptionLattice, type AlignmentIssue } from "../align/alignCaptionLattice.js";
import { parseJson3Captions } from "../align/parseJson3Captions.js";
import { splitScriptSentences } from "../align/splitScriptSentences.js";
import { findRepoRoot } from "../cli/paths.js";
import { tokenizeJapaneseTexts } from "../tokenize/tokenizeJapanese.js";
import { downloadEpisodeSources } from "../youtube/downloadEpisodeSources.js";

const PIPELINE_VERSION = 4;
const LOW_CONFIDENCE_THRESHOLD = 0.68;

export type ProcessEpisodeOptions = {
  episode: number;
  dataDirectory: string;
  workDirectory: string;
  force?: boolean;
  ytDlpPath?: string;
  pythonPath?: string;
};

export type ProcessEpisodeResult = {
  alignment: Alignment;
  alignmentPath: string;
  skipped: boolean;
  scriptUnitCount: number;
  unmatchedIssues: AlignmentIssue[];
};

export async function processEpisode(
  options: ProcessEpisodeOptions
): Promise<ProcessEpisodeResult> {
  const dataDirectory = resolve(options.dataDirectory);
  const workDirectory = resolve(options.workDirectory);
  const repoRoot = await findRepoRoot();
  const episodeKey = makeEpisodeKey(options.episode);
  const alignmentDirectory = resolve(dataDirectory, "alignments");
  const alignmentPath = resolve(alignmentDirectory, `${episodeKey}.json`);

  await mkdir(alignmentDirectory, { recursive: true });

  const { manifestEntry, video, script } = await resolveEpisodeSources(dataDirectory, options.episode);
  if (!manifestEntry.youtubeId || !manifestEntry.videoUrl || !manifestEntry.scriptUrl) {
    throw new Error(`Episode ${options.episode} does not have complete video and script sources`);
  }

  const sourcePaths = await downloadEpisodeSources({
    episode: options.episode,
    videoUrl: manifestEntry.videoUrl,
    workDirectory,
    force: options.force,
    ytDlpPath: options.ytDlpPath
  });

  await ensureScriptCache(script, repoRoot);

  const [scriptText, captionJsonText, videoMetadataText] = await Promise.all([
    readScriptText(script, repoRoot),
    readFile(sourcePaths.captionPath, "utf8"),
    readFile(sourcePaths.videoMetadataPath, "utf8")
  ]);
  const source = {
    captionTrack: "ja-orig",
    alignmentMethod: "youtube-caption-lattice",
    scriptHash: sha256(scriptText),
    captionHash: sha256(captionJsonText),
    videoMetadataHash: sha256(videoMetadataText),
    pipelineVersion: PIPELINE_VERSION,
    generatedAt: new Date().toISOString()
  };

  const existingAlignment = await readExistingAlignment(alignmentPath);
  if (
    !options.force &&
    existingAlignment &&
    existingAlignment.episode === options.episode &&
    existingAlignment.youtubeId === manifestEntry.youtubeId &&
    existingAlignment.source.scriptHash === source.scriptHash &&
    existingAlignment.source.captionHash === source.captionHash &&
    existingAlignment.source.videoMetadataHash === source.videoMetadataHash &&
    existingAlignment.source.pipelineVersion === PIPELINE_VERSION
  ) {
    return {
      alignment: existingAlignment,
      alignmentPath,
      skipped: true,
      scriptUnitCount: existingAlignment.summary.scriptUnitCount ?? existingAlignment.segments.length,
      unmatchedIssues: []
    };
  }

  const scriptUnits = splitScriptSentences(scriptText);
  const lattice = parseJson3Captions(JSON.parse(captionJsonText) as unknown);
  const alignmentResult = alignCaptionLattice({
    episode: options.episode,
    youtubeId: manifestEntry.youtubeId,
    scriptUnits,
    lattice,
    lowConfidenceThreshold: LOW_CONFIDENCE_THRESHOLD
  });

  const tokenized = await tokenizeJapaneseTexts(
    alignmentResult.segments.map((segment) => segment.text),
    { pythonPath: resolveOptionalPath(options.pythonPath, repoRoot) }
  );
  const segments = alignmentResult.segments.map((segment, index): CorpusSegment => ({
    ...segment,
    tokens: tokenized[index] ?? []
  }));
  const lowConfidenceCount = segments.filter(
    (segment) => (segment.confidence ?? 0) < LOW_CONFIDENCE_THRESHOLD
  ).length;
  const inferredCount = segments.filter(
    (segment) => segment.timingSource === "interpolated-between-caption-matches"
  ).length;
  const confidenceValues = segments.flatMap((segment) =>
    segment.confidence === undefined ? [] : [segment.confidence]
  );
  const averageConfidence =
    confidenceValues.length > 0
      ? roundConfidence(
          confidenceValues.reduce((sum, confidence) => sum + confidence, 0) /
            confidenceValues.length
        )
      : undefined;

  const rawAlignment: Alignment = {
    episode: options.episode,
    youtubeId: manifestEntry.youtubeId,
    source,
    summary: {
      scriptUnitCount: scriptUnits.length,
      segmentCount: segments.length,
      matchedCount: segments.length,
      unmatchedCount: alignmentResult.issues.length,
      inferredCount,
      lowConfidenceCount
    },
    segments
  };

  if (averageConfidence !== undefined) {
    rawAlignment.summary.averageConfidence = averageConfidence;
  }

  validateTimestamps(rawAlignment, video.durationSeconds);
  const alignment = AlignmentSchema.parse(rawAlignment);

  await writeStableJson(alignmentPath, alignment);
  await updateBuildReport(dataDirectory, episodeKey, {
    status: lowConfidenceCount > 0 ? "low-confidence" : "processed",
    segments: segments.length,
    matchedCount: segments.length,
    unmatchedCount: alignmentResult.issues.length,
    inferredCount,
    lowConfidenceCount,
    ...(averageConfidence === undefined ? {} : { averageConfidence })
  });

  return {
    alignment,
    alignmentPath,
    skipped: false,
    scriptUnitCount: scriptUnits.length,
    unmatchedIssues: alignmentResult.issues
  };
}

async function resolveEpisodeSources(
  dataDirectory: string,
  episode: number
): Promise<{
  manifestEntry: ManifestEntry;
  video: Video;
  script: Script;
}> {
  const [manifest, videos, scripts] = await Promise.all([
    readJson(resolve(dataDirectory, "manifest.json")).then((value) => ManifestSchema.parse(value)),
    readJson(resolve(dataDirectory, "videos.json")).then((value) => VideosSchema.parse(value)),
    readJson(resolve(dataDirectory, "scripts.json")).then((value) => ScriptsSchema.parse(value))
  ]);

  const manifestEntry = manifest.episodes.find((entry) => entry.episode === episode);
  if (!manifestEntry) {
    throw new Error(`Episode ${episode} is not present in manifest.json`);
  }

  if (!manifestEntry.youtubeId) {
    throw new Error(`Episode ${episode} is missing a YouTube video`);
  }

  if (!manifestEntry.scriptUrl) {
    throw new Error(`Episode ${episode} is missing an official script`);
  }

  const video = videos.find((candidate) => candidate.youtubeId === manifestEntry.youtubeId);
  if (!video) {
    throw new Error(`Episode ${episode} selected video is missing from videos.json`);
  }

  const script = scripts.find((candidate) => candidate.url === manifestEntry.scriptUrl);
  if (!script) {
    throw new Error(`Episode ${episode} selected script is missing from scripts.json`);
  }

  return { manifestEntry, video, script };
}

async function ensureScriptCache(script: Script, repoRoot: string): Promise<void> {
  const textPath = resolve(repoRoot, script.textPath);
  try {
    await access(textPath, constants.F_OK);
    return;
  } catch {
    await writeFile(textPath, `${script.text}\n`, "utf8");
  }
}

async function readScriptText(script: Script, repoRoot: string): Promise<string> {
  const textPath = resolve(repoRoot, script.textPath);
  try {
    return await readFile(textPath, "utf8");
  } catch {
    return script.text;
  }
}

async function readExistingAlignment(path: string): Promise<Alignment | undefined> {
  try {
    return AlignmentSchema.parse(await readJson(path));
  } catch {
    return undefined;
  }
}

function validateTimestamps(alignment: Alignment, durationSeconds: number | undefined): void {
  let previousEnd = 0;

  for (const segment of alignment.segments) {
    if (segment.start < previousEnd - 0.01) {
      throw new Error(`Segment ${segment.segmentKey} overlaps previous segment`);
    }

    if (durationSeconds !== undefined && segment.end > durationSeconds + 1) {
      throw new Error(`Segment ${segment.segmentKey} ends after video duration`);
    }

    previousEnd = segment.end;
  }
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

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function roundConfidence(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function resolveOptionalPath(path: string | undefined, baseDirectory: string): string | undefined {
  if (!path || isAbsolute(path) || !path.includes("/")) {
    return path;
  }

  return resolve(baseDirectory, path);
}
