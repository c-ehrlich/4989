# 4989 Web

TanStack Start app for the static 4989 corpus search experience.

Step 11.1 only establishes the app shell, scripts, lint, typecheck, and build. In Step 11.4, corpus assets should be served from stable public paths under `/data/...`, matching the generated layout in `packages/corpus-data/data`.

## Corpus Client

`src/corpus` owns the web app contract for static corpus files. UI and search code should use these helpers instead of hard-coding JSON paths:

- `loadEpisodes()` -> `/data/episodes.json`
- `loadEpisodeSegments(178)` -> `/data/segments/ep178.json`
- `loadLemmaBucket("ab")` -> `/data/index/lemma-buckets/ab.json`
- `loadSurfaceBucket("ab")` -> `/data/index/surface-buckets/ab.json`
- `loadSurfaceToLemmas()` -> `/data/index/surface-to-lemmas.json`

The loaders validate fetched JSON with the shared schemas from `@4989/corpus-types`.
