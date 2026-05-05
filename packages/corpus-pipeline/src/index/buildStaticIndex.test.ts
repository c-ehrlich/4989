import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  makeSegmentId,
  makeSegmentKey,
  type Alignment,
  type CorpusSegment
} from "@4989/corpus-types";
import { afterEach, describe, expect, it } from "vitest";

import { buildStaticIndex, getIndexBucketName } from "./buildStaticIndex.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("buildStaticIndex", () => {
  it("builds deployable segment files, lookup indexes, and episode metadata", async () => {
    const dataDirectory = await makeTempDataDirectory();
    const alignment = makeAlignment(1, "youtube0001", [
      makeSegment(1, "youtube0001", 0, "食べた本文です。", [
        token("食べ", "食べる", ["動詞"]),
        token("食べ", "食べる", ["動詞"]),
        token("本文", "本文", ["名詞"]),
        token("。", "。", ["補助記号", "句点"])
      ]),
      makeSegment(1, "youtube0001", 1, "行った本文です。", [
        token("行っ", "行く", ["動詞"]),
        token("本文", "本文", ["名詞"])
      ])
    ]);

    await writeJson(join(dataDirectory, "videos.json"), [
      {
        youtubeId: "youtube0001",
        title: "ep.1/sample",
        url: "https://www.youtube.com/watch?v=youtube0001",
        episode: 1,
        publishedAt: "2026-05-01T00:00:00.000Z",
        durationSeconds: 120
      }
    ]);
    await writeJson(join(dataDirectory, "manifest.json"), {
      generatedAt: "2026-05-05T00:00:00.000Z",
      episodes: [
        {
          episode: 1,
          youtubeId: "youtube0001",
          videoUrl: "https://www.youtube.com/watch?v=youtube0001",
          scriptUrl: "https://example.com/post/ep-1",
          hasScript: true,
          hasCaption: true,
          status: "processed",
          alignmentPath: "data/alignments/ep1.json"
        }
      ]
    });
    await writeJson(join(dataDirectory, "build-report.json"), {
      ep998: {
        status: "low-confidence",
        segments: 10
      },
      ep999: {
        status: "missing-script"
      }
    });
    await writeJson(join(dataDirectory, "segments", "stale.json"), { stale: true });
    await writeJson(join(dataDirectory, "index", "lemma-buckets", "ff.json"), { stale: [99900000] });
    await writeJson(join(dataDirectory, "alignments", "ep1.json"), alignment);

    const result = await buildStaticIndex({ dataDirectory });

    expect(result).toMatchObject({
      alignmentCount: 1,
      episodeCount: 1,
      segmentCount: 2,
      lemmaCount: 3,
      surfaceCount: 3,
      surfaceToLemmaCount: 3
    });

    await expect(readFile(join(dataDirectory, "segments", "stale.json"), "utf8")).rejects.toThrow();

    expect(await readJson(join(dataDirectory, "episodes.json"))).toEqual([
      {
        episode: 1,
        title: "ep.1/sample",
        youtubeId: "youtube0001",
        videoUrl: "https://www.youtube.com/watch?v=youtube0001",
        scriptUrl: "https://example.com/post/ep-1",
        publishedDate: "2026-05-01",
        durationSeconds: 120,
        segmentPath: "data/segments/ep1.json"
      }
    ]);

    expect(await readJson(join(dataDirectory, "segments", "ep1.json"))).toEqual({
      episode: 1,
      youtubeId: "youtube0001",
      title: "ep.1/sample",
      segments: alignment.segments
    });

    const lemmaBucket = await readJson(
      join(dataDirectory, "index", "lemma-buckets", `${getIndexBucketName("食べる")}.json`)
    );
    expect(lemmaBucket).toMatchObject({
      食べる: [100000]
    });
    expect(lemmaBucket).not.toHaveProperty("。");

    const nounLemmaBucket = await readJson(
      join(dataDirectory, "index", "lemma-buckets", `${getIndexBucketName("本文")}.json`)
    );
    expect(nounLemmaBucket).toMatchObject({
      本文: [100000, 100001]
    });

    const surfaceBucket = await readJson(
      join(dataDirectory, "index", "surface-buckets", `${getIndexBucketName("食べ")}.json`)
    );
    expect(surfaceBucket).toMatchObject({
      食べ: [100000]
    });

    expect(await readJson(join(dataDirectory, "index", "surface-to-lemmas.json"))).toEqual({
      行っ: ["行く"],
      食べ: ["食べる"],
      本文: ["本文"]
    });

    expect((await readdir(join(dataDirectory, "index", "lemma-buckets"))).length).toBe(256);
    expect((await readdir(join(dataDirectory, "index", "surface-buckets"))).length).toBe(256);

    expect(await readJson(join(dataDirectory, "build-report.json"))).toEqual({
      ep1: {
        status: "processed",
        segments: 2,
        matchedCount: 2,
        unmatchedCount: 0,
        inferredCount: 0,
        averageConfidence: 0.95,
        lowConfidenceCount: 0
      },
      ep999: {
        status: "missing-script"
      }
    });
  });

  it("falls back to generated episode titles when source metadata is absent", async () => {
    const dataDirectory = await makeTempDataDirectory();
    await writeJson(
      join(dataDirectory, "alignments", "ep2.json"),
      makeAlignment(2, "youtube0002", [makeSegment(2, "youtube0002", 0, "本文です。")])
    );

    await buildStaticIndex({ dataDirectory });

    expect(await readJson(join(dataDirectory, "episodes.json"))).toEqual([
      {
        episode: 2,
        title: "ep.2",
        youtubeId: "youtube0002",
        segmentPath: "data/segments/ep2.json"
      }
    ]);
    expect(await readJson(join(dataDirectory, "segments", "ep2.json"))).toMatchObject({
      title: "ep.2"
    });
  });

  it("sorts segment files by localIndex for segment-id hydration", async () => {
    const dataDirectory = await makeTempDataDirectory();
    const firstSegment = {
      ...makeSegment(3, "youtube0003", 0, "最初です。"),
      start: 2,
      end: 3
    };
    const secondSegment = {
      ...makeSegment(3, "youtube0003", 1, "次です。"),
      start: 0,
      end: 1
    };
    await writeJson(
      join(dataDirectory, "alignments", "ep3.json"),
      makeAlignment(3, "youtube0003", [secondSegment, firstSegment])
    );

    await buildStaticIndex({ dataDirectory });

    expect(await readJson(join(dataDirectory, "segments", "ep3.json"))).toMatchObject({
      segments: [firstSegment, secondSegment]
    });
  });

  it("rejects non-contiguous local indexes", async () => {
    const dataDirectory = await makeTempDataDirectory();
    await writeJson(
      join(dataDirectory, "alignments", "ep4.json"),
      makeAlignment(4, "youtube0004", [makeSegment(4, "youtube0004", 1, "欠番です。")])
    );

    await expect(buildStaticIndex({ dataDirectory })).rejects.toThrow(
      /non-contiguous segment localIndex 1; expected 0/
    );
  });

  it("rejects alignment files whose filename episode does not match the content", async () => {
    const dataDirectory = await makeTempDataDirectory();
    await writeJson(
      join(dataDirectory, "alignments", "ep1.json"),
      makeAlignment(2, "youtube0002", [makeSegment(2, "youtube0002", 0, "不一致です。")])
    );

    await expect(buildStaticIndex({ dataDirectory })).rejects.toThrow(
      /ep1\.json contains episode 2; expected episode 1/
    );
  });

  it("rejects duplicate parsed alignment episodes", async () => {
    const dataDirectory = await makeTempDataDirectory();
    await writeJson(
      join(dataDirectory, "alignments", "ep2.json"),
      makeAlignment(2, "youtube0002", [makeSegment(2, "youtube0002", 0, "重複1です。")])
    );
    await writeJson(
      join(dataDirectory, "alignments", "ep02.json"),
      makeAlignment(2, "youtube0002b", [makeSegment(2, "youtube0002b", 0, "重複2です。")])
    );

    await expect(buildStaticIndex({ dataDirectory })).rejects.toThrow(
      /Duplicate alignment episode 2 in ep02\.json and ep2\.json|Duplicate alignment episode 2 in ep2\.json and ep02\.json/
    );
  });

  it("fails on a missing alignments directory unless empty indexes are explicit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "4989-index-missing-"));
    tempDirectories.push(directory);

    await expect(buildStaticIndex({ dataDirectory: directory })).rejects.toThrow();

    const result = await buildStaticIndex({ dataDirectory: directory, allowEmpty: true });
    expect(result).toMatchObject({
      alignmentCount: 0,
      episodeCount: 0,
      segmentCount: 0
    });
    expect(await readJson(join(directory, "episodes.json"))).toEqual([]);
  });
});

