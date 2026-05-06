import { corpusClient, type CorpusClient, type SurfaceToLemmas } from "./client";

export type SearchMode = "exact" | "loose";

export type SearchCorpusInput = {
  query: string;
  mode: SearchMode;
  limit?: number;
  cursor?: number;
};

export type SearchCorpusResult = {
  query: string;
  mode: SearchMode;
  segmentIds: number[];
  allSegmentIds: number[];
  total: number;
  limit: number;
  cursor: number;
  nextCursor: number | null;
  matchedTerms: string[];
};

type CorpusSearchClient = Pick<
  CorpusClient,
  "loadLemmaBucketForKey" | "loadSurfaceBucketForKey" | "loadSurfaceToLemmas"
>;

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export type CorpusSearcher = ReturnType<typeof createCorpusSearcher>;

export function createCorpusSearcher(client: CorpusSearchClient = corpusClient) {
  let surfaceToLemmasPromise: ReturnType<CorpusSearchClient["loadSurfaceToLemmas"]> | null = null;

  return {
    searchCorpus: async (input: SearchCorpusInput): Promise<SearchCorpusResult> => {
      const query = normalizeSearchQuery(input.query);
      const limit = normalizeLimit(input.limit);
      const cursor = normalizeCursor(input.cursor);

      if (!query) {
        return emptySearchResult({ query, mode: input.mode, limit, cursor });
      }

      const allSegmentIds =
        input.mode === "exact"
          ? await searchExact(client, query)
          : await searchLoose(client, query, async () => {
              surfaceToLemmasPromise ??= client.loadSurfaceToLemmas();
              return surfaceToLemmasPromise;
            });

      return paginateResult({
        query,
        mode: input.mode,
        limit,
        cursor,
        allSegmentIds: allSegmentIds.segmentIds,
        matchedTerms: allSegmentIds.matchedTerms
      });
    }
  };
}

const defaultCorpusSearcher = createCorpusSearcher();

export function searchCorpus(input: SearchCorpusInput): Promise<SearchCorpusResult> {
  return defaultCorpusSearcher.searchCorpus(input);
}

async function searchExact(
  client: CorpusSearchClient,
  query: string
): Promise<Pick<SearchCorpusResult, "matchedTerms" | "segmentIds">> {
  const { bucket } = await client.loadSurfaceBucketForKey(query);
  const segmentIds = dedupeAndSortSegmentIds(bucket[query] ?? []);

  return {
    matchedTerms: segmentIds.length > 0 ? [query] : [],
    segmentIds
  };
}

async function searchLoose(
  client: CorpusSearchClient,
  query: string,
  loadSurfaceToLemmas: () => ReturnType<CorpusSearchClient["loadSurfaceToLemmas"]>
): Promise<Pick<SearchCorpusResult, "matchedTerms" | "segmentIds">> {
  const surfaceToLemmas = await loadSurfaceToLemmas();
  const lemmas = uniqueTerms([query, ...resolveLooseLemmas(query, surfaceToLemmas)]);
  const buckets = await Promise.all(
    lemmas.map(async (lemma) => ({
      lemma,
      bucket: (await client.loadLemmaBucketForKey(lemma)).bucket
    }))
  );

  const segmentIds = dedupeAndSortSegmentIds(
    buckets.flatMap(({ bucket, lemma }) => bucket[lemma] ?? [])
  );

  return {
    matchedTerms: buckets
      .filter(({ bucket, lemma }) => (bucket[lemma]?.length ?? 0) > 0)
      .map(({ lemma }) => lemma),
    segmentIds
  };
}

function resolveLooseLemmas(query: string, surfaceToLemmas: SurfaceToLemmas) {
  const exactSurfaceLemmas = surfaceToLemmas[query] ?? [];
  if (exactSurfaceLemmas.length > 0) {
    return exactSurfaceLemmas;
  }

  return inferStemSurfaceLemmas(query, surfaceToLemmas);
}

function inferStemSurfaceLemmas(query: string, surfaceToLemmas: SurfaceToLemmas) {
  const candidates = Object.keys(surfaceToLemmas)
    .map((surface) => ({
      surface,
      start: query.indexOf(surface)
    }))
    .filter(
      ({ surface, start }) =>
        start >= 0 &&
        surface !== query &&
        (surface.length >= 2 || containsKanji(surface))
    );

  if (candidates.length === 0) {
    return [];
  }

  const firstStart = Math.min(...candidates.map(({ start }) => start));
  const firstCandidates = candidates.filter(({ start }) => start === firstStart);
  const longestLength = Math.max(...firstCandidates.map(({ surface }) => surface.length));

  return uniqueTerms(
    firstCandidates
      .filter(({ surface }) => surface.length === longestLength)
      .flatMap(({ surface }) => surfaceToLemmas[surface] ?? [])
  );
}

function paginateResult({
  query,
  mode,
  limit,
  cursor,
  allSegmentIds,
  matchedTerms
}: {
  query: string;
  mode: SearchMode;
  limit: number;
  cursor: number;
  allSegmentIds: number[];
  matchedTerms: string[];
}): SearchCorpusResult {
  const total = allSegmentIds.length;
  const segmentIds = allSegmentIds.slice(cursor, cursor + limit);
  const nextCursor = cursor + limit < total ? cursor + limit : null;

  return {
    query,
    mode,
    segmentIds,
    allSegmentIds,
    total,
    limit,
    cursor,
    nextCursor,
    matchedTerms
  };
}

function emptySearchResult({
  query,
  mode,
  limit,
  cursor
}: {
  query: string;
  mode: SearchMode;
  limit: number;
  cursor: number;
}): SearchCorpusResult {
  return {
    query,
    mode,
    segmentIds: [],
    allSegmentIds: [],
    total: 0,
    limit,
    cursor,
    nextCursor: null,
    matchedTerms: []
  };
}

function normalizeSearchQuery(query: string) {
  return query.trim();
}

function normalizeLimit(limit = DEFAULT_LIMIT) {
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

function normalizeCursor(cursor = 0) {
  if (!Number.isFinite(cursor)) {
    return 0;
  }

  return Math.max(0, Math.trunc(cursor));
}

function uniqueTerms(terms: string[]) {
  return Array.from(new Set(terms.filter((term) => term.length > 0)));
}

function dedupeAndSortSegmentIds(segmentIds: number[]) {
  return Array.from(new Set(segmentIds)).sort((left, right) => left - right);
}

function containsKanji(value: string) {
  return /\p{Script=Han}/u.test(value);
}
