# 4989 Full Corpus QA Report

Generated after the pipeline v9 cue-aware timing rebuild.

Scope: 270 aligned script-covered episodes, 65,296 segments, 0 unmatched, 999 low-confidence segments, 272 inferred segments, 7 ASR-backed episodes.

## Key Result

The v9 timing pass keeps the corpus at 0 unmatched while improving review load from the v6 run:

- Low-confidence: 1,049 -> 999
- Inferred: 518 -> 272
- Mean episode average confidence: 0.935 -> 0.936

The user-checked timestamp examples are now all within 1 second of the supplied expected start time.

## Checked Examples

| Segment | Current start | Expected start | Offset | Confidence | Timing source |
|---|---:|---:|---:|---:|---|
| `ep178-s00096` | `10:25.60` | `10:25.60` | `+0.00s` | `1` | `youtube-caption-lattice` |
| `ep91-s00100` | `12:29.90` | `12:29.90` | `+0.00s` | `0.25` | `youtube-caption-lattice` |
| `ep300-s00047` | `7:57.77` | `7:57.00` | `+0.77s` | `0.25` | `youtube-caption-lattice` |
| `ep284-s00083` | `11:10.86` | `11:10.86` | `+0.00s` | `0.25` | `interpolated-between-caption-matches` |
| `ep108-s00198` | `22:09.93` | `22:10.00` | `-0.07s` | `0.25` | `interpolated-between-caption-matches` |
| `ep150-s00080` | `10:19.02` | `10:19.50` | `-0.48s` | `0.25` | `youtube-caption-lattice` |
| `ep137-s00150` | `17:59.43` | `17:59.00` | `+0.43s` | `0.25` | `youtube-caption-lattice` |
| `ep362-s00030` | `4:50.32` | `4:49.50` | `+0.82s` | `0.25` | `youtube-caption-lattice` |

## Top Review Targets

| Rank | Episode | Source | Low | Inferred | Avg confidence | Why review |
|---:|---:|---|---:|---:|---:|---|
| 1 | 91 | `ja-orig` | 64 | 19 | 0.789 | Highest low-confidence count. |
| 2 | 300 | `ja-orig` | 24 | 6 | 0.842 | Dialogue-heavy script with speaker labels and English. |
| 3 | 150 | `ja-orig` | 21 | 6 | 0.895 | English vocabulary lesson sections. |
| 4 | 137 | `ja-orig` | 20 | 3 | 0.906 | English phrase examples. |
| 5 | 124 | `ja-orig` | 15 | 10 | 0.894 | Cluster near episode ending. |
| 6 | 239 | `ja-orig` | 19 | 3 | 0.892 | English word comparison section. |
| 7 | 133 | `ja-orig` | 15 | 5 | 0.886 | Spelling/alphabet examples. |
| 8 | 125 | `ja-orig` | 12 | 10 | 0.907 | Cluster near episode ending. |
| 9 | 284 | `ja-orig` | 14 | 6 | 0.904 | English phrases and clustered inferred timings. |
| 10 | 200 | `ja-orig` | 12 | 6 | 0.875 | URL/list sections. |

## Fresh Examples

- `ep91-s00100`, `12:29.90-12:44.24`, confidence `0.25`: me llamo Utaco. soy de japon. Mucho gusto. chao!
- `ep300-s00047`, `7:57.77-8:10.32`, confidence `0.25`: やった後に、そのままアメリカのboarding school、寮のある学校に入学をして、うたこ：高校時代を過ごした。Mr.T：はい。うたこ：
- `ep150-s00080`, `10:19.02-10:28.41`, confidence `0.25`: 次は、fulfill 満たすとかっていう意味ですね。
- `ep137-s00150`, `17:59.43-18:04.46`, confidence `0.25`: I forgot about that!
- `ep124-s00240`, `28:58.08-29:01.00`, confidence `0.25`: あのーそれが蚊だったらね、刺されたら痒いし嫌だから、全力で虫除けするんですけど、
- `ep239-s00064`, `8:58.10-9:07.42`, confidence `0.25`: Bookstoreではなくて、Brookstoneだったんです。衝撃の勘違い。
- `ep284-s00083`, `11:10.86-11:17.68`, confidence `0.25`: I’m sorry. Can you say that again, please?Sorry, what?え、何？え、全然聞こえない、え？みたいな。
- `ep362-s00030`, `4:50.32-4:53.12`, confidence `0.25`: A Good Girl’s Guide to Murder
