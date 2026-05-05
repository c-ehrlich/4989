import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  makeSegmentId,
  makeSegmentKey,
  type Alignment,
  type CorpusSegment
} from "@4989/corpus-types";
import { afterEach, describe, expect, it } from "vitest";

import { AlignmentValidationError, validateAlignmentFile } from "./validateAlignment.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("validateAlignmentFile", () => {
  it("validates schema, timestamps, duration, and review report consistency", async () => {
    const dataDirectory = await makeTempDataDirectory();
    const alignment = makeAlignment();

    await writeJson(join(dataDirectory, "videos.json"), [
      {
        youtubeId: "youtube0001",
        title: "ep.1/sample",
        url: "https://www.youtube.com/watch?v=youtube0001",
        episode: 1,
        durationSeconds: 30
      }
    ]);
    await writeJson(join(dataDirectory, "alignments", "ep1.json"), alignment);
    await writeJson(join(dataDirectory, "reports", "ep1.json"), {
      generatedAt: alignment.source.generatedAt,
      episode: alignment.episode,
      youtubeId: alignment.youtubeId,
      alignmentPath: "data/alignments/ep1.json",
      summary: alignment.summary,
      lowConfidenceSegments: [toReviewSegment(alignment.segments[1] as CorpusSegment)],
      inferredSegments: [toReviewSegment(alignment.segments[1] as CorpusSegment)],
      unmatchedIssues: []
    });

    const result = await validateAlignmentFile({
      dataDirectory,
      alignmentPath: join(dataDirectory, "alignments", "ep1.json")
    });

    expect(result.alignment.summary.segmentCount).toBe(2);
    expect(result.durationSeconds).toBe(30);
    expect(result.firstSegment?.segmentKey).toBe("ep1-s00000");
    expect(result.lastSegment?.segmentKey).toBe("ep1-s00001");
    expect(result.lowConfidenceReviewCount).toBe(1);
    expect(result.inferredReviewCount).toBe(1);
    expect(result.warnings).toEqual([]);
  });

  it("rejects overlapping timestamps that would make playback boundaries ambiguous", async () => {
    const dataDirectory = await makeTempDataDirectory();
    const alignment = makeAlignment({
      segments: [makeSegment(0, 1, 5), makeSegment(1, 4.5, 7)]
    });

    await writeJson(join(dataDirectory, "alignments", "ep1.json"), alignment);
    await writeJson(join(dataDirectory, "reports", "ep1.json"), {
      episode: alignment.episode,
      youtubeId: alignment.youtubeId,
      summary: alignment.summary,
      lowConfidenceSegments: [],
      inferredSegments: []
    });

    await expect(
      validateAlignmentFile({
        dataDirectory,
        alignmentPath: join(dataDirectory, "alignments", "ep1.json")
      })
    ).rejects.toThrow(AlignmentValidationError);
  });

  it("requires the generated review report by default", async () => {
    const dataDirectory = await makeTempDataDirectory();
    await writeJson(join(dataDirectory, "alignments", "ep1.json"), makeAlignment());

    await expect(
      validateAlignmentFile({
        dataDirectory,
        alignmentPath: join(dataDirectory, "alignments", "ep1.json")
      })
    ).rejects.toThrow(/Review report is missing/);
  });

  it("rejects summary metrics that do not match the emitted segments", async () => {
    const dataDirectory = await makeTempDataDirectory();
    const alignment = makeAlignment();
    await writeJson(join(dataDirectory, "alignments", "ep1.json"), {
      ...alignment,
      summary: {
        ...alignment.summary,
        lowConfidenceCount: 0
      }
    });
    await writeJson(join(dataDirectory, "reports", "ep1.json"), {
      episode: alignment.episode,
      youtubeId: alignment.youtubeId,
      summary: {
        ...alignment.summary,
        lowConfidenceCount: 0
      },
      lowConfidenceSegments: [],
      inferredSegments: [toReviewSegment(alignment.segments[1] as CorpusSegment)]
    });

    await expect(
      validateAlignmentFile({
        dataDirectory,
        alignmentPath: join(dataDirectory, "alignments", "ep1.json")
      })
    ).rejects.toThrow(/derived low-confidence count 1/);
  });

  it("rejects missing or malformed review segment arrays", async () => {
    const dataDirectory = await makeTempDataDirectory();
    const alignment = makeAlignment();
    await writeJson(join(dataDirectory, "alignments", "ep1.json"), alignment);
    await writeJson(join(dataDirectory, "reports", "ep1.json"), {
      episode: alignment.episode,
      youtubeId: alignment.youtubeId,
      summary: alignment.summary,
      lowConfidenceSegments: "not-an-array"
    });

    await expect(
      validateAlignmentFile({
        dataDirectory,
        alignmentPath: join(dataDirectory, "alignments", "ep1.json")
      })
    ).rejects.toThrow(/lowConfidenceSegments must be an array/);
  });
});

async function makeTempDataDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "4989-alignment-"));
  tempDirectories.push(directory);
  await Promise.all([
    mkdir(join(directory, "alignments"), { recursive: true }),
    mkdir(join(directory, "reports"), { recursive: true })
  ]);
  return directory;
}

function makeAlignment(input?: { segments?: CorpusSegment[] }): Alignment {
  const segments = input?.segments ?? [
    makeSegment(0, 1, 3, {
      confidence: 0.95
    }),
    makeSegment(1, 3.2, 5, {
      confidence: 0.25,
      timingSource: "interpolated-between-caption-matches"
    })
  ];

  return {
    episode: 1,
    youtubeId: "youtube0001",
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
      averageConfidence: 0.6,
      lowConfidenceCount: segments.filter((segment) => (segment.confidence ?? 1) < 0.68).length
    },
    segments
  };
}

function makeSegment(
  localIndex: number,
  start: number,
  end: number,
  input?: Pick<CorpusSegment, "confidence" | "timingSource">
): CorpusSegment {
  return {
    id: makeSegmentId(1, localIndex),
    segmentKey: makeSegmentKey(1, localIndex),
    episode: 1,
    localIndex,
    youtubeId: "youtube0001",
    start,
    end,
    text: `本文${localIndex}です。`,
    confidence: input?.confidence ?? 0.9,
    timingSource: input?.timingSource ?? "youtube-caption-lattice",
    tokens: [
      {
        surface: "本文",
        lemma: "本文",
        pos: ["名詞"],
        reading: "ホンブン"
      }
    ]
  };
}

function toReviewSegment(segment: CorpusSegment): unknown {
  return {
    id: segment.id,
    segmentKey: segment.segmentKey,
    localIndex: segment.localIndex,
    start: segment.start,
    end: segment.end,
    confidence: segment.confidence,
    timingSource: segment.timingSource,
    text: segment.text
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
