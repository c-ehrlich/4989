import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildManifest } from "./buildManifest.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("buildManifest", () => {
  it("combines videos, scripts, overrides, and validated alignments", async () => {
    const dataDirectory = await makeTempDataDirectory();

    await writeJson(join(dataDirectory, "videos.json"), [
      {
        youtubeId: "episode0001",
        title: "ep.1/one",
        url: "https://www.youtube.com/watch?v=episode0001",
        episode: 1
      },
      {
        youtubeId: "episode0002",
        title: "ep.2/two",
        url: "https://www.youtube.com/watch?v=episode0002",
        episode: 2
      },
      {
        youtubeId: "episode0134",
        title: "ep.134/newer duplicate",
        url: "https://www.youtube.com/watch?v=episode0134",
        episode: 134
      },
      {
        youtubeId: "episode0279",
        title: "ep.279/title corrected",
        url: "https://www.youtube.com/watch?v=episode0279",
        episode: 279
      },
      {
        youtubeId: "episode0004",
        title: "ep.4/ambiguous scripts",
        url: "https://www.youtube.com/watch?v=episode0004",
        episode: 4
      },
      {
        youtubeId: "episode0005",
        title: "ep.5/stale alignment video",
        url: "https://www.youtube.com/watch?v=episode0005",
        episode: 5
      },
      {
        youtubeId: "episode0006",
        title: "ep.6/misfiled alignment episode",
        url: "https://www.youtube.com/watch?v=episode0006",
        episode: 6
      }
    ]);

    await writeJson(join(dataDirectory, "scripts.json"), [
      makeScript(1, "https://example.com/post/ep-1", "2026-01-01T00:00:00.000Z"),
      makeScript(3, "https://example.com/post/ep-3", "2026-01-03T00:00:00.000Z"),
      makeScript(4, "https://example.com/post/ep-4-old", "2020-01-01T00:00:00.000Z"),
      makeScript(4, "https://example.com/post/ep-4-new", "2025-01-01T00:00:00.000Z"),
      makeScript(5, "https://example.com/post/ep-5", "2026-01-05T00:00:00.000Z"),
      makeScript(6, "https://example.com/post/ep-6", "2026-01-06T00:00:00.000Z"),
      makeScript(134, "https://example.com/post/ep-134-old", "2020-01-01T00:00:00.000Z"),
      makeScript(134, "https://example.com/post/ep-134-new", "2025-01-01T00:00:00.000Z"),
      makeScript(278, "https://example.com/post/ep-278-title-is-279", "2026-01-04T00:00:00.000Z")
    ]);

    await mkdir(join(dataDirectory, "alignments"), { recursive: true });
    await writeJson(join(dataDirectory, "alignments", "ep1.json"), makeAlignment(1, "episode0001"));
    await writeJson(join(dataDirectory, "alignments", "ep5.json"), makeAlignment(5, "stale000001"));
    await writeJson(join(dataDirectory, "alignments", "ep6.json"), makeAlignment(999, "episode0006"));

    const result = await buildManifest({
      dataDirectory,
      generatedAt: "2026-05-05T00:00:00.000Z",
      sourceOverrides: {
        youtubeEpisodeOverrides: {},
        scriptEpisodeOverrides: {
          "https://example.com/post/ep-278-title-is-279": 279
        },
        preferredScriptUrlsByEpisode: {
          134: "https://example.com/post/ep-134-new"
        },
        preferredAsrEpisodes: []
      }
    });

    expect(result.manifest.episodes).toEqual([
      {
        episode: 1,
        youtubeId: "episode0001",
        videoUrl: "https://www.youtube.com/watch?v=episode0001",
        scriptUrl: "https://example.com/post/ep-1",
        hasScript: true,
        hasCaption: true,
        status: "processed",
        alignmentPath: "data/alignments/ep1.json"
      },
      {
        episode: 2,
        youtubeId: "episode0002",
        videoUrl: "https://www.youtube.com/watch?v=episode0002",
        hasScript: false,
        hasCaption: false,
        status: "missing-script"
      },
      {
        episode: 3,
        scriptUrl: "https://example.com/post/ep-3",
        hasScript: true,
        hasCaption: false,
        status: "missing-video"
      },
      {
        episode: 4,
        youtubeId: "episode0004",
        videoUrl: "https://www.youtube.com/watch?v=episode0004",
        scriptUrl: "https://example.com/post/ep-4-new",
        hasScript: true,
        hasCaption: false,
        status: "ambiguous",
        notes:
          "multiple scripts found without preference; selected newest only for reference https://example.com/post/ep-4-new"
      },
      {
        episode: 5,
        youtubeId: "episode0005",
        videoUrl: "https://www.youtube.com/watch?v=episode0005",
        scriptUrl: "https://example.com/post/ep-5",
        hasScript: true,
        hasCaption: false,
        status: "failed",
        notes:
          "invalid alignment at data/alignments/ep5.json: alignment YouTube ID stale000001 does not match selected video episode0005"
      },
      {
        episode: 6,
        youtubeId: "episode0006",
        videoUrl: "https://www.youtube.com/watch?v=episode0006",
        scriptUrl: "https://example.com/post/ep-6",
        hasScript: true,
        hasCaption: false,
        status: "failed",
        notes:
          "invalid alignment at data/alignments/ep6.json: alignment episode 999 does not match manifest episode 6"
      },
      {
        episode: 134,
        youtubeId: "episode0134",
        videoUrl: "https://www.youtube.com/watch?v=episode0134",
        scriptUrl: "https://example.com/post/ep-134-new",
        hasScript: true,
        hasCaption: false,
        status: "discovered",
        notes: "multiple scripts found; selected preferred https://example.com/post/ep-134-new"
      },
      {
        episode: 279,
        youtubeId: "episode0279",
        videoUrl: "https://www.youtube.com/watch?v=episode0279",
        scriptUrl: "https://example.com/post/ep-278-title-is-279",
        hasScript: true,
        hasCaption: false,
        status: "discovered",
        notes: "script episode corrected from 278 to 279"
      }
    ]);
  });
});

async function makeTempDataDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "4989-manifest-"));
  tempDirectories.push(directory);
  return directory;
}

function makeScript(episode: number, url: string, publishedAt: string): unknown {
  return {
    episode,
    title: `ep.${episode}/sample`,
    url,
    publishedAt,
    text: "本文です。",
    htmlPath: `.work/4989/scripts/ep${episode}.html`,
    textPath: `.work/4989/scripts/ep${episode}.txt`
  };
}

function makeAlignment(episode: number, youtubeId: string): unknown {
  return {
    episode,
    youtubeId,
    source: {
      captionTrack: "ja-orig",
      alignmentMethod: "youtube-caption-lattice",
      scriptHash: `sha256:${"a".repeat(64)}`,
      captionHash: `sha256:${"b".repeat(64)}`,
      videoMetadataHash: `sha256:${"c".repeat(64)}`,
      pipelineVersion: 1,
      generatedAt: "2026-05-05T00:00:00.000Z"
    },
    summary: {
      segmentCount: 0,
      matchedCount: 0,
      unmatchedCount: 0,
      lowConfidenceCount: 0
    },
    segments: []
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