async function makeTempDataDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "4989-index-"));
  tempDirectories.push(directory);
  await Promise.all([
    mkdir(join(directory, "alignments"), { recursive: true }),
    mkdir(join(directory, "segments"), { recursive: true }),
    mkdir(join(directory, "index", "lemma-buckets"), { recursive: true })
  ]);
  return directory;
}

function makeAlignment(episode: number, youtubeId: string, segments: CorpusSegment[]): Alignment {
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
      scriptUnitCount: segments.length,
      segmentCount: segments.length,
      matchedCount: segments.length,
      unmatchedCount: 0,
      inferredCount: segments.filter(
        (segment) => segment.timingSource === "interpolated-between-caption-matches"
      ).length,
      averageConfidence: 0.95,
      lowConfidenceCount: segments.filter((segment) => (segment.confidence ?? 1) < 0.68).length
    },
    segments
  };
}

function makeSegment(
  episode: number,
  youtubeId: string,
  localIndex: number,
  text: string,
  tokens = [token("本文", "本文", ["名詞"])]
): CorpusSegment {
  return {
    id: makeSegmentId(episode, localIndex),
    segmentKey: makeSegmentKey(episode, localIndex),
    episode,
    localIndex,
    youtubeId,
    start: localIndex * 2,
    end: localIndex * 2 + 1,
    text,
    confidence: 0.95,
    timingSource: "youtube-caption-lattice",
    tokens
  };
}

function token(surface: string, lemma: string, pos: string[]): CorpusSegment["tokens"][number] {
  return {
    surface,
    lemma,
    pos
  };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
