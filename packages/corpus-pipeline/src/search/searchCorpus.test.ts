import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  makeSegmentId,
  makeSegmentKey,
  type Alignment,
  type CorpusSegment
} from "@4989/corpus-types";
import { afterEach, describe, expect, it } from "vitest";

import { buildStaticIndex } from "../index/buildStaticIndex.js";
import { formatTimestamp, searchCorpus } from "./searchCorpus.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("searchCorpus", () => {
  it("searches lemma buckets and hydrates results from segment files", async () => {
    const dataDirectory = await makeIndexedCorpus();

    const result = await searchCorpus({
      dataDirectory,
      query: "食べる",
      mode: "lemma",
      limit: 10
    });

    expect(result.searched).toEqual([{ kind: "lemma", key: "食べる" }]);
    expect(result.totalSegmentIds).toBe(2);
    expect(result.hits.map((hit) => hit.text)).toEqual([
      "昨日カレーを食べた。",
      "今日はパンを食べる。"
    ]);
    expect(result.hits[0]).toMatchObject({
      segmentId: 36700000,
      episode: 367,
      localIndex: 0,
      title: "ep.367/sample",
      timestamp: "0:49",
      youtubeTimestampUrl: "https://www.youtube.com/watch?v=youtube0367&t=49s"
    });
  });

  it("uses surface-to-lemmas in auto mode for observed conjugated forms", async () => {
    const dataDirectory = await makeIndexedCorpus();

    const result = await searchCorpus({
      dataDirectory,
      query: "食べ",
      limit: 10
    });

    expect(result.searched).toEqual([{ kind: "lemma", key: "食べる" }]);
    expect(result.hits.map((hit) => hit.text)).toEqual([
      "昨日カレーを食べた。",
      "今日はパンを食べる。"
    ]);
  });

  it("supports exact surface lookup and result limits", async () => {
    const dataDirectory = await makeIndexedCorpus();

    const result = await searchCorpus({
      dataDirectory,
      query: "食べ",
      mode: "surface",
      limit: 1
    });

    expect(result.searched).toEqual([{ kind: "surface", key: "食べ" }]);
    expect(result.totalSegmentIds).toBe(1);
    expect(result.hits.map((hit) => hit.text)).toEqual(["昨日カレーを食べた。"]);
  });

  it("falls back to surface lookup for unknown auto queries without throwing", async () => {
    const dataDirectory = await makeIndexedCorpus();

    const result = await searchCorpus({
      dataDirectory,
      query: "存在しない語",
      limit: 5
    });

    expect(result.searched).toEqual([{ kind: "surface", key: "存在しない語" }]);
    expect(result.totalSegmentIds).toBe(0);
    expect(result.hits).toEqual([]);
  });

  it("formats timestamps compactly", () => {
    expect(formatTimestamp(49.36)).toBe("0:49");
    expect(formatTimestamp(3723.9)).toBe("1:02:03");
  });
});

async function makeIndexedCorpus(): Promise<string> {
  const dataDirectory = await mkdtemp(join(tmpdir(), "4989-search-"));
  tempDirectories.push(dataDirectory);

  await Promise.all([
    mkdir(join(dataDirectory, "alignments"), { recursive: true }),
    mkdir(join(dataDirectory, "segments"), { recursive: true }),
    mkdir(join(dataDirectory, "index", "lemma-buckets"), { recursive: true })
  ]);

  await writeJson(join(dataDirectory, "videos.json"), [
    {
      youtubeId: "youtube0367",
      title: "ep.367/sample",
      url: "https://www.youtube.com/watch?v=youtube0367",
      episode: 367,
      durationSeconds: 120
    }
  ]);
  await writeJson(
    join(dataDirectory, "alignments", "ep367.json"),
    makeAlignment(367, "youtube0367", [
      makeSegment(367, "youtube0367", 0, 49.36, "昨日カレーを食べた。", [
        token("昨日", "昨日", ["名詞"]),
        token("食べ", "食べる", ["動詞"])
      ]),
      makeSegment(367, "youtube0367", 1, 52.1, "今日はパンを食べる。", [
        token("今日", "今日", ["名詞"]),
        token("食べる", "食べる", ["動詞"])
      ]),
      makeSegment(367, "youtube0367", 2, 55.8, "散歩に行く。", [
        token("行く", "行く", ["動詞"])
      ])
    ])
  );

  await buildStaticIndex({ dataDirectory });
  return dataDirectory;
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
      inferredCount: 0,
      averageConfidence: 0.95,
      lowConfidenceCount: 0
    },
    segments
  };
}

function makeSegment(
  episode: number,
  youtubeId: string,
  localIndex: number,
  start: number,
  text: string,
  tokens: CorpusSegment["tokens"]
): CorpusSegment {
  return {
    id: makeSegmentId(episode, localIndex),
    segmentKey: makeSegmentKey(episode, localIndex),
    episode,
    localIndex,
    youtubeId,
    start,
    end: start + 1,
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

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
