# 4989 Alignment Iteration Log

This log tracks alignment improvement loops over the latest 10 script-covered episodes: `ep367` through `ep358`.

| Loop | Commit | Change | Segments | Unmatched | Low confidence | Notes |
|---:|---|---|---:|---:|---:|---|
| 0 | `cab7fb4` | Reading lattice plus local context/jump scoring baseline | 2257 | 12 | 17 | `ep360` unmatched 3, `ep362` unmatched 8, `ep366` unmatched 1. |
| 1 | `5bf6d06` | Broad global monotonic candidate path | 2254 | 15 | 299 | Worse overall. Recovered `ep366` to 0 unmatched and `ep362` to 2 unmatched, but broad low-confidence candidates degraded otherwise. |
| 2 | `06420ee` | Local path plus windowed global rescue | n/a | n/a | n/a | Failed validation for `ep366` and `ep361` with overlapping timestamps. Other episodes also had much higher low-confidence counts, so this was worse than loop 0. |
| 3 | `b610762` | Increased local next-context scoring weight | 2257 | 12 | 17 | Neutral against loop 0. Preserved good metrics but did not reduce unmatched units. |
| 4 | `67e253b` | Interpolate orphaned blocks by borrowing bounded timing gaps | 2269 | 0 | 30 | Best so far. Recovered all remaining unmatched units. Low-confidence count increased because difficult blocks are explicitly marked interpolated rather than hidden. |
