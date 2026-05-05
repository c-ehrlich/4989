import { describe, expect, it } from "vitest";

import { normalizeJapaneseReadings, tokenizeJapaneseTexts } from "./tokenizeJapanese.js";

const describeSudachi = process.env.SUDACHI_PYTHON ? describe : describe.skip;

describeSudachi("tokenizeJapaneseTexts Sudachi integration", () => {
  it("resolves common conjugated forms to dictionary lemmas", async () => {
    const [tabeta, tabenai, itta, yokatta] = await tokenizeJapaneseTexts(
      ["食べた", "食べない", "行った", "良かった"],
      { pythonPath: process.env.SUDACHI_PYTHON }
    );

    expect(tabeta?.map((token) => token.lemma)).toContain("食べる");
    expect(tabenai?.map((token) => token.lemma)).toContain("食べる");
    expect(itta?.map((token) => token.lemma)).toContain("行く");
    expect(yokatta?.map((token) => token.lemma)).toContain("良い");
  });

  it("normalizes kanji and kana variants through readings", async () => {
    const [kanji, kana] = await normalizeJapaneseReadings(["聞かれた時", "聞かれたとき"], {
      pythonPath: process.env.SUDACHI_PYTHON
    });

    expect(kanji).toBe(kana);
  });
});
