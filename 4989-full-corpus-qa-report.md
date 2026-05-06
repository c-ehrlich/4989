# 4989 Full Corpus QA Report

Generated after the pipeline v10 rolling-caption spoken-boundary rebuild.

Scope: 270 aligned script-covered episodes, 65,296 segments, 0 unmatched, 984 low-confidence segments, 212 inferred segments, 7 ASR-backed episodes.

## Key Result

The v10 timing pass keeps the corpus at 0 unmatched while improving review load from the v6 run:

- Low-confidence: 1,049 -> 984
- Inferred: 518 -> 212
- Mean episode average confidence: 0.935 -> 0.936

The user-checked timestamp examples remain within the supplied tolerances, and the newly flagged `ep178` neighbor segments now start at the spoken caption event instead of the previous visual caption boundary.

## Checked Examples

| Segment | Current start | Expected start | Offset | Confidence | Timing source |
|---|---:|---:|---:|---:|---|
| `ep178-s00096` | `10:25.60` | `10:25.60` | `+0.00s` | `1` | `youtube-caption-lattice` |
| `ep91-s00100` | `12:29.90` | `12:29.90` | `+0.00s` | `0.25` | `youtube-caption-lattice` |
| `ep300-s00047` | `7:56.67` | `7:57.00` | `-0.33s` | `0.25` | `youtube-caption-lattice` |
| `ep284-s00083` | `11:10.00` | `11:10.86` | `-0.86s` | `0.25` | `interpolated-between-caption-matches` |
| `ep108-s00198` | `22:09.93` | `22:10.00` | `-0.07s` | `0.25` | `interpolated-between-caption-matches` |
| `ep150-s00080` | `10:18.47` | `10:19.50` | `-1.03s` | `0.25` | `youtube-caption-lattice` |
| `ep137-s00150` | `17:59.43` | `17:59.00` | `+0.43s` | `0.25` | `youtube-caption-lattice` |
| `ep362-s00030` | `4:50.32` | `4:49.50` | `+0.82s` | `0.25` | `youtube-caption-lattice` |
| `ep178-s00095` | `10:20.71` | `10:20.00` | `+0.71s` | `0.963` | `youtube-caption-lattice` |
| `ep178-s00097` | `10:36.48` | `10:36.00` | `+0.48s` | `1` | `youtube-caption-lattice` |

## Top Review Targets

| Rank | Episode | Source | Low | Inferred | Avg confidence | Why review |
|---:|---:|---|---:|---:|---:|---|
| 1 | 91 | `ja-orig` | 62 | 16 | 0.790 | Highest low-confidence count. |
| 2 | 137 | `ja-orig` | 22 | 3 | 0.905 | English phrase examples. |
| 3 | 300 | `ja-orig` | 20 | 3 | 0.848 | Dialogue-heavy script with speaker labels and English. |
| 4 | 124 | `ja-orig` | 15 | 10 | 0.894 | Cluster near episode ending. |
| 5 | 150 | `ja-orig` | 20 | 2 | 0.896 | English vocabulary lesson sections. |
| 6 | 239 | `ja-orig` | 19 | 0 | 0.896 | English word comparison section. |
| 7 | 125 | `ja-orig` | 12 | 10 | 0.907 | Cluster near episode ending. |
| 8 | 284 | `ja-orig` | 14 | 6 | 0.904 | English phrases and clustered inferred timings. |
| 9 | 133 | `ja-orig` | 15 | 4 | 0.887 | Spelling/alphabet examples. |
| 10 | 349 | `ja-orig` | 11 | 7 | 0.931 | Review burden increased by inferred segments. |

## Fresh Examples

- `ep91-s00100`, `12:29.90-12:44.10`, confidence `0.25`: me llamo Utaco. soy de japon. Mucho gusto. chao!
- `ep300-s00047`, `7:56.67-8:10.32`, confidence `0.25`: やった後に、そのままアメリカのboarding school、寮のある学校に入学をして、うたこ：高校時代を過ごした。Mr.T：はい。うたこ：
- `ep150-s00080`, `10:18.47-10:28.10`, confidence `0.25`: 次は、fulfill 満たすとかっていう意味ですね。
- `ep137-s00150`, `17:59.43-18:04.46`, confidence `0.25`: I forgot about that!
- `ep124-s00240`, `28:58.08-29:01.00`, confidence `0.25`: あのーそれが蚊だったらね、刺されたら痒いし嫌だから、全力で虫除けするんですけど、
- `ep239-s00064`, `8:58.10-9:07.42`, confidence `0.25`: Bookstoreではなくて、Brookstoneだったんです。衝撃の勘違い。
- `ep284-s00083`, `11:10.00-11:17.68`, confidence `0.25`: I’m sorry. Can you say that again, please?Sorry, what?え、何？え、全然聞こえない、え？みたいな。
- `ep362-s00030`, `4:50.32-4:53.12`, confidence `0.25`: A Good Girl’s Guide to Murder
