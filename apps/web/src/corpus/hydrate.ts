import { parseSegmentId, type CorpusSegment, type Episode } from "@4989/corpus-types";

import { corpusClient, type CorpusClient } from "./client";

export type HydrateSegmentIdsInput = {
  segmentIds: number[];
};

export type HydratedSegment = {
  segmentId: number;
  episode: number;
  localIndex: number;
  title: string;
  episodeTitle: string;
  youtubeId: string;
  videoUrl?: string;
  scriptUrl?: string;
  start: number;
  end: number;
  timestamp: string;
  endTimestamp: string;
  youtubeTimestampUrl: string;
  confidence?: number;
  timingSource?: string;
  text: string;
  segment: CorpusSegment;
  episodeMetadata?: Episode;
};

type CorpusHydrationClient = Pick<CorpusClient, "loadEpisodes" | "loadEpisodeSegments">;

export type CorpusHydrator = ReturnType<typeof createCorpusHydrator>;

export function createCorpusHydrator(client: CorpusHydrationClient = corpusClient) {
  let episodesPromise: ReturnType<CorpusHydrationClient["loadEpisodes"]> | null = null;
  const episodeSegmentsCache = new Map<
    number,
    ReturnType<CorpusHydrationClient["loadEpisodeSegments"]>
  >();

  return {
    hydrateSegmentIds: async (input: HydrateSegmentIdsInput): Promise<HydratedSegment[]> => {
      if (input.segmentIds.length === 0) {
        return [];
      }

      episodesPromise ??= client.loadEpisodes();
      const episodes = await episodesPromise;
      const episodeMetadataByNumber = new Map(
        episodes.map((episodeMetadata) => [episodeMetadata.episode, episodeMetadata])
      );
      const segmentReferences = input.segmentIds.map((segmentId) => ({
        segmentId,
        ...parseSegmentId(segmentId)
      }));
      const episodeSegmentsByNumber = await loadEpisodeSegmentsByNumber(
        client,
        episodeSegmentsCache,
        segmentReferences.map(({ episode }) => episode)
      );

      return segmentReferences.map(({ segmentId, episode, localIndex }) => {
        const episodeSegments = episodeSegmentsByNumber.get(episode);
        const segment = episodeSegments?.segments[localIndex];

        if (!episodeSegments || !segment || segment.id !== segmentId) {
          throw new Error(`Index referenced missing segment ${segmentId} in ep${episode}.json`);
        }

        const episodeMetadata = episodeMetadataByNumber.get(episode);
        const title = episodeMetadata?.title ?? episodeSegments.title;
        const youtubeId = segment.youtubeId || episodeMetadata?.youtubeId || episodeSegments.youtubeId;

        return {
          segmentId,
          episode,
          localIndex,
          title,
          episodeTitle: title,
          youtubeId,
          videoUrl: episodeMetadata?.videoUrl,
          scriptUrl: episodeMetadata?.scriptUrl,
          start: segment.start,
          end: segment.end,
          timestamp: formatTimestamp(segment.start),
          endTimestamp: formatTimestamp(segment.end),
          youtubeTimestampUrl: makeYoutubeTimestampUrl(youtubeId, segment.start),
          confidence: segment.confidence,
          timingSource: segment.timingSource,
          text: segment.text,
          segment,
          episodeMetadata
        };
      });
    }
  };
}

const defaultCorpusHydrator = createCorpusHydrator();

export function hydrateSegmentIds(input: HydrateSegmentIdsInput): Promise<HydratedSegment[]> {
  return defaultCorpusHydrator.hydrateSegmentIds(input);
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

async function loadEpisodeSegmentsByNumber(
  client: CorpusHydrationClient,
  cache: Map<number, ReturnType<CorpusHydrationClient["loadEpisodeSegments"]>>,
  episodes: number[]
) {
  const uniqueEpisodes = Array.from(new Set(episodes));
  await Promise.all(
    uniqueEpisodes.map(async (episode) => {
      if (!cache.has(episode)) {
        cache.set(episode, client.loadEpisodeSegments(episode));
      }

      await cache.get(episode);
    })
  );

  return new Map(
    await Promise.all(
      uniqueEpisodes.map(async (episode) => [episode, await cache.get(episode)] as const)
    )
  );
}
