import { corpusClient, type CorpusClient } from "./client";

const SAMPLE_EPISODE = 178;
const SAMPLE_LEMMA = "食べる";
const SAMPLE_SURFACE = "食べ";

export type CorpusStaticStatus = {
  episodeCount: number;
  minEpisodeNumber: number;
  maxEpisodeNumber: number;
  sampleEpisodeNumber: number;
  sampleEpisodeTitle: string;
  sampleSegmentCount: number;
  sampleFirstSegmentKey: string;
  sampleFirstSegmentText: string;
  sampleLemma: string;
  sampleLemmaBucketName: string;
  sampleLemmaHitCount: number;
  sampleSurface: string;
  sampleSurfaceLemmaCount: number;
};

export async function loadCorpusStaticStatus(
  client: CorpusClient = corpusClient
): Promise<CorpusStaticStatus> {
  const [episodes, episodeSegments, lemmaBucketResult, surfaceToLemmas] = await Promise.all([
    client.loadEpisodes(),
    client.loadEpisodeSegments(SAMPLE_EPISODE),
    client.loadLemmaBucketForKey(SAMPLE_LEMMA),
    client.loadSurfaceToLemmas()
  ]);

  const sampleEpisode = episodes.find((episode) => episode.episode === SAMPLE_EPISODE);
  const firstSegment = episodeSegments.segments[0];
  const episodeNumbers = episodes.map((episode) => episode.episode);

  if (!sampleEpisode) {
    throw new Error(`Missing sample episode ${SAMPLE_EPISODE}`);
  }

  if (episodeNumbers.length === 0) {
    throw new Error("Corpus episode metadata is empty");
  }

  if (!firstSegment) {
    throw new Error(`Missing sample segments for episode ${SAMPLE_EPISODE}`);
  }

  return {
    episodeCount: episodes.length,
    minEpisodeNumber: Math.min(...episodeNumbers),
    maxEpisodeNumber: Math.max(...episodeNumbers),
    sampleEpisodeNumber: sampleEpisode.episode,
    sampleEpisodeTitle: sampleEpisode.title ?? `ep${SAMPLE_EPISODE}`,
    sampleSegmentCount: episodeSegments.segments.length,
    sampleFirstSegmentKey: firstSegment.segmentKey,
    sampleFirstSegmentText: firstSegment.text,
    sampleLemma: SAMPLE_LEMMA,
    sampleLemmaBucketName: lemmaBucketResult.bucketName,
    sampleLemmaHitCount: lemmaBucketResult.bucket[SAMPLE_LEMMA]?.length ?? 0,
    sampleSurface: SAMPLE_SURFACE,
    sampleSurfaceLemmaCount: surfaceToLemmas[SAMPLE_SURFACE]?.length ?? 0
  };
}
