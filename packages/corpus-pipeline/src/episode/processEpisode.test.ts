import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeSegmentId, makeSegmentKey, type Alignment } from "@4989/corpus-types";
import { afterEach, describe, expect, it } from "vitest";

import { processEpisode } from "./processEpisode.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("processEpisode", () => {
  it("repairs missing generated reports on an unchanged alignment cache hit", async () => {
    const root = await makeTempDirectory();
    const dataDirectory = join(root, "data");
    const workDirectory = join(root, "work");
    const scriptPath = join(root, "ep1.txt");
    const scriptText = "本文です。\n";
    const captionText = "{}\n";
    const videoMetadataText = "{\"id\":\"youtube0001\"}\n";
    const alignment = makeCachedAlignment({
      scriptHash: sha256(scriptText),
      captionHash: sha256(captionText),
      videoMetadataHash: sha256(videoMetadataText)
    });

    await Promise.all([
      mkdir(join(dataDirectory, "alignments"), { recursive: true }),
      mkdir(join(workDirectory, "captions"), { recursive: true }),
      mkdir(join(workDirectory, "youtube"), { recursive: true })
    ]);
    await writeFile(scriptPath, scriptText, "utf8");
    await writeFile(join(workDirectory, "captions", "ep1.ja-orig.json3"), captionText, "utf8");
    await writeFile(join(workDirectory, "youtube", "ep1.info.json"), videoMetadataText, "utf8");
    await writeJson(join(dataDirectory, "manifest.json"), {
      generatedAt: "2026-05-05T00:00:00.000Z",
      episodes: [
        {
          episode: 1,
          youtubeId: "youtube0001",
          videoUrl: "https://www.youtube.com/watch?v=youtube0001",
          scriptUrl: "https://example.com/post/ep1",
          hasScript: true,
          hasCaption: true,
          status: "processed",
          alignmentPath: "data/alignments/ep1.json"
        }
      ]
    });
    await writeJson(join(dataDirectory, "videos.json"), [
      {
        youtubeId: "youtube0001",
        title: "ep.1/sample",
        url: "https://www.youtube.com/watch?v=youtube0001",
        episode: 1,
        durationSeconds: 30
      }
    ]);
    await writeJson(join(dataDirectory, "scripts.json"), [
      {
        episode: 1,
        title: "ep.1/sample",
        url: "https://example.com/post/ep1",
        text: scriptText.trimEnd(),
        htmlPath: join(root, "ep1.html"),
        textPath: scriptPath
      }
    ]);
    await writeJson(join(dataDirectory, "alignments", "ep1.json"), alignment);

    const result = await processEpisode({
      episode: 1,
      dataDirectory,
      workDirectory
    });

    expect(result.skipped).toBe(true);
    const report = JSON.parse(await readFile(join(dataDirectory, "reports", "ep1.json"), "utf8"));
    expect(report.summary).toEqual(alignment.summary);
    expect(report.lowConfidenceSegments).toHaveLength(1);
    const buildReport = JSON.parse(await readFile(join(dataDirectory, "build-report.json"), "utf8"));
    expect(buildReport.ep1).toMatchObject({
      status: "low-confidence",
      segments: 2,
      lowConfidenceCount: 1,
      reportPath: "data/reports/ep1.json"
    });
  });
});

async function makeTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "4989-process-episode-"));
  tempDirectories.push(directory);
  return directory;
}

function makeCachedAlignment(input: {
  scriptHash: string;
  captionHash: string;
  videoMetadataHash: string;
}): Alignment {
  return {
    episode: 1,
    youtubeId: "youtube0001",
    source: {
      captionTrack: "ja-orig",
      alignmentMethod: "youtube-caption-lattice",
      scriptHash: input.scriptHash,
      captionHash: input.captionHash,
      videoMetadataHash: input.videoMetadataHash,
      pipelineVersion: 9,
      generatedAt: "2026-05-05T00:00:00.000Z"
    },
    summary: {
      scriptUnitCount: 2,
      segmentCount: 2,
      matchedCount: 2,
      unmatchedCount: 0,
      inferredCount: 1,
      averageConfidence: 0.6,
      lowConfidenceCount: 1
    },
    segments: [
      {
        id: makeSegmentId(1, 0),
        segmentKey: makeSegmentKey(1, 0),
        episode: 1,
        localIndex: 0,
        youtubeId: "youtube0001",
        start: 1,
        end: 3,
        text: "本文0です。",
        confidence: 0.95,
        timingSource: "youtube-caption-lattice",
        tokens: [{ surface: "本文", lemma: "本文", pos: ["名詞"], reading: "ホンブン" }]
      },
      {
        id: makeSegmentId(1, 1),
        segmentKey: makeSegmentKey(1, 1),
        episode: 1,
        localIndex: 1,
        youtubeId: "youtube0001",
        start: 3.2,
        end: 5,
        text: "本文1です。",
        confidence: 0.25,
        timingSource: "interpolated-between-caption-matches",
        tokens: [{ surface: "本文", lemma: "本文", pos: ["名詞"], reading: "ホンブン" }]
      }
    ]
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
