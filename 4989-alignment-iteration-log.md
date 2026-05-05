# 4989 Alignment Iteration Log

This log tracks alignment improvement loops over the latest 10 script-covered episodes: `ep367` through `ep358`.

| Loop | Commit | Change | Segments | Unmatched | Low confidence | Notes |
|---:|---|---|---:|---:|---:|---|
| 0 | `cab7fb4` | Reading lattice plus local context/jump scoring baseline | 2257 | 12 | 17 | `ep360` unmatched 3, `ep362` unmatched 8, `ep366` unmatched 1. |
| 1 | `5bf6d06` | Broad global monotonic candidate path | 2254 | 15 | 299 | Worse overall. Recovered `ep366` to 0 unmatched and `ep362` to 2 unmatched, but broad low-confidence candidates degraded otherwise. |
