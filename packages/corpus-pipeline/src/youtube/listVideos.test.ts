import { describe, expect, it } from "vitest";

import {
  buildVideoEnumerationReport,
  normalizePlaylist
} from "./listVideos.js";
import { parseEpisodeNumberFromTitle } from "./parseEpisode.js";

describe("parseEpisodeNumberFromTitle", () => {
  it("parses common 4989 episode title formats", () => {
    expect(parseEpisodeNumberFromTitle("ep.367/アメリカの道路が凸凹すぎる件")).toBe(367);
    expect(parseEpisodeNumberFromTitle("https://example.com/post/ep-343--title")).toBe(343);
    expect(parseEpisodeNumberFromTitle("4989 American Life EP 12 topic")).toBe(12);
    expect(parseEpisodeNumberFromTitle("第89回 アメリカ生活")).toBe(89);
  });

  it("does not treat unrelated numbers as episodes", () => {
    expect(parseEpisodeNumberFromTitle("4989 American Life trailer")).toBeUndefined();
    expect(parseEpisodeNumberFromTitle("2024年の振り返り")).toBeUndefined();
  });
});

describe("normalizePlaylist", () => {
  it("normalizes yt-dlp flat playlist entries into stable video records", () => {
    const videos = normalizePlaylist({
      entries: [
        {
          id: "recent00001",
          title: "ep.367/Recent",
          webpage_url: "https://www.youtube.com/watch?v=recent00001",
          timestamp: 1_714_000_000,
          duration: 1200
        },
        {
          id: "intro000001",
          title: "Channel intro",
          url: "intro000001",
          upload_date: "20200102"
        },
        {
          id: "older000001",
          title: "ep.1/Old",
          url: "older000001",
          upload_date: "20150102",
          duration: 900
        }
      ]
    });

    expect(videos).toEqual([
      {
        youtubeId: "older000001",
        title: "ep.1/Old",
        url: "https://www.youtube.com/watch?v=older000001",
        episode: 1,
        publishedAt: "2015-01-02T00:00:00.000Z",
        durationSeconds: 900
      },
      {
        youtubeId: "recent00001",
        title: "ep.367/Recent",
        url: "https://www.youtube.com/watch?v=recent00001",
        episode: 367,
        publishedAt: "2024-04-24T23:06:40.000Z",
        durationSeconds: 1200
      },
      {
        youtubeId: "intro000001",
        title: "Channel intro",
        url: "https://www.youtube.com/watch?v=intro000001",
        publishedAt: "2020-01-02T00:00:00.000Z"
      }
    ]);
  });

  it("applies explicit YouTube episode overrides before sorting and reporting", () => {
    const videos = normalizePlaylist(
      {
        entries: [
          {
            id: "HHjZfpG1qao",
            title: "[ポッドキャスト] ep.078/ アメリカの生理用品",
            url: "HHjZfpG1qao"
          },
          {
            id: "zR3K3XDo6xU",
            title: "[ポッドキャスト] ep.078/ 今年2度目の車購入話…。",
            url: "zR3K3XDo6xU"
          }
        ]
      },
      { episodeOverrides: { HHjZfpG1qao: 79 } }
    );

    expect(videos.map((video) => ({ youtubeId: video.youtubeId, episode: video.episode }))).toEqual(
      [
        { youtubeId: "zR3K3XDo6xU", episode: 78 },
        { youtubeId: "HHjZfpG1qao", episode: 79 }
      ]
    );
  });

  it("skips entries without valid YouTube IDs", () => {
    const videos = normalizePlaylist({
      entries: [
        {
          id: "not-a-youtube-id",
          title: "ep.1/Invalid",
          url: "not-a-youtube-id"
        },
        {
          title: "ep.2/Invalid URL",
          url: "https://www.youtube.com/channel/not-a-video"
        },
        {
          id: "valid000001",
          title: "ep.3/Valid",
          url: "valid000001"
        }
      ]
    });

    expect(videos).toEqual([
      {
        youtubeId: "valid000001",
        title: "ep.3/Valid",
        url: "https://www.youtube.com/watch?v=valid000001",
        episode: 3
      }
    ]);
  });
});

