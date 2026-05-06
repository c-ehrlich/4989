import { describe, expect, it, vi } from "vitest";

import { createCorpusHydrator, formatTimestamp, makeYoutubeTimestampUrl } from "../src/corpus/hydrate";
import type { CorpusClient, EpisodeSegments, Episodes } from "../src/corpus/client";

type HydrationClient = Pick<CorpusClient, "loadEpisodes" | "loadEpisodeSegments">;

function createHydrationClient(overrides: Partial<HydrationClient>): HydrationClient {
  return {
    loadEpisodes: vi.fn(async () => []),
    loadEpisodeSegments: vi.fn(async () => makeEpisodeSegments(367)),
    ...overrides
  };
}

describe("corpus hydration", () => {
  it("hydrates segment IDs with segment and episode metadata", async () => {
    const episodes: Episodes = [
      {
        episode: 367,
        title: "ep.367/sample",
        youtubeId: "youtube0367",
        videoUrl: "https://www.youtube.com/watch?v=youtube0367",
        scriptUrl: "https://www.4989americanlife.com/post/ep-367"
      }
    ];
    const episodeSegments = makeEpisodeSegments(367);
    const client = createHydrationClient({
      loadEpisodes: vi.fn(async () => episodes),
      loadEpisodeSegments: vi.fn(async () => episodeSegments)
    });

    const result = await createCorpusHydrator(client).hydrateSegmentIds({
      segmentIds: [36700001, 36700000]
    });

    expect(result.map((hit) => hit.segmentId)).toEqual([36700001, 36700000]);
    expect(result[0]).toMatchObject({
      segmentId: 36700001,
      episode: 367,
      localIndex: 1,
      title: "ep.367/sample",
      youtubeId: "youtube0367",
      videoUrl: "https://www.youtube.com/watch?v=youtube0367",
      scriptUrl: "https://www.4989americanlife.com/post/ep-367",
      start: 72.2,
      end: 75.9,
      timestamp: "1:12",
      endTimestamp: "1:15",
      youtubeTimestampUrl: "https://www.youtube.com/watch?v=youtube0367&t=71s",
      confidence: 0.75,
      timingSource: "youtube-caption-lattice",
      text: "今日はパンを食べる。"
    });
    expect(client.loadEpisodeSegments).toHaveBeenCalledTimes(1);
    expect(client.loadEpisodeSegments).toHaveBeenCalledWith(367);
  });

  it("fetches each referenced episode file only once", async () => {
    const client = createHydrationClient({
      loadEpisodeSegments: vi.fn(async (episode) => makeEpisodeSegments(episode))
    });

    const result = await createCorpusHydrator(client).hydrateSegmentIds({
      segmentIds: [36700000, 36700001, 36800000]
    });

    expect(result.map((hit) => hit.episode)).toEqual([367, 367, 368]);
    expect(client.loadEpisodeSegments).toHaveBeenCalledTimes(2);
    expect(client.loadEpisodeSegments).toHaveBeenCalledWith(367);
    expect(client.loadEpisodeSegments).toHaveBeenCalledWith(368);
  });

  it("throws when an index references a missing segment", async () => {
    const client = createHydrationClient({
      loadEpisodeSegments: vi.fn(async () => ({
        ...makeEpisodeSegments(367),
        segments: []
      }))
    });

    await expect(
      createCorpusHydrator(client).hydrateSegmentIds({ segmentIds: [36700000] })
    ).rejects.toThrow("Index referenced missing segment 36700000 in ep367.json");
  });

  it("formats timestamps and YouTube timestamp URLs", () => {
    expect(formatTimestamp(49.36)).toBe("0:49");
    expect(formatTimestamp(3723.9)).toBe("1:02:03");
    expect(makeYoutubeTimestampUrl("abc 123", 49.36)).toBe(
      "https://www.youtube.com/watch?v=abc%20123&t=48s"
    );
    expect(makeYoutubeTimestampUrl("abc 123", 1.5)).toBe(
      "https://www.youtube.com/watch?v=abc%20123&t=0s"
    );
  });
});

function makeEpisodeSegments(episode: number): EpisodeSegments {
  return {
    episode,
    youtubeId: `youtube${episode.toString().padStart(4, "0")}`,
    title: `ep.${episode}/sample`,
    segments: [
      {
        id: episode * 100000,
        segmentKey: `ep${episode}-s00000`,
        episode,
        localIndex: 0,
        youtubeId: `youtube${episode.toString().padStart(4, "0")}`,
        start: 49.36,
        end: 52.1,
        text: "昨日カレーを食べた。",
        confidence: 1,
        timingSource: "youtube-caption-lattice",
        tokens: []
      },
      {
        id: episode * 100000 + 1,
        segmentKey: `ep${episode}-s00001`,
        episode,
        localIndex: 1,
        youtubeId: `youtube${episode.toString().padStart(4, "0")}`,
        start: 72.2,
        end: 75.9,
        text: "今日はパンを食べる。",
        confidence: 0.75,
        timingSource: "youtube-caption-lattice",
        tokens: []
      }
    ]
  };
}
