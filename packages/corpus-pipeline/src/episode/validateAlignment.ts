import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  AlignmentSchema,
  VideosSchema,
  makeEpisodeKey,
  type Alignment,
  type AlignmentSummary,
  type CorpusSegment
} from "@4989/corpus-types";

import { LOW_CONFIDENCE_THRESHOLD, MAX_REVIEW_ITEMS } from "./alignmentConstants.js";

const TIMESTAMP_OVERLAP_TOLERANCE_SECONDS = 0.01;
const VIDEO_DURATION_TOLERANCE_SECONDS = 1;

export class AlignmentValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Alignment validation failed:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "AlignmentValidationError";
    this.issues = issues;
  }
}

export type AlignmentValidationOptions = {
  alignmentPath: string;
  dataDirectory?: string;
  reportPath?: string;
  requireReviewReport?: boolean;
};

export type AlignmentValidationResult = {
  alignment: Alignment;
  alignmentPath: string;
  reportPath?: string;
  durationSeconds?: number;
  firstSegment?: ReviewableSegment;
  lastSegment?: ReviewableSegment;
  lowConfidenceReviewCount?: number;
  inferredReviewCount?: number;
  warnings: string[];
};

type ReviewableSegment = Pick<
  CorpusSegment,
  "id" | "segmentKey" | "localIndex" | "start" | "end" | "confidence" | "timingSource" | "text"
>;

type ReviewReport = {
  episode?: unknown;
  youtubeId?: unknown;
  summary?: unknown;
  lowConfidenceSegments?: unknown;
  inferredSegments?: unknown;
};

export async function validateAlignmentFile(
  options: AlignmentValidationOptions
): Promise<AlignmentValidationResult> {
  const alignmentPath = resolve(options.alignmentPath);
  const issues: string[] = [];
  const warnings: string[] = [];

  const parsedAlignment = AlignmentSchema.safeParse(await readJson(alignmentPath));
  if (!parsedAlignment.success) {
    throw new AlignmentValidationError(
      parsedAlignment.error.issues.map(
        (issue) => `${formatIssuePath(issue.path)}: ${issue.message}`
      )
    );
  }

  const alignment = parsedAlignment.data;
  validateDerivedSummary(alignment, issues);
  validateMonotonicTimestamps(alignment, issues);

  const durationSeconds = options.dataDirectory
    ? await readVideoDuration(resolve(options.dataDirectory), alignment.youtubeId, warnings)
    : undefined;
  if (durationSeconds !== undefined) {
    validateVideoDuration(alignment, durationSeconds, issues);
  }

  const reportPath =
    options.reportPath ??
    (options.dataDirectory
      ? resolve(options.dataDirectory, "reports", `${makeEpisodeKey(alignment.episode)}.json`)
      : undefined);
  const reportValidation = reportPath
    ? await validateReviewReport({
        reportPath,
        alignment,
        requireReviewReport: options.requireReviewReport ?? true,
        issues,
        warnings
      })
    : {};

  if (issues.length > 0) {
    throw new AlignmentValidationError(issues);
  }

  return {
    alignment,
    alignmentPath,
    reportPath,
    durationSeconds,
    firstSegment: alignment.segments[0],
    lastSegment: alignment.segments[alignment.segments.length - 1],
    lowConfidenceReviewCount: reportValidation.lowConfidenceReviewCount,
    inferredReviewCount: reportValidation.inferredReviewCount,
    warnings
  };
}

function validateMonotonicTimestamps(alignment: Alignment, issues: string[]): void {
  for (let index = 1; index < alignment.segments.length; index += 1) {
    const previous = alignment.segments[index - 1] as CorpusSegment;
    const current = alignment.segments[index] as CorpusSegment;

    if (current.start < previous.end - TIMESTAMP_OVERLAP_TOLERANCE_SECONDS) {
      issues.push(
        `${current.segmentKey} starts at ${current.start}s before previous segment ${previous.segmentKey} ends at ${previous.end}s`
      );
    }
  }
}

function validateDerivedSummary(alignment: Alignment, issues: string[]): void {
  const summary = alignment.summary;
  const scriptUnitCount = summary.scriptUnitCount ?? alignment.segments.length;
  const inferredCount = alignment.segments.filter(
    (segment) => segment.timingSource === "interpolated-between-caption-matches"
  ).length;
  const lowConfidenceCount = alignment.segments.filter(
    (segment) => (segment.confidence ?? 0) < LOW_CONFIDENCE_THRESHOLD
  ).length;
  const confidenceValues = alignment.segments.flatMap((segment) =>
    segment.confidence === undefined ? [] : [segment.confidence]
  );
  const averageConfidence =
    confidenceValues.length === 0
      ? undefined
      : roundConfidence(
          confidenceValues.reduce((sum, confidence) => sum + confidence, 0) /
            confidenceValues.length
        );

  // In this pipeline, matchedCount means emitted aligned script units. Inferred
  // timings are a subset of matchedCount and are separately counted above.
  if (summary.matchedCount !== alignment.segments.length) {
    issues.push(
      `Alignment summary matchedCount ${summary.matchedCount} does not equal emitted segment count ${alignment.segments.length}`
    );
  }

  const expectedUnmatchedCount = scriptUnitCount - alignment.segments.length;
  if (summary.unmatchedCount !== expectedUnmatchedCount) {
    issues.push(
      `Alignment summary unmatchedCount ${summary.unmatchedCount} does not equal scriptUnitCount minus segmentCount ${expectedUnmatchedCount}`
    );
  }

  if ((summary.inferredCount ?? 0) !== inferredCount) {
    issues.push(
      `Alignment summary inferredCount ${summary.inferredCount ?? 0} does not equal derived inferred segment count ${inferredCount}`
    );
  }

  if (summary.lowConfidenceCount !== lowConfidenceCount) {
    issues.push(
      `Alignment summary lowConfidenceCount ${summary.lowConfidenceCount} does not equal derived low-confidence count ${lowConfidenceCount}`
    );
  }

  if (summary.averageConfidence !== averageConfidence) {
    issues.push(
      `Alignment summary averageConfidence ${summary.averageConfidence ?? "undefined"} does not equal derived average ${averageConfidence ?? "undefined"}`
    );
  }
}

