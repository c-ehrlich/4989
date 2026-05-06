# 4989 Full Corpus Iteration Log

This log tracks alignment improvement loops over all currently processable script-covered videos.

Scope at start: 270 manifest entries with YouTube video and official script, ranging `ep89` through `ep367`.

| Loop | Commit | Change | Episodes processed | Episodes failed | Segments | Unmatched | Low confidence | Notes |
|---:|---|---|---:|---:|---:|---:|---:|---|
| 0 | `9da9008` | Current best latest-10 pipeline before full-corpus run | 10 | 0 | 2269 | 0 | 30 | Baseline commit from latest-10 work. Full corpus not measured yet. |
| 1 | `67e253b` | Interrupted full run through most of `ep301`-`ep367` | 64 | 2 | 15457 | 0 | 164 | `ep315` failed with overlap; `ep344` has no YouTube captions. `ep314` is missing script. |
| 2 | `0e68e6c` | Enforce monotonic final draft timings | 65 | 1 | 15699 | 0 | 167 | Fixed `ep315`. Remaining unaligned processable episode in `ep301`-`ep367` is `ep344`, which has no YouTube captions/subtitles and needs ASR fallback. |