describe("buildVideoEnumerationReport", () => {
  it("reports unparsed videos, duplicates, ranges, and missing episodes", () => {
    const videos = normalizePlaylist({
      entries: [
        { id: "episode0001", title: "ep.1/one", url: "episode0001" },
        { id: "episode0003", title: "ep.3/three", url: "episode0003" },
        { id: "episode003b", title: "ep.3/three duplicate", url: "episode003b" },
        { id: "notepisode1", title: "Announcement", url: "notepisode1" }
      ]
    });

    const report = buildVideoEnumerationReport({
      channelUrl: "https://example.com/channel/videos",
      generatedAt: "2026-05-05T00:00:00.000Z",
      videos,
      ytDlpVersion: "2026.03.17"
    });

    expect(report.totalVideos).toBe(4);
    expect(report.parsedPodcastVideos).toBe(3);
    expect(report.episodeRange).toEqual({ min: 1, max: 3 });
    expect(report.missingEpisodesInRange).toEqual([2]);
    expect(report.unparsedVideos).toHaveLength(1);
    expect(report.duplicateEpisodes).toEqual([
      {
        episode: 3,
        videos: [
          {
            youtubeId: "episode0003",
            title: "ep.3/three",
            url: "https://www.youtube.com/watch?v=episode0003"
          },
          {
            youtubeId: "episode003b",
            title: "ep.3/three duplicate",
            url: "https://www.youtube.com/watch?v=episode003b"
          }
        ]
      }
    ]);
  });

  it("reports applied episode overrides and removes corrected duplicates", () => {
    const videos = normalizePlaylist(
      {
        entries: [
          {
            id: "HHjZfpG1qao",
            title: "[ポッドキャスト] ep.078/ アメリカの生理用品",
            url: "HHjZfpG1qao"
          },
          {
            id: "zR3K3XDo6xU",
            title: "[ポッドキャスト] ep.078/ 今年2度目の車購入話…。",
            url: "zR3K3XDo6xU"
          }
        ]
      },
      { episodeOverrides: { HHjZfpG1qao: 79 } }
    );

    const report = buildVideoEnumerationReport({
      channelUrl: "https://example.com/channel/videos",
      generatedAt: "2026-05-05T00:00:00.000Z",
      videos,
      episodeOverrides: { HHjZfpG1qao: 79 }
    });

    expect(report.duplicateEpisodes).toEqual([]);
    expect(report.missingEpisodesInRange).toEqual([]);
    expect(report.appliedEpisodeOverrides).toEqual([
      {
        youtubeId: "HHjZfpG1qao",
        title: "[ポッドキャスト] ep.078/ アメリカの生理用品",
        url: "https://www.youtube.com/watch?v=HHjZfpG1qao",
        parsedEpisode: 78,
        episode: 79,
        reason: "youtube-title-numbering-conflicts-with-video-description"
      }
    ]);
    expect(report.staleEpisodeOverrides).toEqual([]);
  });

  it("reports stale episode overrides that do not match enumerated videos", () => {
    const videos = normalizePlaylist({
      entries: [{ id: "episode0001", title: "ep.1/one", url: "episode0001" }]
    });

    const report = buildVideoEnumerationReport({
      channelUrl: "https://example.com/channel/videos",
      generatedAt: "2026-05-05T00:00:00.000Z",
      videos,
      episodeOverrides: { missing0001: 79 }
    });

    expect(report.appliedEpisodeOverrides).toEqual([]);
    expect(report.staleEpisodeOverrides).toEqual([
      {
        youtubeId: "missing0001",
        episode: 79,
        reason: "video-not-found-in-enumeration"
      }
    ]);
  });
});