async function readVideoDuration(
  dataDirectory: string,
  youtubeId: string,
  warnings: string[]
): Promise<number | undefined> {
  const videosPath = resolve(dataDirectory, "videos.json");
  try {
    const videos = VideosSchema.parse(await readJson(videosPath));
    const video = videos.find((candidate) => candidate.youtubeId === youtubeId);
    if (!video) {
      warnings.push(`No matching video entry found in ${videosPath}`);
      return undefined;
    }

    if (video.durationSeconds === undefined) {
      warnings.push(`Video ${youtubeId} has no durationSeconds in ${videosPath}`);
    }

    return video.durationSeconds;
  } catch (error) {
    warnings.push(`Could not read video duration from ${videosPath}: ${formatError(error)}`);
    return undefined;
  }
}

function validateVideoDuration(
  alignment: Alignment,
  durationSeconds: number,
  issues: string[]
): void {
  const lastSegment = alignment.segments[alignment.segments.length - 1];
  if (lastSegment && lastSegment.end > durationSeconds + VIDEO_DURATION_TOLERANCE_SECONDS) {
    issues.push(
      `${lastSegment.segmentKey} ends at ${lastSegment.end}s after video duration ${durationSeconds}s`
    );
  }
}

async function validateReviewReport(input: {
  reportPath: string;
  alignment: Alignment;
  requireReviewReport: boolean;
  issues: string[];
  warnings: string[];
}): Promise<{
  lowConfidenceReviewCount?: number;
  inferredReviewCount?: number;
}> {
  const exists = await fileExists(input.reportPath);
  if (!exists) {
    const message = `Review report is missing at ${input.reportPath}`;
    if (input.requireReviewReport) {
      input.issues.push(message);
    } else {
      input.warnings.push(message);
    }
    return {};
  }

  const report = (await readJson(input.reportPath)) as ReviewReport;
  if (report.episode !== input.alignment.episode) {
    input.issues.push(`Review report episode does not match alignment episode`);
  }
  if (report.youtubeId !== input.alignment.youtubeId) {
    input.issues.push(`Review report youtubeId does not match alignment youtubeId`);
  }
  if (!summaryMatches(report.summary, input.alignment.summary)) {
    input.issues.push(`Review report summary does not match alignment summary`);
  }

  const lowConfidenceReviewCount = validateReportArray(
    report.lowConfidenceSegments,
    "lowConfidenceSegments",
    input.issues
  );
  const expectedLowConfidenceReviewCount = Math.min(
    input.alignment.summary.lowConfidenceCount,
    MAX_REVIEW_ITEMS
  );
  if (
    lowConfidenceReviewCount !== undefined &&
    lowConfidenceReviewCount !== expectedLowConfidenceReviewCount
  ) {
    input.issues.push(
      `Review report lowConfidenceSegments length ${lowConfidenceReviewCount} does not equal expected ${expectedLowConfidenceReviewCount}`
    );
  }

  const inferredReviewCount = validateReportArray(
    report.inferredSegments,
    "inferredSegments",
    input.issues
  );
  const expectedInferredReviewCount = input.alignment.summary.inferredCount ?? 0;
  if (
    inferredReviewCount !== undefined &&
    inferredReviewCount !== expectedInferredReviewCount
  ) {
    input.issues.push(
      `Review report inferredSegments length ${inferredReviewCount} does not equal expected ${expectedInferredReviewCount}`
    );
  }

  return {
    lowConfidenceReviewCount,
    inferredReviewCount
  };
}

function summaryMatches(candidate: unknown, expected: AlignmentSummary): boolean {
  return JSON.stringify(candidate) === JSON.stringify(expected);
}

function validateReportArray(
  value: unknown,
  name: "lowConfidenceSegments" | "inferredSegments",
  issues: string[]
): number | undefined {
  if (!Array.isArray(value)) {
    issues.push(`Review report ${name} must be an array`);
    return undefined;
  }

  return value.length;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function formatIssuePath(path: PropertyKey[]): string {
  return path.length === 0 ? "<root>" : path.map(String).join(".");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function roundConfidence(value: number): number {
  return Math.round(value * 1000) / 1000;
}
