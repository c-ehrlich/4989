import type { CorpusSegment, CorpusToken } from "@4989/corpus-types";
import { describe, expect, it } from "vitest";

import { getSearchHighlightParts, getSearchHighlightRanges } from "../src/corpus/highlight";

describe("search result highlighting", () => {
  it("highlights loose lemma matches with adjacent inflection endings", () => {
    const segment = makeSegment(
      "私はリンゴを食べたことがあります。",
      token("私", "私", ["代名詞"]),
      token("は", "は", ["助詞", "係助詞"]),
      token("リンゴ", "リンゴ", ["名詞", "普通名詞", "一般"]),
      token("を", "を", ["助詞", "格助詞"]),
      token("食べ", "食べる", ["動詞", "一般", "下一段-バ行", "連用形-一般"]),
      token("た", "た", ["助動詞", "助動詞-タ", "連体形-一般"]),
      token("こと", "こと", ["名詞", "普通名詞", "一般"]),
      token("が", "が", ["助詞", "格助詞"]),
      token("あり", "ある", ["動詞", "非自立可能", "五段-ラ行", "連用形-一般"]),
      token("ます", "ます", ["助動詞", "助動詞-マス", "終止形-一般"]),
      token("。", "。", ["補助記号", "句点"])
    );

    expect(
      getSearchHighlightParts(segment, {
        query: "食べる",
        mode: "loose",
        matchedTerms: ["食べる"]
      })
    ).toEqual([
      { text: "私はリンゴを", highlighted: false },
      { text: "食べた", highlighted: true },
      { text: "ことがあります。", highlighted: false }
    ]);
  });

  it("highlights each matching inflected form in a segment", () => {
    const segment = makeSegment(
      "食べてないし、食べました。",
      token("食べ", "食べる", ["動詞", "一般", "下一段-バ行", "連用形-一般"]),
      token("て", "て", ["助詞", "接続助詞"]),
      token("ない", "ない", ["助動詞", "助動詞-ナイ", "終止形-一般"]),
      token("し", "し", ["助詞", "接続助詞"]),
      token("、", "、", ["補助記号", "読点"]),
      token("食べ", "食べる", ["動詞", "一般", "下一段-バ行", "連用形-一般"]),
      token("まし", "ます", ["助動詞", "助動詞-マス", "連用形-一般"]),
      token("た", "た", ["助動詞", "助動詞-タ", "終止形-一般"]),
      token("。", "。", ["補助記号", "句点"])
    );

    expect(
      getSearchHighlightRanges(segment, {
        query: "食べる",
        mode: "loose",
        matchedTerms: ["食べる"]
      }).map((range) => segment.text.slice(range.start, range.end))
    ).toEqual(["食べてない", "食べました"]);
  });

  it("falls back to direct text matching when token spans are unavailable", () => {
    const segment = makeSegment("今日はパンを食べる。");

    expect(
      getSearchHighlightParts(segment, {
        query: "食べる",
        mode: "exact",
        matchedTerms: ["食べる"]
      })
    ).toEqual([
      { text: "今日はパンを", highlighted: false },
      { text: "食べる", highlighted: true },
      { text: "。", highlighted: false }
    ]);
  });
});

function makeSegment(text: string, ...tokens: CorpusToken[]): CorpusSegment {
  return {
    id: 17800001,
    segmentKey: "ep178-s00001",
    episode: 178,
    localIndex: 1,
    youtubeId: "youtube0178",
    start: 1,
    end: 2,
    text,
    tokens
  };
}

function token(surface: string, lemma: string, pos: string[]): CorpusToken {
  return {
    surface,
    lemma,
    pos
  };
}
