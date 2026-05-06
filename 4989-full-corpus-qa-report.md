# 4989 Full Corpus QA Report

Generated after the pipeline v6 structural-heading fix and full corpus rebuild.

Scope: 270 aligned script-covered episodes, 65,296 segments, 0 unmatched, 1,049 low-confidence segments, 518 inferred segments, 7 ASR-backed episodes.

This report lists the highest-risk episodes by review burden. Each example includes the timestamp range and extracted segment text for that timestamp.

## Top Review Targets

| Rank | Episode | Source | Low | Inferred | Avg confidence | Why review |
|---:|---:|---|---:|---:|---:|---|
| 1 | 91 | `ja-orig` | 64 | 27 | 0.788 | Highest low-confidence count and lowest average confidence. |
| 2 | 300 | `ja-orig` | 24 | 12 | 0.841 | Dialogue-heavy script with speaker labels and English. |
| 3 | 284 | `ja-orig` | 20 | 18 | 0.889 | English phrases and clustered inferred timings. |
| 4 | 108 | `ja-orig` | 18 | 16 | 0.872 | Several long interpolated spans. |
| 5 | 150 | `ja-orig` | 21 | 10 | 0.895 | English vocabulary lesson sections. |
| 6 | 137 | `ja-orig` | 20 | 11 | 0.904 | English phrase examples. |
| 7 | 239 | `ja-orig` | 19 | 9 | 0.887 | English word comparison section. |
| 8 | 124 | `ja-orig` | 15 | 13 | 0.893 | Cluster near episode ending. |
| 9 | 133 | `ja-orig` | 16 | 11 | 0.883 | Spelling/alphabet examples. |
| 10 | 362 | `ja-orig` | 14 | 9 | 0.931 | English book title and surrounding discussion. |
| 11 | 125 | `ja-orig` | 12 | 10 | 0.907 | Cluster near episode ending. |
| 12 | 327 | `ja-orig` | 13 | 8 | 0.917 | English names/phrases. |
| 13 | 167 | `ja-orig` | 13 | 7 | 0.920 | English vocabulary section. |
| 14 | 200 | `ja-orig` | 12 | 7 | 0.875 | URL/list sections. |
| 15 | 273 | `ja-orig` | 12 | 8 | 0.922 | English phrases and inferred timings. |

## Key Result

`ep178` was removed from ASR preference after we identified `What I miss about Japan` as a repeated structural heading, not spoken transcript. With that heading filtered out, the YouTube-caption alignment now has 0 unmatched, 4 low-confidence, 1 inferred, and average confidence 0.931.

The segment the user checked now lands at:

- `10:25.60-10:37.52`, confidence `1`, `ep178-s00096`: 夏だとケンタッキーのレッドホットチキンとかね、辛い系が出ますよね。春は、何かありましたっけ？毎年出る商品。

## Fresh Examples

### ep91

Summary: `ja-orig`, 312 segments, 64 low-confidence, 27 inferred, average confidence 0.788.

- `12:29.90-12:44.24`, confidence `0.25`, `ep91-s00100`: me llamo Utaco. soy de japon. Mucho gusto. chao!
- `14:00.34-14:07.88`, confidence `0.25`, `ep91-s00112`: い：「いくこがアメリカでビックリしたこと〜」
- `15:24.98-15:27.94`, confidence `0.25`, `ep91-s00123`: う：笑、無駄にデカい部屋どーん、便器どーん。
- `16:11.11-16:12.34`, confidence `0.25`, `ep91-s00129`: う：walmartとかね、Targetとかね、あれ系ね。
- `16:15.29-16:20.22`, confidence `0.25`, `ep91-s00131`: う：隣の人の靴汚いなーとかね。い：え、見えるの？みたいなのと、

### ep300

Summary: `ja-orig`, 309 segments, 24 low-confidence, 12 inferred, average confidence 0.841.

- `7:59.28-8:10.32`, confidence `0.25`, `ep300-s00047`: やった後に、そのままアメリカのboarding school、寮のある学校に入学をして、うたこ：高校時代を過ごした。Mr.T：はい。うたこ：
- `8:37.13-8:44.60`, confidence `0.25`, `ep300-s00052`: っつってね、あれしたんですね。Mr.T：留学をしたんです。うたこ：
- `9:49.51-9:57.10`, confidence `0.25`, `ep300-s00060`: 一応Major、先行がliterature、文学だったんで、うたこ：おお、なかなかMr.T：エッセイが書けないと、うたこ：
- `9:57.10-10:01.04`, confidence `0.25`, `ep300-s00061`: 挑戦的なメジャーを選びますね。Mr.T：ダメだったんで。うたこ：
- `10:20.69-10:23.76`, confidence `0.25`, `ep300-s00066`: エッセイって何て言うんですか、日本語で。Mr.T：論文。うたこ：

### ep284

Summary: `ja-orig`, 259 segments, 20 low-confidence, 18 inferred, average confidence 0.889.

