import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  EpisodeSegmentsSchema,
  LemmaBucketSchema,
  SurfaceBucketSchema,
  SurfaceToLemmasSchema,
  makeEpisodeKey,
  parseSegmentId,
  type CorpusSegment,
  type EpisodeSegments,
  type LemmaBucket,
  type SurfaceBucket,
  type SurfaceToLemmas
} from "@4989/corpus-types";

import { getIndexBucketName } from "../index/buildStaticIndex.js";

export type SearchMode = "auto" | "lemma" | "surface";

export type SearchCorpusOptions = {
  dataDirectory: string;
  query: string;
  mode?: SearchMode;
  limit?: number;
};

export type SearchHit = {
  segmentId: number;
  episode: number;
  localIndex: number;
  title: string;
  youtubeId: string;
  start: number;
  end: number;
  text: string;
  timestamp: string;
  youtubeTimestampUrl: string;
  segment: CorpusSegment;
};

export type SearchCorpusResult = {
  query: string;
  normalizedQuery: string;
  mode: SearchMode;
  limit: number;
  searched: SearchLookup[];
  totalSegmentIds: number;
  hits: SearchHit[];
};

export type SearchLookup = {
  kind: "lemma" | "surface";
  key: string;
};

const DEFAULT_LIMIT = 20;

export async function searchCorpus(options: SearchCorpusOptions): Promise<SearchCorpusResult> {
  const dataDirectory = resolve(options.dataDirectory);
  const normalizedQuery = normalizeQuery(options.query);
  const mode = options.mode ?? "auto";
  const limit = options.limit ?? DEFAULT_LIMIT;

  if (!normalizedQuery) {
    throw new Error("Search query cannot be empty");
  }

  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error("Search limit must be a positive integer");
  }

  const searched = await resolveLookups(dataDirectory, normalizedQuery, mode);
  const segmentIds = dedupeAndSort(
    (
      await Promise.all(
        searched.map((lookup) =>
          lookup.kind === "lemma"
            ? readLemmaHits(dataDirectory, lookup.key)
            : readSurfaceHits(dataDirectory, lookup.key)
        )
      )
    ).flat()
  );
  const limitedSegmentIds = segmentIds.slice(0, limit);
  const hits = await hydrateSegmentIds(dataDirectory, limitedSegmentIds);

  return {
    query: options.query,
    normalizedQuery,
    mode,
    limit,
    searched,
    totalSegmentIds: segmentIds.length,
    hits
  };
}

export function normalizeQuery(query: string): string {
  return query.normalize("NFKC").trim();
}

export function formatTimestamp(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainingSeconds = wholeSeconds % 60;

  if (hours > 0) {
    return [
      hours.toString(),
      minutes.toString().padStart(2, "0"),
      remainingSeconds.toString().padStart(2, "0")
    ].join(":");
  }

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function makeYoutubeTimestampUrl(youtubeId: string, start: number): string {
  const timestampSeconds = Math.max(0, Math.floor(start));
  return `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}&t=${timestampSeconds}s`;
}

async function resolveLookups(
  dataDirectory: string,
  normalizedQuery: string,
  mode: SearchMode
): Promise<SearchLookup[]> {
  if (mode === "lemma") {
    return [{ kind: "lemma", key: normalizedQuery }];
  }

  if (mode === "surface") {
    return [{ kind: "surface", key: normalizedQuery }];
  }

  const directLemmaHits = await readLemmaHits(dataDirectory, normalizedQuery);
  if (directLemmaHits.length > 0) {
    return [{ kind: "lemma", key: normalizedQuery }];
  }

  const surfaceToLemmas = await readSurfaceToLemmas(dataDirectory);
  const lemmas = surfaceToLemmas[normalizedQuery] ?? [];
  if (lemmas.length > 0) {
    return lemmas.map((lemma) => ({ kind: "lemma", key: lemma }));
  }

  return [{ kind: "surface", key: normalizedQuery }];
}

async function readLemmaHits(dataDirectory: string, lemma: string): Promise<number[]> {
  const bucket = await readBucket(
    resolve(dataDirectory, "index", "lemma-buckets", `${getIndexBucketName(lemma)}.json`),
    LemmaBucketSchema.parse
  );
  return bucket[lemma] ?? [];
}

async function readSurfaceHits(dataDirectory: string, surface: string): Promise<number[]> {
  const bucket = await readBucket(
    resolve(dataDirectory, "index", "surface-buckets", `${getIndexBucketName(surface)}.json`),
    SurfaceBucketSchema.parse
  );
  return bucket[surface] ?? [];
}

async function readSurfaceToLemmas(dataDirectory: string): Promise<SurfaceToLemmas> {
  return SurfaceToLemmasSchema.parse(
    await readJson(resolve(dataDirectory, "index", "surface-to-lemmas.json"))
  );
}

async function readBucket<TBucket extends LemmaBucket | SurfaceBucket>(
  path: string,
  parse: (value: unknown) => TBucket
): Promise<TBucket> {
  return parse(await readJson(path));
}

async function hydrateSegmentIds(dataDirectory: string, segmentIds: number[]): Promise<SearchHit[]> {
  const episodeCache = new Map<number, Promise<EpisodeSegments>>();

  return Promise.all(
    segmentIds.map(async (segmentId) => {
      const { episode, localIndex } = parseSegmentId(segmentId);
      const episodeSegments = await readEpisodeSegments(dataDirectory, episode, episodeCache);
      const segment = episodeSegments.segments[localIndex];

      if (!segment || segment.id !== segmentId) {
        throw new Error(
          `Index referenced missing segment ${segmentId} in ${makeEpisodeKey(episode)}.json`
        );
      }

      return {
        segmentId,
        episode,
        localIndex,
        title: episodeSegments.title,
        youtubeId: segment.youtubeId,
        start: segment.start,
        end: segment.end,
        text: segment.text,
        timestamp: formatTimestamp(segment.start),
        youtubeTimestampUrl: makeYoutubeTimestampUrl(segment.youtubeId, segment.start),
        segment
      };
    })
  );
}

async function readEpisodeSegments(
  dataDirectory: string,
  episode: number,
  cache: Map<number, Promise<EpisodeSegments>>
): Promise<EpisodeSegments> {
  const cached = cache.get(episode);
  if (cached) {
    return cached;
  }

  const promise = readJson(
    resolve(dataDirectory, "segments", `${makeEpisodeKey(episode)}.json`)
  ).then((value) => EpisodeSegmentsSchema.parse(value));
  cache.set(episode, promise);
  return promise;
}

function dedupeAndSort(segmentIds: number[]): number[] {
  return Array.from(new Set(segmentIds)).sort((left, right) => left - right);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}
