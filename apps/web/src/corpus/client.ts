import {
  EpisodeSegmentsSchema,
  EpisodesSchema,
  LemmaBucketSchema,
  SurfaceBucketSchema,
  SurfaceToLemmasSchema,
  type EpisodeSegments,
  type Episodes,
  type LemmaBucket,
  type SurfaceBucket,
  type SurfaceToLemmas
} from "@4989/corpus-types";

import {
  episodeSegmentsPath,
  episodesPath,
  getIndexBucketName,
  lemmaBucketPath,
  surfaceBucketPath,
  surfaceToLemmasPath,
  type IndexBucketName
} from "./paths";

export type CorpusClientOptions = {
  basePath?: string;
  fetcher?: typeof fetch;
};

export type CorpusClient = ReturnType<typeof createCorpusClient>;

type Parser<T> = {
  parse(value: unknown): T;
};

export function createCorpusClient(options: CorpusClientOptions = {}) {
  const basePath = options.basePath;
  const fetcher = options.fetcher ?? fetch;

  return {
    loadEpisodes: () => loadJson(episodesPath(basePath), EpisodesSchema, fetcher),
    loadEpisodeSegments: (episode: number) =>
      loadJson(episodeSegmentsPath(episode, basePath), EpisodeSegmentsSchema, fetcher),
    loadLemmaBucket: (bucketName: IndexBucketName) =>
      loadJson(lemmaBucketPath(bucketName, basePath), LemmaBucketSchema, fetcher),
    loadLemmaBucketForKey: async (lemma: string) => {
      const bucketName = await getIndexBucketName(lemma);
      return {
        bucketName,
        bucket: await loadJson(lemmaBucketPath(bucketName, basePath), LemmaBucketSchema, fetcher)
      };
    },
    loadSurfaceBucket: (bucketName: IndexBucketName) =>
      loadJson(surfaceBucketPath(bucketName, basePath), SurfaceBucketSchema, fetcher),
    loadSurfaceBucketForKey: async (surface: string) => {
      const bucketName = await getIndexBucketName(surface);
      return {
        bucketName,
        bucket: await loadJson(surfaceBucketPath(bucketName, basePath), SurfaceBucketSchema, fetcher)
      };
    },
    loadSurfaceToLemmas: () =>
      loadJson(surfaceToLemmasPath(basePath), SurfaceToLemmasSchema, fetcher)
  };
}

export const corpusClient = createCorpusClient();

async function loadJson<T>(path: string, parser: Parser<T>, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(path);
  if (!response.ok) {
    throw new Error(`Failed to load corpus JSON ${path}: ${response.status} ${response.statusText}`);
  }

  return parser.parse((await response.json()) as unknown);
}

export type {
  EpisodeSegments,
  Episodes,
  LemmaBucket,
  SurfaceBucket,
  SurfaceToLemmas
};
