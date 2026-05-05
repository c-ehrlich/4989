import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  AlignmentSchema,
  BuildReportSchema,
  EpisodeSchema,
  EpisodeSegmentsSchema,
  EpisodesSchema,
  LemmaBucketSchema,
  ManifestSchema,
  SurfaceBucketSchema,
  SurfaceToLemmasSchema,
  VideosSchema,
  makeEpisodeKey,
  type Alignment,
  type BuildReport,
  type CorpusSegment,
  type Episode,
  type LemmaBucket,
  type Manifest,
  type SurfaceBucket,
  type SurfaceToLemmas,
  type Video
} from "@4989/corpus-types";

export type BuildStaticIndexOptions = {
  dataDirectory: string;
  allowEmpty?: boolean;
};

export type BuildStaticIndexResult = {
  alignmentCount: number;
  episodeCount: number;
  segmentCount: number;
  lemmaCount: number;
  surfaceCount: number;
  surfaceToLemmaCount: number;
  dataDirectory: string;
};

type SegmentMetadata = {
  title: string;
  videoUrl?: string;
  scriptUrl?: string;
  publishedDate?: string;
  durationSeconds?: number;
};

type MutableIndex = Map<string, Set<number>>;

const BUCKET_NAMES = Array.from({ length: 256 }, (_value, index) =>
  index.toString(16).padStart(2, "0")
);

export async function buildStaticIndex(
  options: BuildStaticIndexOptions
): Promise<BuildStaticIndexResult> {
  const dataDirectory = resolve(options.dataDirectory);
  const alignmentDirectory = resolve(dataDirectory, "alignments");
  const segmentsDirectory = resolve(dataDirectory, "segments");
  const indexDirectory = resolve(dataDirectory, "index");
  const lemmaBucketDirectory = resolve(indexDirectory, "lemma-buckets");
  const surfaceBucketDirectory = resolve(indexDirectory, "surface-buckets");

  const [alignments, manifest, videos] = await Promise.all([
    readAlignments(alignmentDirectory, { allowEmpty: options.allowEmpty ?? false }),
    readOptionalJson(resolve(dataDirectory, "manifest.json")).then((value) =>
      value === undefined ? undefined : ManifestSchema.parse(value)
    ),
    readOptionalJson(resolve(dataDirectory, "videos.json")).then((value) =>
      value === undefined ? [] : VideosSchema.parse(value)
    )
  ]);

  const videosByYoutubeId = new Map(videos.map((video) => [video.youtubeId, video]));
  const manifestByEpisode = new Map(
    (manifest?.episodes ?? []).map((entry) => [entry.episode, entry])
  );

  await Promise.all([
    replaceDirectory(segmentsDirectory),
    replaceDirectory(lemmaBucketDirectory),
    replaceDirectory(surfaceBucketDirectory),
    mkdir(indexDirectory, { recursive: true })
  ]);

  const lemmaIndex: MutableIndex = new Map();
  const surfaceIndex: MutableIndex = new Map();
  const surfaceToLemmas = new Map<string, Set<string>>();
  const episodes: Episode[] = [];
  let segmentCount = 0;

  for (const alignment of alignments) {
    const segments = normalizeAlignmentSegments(alignment);
    const video = videosByYoutubeId.get(alignment.youtubeId);
    const manifestEntry = manifestByEpisode.get(alignment.episode);
    const metadata = getSegmentMetadata(alignment, video, manifestEntry);
    const episodeKey = makeEpisodeKey(alignment.episode);

    await writeStableJson(
      resolve(segmentsDirectory, `${episodeKey}.json`),
      EpisodeSegmentsSchema.parse({
        episode: alignment.episode,
        youtubeId: alignment.youtubeId,
        title: metadata.title,
        segments
      })
    );

    episodes.push(
      EpisodeSchema.parse({
        episode: alignment.episode,
        title: metadata.title,
        youtubeId: alignment.youtubeId,
        videoUrl: metadata.videoUrl,
        scriptUrl: metadata.scriptUrl,
        publishedDate: metadata.publishedDate,
        durationSeconds: metadata.durationSeconds,
        segmentPath: `data/segments/${episodeKey}.json`
      })
    );

    for (const segment of segments) {
      segmentCount += 1;
      indexSegmentTokens(segment, lemmaIndex, surfaceIndex, surfaceToLemmas);
    }
  }

  episodes.sort((left, right) => left.episode - right.episode);
  await writeStableJson(resolve(dataDirectory, "episodes.json"), EpisodesSchema.parse(episodes));

  if (videos.length > 0) {
    await writeStableJson(resolve(dataDirectory, "videos.json"), VideosSchema.parse(sortVideos(videos)));
  }

  await Promise.all([
    writeBuckets(lemmaBucketDirectory, lemmaIndex, LemmaBucketSchema.parse),
    writeBuckets(surfaceBucketDirectory, surfaceIndex, SurfaceBucketSchema.parse),
    writeSurfaceToLemmas(resolve(indexDirectory, "surface-to-lemmas.json"), surfaceToLemmas),
    updateBuildReport(dataDirectory, alignments)
  ]);

  return {
    alignmentCount: alignments.length,
    episodeCount: episodes.length,
    segmentCount,
    lemmaCount: lemmaIndex.size,
    surfaceCount: surfaceIndex.size,
    surfaceToLemmaCount: surfaceToLemmas.size,
    dataDirectory
  };
}

