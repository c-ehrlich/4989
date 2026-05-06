import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { alignCaptionLattice } from "./alignCaptionLattice.js";
import { parseJson3Captions } from "./parseJson3Captions.js";
import { splitScriptSentences } from "./splitScriptSentences.js";

describe("splitScriptSentences", () => {
  it("splits spoken script text and skips structural headings", () => {
    const units = splitScriptSentences(`★答えて！うたこさん
------------
What I miss about Japan
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

  it("uses bounded low-confidence candidate timing before falling back to interpolation", () => {
    const lattice = parseJson3Captions({
      events: [
        {
          tStartMs: 1000,
          dDurationMs: 1000,
          segs: [{ utf8: "firstanchor" }]
        },
        {
          tStartMs: 4000,
          dDurationMs: 1000,
          segs: [{ utf8: "abc12345def" }]
        },
        {
          tStartMs: 9000,
          dDurationMs: 1000,
          segs: [{ utf8: "lastanchor" }]
        }
      ]
    });

    const result = alignCaptionLattice({
      episode: 367,
      youtubeId: "nNRz_Jh_wZI",
      scriptUnits: [
        {
          index: 0,
          blockIndex: 0,
          text: "First anchor.",
          normalizedText: "firstanchor"
        },
        {
          index: 1,
          blockIndex: 0,
          text: "Middle low-confidence candidate.",
          normalizedText: "abcxyzpqdef"
        },
        {
          index: 2,
          blockIndex: 0,
          text: "Last anchor.",
          normalizedText: "lastanchor"
        }
      ],
      lattice
    });

    expect(result.issues).toEqual([]);
    expect(result.segments[1]).toMatchObject({
      start: 4,
      end: 5,
      text: "Middle low-confidence candidate.",
      timingSource: "youtube-caption-lattice"
    });
    expect(result.segments[1]?.confidence).toBeLessThan(0.58);
  });

  it("uses spoken starts instead of rolling caption visual lifetimes", () => {
    const lattice = parseJson3Captions({
      events: [
        {
          tStartMs: 617509,
          dDurationMs: 6741,
          segs: [
            { utf8: "グラコロ" },
            { utf8: "も", tOffsetMs: 450 },
            { utf8: "さん", tOffsetMs: 661 },
            { utf8: "美味しい", tOffsetMs: 870 },
            { utf8: "です", tOffsetMs: 1320 },
            { utf8: "よ", tOffsetMs: 1560 },
            { utf8: "ね", tOffsetMs: 1680 }
          ]
        },
        {
          tStartMs: 620700,
          dDurationMs: 3550,
          segs: [{ utf8: "\n" }]
        },
        {
          tStartMs: 620710,
          dDurationMs: 7320,
          segs: [
            { utf8: "やっぱり" },
            { utf8: "そう", tOffsetMs: 480 },
            { utf8: "いう", tOffsetMs: 690 },
            { utf8: "季節", tOffsetMs: 1230 },
            { utf8: "の", tOffsetMs: 1890 },
            { utf8: "定番", tOffsetMs: 2100 },
            { utf8: "が", tOffsetMs: 2880 },
            { utf8: "あ", tOffsetMs: 3090 },
            { utf8: "るって", tOffsetMs: 3180 }
          ]
        },
        {
          tStartMs: 624240,
          dDurationMs: 3790,
          segs: [{ utf8: "\n" }]
        },
        {
          tStartMs: 624250,
          dDurationMs: 7350,
          segs: [
            { utf8: "いい" },
            { utf8: "です", tOffsetMs: 420 },
            { utf8: "ね", tOffsetMs: 810 },
            { utf8: "夏", tOffsetMs: 1350 },
            { utf8: "だ", tOffsetMs: 1620 },
            { utf8: "と", tOffsetMs: 1740 },
            { utf8: "ケンタッキー", tOffsetMs: 1980 },
            { utf8: "の", tOffsetMs: 2730 },
            { utf8: "レッド", tOffsetMs: 3150 }
          ]
        },
        {
          tStartMs: 628020,
          dDurationMs: 3580,
          segs: [{ utf8: "\n" }]
        },
        {
          tStartMs: 628030,
          dDurationMs: 5640,
          segs: [
            { utf8: "ホット" },
            { utf8: "チキン", tOffsetMs: 300 },
            { utf8: "と", tOffsetMs: 480 },
            { utf8: "か", tOffsetMs: 690 },
            { utf8: "ね", tOffsetMs: 780 },
            { utf8: "辛い", tOffsetMs: 840 },
            { utf8: "系", tOffsetMs: 1170 },
            { utf8: "が", tOffsetMs: 1350 },
            { utf8: "出", tOffsetMs: 1560 },
            { utf8: "ます", tOffsetMs: 2100 },
            { utf8: "よ", tOffsetMs: 2370 },
            { utf8: "ね", tOffsetMs: 2490 },
            { utf8: "春", tOffsetMs: 3060 }
          ]
        },
        {
          tStartMs: 631590,
          dDurationMs: 2080,
          segs: [{ utf8: "\n" }]
        },
        {
          tStartMs: 631600,
          dDurationMs: 4880,
          segs: [
            { utf8: "は" },
            { utf8: "何", tOffsetMs: 180 },
            { utf8: "か", tOffsetMs: 510 },
            { utf8: "あり", tOffsetMs: 630 },
            { utf8: "まし", tOffsetMs: 780 },
            { utf8: "たっ", tOffsetMs: 960 },
            { utf8: "け", tOffsetMs: 1140 }
          ]
        },
        {
          tStartMs: 633660,
          dDurationMs: 2820,
          segs: [{ utf8: "\n" }]
        },
        {
          tStartMs: 633670,
          dDurationMs: 3850,
          segs: [
            { utf8: "毎年" },
            { utf8: "出る", tOffsetMs: 420 },
            { utf8: "商品", tOffsetMs: 660 }
          ]
        },
        {
          tStartMs: 636470,
          dDurationMs: 1050,
          segs: [{ utf8: "\n" }]
        },
        {
          tStartMs: 636480,
          dDurationMs: 4010,
          segs: [{ utf8: "ちょっと" }]
        },
        {
          tStartMs: 637510,
          dDurationMs: 2980,
          segs: [{ utf8: "\n" }]
        },
        {
          tStartMs: 637520,
          dDurationMs: 5460,
          segs: [
            { utf8: "思いつか" },
            { utf8: "ない", tOffsetMs: 420 },
            { utf8: "です", tOffsetMs: 540 },
            { utf8: "けど", tOffsetMs: 720 }
          ]
        }
      ]
    });
    const scriptUnits = splitScriptSentences(
      [
        "グラコロもさ、美味しいですよね。",
        "やっぱりそういう季節の定番があるっていいですよね。",
        "夏だとケンタッキーのレッドホットチキンとかね、辛い系が出ますよね。春は、何かありましたっけ？毎年出る商品。",
        "ちょっと思いつかないですけど。"
      ].join("\n")
    );

    const result = alignCaptionLattice({
      episode: 178,
      youtubeId: "r6SyISK_0eg",
      scriptUnits,
      lattice
    });

    expect(result.issues).toEqual([]);
    expect(result.segments[1]?.start).toBeCloseTo(620.71, 0);
    expect(result.segments[2]?.start).toBeCloseTo(625.6, 0);
    expect(result.segments[3]?.start).toBeCloseTo(636.48, 0);
  });

  it("anchors low-confidence cues across long bounded interstitial gaps", () => {
    const lattice = parseJson3Captions({
      events: [
        {
          tStartMs: 920519,
          dDurationMs: 4930,
          segs: [
            { utf8: "続け" },
            { utf8: "られる", tOffsetMs: 331 },
            { utf8: "こと", tOffsetMs: 601 },
            { utf8: "を", tOffsetMs: 750 },
            { utf8: "本", tOffsetMs: 991 },
            { utf8: "と", tOffsetMs: 1861 },
            { utf8: "切に", tOffsetMs: 1921 },
            { utf8: "願っ", tOffsetMs: 2371 },
            { utf8: "て", tOffsetMs: 3181 },
            { utf8: "い", tOffsetMs: 3301 },
            { utf8: "ます", tOffsetMs: 3331 }
          ]
        },
        {
          tStartMs: 925449,
          dDurationMs: 4371,
          segs: [{ utf8: "\n" }]
        },
        {
          tStartMs: 933970,
          dDurationMs: 8650,
          segs: [{ utf8: "[音楽]" }]
        },
        {
          tStartMs: 941449,
          dDurationMs: 1881,
          segs: [
            { utf8: "英語" },
            { utf8: "の", tOffsetMs: 240 },
            { utf8: "話", tOffsetMs: 330 }
          ]
        },
        {
          tStartMs: 947600,
          dDurationMs: 8350,
          segs: [
            { utf8: "はい" },
            { utf8: "アメリカ", tOffsetMs: 390 },
            { utf8: "生活", tOffsetMs: 900 },
            { utf8: "と", tOffsetMs: 1289 },
            { utf8: "は", tOffsetMs: 1440 },
            { utf8: "切っ", tOffsetMs: 1500 },
            { utf8: "て", tOffsetMs: 1799 },
            { utf8: "も", tOffsetMs: 1859 },
            { utf8: "切れ", tOffsetMs: 1979 },
            { utf8: "ない", tOffsetMs: 2340 },
            { utf8: "大きな", tOffsetMs: 2400 },
            { utf8: "大きな", tOffsetMs: 3090 },
            { utf8: "大きな", tOffsetMs: 3419 },
            { utf8: "壁", tOffsetMs: 4049 },
            { utf8: "英語", tOffsetMs: 4469 },
            { utf8: "に", tOffsetMs: 4830 },
            { utf8: "つい", tOffsetMs: 4950 },
            { utf8: "て", tOffsetMs: 5130 },
            { utf8: "お", tOffsetMs: 5219 },
            { utf8: "話し", tOffsetMs: 5370 },
            { utf8: "し", tOffsetMs: 5700 },
            { utf8: "て", tOffsetMs: 5849 }
          ]
        },
        {
          tStartMs: 953530,
          dDurationMs: 2420,
          segs: [{ utf8: "\n" }]
        },
        {
          tStartMs: 953540,
          dDurationMs: 7600,
          segs: [
            { utf8: "いる" },
            { utf8: "コーナー", tOffsetMs: 120 },
            { utf8: "です", tOffsetMs: 560 }
          ]
        }
      ]
    });
    const scriptUnits = splitScriptSentences(
      [
        "続けられることを、ほんと切に願っています。",
        "アメリカ生活とは切っても切れない大きな大きな壁、",
        "英語についてお話しているコーナーです。"
      ].join("\n")
    );

    const result = alignCaptionLattice({
      episode: 111,
      youtubeId: "L82HtWIp3Do",
      scriptUnits,
      lattice
    });

    expect(result.issues).toEqual([]);
    expect(result.segments[1]?.start).toBeCloseTo(947.99, 0);
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

describe("reviewed corpus timestamp regressions", () => {
  const corpusDataDirectory = resolve(process.cwd(), "../corpus-data/data");

  const expectedStarts = [
    { segmentKey: "ep300-s00047", start: 476.67 },
    { segmentKey: "ep150-s00080", start: 618.47 },
    { segmentKey: "ep362-s00030", start: 290.32 },
    { segmentKey: "ep178-s00095", start: 620.71 },
    { segmentKey: "ep178-s00096", start: 625.6 },
    { segmentKey: "ep178-s00097", start: 636.48 },
    { segmentKey: "ep91-s00100", start: 749.9 },
    { segmentKey: "ep284-s00083", start: 670.0 },
    { segmentKey: "ep91-s00112", start: 839.6 }
  ];

  it("keeps reviewed generated segment starts within one second", async () => {
    if (!(await hasGeneratedAlignmentData())) {
      return;
    }

    for (const expected of expectedStarts) {
      const segment = await readGeneratedSegment(expected.segmentKey);
      expect(segment.start, expected.segmentKey).toBeGreaterThanOrEqual(expected.start - 1);
      expect(segment.start, expected.segmentKey).toBeLessThanOrEqual(expected.start + 1);
    }
  });

  async function hasGeneratedAlignmentData(): Promise<boolean> {
    try {
      await access(join(corpusDataDirectory, "alignments", "ep178.json"));
      return true;
    } catch {
      return false;
    }
  }

  async function readGeneratedSegment(segmentKey: string): Promise<{ start: number }> {
    const episode = segmentKey.match(/^ep(\d+)-/)?.[1];
    if (!episode) {
      throw new Error(`Invalid segment key: ${segmentKey}`);
    }

    const alignment = JSON.parse(
      await readFile(join(corpusDataDirectory, "alignments", `ep${episode}.json`), "utf8")
    ) as { segments?: unknown };
    if (!Array.isArray(alignment.segments)) {
      throw new Error(`Alignment for ep${episode} does not contain segments`);
    }

    const segment = alignment.segments.find(
      (candidate): candidate is { segmentKey: string; start: number } =>
        isRecord(candidate) &&
        candidate.segmentKey === segmentKey &&
        typeof candidate.start === "number"
    );
    if (!segment) {
      throw new Error(`Could not find generated segment ${segmentKey}`);
    }

    return segment;
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }
});
