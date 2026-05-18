import { describe, expect, it, vi } from "vitest";

import { createCorpusSearcher } from "../src/corpus/search";
import type { CorpusClient } from "../src/corpus/client";

type SearchClient = Pick<
  CorpusClient,
  "loadLemmaBucketForKey" | "loadSurfaceBucketForKey" | "loadSurfaceToLemmas"
>;

function createSearchClient(overrides: Partial<SearchClient>): SearchClient {
  return {
    loadLemmaBucketForKey: vi.fn(async () => ({ bucketName: "00", bucket: {} })),
    loadSurfaceBucketForKey: vi.fn(async () => ({ bucketName: "00", bucket: {} })),
    loadSurfaceToLemmas: vi.fn(async () => ({})),
    ...overrides
  };
}

describe("corpus search", () => {
  it("uses exact surface matching for exact mode", async () => {
    const client = createSearchClient({
      loadSurfaceBucketForKey: vi.fn(async () => ({
        bucketName: "aa",
        bucket: {
          "食べる": [17800001, 17800002],
          "食べた": [17800003]
        }
      }))
    });

    const result = await createCorpusSearcher(client).searchCorpus({
      query: "食べる",
      mode: "exact"
    });

    expect(result.segmentIds).toEqual([17800001, 17800002]);
    expect(result.total).toBe(2);
    expect(result.matchedTerms).toEqual(["食べる"]);
    expect(client.loadSurfaceBucketForKey).toHaveBeenCalledWith("食べる");
    expect(client.loadLemmaBucketForKey).not.toHaveBeenCalled();
  });

  it("expands observed surfaces through lemmas for loose mode", async () => {
    const client = createSearchClient({
      loadSurfaceToLemmas: vi.fn(async () => ({
        "食べた": ["食べる"]
      })),
      loadLemmaBucketForKey: vi.fn(async () => ({
        bucketName: "2b",
        bucket: {
          "食べる": [17800001, 17800003]
        }
      }))
    });

    const result = await createCorpusSearcher(client).searchCorpus({
      query: "食べた",
      mode: "loose"
    });

    expect(result.segmentIds).toEqual([17800001, 17800003]);
    expect(result.matchedTerms).toEqual(["食べる"]);
    expect(client.loadLemmaBucketForKey).toHaveBeenCalledWith("食べた");
    expect(client.loadLemmaBucketForKey).toHaveBeenCalledWith("食べる");
    expect(client.loadSurfaceBucketForKey).not.toHaveBeenCalled();
  });

  it("infers a leading indexed stem when the full loose query is not an indexed surface", async () => {
    const client = createSearchClient({
      loadSurfaceToLemmas: vi.fn(async () => ({
        "食べ": ["食べる"],
        "た": ["た", "たい"]
      })),
      loadLemmaBucketForKey: vi.fn(async (lemma) => {
        const bucket: Record<string, number[]> =
          lemma === "食べる" ? { "食べる": [17800001, 17800003] } : {};

        return {
          bucketName: "2b",
          bucket
        };
      })
    });

    const result = await createCorpusSearcher(client).searchCorpus({
      query: "食べた",
      mode: "loose"
    });

    expect(result.segmentIds).toEqual([17800001, 17800003]);
    expect(result.matchedTerms).toEqual(["食べる"]);
    expect(client.loadLemmaBucketForKey).toHaveBeenCalledWith("食べた");
    expect(client.loadLemmaBucketForKey).toHaveBeenCalledWith("食べる");
    expect(client.loadLemmaBucketForKey).not.toHaveBeenCalledWith("た");
  });

  it("does not infer a one-kanji noun as a stem inside an unknown compound", async () => {
    const client = createSearchClient({
      loadSurfaceToLemmas: vi.fn(async () => ({
        "指": ["指"]
      })),
      loadLemmaBucketForKey: vi.fn(async (lemma) => {
        const bucket: Record<string, number[]> = lemma === "指" ? { "指": [14400166] } : {};

        return {
          bucketName: "0c",
          bucket
        };
      })
    });

    const result = await createCorpusSearcher(client).searchCorpus({
      query: "指図",
      mode: "loose"
    });

    expect(result.segmentIds).toEqual([]);
    expect(result.matchedTerms).toEqual([]);
    expect(client.loadLemmaBucketForKey).toHaveBeenCalledWith("指図");
    expect(client.loadLemmaBucketForKey).not.toHaveBeenCalledWith("指");
  });

  it("deinflects godan compound verbs before falling back to shorter stems", async () => {
    const client = createSearchClient({
      loadSurfaceToLemmas: vi.fn(async () => ({
        "飲み": ["飲み", "飲む"]
      })),
      loadLemmaBucketForKey: vi.fn(async (lemma) => {
        const bucket: Record<string, number[]> =
          lemma === "飲み込む" ? { "飲み込む": [14600123, 24400199] } : {};

        return {
          bucketName: "e9",
          bucket
        };
      })
    });

    const result = await createCorpusSearcher(client).searchCorpus({
      query: "飲み込んだ",
      mode: "loose"
    });

    expect(result.segmentIds).toEqual([14600123, 24400199]);
    expect(result.matchedTerms).toEqual(["飲み込む"]);
    expect(client.loadLemmaBucketForKey).toHaveBeenCalledWith("飲み込んだ");
    expect(client.loadLemmaBucketForKey).toHaveBeenCalledWith("飲み込む");
    expect(client.loadLemmaBucketForKey).not.toHaveBeenCalledWith("飲む");
  });

  it("deinflects chained colloquial verb endings", async () => {
    const client = createSearchClient({
      loadSurfaceToLemmas: vi.fn(async () => ({
        "飲み": ["飲み", "飲む"]
      })),
      loadLemmaBucketForKey: vi.fn(async (lemma) => {
        const bucket: Record<string, number[]> =
          lemma === "飲み込む" ? { "飲み込む": [14600123, 24400199] } : {};

        return {
          bucketName: "e9",
          bucket
        };
      })
    });

    const result = await createCorpusSearcher(client).searchCorpus({
      query: "飲み込んじゃった",
      mode: "loose"
    });

    expect(result.segmentIds).toEqual([14600123, 24400199]);
    expect(result.matchedTerms).toEqual(["飲み込む"]);
    expect(client.loadLemmaBucketForKey).toHaveBeenCalledWith("飲み込む");
    expect(client.loadLemmaBucketForKey).not.toHaveBeenCalledWith("飲む");
  });

  it("treats base lemmas as loose queries even without surface expansion", async () => {
    const client = createSearchClient({
      loadLemmaBucketForKey: vi.fn(async () => ({
        bucketName: "2b",
        bucket: {
          "食べる": [17800001, 17800003]
        }
      }))
    });

    const result = await createCorpusSearcher(client).searchCorpus({
      query: "食べる",
      mode: "loose"
    });

    expect(result.segmentIds).toEqual([17800001, 17800003]);
    expect(result.matchedTerms).toEqual(["食べる"]);
  });

  it("dedupes, sorts, and paginates loose results", async () => {
    const client = createSearchClient({
      loadSurfaceToLemmas: vi.fn(async () => ({
        "食べ": ["食べる", "食う"]
      })),
      loadLemmaBucketForKey: vi.fn(async (lemma) => {
        const bucket: Record<string, number[]> =
          lemma === "食べる"
            ? { "食べる": [17800003, 17800001, 17800001] }
            : { "食う": [17800002, 17800001] };

        return {
          bucketName: "2b",
          bucket
        };
      })
    });

    const result = await createCorpusSearcher(client).searchCorpus({
      query: " 食べ ",
      mode: "loose",
      limit: 2,
      cursor: 1
    });

    expect(result.query).toBe("食べ");
    expect(result.segmentIds).toEqual([17800002, 17800003]);
    expect(result.allSegmentIds).toEqual([17800001, 17800002, 17800003]);
    expect(result.total).toBe(3);
    expect(result.cursor).toBe(1);
    expect(result.nextCursor).toBeNull();
    expect(result.matchedTerms).toEqual(["食べる", "食う"]);
  });

  it("does not fetch indexes for empty queries", async () => {
    const client = createSearchClient({});

    const result = await createCorpusSearcher(client).searchCorpus({
      query: "   ",
      mode: "exact"
    });

    expect(result.segmentIds).toEqual([]);
    expect(result.total).toBe(0);
    expect(client.loadSurfaceBucketForKey).not.toHaveBeenCalled();
    expect(client.loadLemmaBucketForKey).not.toHaveBeenCalled();
    expect(client.loadSurfaceToLemmas).not.toHaveBeenCalled();
  });
});