- `11:10.86-11:17.68`, confidence `0.25`, `ep284-s00083`: I’m sorry. Can you say that again, please?Sorry, what?え、何？え、全然聞こえない、え？みたいな。
- `14:56.96-15:06.34`, confidence `0.25`, `ep284-s00121`: 」みたいに聞いた時に、こっちが聞かれた時に、質問がわかっていないのに、とりあえず「yes」って答えちゃうみたいな。
- `15:06.34-15:10.12`, confidence `0.25`, `ep284-s00122`: とりあえずyes yes、yeah, okayみたいな。
- `20:28.95-20:30.98`, confidence `0.25`, `ep284-s00173`: Two cucumber rollsAnd
- `20:30.98-20:33.54`, confidence `0.25`, `ep284-s00174`: Two Shrimp Tempura rollsAnd

### ep108

Summary: `ja-orig`, 257 segments, 18 low-confidence, 16 inferred, average confidence 0.872.

- `5:29.25-5:37.08`, confidence `0.25`, `ep108-s00043`: そう、家から行けるbreweryに行くっというのは日常レベルのリストに分類されるのですが、大きなプロジェクト？
- `11:47.47-11:50.28`, confidence `0.25`, `ep108-s00102`: 早くThrift行きたいなー。
- `22:06.97-22:16.57`, confidence `0.25`, `ep108-s00198`: コロナの自粛がスタートした当初、3月の終わり位だっけ？4月の頭だっけ？
- `22:16.57-22:21.78`, confidence `0.25`, `ep108-s00199`: このポッドキャストでもお話したんですが、
- `25:17.94-25:23.60`, confidence `0.25`, `ep108-s00233`: 「止まない雨はない、超えられない壁はない」ってことですよ。

### ep150

Summary: `ja-orig`, 282 segments, 21 low-confidence, 10 inferred, average confidence 0.895.

- `9:10.59-9:16.77`, confidence `0.25`, `ep150-s00068`: 次は、humongous という単語です。
- `10:08.65-10:09.62`, confidence `0.25`, `ep150-s00078`: humongous でした。
- `10:16.12-10:28.41`, confidence `0.25`, `ep150-s00080`: 次は、fulfill 満たすとかっていう意味ですね。
- `11:24.74-11:28.93`, confidence `0.446`, `ep150-s00086`: fulfillって動詞か。
- `13:31.75-13:38.28`, confidence `0.25`, `ep150-s00106`: 州都はHarrisburg。

### ep137

Summary: `ja-orig`, 294 segments, 20 low-confidence, 11 inferred, average confidence 0.904.

- `18:01.21-18:04.65`, confidence `0.25`, `ep137-s00150`: I forgot about that!
- `18:04.65-18:12.81`, confidence `0.25`, `ep137-s00151`: すっかり、完全に忘れてたって時はcompletelyとかtotallyをつけて、
- `18:12.81-18:16.46`, confidence `0.25`, `ep137-s00152`: I completely forgot!
- `18:16.46-18:21.19`, confidence `0.25`, `ep137-s00153`: I totally forgot!っていうんですが、
- `18:55.17-19:03.72`, confidence `0.25`, `ep137-s00161`: 「忘れてた」って訳そうとすると、感覚的に「I have forgotten」とか「I have been forgetting」とかって感じしません？しません？

### ep239

Summary: `ja-orig`, 176 segments, 19 low-confidence, 9 inferred, average confidence 0.887.

- `8:58.10-9:07.42`, confidence `0.25`, `ep239-s00064`: Bookstoreではなくて、Brookstoneだったんです。衝撃の勘違い。
- `9:07.42-9:17.51`, confidence `0.25`, `ep239-s00065`: Bookstore ー　Brookstone …。めっちゃ似てるでしょ。パッと見、同じなのよ。
- `11:47.62-11:52.03`, confidence `0.25`, `ep239-s00088`: 今回のbookstoreとbrookstoneみたいな感じで。
- `13:54.30-13:57.56`, confidence `0.25`, `ep239-s00105`: graduation cap と、grand champion cup です。
- `14:21.04-14:27.02`, confidence `0.25`, `ep239-s00109`: あ、なんだ、graduation cap じゃなくて、grand champion cupか、って。

### ep362

Summary: `ja-orig`, 290 segments, 14 low-confidence, 9 inferred, average confidence 0.931.

- `4:53.12-4:58.90`, confidence `0.25`, `ep362-s00030`: A Good Girl’s Guide to Murder
- `4:58.90-5:02.88`, confidence `0.25`, `ep362-s00031`: という、Holly Jackson の作品です。
- `5:02.88-5:12.64`, confidence `0.25`, `ep362-s00032`: この本についての話、具体的な内容とか感想や考察とか、それらを今日話そうかっていうのはまだ迷ってるんです。
- `5:12.64-5:19.22`, confidence `0.25`, `ep362-s00033`: というのも、実は今日私が話したいのは、この本の内容そのものというよりは、
- `5:19.22-5:24.00`, confidence `0.25`, `ep362-s00034`: どのように私がこの本を楽しんだかってことなんです。

## Suggested Review Order

1. Start with `ep91`, `ep300`, `ep284`, `ep108`, and `ep150`; these now carry the highest review burden.
2. For each example, listen at the timestamp and judge whether the segment boundary/text is acceptable for search snippets.
3. If the extracted text is right but the timestamp is broad or slightly shifted, keep it and treat it as low-priority.
4. If the timestamp points to unrelated audio, flag the episode for another alignment loop.
5. Treat the remaining ASR episodes as a separate QA pass; they have zero unmatched but may carry different timing characteristics than YouTube captions.
