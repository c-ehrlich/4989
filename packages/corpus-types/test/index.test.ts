import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  AlignmentSchema,
  BuildReportSchema,
  CorpusSegmentSchema,
  CorpusTokenSchema,
  EpisodeSegmentsSchema,
  EpisodeSchema,
  EpisodesSchema,
  LemmaBucketSchema,
  ManifestEntrySchema,
  ManifestSchema,
  SurfaceBucketSchema,
  SurfaceToLemmasSchema,
  VideoSchema,
  VideosSchema,
  makeEpisodeKey,
  makeSegmentId,
  makeSegmentKey,
  parseSegmentId
} from "../src/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readFixture(path: string): Promise<unknown> {
  const fixturePath = resolve(packageRoot, "fixtures", path);
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

describe("corpus schemas", () => {
  it("validates the sample corpus contract", async () => {
    const sample = (await readFixture("valid-sample.json")) as {
      manifest: unknown;
      videos: unknown[];
      episodes: unknown[];
      alignment: { segments: unknown[] };
      episodeSegments: unknown;
      lemmaBucket: unknown;
      surfaceBucket: unknown;
      surfaceToLemmas: unknown;
      buildReport: unknown;
    };

    expect(ManifestSchema.safeParse(sample.manifest).success).toBe(true);
    expect(sample.videos.every((video) => VideoSchema.safeParse(video).success)).toBe(true);
    expect(VideosSchema.safeParse(sample.videos).success).toBe(true);
    expect(sample.episodes.every((episode) => EpisodeSchema.safeParse(episode).success)).toBe(true);
    expect(EpisodesSchema.safeParse(sample.episodes).success).toBe(true);
    expect(AlignmentSchema.safeParse(sample.alignment).success).toBe(true);
    expect(
      sample.alignment.segments.every((segment) => CorpusSegmentSchema.safeParse(segment).success)
    ).toBe(true);
    expect(EpisodeSegmentsSchema.safeParse(sample.episodeSegments).success).toBe(true);
    expect(LemmaBucketSchema.safeParse(sample.lemmaBucket).success).toBe(true);
    expect(SurfaceBucketSchema.safeParse(sample.surfaceBucket).success).toBe(true);
    expect(SurfaceToLemmasSchema.safeParse(sample.surfaceToLemmas).success).toBe(true);
    expect(BuildReportSchema.safeParse(sample.buildReport).success).toBe(true);
  });

  it("rejects malformed fixtures", async () => {
    await expectInvalid("invalid/manifest-processed-without-youtube-id.json", ManifestEntrySchema);
    await expectInvalid(
      "invalid/manifest-processed-without-alignment-path.json",
      ManifestEntrySchema
    );
    await expectInvalid("invalid/segment-invalid-id.json", CorpusSegmentSchema);
    await expectInvalid("invalid/segment-missing-episode.json", CorpusSegmentSchema);
    await expectInvalid("invalid/token-missing-lemma.json", CorpusTokenSchema);
  });

  it("round-trips stable segment IDs", () => {
    expect(makeSegmentId(367, 42)).toBe(36700042);
    expect(parseSegmentId(36700042)).toEqual({ episode: 367, localIndex: 42 });
    expect(makeSegmentKey(367, 42)).toBe("ep367-s00042");
    expect(makeEpisodeKey(367)).toBe("ep367");
  });

  it("rejects out-of-range segment helper input", () => {
    expect(() => makeSegmentId(367, 100000)).toThrow(RangeError);
    expect(() => makeSegmentId(0, 42)).toThrow(RangeError);
    expect(() => parseSegmentId(42)).toThrow(RangeError);
  });

  it("rejects index buckets with non-generated segment IDs", () => {
    expect(LemmaBucketSchema.safeParse({ 今日: [42] }).success).toBe(false);
    expect(SurfaceBucketSchema.safeParse({ 今日: [42] }).success).toBe(false);
  });

  it("rejects contradictory alignment summaries and duplicate segment identities", async () => {
    const sample = (await readFixture("valid-sample.json")) as {
      alignment: {
        summary: {
          segmentCount: number;
          matchedCount: number;
          lowConfidenceCount: number;
        };
        segments: unknown[];
      };
    };

    const contradictorySummary = cloneJson(sample.alignment);
    contradictorySummary.summary.matchedCount = 0;
    expect(AlignmentSchema.safeParse(contradictorySummary).success).toBe(false);

    const impossibleLowConfidenceCount = cloneJson(sample.alignment);
    impossibleLowConfidenceCount.summary.lowConfidenceCount = 2;
    expect(AlignmentSchema.safeParse(impossibleLowConfidenceCount).success).toBe(false);

    const duplicateSegment = cloneJson(sample.alignment);
    duplicateSegment.segments.push(cloneJson(duplicateSegment.segments[0]));
    duplicateSegment.summary.segmentCount = 2;
    duplicateSegment.summary.matchedCount = 2;
    expect(AlignmentSchema.safeParse(duplicateSegment).success).toBe(false);
  });

  it("rejects processed manifest entries without source URLs", async () => {
    const sample = (await readFixture("valid-sample.json")) as {
      manifest: { episodes: [Record<string, unknown>] };
    };

    const withoutVideoUrl = cloneJson(sample.manifest.episodes[0]);
    delete withoutVideoUrl.videoUrl;
    expect(ManifestEntrySchema.safeParse(withoutVideoUrl).success).toBe(false);

    const withoutScriptUrl = cloneJson(sample.manifest.episodes[0]);
    delete withoutScriptUrl.scriptUrl;
    expect(ManifestEntrySchema.safeParse(withoutScriptUrl).success).toBe(false);
  });
});

async function expectInvalid(
  fixturePath: string,
  schema: { safeParse: (value: unknown) => { success: boolean } }
): Promise<void> {
  const parsed = schema.safeParse(await readFixture(fixturePath));
  expect(parsed.success).toBe(false);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
