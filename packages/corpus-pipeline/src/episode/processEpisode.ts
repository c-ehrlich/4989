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
  type EpisodeStatus,
  type ManifestEntry,
  type Script,
  type Video
} from "@4989/corpus-types";

import { alignCaptionLattice, type AlignmentIssue } from "../align/alignCaptionLattice.js";
import { buildReadingCaptionLattice } from "../align/buildReadingLattice.js";
import { normalizeForAlignment } from "../align/normalizeText.js";
import { parseAsrTranscriptCaptions } from "../align/parseAsrTranscript.js";
import type { CaptionLattice } from "../align/parseJson3Captions.js";
import { parseJson3Captions } from "../align/parseJson3Captions.js";
import { splitScriptSentences } from "../align/splitScriptSentences.js";
import { transcribeAudioWithFasterWhisper } from "../asr/transcribeAudio.js";
import { findRepoRoot } from "../cli/paths.js";
import {
  normalizeJapaneseReadings,
  tokenizeJapaneseTexts
} from "../tokenize/tokenizeJapanese.js";
import {
  downloadEpisodeAudio,
  downloadEpisodeSources
} from "../youtube/downloadEpisodeSources.js";
import { LOW_CONFIDENCE_THRESHOLD, MAX_REVIEW_ITEMS } from "./alignmentConstants.js";
import { AlignmentValidationError, validateAlignmentFile } from "./validateAlignment.js";

const PIPELINE_VERSION = 10;

export type ProcessEpisodeOptions = {
  episode: number;
  dataDirectory: string;
  workDirectory: string;
  force?: boolean;
  ytDlpPath?: string;
  pythonPath?: string;
  asrPythonPath?: string;
  asrModel?: string;
  preferAsr?: boolean;
};

export type ProcessEpisodeResult = {
  alignment: Alignment;
  alignmentPath: string;
  reportPath: string;
  skipped: boolean;
  scriptUnitCount: number;
  unmatchedIssues: AlignmentIssue[];
};

type ResolvedCaptionSource = {
  captionTrack: string;
  alignmentMethod: string;
  sourceText: string;
  lattice: CaptionLattice;
};