export function getIndexBucketName(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 2);
}

async function readAlignments(
  alignmentDirectory: string,
  options: { allowEmpty: boolean }
): Promise<Alignment[]> {
  let entries: string[];
  try {
    entries = await readdir(alignmentDirectory);
  } catch (error) {
    if (options.allowEmpty && isFileMissingError(error)) {
      return [];
    }

    throw error;
  }

  const alignmentFiles = entries
    .filter((entry) => /^ep\d+\.json$/.test(entry))
    .sort((left, right) => {
      const leftEpisode = Number(left.match(/\d+/)?.[0] ?? 0);
      const rightEpisode = Number(right.match(/\d+/)?.[0] ?? 0);
      return leftEpisode - rightEpisode || left.localeCompare(right);
    });

  const seenEpisodes = new Map<number, string>();
  const alignments: Alignment[] = [];

  for (const fileName of alignmentFiles) {
    const fileEpisode = parseEpisodeFromAlignmentFileName(fileName);
    const alignment = AlignmentSchema.parse(await readJson(resolve(alignmentDirectory, fileName)));

    if (alignment.episode !== fileEpisode) {
      throw new Error(
        `Alignment file ${fileName} contains episode ${alignment.episode}; expected episode ${fileEpisode}`
      );
    }

    const previousFileName = seenEpisodes.get(alignment.episode);
    if (previousFileName) {
      throw new Error(
        `Duplicate alignment episode ${alignment.episode} in ${previousFileName} and ${fileName}`
      );
    }

    seenEpisodes.set(alignment.episode, fileName);
    alignments.push(alignment);
  }

  return alignments;
}

function parseEpisodeFromAlignmentFileName(fileName: string): number {
  const match = /^ep(\d+)\.json$/.exec(fileName);
  if (!match) {
    throw new Error(`Invalid alignment file name: ${fileName}`);
  }

  return Number(match[1]);
}

function normalizeAlignmentSegments(alignment: Alignment): CorpusSegment[] {
  const segments = [...alignment.segments].sort((left, right) => left.localIndex - right.localIndex);

  segments.forEach((segment, index) => {
    if (segment.localIndex !== index) {
      throw new Error(
        `Alignment ${makeEpisodeKey(alignment.episode)} has non-contiguous segment localIndex ${segment.localIndex}; expected ${index}`
      );
    }
  });

  return segments;
}

function getSegmentMetadata(
  alignment: Alignment,
  video: Video | undefined,
  manifestEntry: Manifest["episodes"][number] | undefined
): SegmentMetadata {
  return {
    title: video?.title ?? `ep.${alignment.episode}`,
    videoUrl: manifestEntry?.videoUrl ?? video?.url,
    scriptUrl: manifestEntry?.scriptUrl,
    publishedDate: toDateString(video?.publishedAt),
    durationSeconds: video?.durationSeconds
  };
}

function toDateString(dateTime: string | undefined): string | undefined {
  return dateTime?.slice(0, 10);
}

function indexSegmentTokens(
  segment: CorpusSegment,
  lemmaIndex: MutableIndex,
  surfaceIndex: MutableIndex,
  surfaceToLemmas: Map<string, Set<string>>
): void {
  const seenLemmaKeys = new Set<string>();
  const seenSurfaceKeys = new Set<string>();

  for (const token of segment.tokens) {
    const surface = token.surface.trim();
    const lemma = token.lemma.trim();

    if (!surface || !lemma || !shouldIndexToken(token.pos, surface, lemma)) {
      continue;
    }

    if (!seenLemmaKeys.has(lemma)) {
      addIndexHit(lemmaIndex, lemma, segment.id);
      seenLemmaKeys.add(lemma);
    }

    if (!seenSurfaceKeys.has(surface)) {
      addIndexHit(surfaceIndex, surface, segment.id);
      seenSurfaceKeys.add(surface);
    }

    const lemmas = surfaceToLemmas.get(surface) ?? new Set<string>();
    lemmas.add(lemma);
    surfaceToLemmas.set(surface, lemmas);
  }
}

