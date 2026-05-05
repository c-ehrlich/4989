import { describe, expect, it } from "vitest";

import { alignCaptionLattice } from "./alignCaptionLattice.js";
import { parseJson3Captions } from "./parseJson3Captions.js";
import { splitScriptSentences } from "./splitScriptSentences.js";

describe("splitScriptSentences", () => {
  it("splits spoken script text and skips structural headings", () => {
    const units = splitScriptSentences(`★答えて！うたこさん
------------
4月ももう終わりますね。はや。
皆さまいかがお過ごしでしょうか。`);

    expect(units.map((unit) => unit.text)).toEqual([
      "4月ももう終わりますね。はや。",
      "皆さまいかがお過ごしでしょうか。"
    ]);
  });
});

describe("alignCaptionLattice", () => {
  it("aligns official script text to noisy caption timing", () => {
    const lattice = parseJson3Captions({
      events: [
        {
          tStartMs: 49360,
          dDurationMs: 5880,
          segs: [
            { utf8: "4月ももう", tOffsetMs: 0 },
            { utf8: "終わりますね。早。皆様いかが", tOffsetMs: 1200 }
          ]
        },
        {
          tStartMs: 55240,
          dDurationMs: 2840,
          segs: [{ utf8: "お過ごしでしょうか?日本の皆さんはもう" }]
        }
      ]
    });
    const scriptUnits = splitScriptSentences(
      "4月ももう終わりますね。はや。\n皆さまいかがお過ごしでしょうか。"
    );

    const result = alignCaptionLattice({
      episode: 367,
      youtubeId: "nNRz_Jh_wZI",
      scriptUnits,
      lattice
    });

    expect(result.issues).toEqual([]);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({
      id: 36700000,
      segmentKey: "ep367-s00000",
      start: 49.36,
      text: "4月ももう終わりますね。はや。"
    });
    expect(result.segments[1]?.start).toBeGreaterThanOrEqual(result.segments[0]?.end ?? 0);
  });

  it("interpolates unmatched script units bounded by direct caption matches", () => {
    const lattice = parseJson3Captions({
      events: [
        {
          tStartMs: 1000,
          dDurationMs: 1200,
          segs: [{ utf8: "今日はとても晴れていて散歩日和ですね。" }]
        },
        {
          tStartMs: 6200,
          dDurationMs: 1300,
          segs: [{ utf8: "明日は強い雨が降るかもしれません。" }]
        }
      ]
    });
    const scriptUnits = splitScriptSentences(
      "今日はとても晴れていて散歩日和ですね。\nここだけ字幕にはない短い話をします。\n明日は強い雨が降るかもしれません。"
    );

    const result = alignCaptionLattice({
      episode: 367,
      youtubeId: "nNRz_Jh_wZI",
      scriptUnits,
      lattice
    });

    expect(result.issues).toEqual([]);
    expect(result.segments).toHaveLength(3);
    expect(result.segments[1]).toMatchObject({
      text: "ここだけ字幕にはない短い話をします。",
      confidence: 0.25,
      timingSource: "interpolated-between-caption-matches"
    });
    expect(result.segments[1]?.start).toBeGreaterThanOrEqual(result.segments[0]?.end ?? 0);
    expect(result.segments[1]?.end).toBeLessThanOrEqual(result.segments[2]?.start ?? 0);
  });

  it("can align against a reading lattice when surface text differs", () => {
    const scriptUnits = splitScriptSentences("聞かれたときは、答えに困ります。").map((unit) => ({
      ...unit,
      normalizedReadingText: "キカレタトキハコタエニコマリマス"
    }));
    const surfaceLattice = parseJson3Captions({
      events: [
        {
          tStartMs: 1000,
          dDurationMs: 3000,
          segs: [{ utf8: "まったく違う字幕です。" }]
        }
      ]
    });
    const readingLattice = parseJson3Captions({
      events: [
        {
          tStartMs: 5000,
          dDurationMs: 3000,
          segs: [{ utf8: "キカレタトキハコタエニコマリマス" }]
        }
      ]
    });

    const result = alignCaptionLattice({
      episode: 367,
      youtubeId: "nNRz_Jh_wZI",
      scriptUnits,
      lattice: surfaceLattice,
      readingLattice
    });

    expect(result.issues).toEqual([]);
    expect(result.segments[0]).toMatchObject({
      start: 5,
      text: "聞かれたときは、答えに困ります。"
    });
  });
});