export async function processEpisode(
  options: ProcessEpisodeOptions
): Promise<ProcessEpisodeResult> {
  const dataDirectory = resolve(options.dataDirectory);
  const workDirectory = resolve(options.workDirectory);
  const repoRoot = await findRepoRoot();
  const episodeKey = makeEpisodeKey(options.episode);
  const alignmentDirectory = resolve(dataDirectory, "alignments");
  const reportDirectory = resolve(dataDirectory, "reports");
  const alignmentPath = resolve(alignmentDirectory, `${episodeKey}.json`);
  const reportPath = resolve(reportDirectory, `${episodeKey}.json`);

  await Promise.all([
    mkdir(alignmentDirectory, { recursive: true }),
    mkdir(reportDirectory, { recursive: true })
  ]);

  const { manifestEntry, video, script } = await resolveEpisodeSources(dataDirectory, options.episode);
  assertProcessableManifestEntry(manifestEntry);
  if (!manifestEntry.youtubeId || !manifestEntry.videoUrl || !manifestEntry.scriptUrl) {
    throw new Error(`Episode ${options.episode} does not have complete video and script sources`);
  }

  const sourcePaths = await downloadEpisodeSources({
    episode: options.episode,
    videoUrl: manifestEntry.videoUrl,
    workDirectory,
    force: options.force,
    requireCaption: !options.asrPythonPath,
    ytDlpPath: options.ytDlpPath
  });

  await ensureScriptCache(script, repoRoot);

  const [scriptText, videoMetadataText] = await Promise.all([
    readScriptText(script, repoRoot),
    readFile(sourcePaths.videoMetadataPath, "utf8")
  ]);
  const captionSource = await resolveCaptionSource({
    episode: options.episode,
    videoUrl: manifestEntry.videoUrl,
    workDirectory,
    sourcePaths,
    force: options.force,
    ytDlpPath: options.ytDlpPath,
    asrPythonPath: resolveOptionalPath(options.asrPythonPath, repoRoot),
    asrModel: options.asrModel,
    preferAsr: options.preferAsr
  });
  const source = {
    captionTrack: captionSource.captionTrack,
    alignmentMethod: captionSource.alignmentMethod,
    scriptHash: sha256(scriptText),
    captionHash: sha256(captionSource.sourceText),
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
    const cacheAction = await validateOrRepairCachedArtifacts({
      dataDirectory,
      episodeKey,
      alignmentPath,
      reportPath,
      alignment: existingAlignment,
      video
    });

    if (cacheAction === "regenerate-alignment") {
      // Source hashes match, but the cached alignment failed derived validation.
      // Continue through the normal generation path to repair the canonical JSON.
    } else {
      const summary = existingAlignment.summary;
      await updateBuildReport(dataDirectory, episodeKey, {
        status:
          summary.lowConfidenceCount > 0 || summary.unmatchedCount > 0
            ? "low-confidence"
            : "processed",
        segments: summary.segmentCount,
        matchedCount: summary.matchedCount,
        unmatchedCount: summary.unmatchedCount,
        inferredCount: summary.inferredCount,
        lowConfidenceCount: summary.lowConfidenceCount,
        reportPath: `data/reports/${episodeKey}.json`,
        ...(summary.averageConfidence === undefined
          ? {}
          : { averageConfidence: summary.averageConfidence })
      });

      return {
        alignment: existingAlignment,
        alignmentPath,
        reportPath,
        skipped: true,
        scriptUnitCount:
          existingAlignment.summary.scriptUnitCount ?? existingAlignment.segments.length,
        unmatchedIssues: []
      };
    }
  }

  const lattice = captionSource.lattice;
  const rawScriptUnits = splitScriptSentences(scriptText);
  const pythonPath = resolveOptionalPath(options.pythonPath, repoRoot);
  const readingTexts = await normalizeJapaneseReadings(
    [...rawScriptUnits.map((unit) => unit.text), ...lattice.cues.map((cue) => cue.text)],
    { pythonPath }
  );
  const scriptUnits = rawScriptUnits.map((unit, index) => ({
    ...unit,
    normalizedReadingText: normalizeForAlignment(readingTexts[index] ?? "")
  }));
  const cueReadings = readingTexts.slice(rawScriptUnits.length);
  const readingLattice = buildReadingCaptionLattice(lattice, cueReadings);
  const alignmentResult = alignCaptionLattice({
    episode: options.episode,
    youtubeId: manifestEntry.youtubeId,
    scriptUnits,
    lattice,
    readingLattice,
    lowConfidenceThreshold: LOW_CONFIDENCE_THRESHOLD
  });

  const tokenized = await tokenizeJapaneseTexts(
    alignmentResult.segments.map((segment) => segment.text),
    { pythonPath }
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
  await writeEpisodeReviewReport({
    path: reportPath,
    episodeKey,
    alignment,
    unmatchedIssues: alignmentResult.issues,
    lowConfidenceThreshold: LOW_CONFIDENCE_THRESHOLD
  });
  await updateBuildReport(dataDirectory, episodeKey, {
    status:
      lowConfidenceCount > 0 || alignmentResult.issues.length > 0
        ? "low-confidence"
        : "processed",
    segments: segments.length,
    matchedCount: segments.length,
    unmatchedCount: alignmentResult.issues.length,
    inferredCount,
    lowConfidenceCount,
    reportPath: `data/reports/${episodeKey}.json`,
    ...(averageConfidence === undefined ? {} : { averageConfidence })
  });

  return {
    alignment,
    alignmentPath,
    reportPath,
    skipped: false,
    scriptUnitCount: scriptUnits.length,
    unmatchedIssues: alignmentResult.issues
  };
}

async function resolveCaptionSource(input: {
  episode: number;
  videoUrl: string;
  workDirectory: string;
  sourcePaths: { captionPath?: string };
  force?: boolean;
  ytDlpPath?: string;
  asrPythonPath?: string;
  asrModel?: string;
  preferAsr?: boolean;
}): Promise<ResolvedCaptionSource> {
  if (input.preferAsr && input.asrPythonPath) {
    return resolveAsrCaptionSource(input);
  }

  if (input.sourcePaths.captionPath) {
    const sourceText = await readFile(input.sourcePaths.captionPath, "utf8");
    const lattice = parseJson3Captions(JSON.parse(sourceText) as unknown);
    if (lattice.text.length === 0 && input.asrPythonPath) {
      return resolveAsrCaptionSource(input);
    }

    return {
      captionTrack: "ja-orig",
      alignmentMethod: "youtube-caption-lattice",
      sourceText,
      lattice
    };
  }

  if (!input.asrPythonPath) {
    throw new Error(`Episode ${input.episode} has no ja-orig captions and no ASR fallback enabled`);
  }

  return resolveAsrCaptionSource(input);
}

async function resolveAsrCaptionSource(input: {
  episode: number;
  videoUrl: string;
  workDirectory: string;
  force?: boolean;
  ytDlpPath?: string;
  asrPythonPath?: string;
  asrModel?: string;
}): Promise<ResolvedCaptionSource> {
  if (!input.asrPythonPath) {
    throw new Error(`Episode ${input.episode} has no usable captions and no ASR fallback enabled`);
  }

  const audioPath = await downloadEpisodeAudio({
    episode: input.episode,
    videoUrl: input.videoUrl,
    workDirectory: input.workDirectory,
    force: input.force,
    ytDlpPath: input.ytDlpPath
  });
  const { transcript, transcriptText } = await transcribeAudioWithFasterWhisper({
    episode: input.episode,
    audioPath,
    workDirectory: input.workDirectory,
    pythonPath: input.asrPythonPath,
    model: input.asrModel,
    force: input.force
  });

  return {
    captionTrack: `faster-whisper-${transcript.model}`,
    alignmentMethod: "faster-whisper-caption-lattice",
    sourceText: transcriptText,
    lattice: parseAsrTranscriptCaptions(transcript)
  };
}

async function validateOrRepairCachedArtifacts(input: {
  dataDirectory: string;
  episodeKey: string;
  alignmentPath: string;
  reportPath: string;
  alignment: Alignment;
  video: Video;
}): Promise<"reuse" | "regenerate-alignment"> {
  try {
    validateTimestamps(input.alignment, input.video.durationSeconds);
    await validateAlignmentFile({
      alignmentPath: input.alignmentPath,
      dataDirectory: input.dataDirectory,
      reportPath: input.reportPath
    });
    return "reuse";
  } catch (error) {
    if (!(error instanceof AlignmentValidationError)) {
      throw error;
    }

    const reportOnlyIssues = error.issues.every((issue) => issue.startsWith("Review report "));
    if (!reportOnlyIssues) {
      return "regenerate-alignment";
    }

    await writeEpisodeReviewReport({
      path: input.reportPath,
      episodeKey: input.episodeKey,
      alignment: input.alignment,
      unmatchedIssues: [],
      lowConfidenceThreshold: LOW_CONFIDENCE_THRESHOLD
    });
    await validateAlignmentFile({
      alignmentPath: input.alignmentPath,
      dataDirectory: input.dataDirectory,
      reportPath: input.reportPath
    });
    return "reuse";
  }
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

function assertProcessableManifestEntry(entry: ManifestEntry): void {
  const allowedStatuses = new Set<EpisodeStatus>(["discovered", "processed", "low-confidence"]);

  if (!allowedStatuses.has(entry.status)) {
    throw new Error(
      `Episode ${entry.episode} cannot be processed while manifest status is ${entry.status}`
    );
  }

  if (!entry.youtubeId || !entry.videoUrl || !entry.hasScript || !entry.scriptUrl) {
    throw new Error(`Episode ${entry.episode} does not have complete video and script sources`);
  }
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

async function writeEpisodeReviewReport(input: {
  path: string;
  episodeKey: string;
  alignment: Alignment;
  unmatchedIssues: AlignmentIssue[];
  lowConfidenceThreshold: number;
}): Promise<void> {
  const lowConfidenceSegments = input.alignment.segments
    .filter((segment) => (segment.confidence ?? 1) < input.lowConfidenceThreshold)
    .sort((left, right) => (left.confidence ?? 1) - (right.confidence ?? 1))
    .slice(0, MAX_REVIEW_ITEMS)
    .map(toReviewSegment);
  const inferredSegments = input.alignment.segments
    .filter((segment) => segment.timingSource === "interpolated-between-caption-matches")
    .map(toReviewSegment);

  await writeStableJson(input.path, {
    generatedAt: input.alignment.source.generatedAt,
    episode: input.alignment.episode,
    youtubeId: input.alignment.youtubeId,
    alignmentPath: `data/alignments/${input.episodeKey}.json`,
    summary: input.alignment.summary,
    reviewLimits: {
      maxLowConfidenceSegments: MAX_REVIEW_ITEMS
    },
    unmatchedIssues: input.unmatchedIssues.slice(0, MAX_REVIEW_ITEMS).map((issue) => ({
      scriptIndex: issue.scriptIndex,
      reason: issue.reason,
      confidence: issue.confidence === undefined ? undefined : roundConfidence(issue.confidence),
      text: issue.text
    })),
    lowConfidenceSegments,
    inferredSegments
  });
}

function toReviewSegment(segment: CorpusSegment): {
  id: number;
  segmentKey: string;
  localIndex: number;
  start: number;
  end: number;
  confidence?: number;
  timingSource?: CorpusSegment["timingSource"];
  text: string;
} {
  return {
    id: segment.id,
    segmentKey: segment.segmentKey,
    localIndex: segment.localIndex,
    start: segment.start,
    end: segment.end,
    confidence: segment.confidence,
    timingSource: segment.timingSource,
    text: segment.text
  };
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