function shouldIndexToken(pos: string[], surface: string, lemma: string): boolean {
  if (pos.some((part) => part === "補助記号" || part === "記号" || part === "空白")) {
    return false;
  }

  return containsSearchableCharacter(surface) || containsSearchableCharacter(lemma);
}

function containsSearchableCharacter(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}

function addIndexHit(index: MutableIndex, key: string, segmentId: number): void {
  const hits = index.get(key) ?? new Set<number>();
  hits.add(segmentId);
  index.set(key, hits);
}

async function writeBuckets<TBucket extends LemmaBucket | SurfaceBucket>(
  directory: string,
  index: MutableIndex,
  parse: (value: unknown) => TBucket
): Promise<void> {
  const buckets = new Map<string, Record<string, number[]>>(
    BUCKET_NAMES.map((bucketName) => [bucketName, {}])
  );

  for (const [key, hits] of Array.from(index.entries()).sort(([left], [right]) =>
    left.localeCompare(right, "ja")
  )) {
    const bucketName = getIndexBucketName(key);
    const bucket = buckets.get(bucketName);
    if (!bucket) {
      throw new Error(`Unexpected index bucket ${bucketName}`);
    }

    bucket[key] = Array.from(hits).sort((left, right) => left - right);
  }

  await Promise.all(
    BUCKET_NAMES.map((bucketName) =>
      writeStableJson(resolve(directory, `${bucketName}.json`), parse(buckets.get(bucketName) ?? {}))
    )
  );
}

async function writeSurfaceToLemmas(
  path: string,
  surfaceToLemmas: Map<string, Set<string>>
): Promise<void> {
  const value: SurfaceToLemmas = {};

  for (const [surface, lemmas] of Array.from(surfaceToLemmas.entries()).sort(([left], [right]) =>
    left.localeCompare(right, "ja")
  )) {
    value[surface] = Array.from(lemmas).sort((left, right) => left.localeCompare(right, "ja"));
  }

  await writeStableJson(path, SurfaceToLemmasSchema.parse(value));
}

async function updateBuildReport(dataDirectory: string, alignments: Alignment[]): Promise<void> {
  const reportPath = resolve(dataDirectory, "build-report.json");
  let report: BuildReport = {};

  try {
    report = BuildReportSchema.parse(await readJson(reportPath));
  } catch {
    report = {};
  }

  const currentEpisodeKeys = new Set(alignments.map((alignment) => makeEpisodeKey(alignment.episode)));
  report = Object.fromEntries(
    Object.entries(report).filter(
      ([episodeKey, entry]) => currentEpisodeKeys.has(episodeKey) || !isDerivedAlignmentStatus(entry.status)
    )
  );

  await Promise.all(
    alignments.map(async (alignment) => {
      const episodeKey = makeEpisodeKey(alignment.episode);
      const reviewReportPath = resolve(dataDirectory, "reports", `${episodeKey}.json`);

      report[episodeKey] = {
        status: alignment.summary.lowConfidenceCount > 0 ? "low-confidence" : "processed",
        segments: alignment.summary.segmentCount,
        matchedCount: alignment.summary.matchedCount,
        unmatchedCount: alignment.summary.unmatchedCount,
        ...(alignment.summary.inferredCount === undefined
          ? {}
          : { inferredCount: alignment.summary.inferredCount }),
        ...(alignment.summary.averageConfidence === undefined
          ? {}
          : { averageConfidence: alignment.summary.averageConfidence }),
        lowConfidenceCount: alignment.summary.lowConfidenceCount,
        ...((await fileExists(reviewReportPath))
          ? { reportPath: `data/reports/${episodeKey}.json` }
          : {})
      };
    })
  );

  await writeStableJson(reportPath, BuildReportSchema.parse(report));
}

function isDerivedAlignmentStatus(status: BuildReport[string]["status"]): boolean {
  return status === "processed" || status === "low-confidence";
}

function sortVideos(videos: Video[]): Video[] {
  return [...videos].sort(
    (left, right) =>
      (left.episode ?? Number.MAX_SAFE_INTEGER) - (right.episode ?? Number.MAX_SAFE_INTEGER) ||
      left.title.localeCompare(right.title, "ja") ||
      left.youtubeId.localeCompare(right.youtubeId)
  );
}

async function replaceDirectory(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
}

async function readOptionalJson(path: string): Promise<unknown | undefined> {
  try {
    return await readJson(path);
  } catch (error) {
    if (isFileMissingError(error)) {
      return undefined;
    }

    throw error;
  }
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isFileMissingError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
