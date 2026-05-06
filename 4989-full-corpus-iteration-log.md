# 4989 Full Corpus Iteration Log

This log tracks alignment improvement loops over all currently processable script-covered videos.

Scope at start: 270 manifest entries with YouTube video and official script, ranging `ep89` through `ep367`.

| Loop | Commit | Change | Episodes processed | Episodes failed | Segments | Unmatched | Low confidence | Notes |
|---:|---|---|---:|---:|---:|---:|---:|---|
| 0 | `9da9008` | Current best latest-10 pipeline before full-corpus run | 10 | 0 | 2269 | 0 | 30 | Baseline commit from latest-10 work. Full corpus not measured yet. |
| 1 | `67e253b` | Interrupted full run through most of `ep301`-`ep367` | 64 | 2 | 15457 | 0 | 164 | `ep315` failed with overlap; `ep344` has no YouTube captions. `ep314` is missing script. |
| 2 | `0e68e6c` | Enforce monotonic final draft timings | 65 | 1 | 15699 | 0 | 167 | Fixed `ep315`. Remaining unaligned processable episode in `ep301`-`ep367` is `ep344`, which has no YouTube captions/subtitles and needs ASR fallback. |
| 3 | `29eb20e` | Add Faster Whisper ASR fallback for captionless episodes | 66 | 0 | 15916 | 0 | 168 | Processed `ep344` from cached ASR transcript (`faster-whisper-base`): 217 segments, 0 unmatched, 1 low-confidence, average confidence 0.948. `ep301`-`ep367` now has 66 aligned episodes; only `ep314` is absent because it is missing an official script. |
| 4 | `6649a71` | Make source/ASR choices reproducible for full corpus | 270 | 0 | 65297 | 0 | 1072 | Completed all selected script-covered episodes `ep89`-`ep367`. Fixed `ep134` script/video pairing and persisted ASR-preferred episodes `98`, `102`, `118`, `178`, `244`, `271`, `277`; `ep344` still uses ASR because YouTube has no captions. Mean episode average confidence: 0.935. |
| 5 | `a5a4abd` | Filter recurring `What I miss about Japan` section heading | 270 | 0 | 65296 | 0 | 1049 | Removed `ep178` from ASR preference after identifying the only remaining non-ASR unmatched unit as an unspoken structural heading. Full corpus is still zero-unmatched, `ep178` is back on YouTube captions, and mean episode average confidence remains 0.935. |
| 6 | `439b1d7` | Refine caption timing for rolling cues | 270 | 0 | 65296 | 0 | 999 | Regenerated all script-covered episodes at pipeline v9. Preserved zero unmatched while reducing low-confidence from 1049 to 999 and inferred from 518 to 272. All eight user-checked timing examples are within 1s. Mean episode average confidence: 0.936. |
| 7 | `08a446d` | Use spoken boundaries for rolling captions | 270 | 0 | 65296 | 0 | 984 | Regenerated all script-covered episodes at pipeline v10. Preserved zero unmatched while reducing low-confidence from 999 to 984 and inferred from 272 to 212. Fixed the newly checked `ep178-s00095` and `ep178-s00097` boundary shifts. Mean episode average confidence: 0.936. |

Loop 4 notes:
- The first all-video run after loop 3 produced 270 alignments, 64,960 segments, 320 unmatched, and 1,056 low-confidence segments.
- `ep134` was the largest defect: the manifest paired the only `ep134` video (`コロナ自粛Californiaの現在の様子`) with the duplicate `メール対応にイライラ` script. Correcting the preferred script URL reduced full-corpus unmatched from 320 to 107.
- Targeted Faster Whisper replacement for the remaining high/isolated unmatched episodes reduced unmatched from 107 to 0. The tradeoff is higher low-confidence count, especially `ep178` (27 low-confidence, 23 inferred), so this is the best zero-unmatched run rather than the lowest-review-count run.

Loop 5 notes:
- `ep178` ASR fixed an unmatched count but made timestamp quality worse around the user-checked `10:25` section. Regenerating from YouTube captions produced 1 unmatched item: the standalone heading `What I miss about Japan`.
- Treating that heading as structural script text produced `ep178` with 237 segments, 0 unmatched, 4 low-confidence, 1 inferred, and average confidence 0.931.
- The user-checked line now appears at `10:25.60-10:37.52` with confidence `1`, instead of the stale ASR-derived `10:30.20-10:36.20` low-confidence timing.

Loop 6 notes:
- The first v8 full run exposed 7 unmatched regressions, all from first script units being penalized as long same-block jumps. The jump penalty is now disabled until a previous anchor exists.
- The final v9 pass uses cue-local anchors, bounded candidate timing rescue, bounded previous-segment trimming for rolling captions, and a small leading buffer for pure multi-issue interpolation blocks.
- Final checked offsets: `ep178` +0.00s, `ep91` +0.00s, `ep300` +0.77s, `ep284` +0.00s, `ep108` -0.07s, `ep150` -0.48s, `ep137` +0.43s, `ep362` +0.82s.

Loop 7 notes:
- The new `ep178-s00095` and `ep178-s00097` issues were caused by treating a rolling caption's full visual lifetime as the spoken phrase end. That made the preceding segment end late, and monotonic enforcement pushed the next start late.
- The parser now trims caption character/cue timing to the next event start when rolling caption events overlap. This uses the caption's spoken event boundary rather than the on-screen display duration.
- A first full v10 run exposed one unmatched regression in `ep111` after a long music/interstitial gap; bounded cue rescue now scans the whole gap up to the next direct match, which restored zero unmatched.
- Regression coverage now includes focused unit cases for the `ep178` rolling-caption sequence and the `ep111` long-gap rescue, plus a local generated-corpus guard for the nine reviewed timestamps when alignment artifacts are present.
