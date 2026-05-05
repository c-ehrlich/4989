# 4989 Corpus Pipeline Architecture

## Purpose

This document captures the implementation approach for generating the static JSON corpus for the 4989 American Life search app.

The goal is to build a repeatable Turborepo-based pipeline that can:

- generate searchable, timestamped sentence JSON from YouTube videos and official scripts
- incrementally add new episodes without reprocessing old ones
- keep large downloaded working files out of git and deployment
- produce static JSON that the web app can consume without a hosted database

## Core Design

Treat each episode as an independent build unit.

Per-episode processing should produce durable artifacts such as:

```text
data/alignments/ep367.json
```

Global files such as indexes should be regenerated from all existing per-episode alignment files:

```text
data/episodes.json
data/segments/ep367.json
data/index/lemma-buckets/00.json
data/index/surface-buckets/00.json
data/index/surface-to-lemmas.json
```

This keeps the expensive work incremental while keeping the global index generation simple and reliable.

## Turborepo Layout

Recommended long-term layout:

```text
apps/
  web/

packages/
  corpus-pipeline/
  corpus-data/
  corpus-types/
```

### `packages/corpus-pipeline`

Owns the local processing tools and CLIs.

```text
packages/corpus-pipeline/
  src/
    cli/
      process-episode.ts
      process-latest.ts
      rebuild-index.ts
    youtube/
      listVideos.ts
      downloadCaptions.ts
      downloadAudio.ts
    scripts/
      scrapeScripts.ts
      parseScriptPage.ts
    align/
      alignCaptionLattice.ts
    tokenize/
      tokenizeJapanese.ts
    index/
      buildStaticIndex.ts
```

This package can depend on tooling such as `yt-dlp`, `ffmpeg`, Python scripts, SudachiPy, and optional faster-whisper support.

### `packages/corpus-data`

Owns generated corpus JSON.

```text
packages/corpus-data/
  data/
    manifest.json
    episodes.json
    videos.json
    alignments/
      ep367.json
    segments/
      ep367.json
    index/
      lemma-buckets/
      surface-buckets/
      surface-to-lemmas.json
```

The web app should consume this package or copy its `data/` output into the app's public/static assets.

### `packages/corpus-types`

Owns shared TypeScript types and schemas.

```text
packages/corpus-types/
  src/
    episode.ts
    segment.ts
    manifest.ts
    index.ts
```

This keeps the pipeline and web app aligned on the JSON contract.

For the fastest prototype, these can temporarily be collapsed into one `packages/corpus` package, but the three-package split is cleaner once the web app exists.

## Working Files

Do not download all videos at 720p.

The primary alignment strategy uses YouTube automatic captions as the timing lattice, so most episodes only need:

- YouTube metadata
- YouTube `ja-orig` automatic caption JSON
- official script HTML/text

Large or raw working files should live in a gitignored folder:

```text
.work/4989/
  youtube/
    ep367.info.json
  captions/
    ep367.ja-orig.json3
  scripts/
    ep367.html
    ep367.txt
  audio/
    ep367.m4a
```

Use `ep<number>.<extension>` naming, not bare numbers. Examples:

```text
ep367.info.json
ep367.ja-orig.json3
ep367.html
ep367.txt
ep367.m4a
```

Audio should be downloaded only when captions are missing or alignment confidence is too low and faster-whisper fallback is needed.

## Why Audio Instead Of Video

For fallback ASR, audio is enough.

Prefer:

```text
.work/4989/audio/ep367.m4a
```

Avoid downloading full video unless a future feature needs local screenshots, visual QA, or frame extraction.

The app itself should not host copied video. It should play YouTube by ID and timestamp.

## Source Files

Primary source inputs:

- YouTube channel video metadata
- YouTube `ja-orig` automatic captions in `json3`
- official script pages from the 4989 American Life website

Fallback source input:

- extracted YouTube audio, used only for ASR timing anchors

## Processing Commands

Expected command shape:

```bash
pnpm --filter @4989/corpus-pipeline process-episode -- --episode 367
pnpm --filter @4989/corpus-pipeline process-latest
pnpm --filter @4989/corpus-pipeline build-manifest
pnpm --filter @4989/corpus-pipeline rebuild-index
```

### `process-episode`

Responsibilities:

1. Resolve episode number to YouTube ID and script URL.
2. Download or update working files:
   - YouTube metadata
   - `ja-orig` caption JSON
   - official script HTML/text
   - audio only if fallback is needed
3. Normalize captions and script text.
4. Split official script into sentence-like units.
5. Align official script sentences to caption timestamps.
6. Tokenize aligned sentences with Sudachi.
7. Write `data/alignments/epNNN.json`.

The command should be idempotent. It should skip existing valid work unless `--force` is passed or an input/pipeline version changed.

### `process-latest`

Responsibilities:

1. Refresh YouTube video metadata.
2. Refresh script sitemap/page metadata.
3. Match episodes by episode number.
4. Compare discovered episodes with existing alignments.
5. Process only new, stale, or explicitly requested episodes.
6. Leave known missing or failed episodes alone unless `--retry-failed` is passed.

### `build-manifest`

Responsibilities:

1. Read discovered `videos.json` and `scripts.json`.
2. Apply source overrides for known numbering and duplicate-script edge cases.
3. Build `data/manifest.json` from the union of discovered video and script episode numbers.
4. Mark video-only episodes as `missing-script` and script-only episodes as `missing-video`.
5. Mark episodes with validated alignment JSON as `processed`.

TODO: `hasCaption` is currently provisional in this step. Until the caption-download step writes durable caption metadata, `build-manifest` should only set `hasCaption: true` when a validated alignment already proves that a usable caption timing source existed. When caption download/probing is implemented in `process-episode` or an earlier source-refresh command, update `build-manifest` to read that caption metadata instead.

### `rebuild-index`

Responsibilities:

1. Read all `data/alignments/*.json`.
2. Generate deployable segment files.
3. Generate `episodes.json` and `videos.json`.
4. Generate lemma index buckets.
5. Generate surface index buckets.
6. Generate `surface-to-lemmas.json`.
7. Generate or update a build report.

The first version should rebuild global indexes from scratch. This is simpler and should be fast enough because the expensive per-episode alignment work is already cached.

## Incremental Build Rules

Each `data/alignments/epNNN.json` should include source hashes and pipeline metadata:

```json
{
  "episode": 367,
  "youtubeId": "nNRz_Jh_wZI",
  "source": {
    "captionTrack": "ja-orig",
    "alignmentMethod": "youtube-caption-lattice",
    "scriptHash": "sha256:...",
    "captionHash": "sha256:...",
    "videoMetadataHash": "sha256:...",
    "pipelineVersion": 1,
    "generatedAt": "2026-05-05T00:00:00Z"
  },
  "segments": []
}
```

`process-episode` can skip regeneration when:

- the script hash is unchanged
- the caption hash is unchanged
- the video metadata hash is unchanged
- the pipeline version is unchanged
- the output alignment file exists and validates

It should regenerate when:

- the official script changed
- YouTube captions changed
- video metadata changed in a way that affects playback or timing
- the alignment/tokenization pipeline version changed
- the user passes `--force`

## Manifest

Maintain a manifest that maps episode numbers to source and processing state:

```json
{
  "episodes": [
    {
      "episode": 367,
      "youtubeId": "nNRz_Jh_wZI",
      "videoUrl": "https://www.youtube.com/watch?v=nNRz_Jh_wZI",
      "scriptUrl": "https://www.4989americanlife.com/post/...",
      "hasScript": true,
      "hasCaption": true,
      "status": "processed",
      "alignmentPath": "data/alignments/ep367.json"
    }
  ]
}
```

The manifest is the bridge between source discovery and processing. It should be generated or refreshed by pipeline commands, with room for manual overrides for duplicate or mismatched episodes.

Known source overrides:

- The script URL `ep-278-アパート探しスタート` is episode 279 even though the URL contains 278.
- Duplicate script episode 134 should use the newer `ep.134/ メール対応にイライラ` page.

## Status Report

Generate a report for operational visibility:

```text
data/build-report.json
```

Example:

```json
{
  "ep279": {
    "status": "missing-script"
  },
  "ep314": {
    "status": "missing-script"
  },
  "ep142": {
    "status": "low-confidence",
    "averageConfidence": 0.62
  },
  "ep367": {
    "status": "processed",
    "segments": 184
  }
}
```

This prevents `process-latest` from repeatedly retrying known missing or failed episodes unless requested.

## Deployable JSON

The deployable corpus should include:

```text
data/
  manifest.json
  episodes.json
  videos.json
  segments/
    ep367.json
  index/
    lemma-buckets/
      00.json
      ...
      ff.json
    surface-buckets/
      00.json
      ...
      ff.json
    surface-to-lemmas.json
```

Do not deploy:

- downloaded videos
- downloaded audio
- raw HTML
- raw YouTube caption files
- Python virtual environments
- temporary ASR output unless it becomes part of a documented generated artifact

## Search Index Strategy

Use static JSON inverted indexes.

Lemma bucket:

```ts
type LemmaBucket = {
  [lemma: string]: number[]
}
```

Surface bucket:

```ts
type SurfaceBucket = {
  [surface: string]: number[]
}
```

Surface-to-lemmas lookup:

```ts
type SurfaceToLemmas = {
  [surface: string]: string[]
}
```

Segment IDs should be globally stable and compact:

```text
segment id = episode * 100000 + local segment index
```

Example:

```text
ep367 segment 42 => 36700042
```

The web app can hydrate results by deriving the episode and local index from the segment ID.

## Recommended Milestone Order

1. Set up Turborepo package skeleton.
2. Implement shared corpus types.
3. Implement YouTube video enumeration.
4. Implement official script discovery and parsing.
5. Build the episode manifest.
6. Process one episode with Sudachi tokenization, starting with `ep367`.
7. Generate one alignment JSON.
8. Build static index JSON.
9. Add a tiny CLI search to validate the corpus.
10. Process recent 10 episodes.
11. Build the web app.
12. Backfill all script-covered episodes.

## Milestone Validation

Each milestone should have a concrete completeness check and a correctness check. Completeness answers "did we produce every expected artifact?" Correctness answers "can we trust what we produced?"

### 1. Set Up Turborepo Package Skeleton

Completeness:

- `pnpm install` succeeds from the repo root.
- `pnpm-workspace.yaml` includes `apps/*` and `packages/*`.
- `turbo.json` has tasks for at least `build`, `typecheck`, `lint`, and later pipeline commands.
- Expected package directories exist:
  - `packages/corpus-pipeline`
  - `packages/corpus-data`
  - `packages/corpus-types`
  - `apps/web` when the web app milestone begins
- `.work/`, downloaded media, temporary Python environments, and generated cache files are gitignored.

Correctness:

- `pnpm turbo run build` succeeds with empty or placeholder packages.
- `pnpm turbo run typecheck` succeeds.
- Package names and imports use the intended workspace names, for example `@4989/corpus-types`.
- No generated or downloaded working files appear in `git status`.

### 2. Implement Shared Corpus Types

Completeness:

- Types exist for:
  - episodes
  - videos
  - manifest entries
  - alignments
  - segments
  - tokens
  - index buckets
  - build report entries
- Runtime schemas exist if using a validator such as Zod.
- JSON examples or fixtures exist for one small episode-like sample.

Correctness:

- TypeScript typecheck passes in both producer and consumer packages.
- Example JSON validates against runtime schemas.
- The schema catches malformed fixtures, such as missing `episode`, invalid segment IDs, missing `youtubeId`, or token entries without `surface`/`lemma`.
- Segment ID helpers round-trip correctly:
  - `36700042 -> episode 367, local index 42`
  - `episode 367, local index 42 -> 36700042`

### 3. Implement YouTube Video Enumeration

Completeness:

- The command can enumerate the channel and write a normalized video list.
- It captures at least:
  - YouTube ID
  - title
  - URL
  - published date if available
  - duration if available
  - parsed episode number when present
- It writes a report for videos that cannot be parsed as podcast episodes.

Correctness:

- Total video count is close to the known probe result from the search plan.
- Parsed podcast episode range is close to `ep.1` through the latest available episode.
- Spot-check at least 10 old, middle, and recent videos against YouTube titles.
- Duplicate episode numbers are reported rather than silently overwritten.
- Re-running the command produces stable JSON ordering and no meaningless diffs.

### 4. Implement Official Script Discovery And Parsing

Completeness:

- The command reads the sitemap or blog index and discovers script pages.
- It extracts:
  - script URL
  - episode number
  - title
  - published date if available
  - visible script text
- It writes raw cached HTML/text to `.work/4989/scripts/`.
- It writes normalized script metadata for manifest generation.

Correctness:

- Discovered script count is close to the known probe result from the search plan.
- Missing scripts in the expected range are reported, including known gaps such as `ep279` and `ep314` if still absent.
- Duplicate episode numbers are reported, including known duplicates such as `ep134` and `ep278` if still present.
- Spot-check parsed text for at least 10 pages across old, middle, and recent scripts.
- Parsed text should not include obvious navigation/footer boilerplate as sentence content.
- Re-running the parser produces stable output for unchanged pages.

### 5. Build The Episode Manifest

Completeness:

- Manifest entries exist for every parsed podcast video and/or script-covered episode.
- Each entry includes:
  - episode number
  - YouTube ID when available
  - video URL
  - script URL when available
	  - `hasScript`
	  - `hasCaption`
	  - processing status
	  - alignment path when available
- Script source/cache paths remain in `scripts.json`; the manifest should not duplicate local `.work` cache paths.
- Missing, duplicate, and ambiguous matches are represented explicitly.

Correctness:

- Episode numbers are unique in the manifest unless represented through a deliberate duplicate/override structure.
- For script-covered episodes, the YouTube ID and script URL refer to the same episode number.
- Processed entries only point at alignment files whose `episode` and `youtubeId` match the selected manifest sources.
- Known missing and duplicate cases from discovery are visible in the manifest or build report.
- Manual overrides are applied deterministically and documented.
- Manifest validation fails if an episode has contradictory state, such as `status: "processed"` without an alignment path.

### 6. Process One Episode, Starting With `ep367`

Completeness:

- `process-episode --episode 367` downloads or caches:
  - video metadata
  - `ja-orig` caption JSON
  - official script HTML/text
- It writes `data/alignments/ep367.json`.
- The alignment includes source hashes, pipeline version, generated timestamp, segments, timestamps, confidence scores, and Sudachi tokens.
- Python dependency setup for SudachiPy and the Sudachi dictionary is documented and pinned.

Correctness:

- The command is idempotent: a second run skips unchanged work or produces no meaningful diffs.
- Segment timestamps are monotonic and non-overlapping except for intentional tiny boundary tolerance.
- Segment text comes from the official script, not the noisy YouTube captions.
- Segment start/end times fall inside the YouTube video duration.
- Each emitted segment has token entries with surface, lemma, part of speech, and reading when available.
- Known conjugation examples resolve correctly:
  - `食べた -> 食べる`
  - `食べない -> 食べる`
  - `行った -> 行く`
  - `良かった -> 良い`
- Tokenization output validates against the segment schema and is stable on rerun.
- Manually check about 20 randomly selected sentence timestamps in YouTube.
- Low-confidence or unmatched script portions are reported rather than hidden.

### 7. Generate One Alignment JSON

Completeness:

- The alignment file conforms to the shared schema.
- Every segment has:
  - stable numeric ID
  - segment key
  - episode number
  - YouTube ID
  - start time
  - end time
  - official script text
  - confidence
  - tokens
- Alignment summary metrics are emitted:
  - script unit count
  - segment count
  - matched count
  - unmatched count
  - average confidence
  - low-confidence count

Correctness:

- Schema validation passes.
- Segment IDs follow the expected rule: `episode * 100000 + local segment index`.
- Start times are sorted ascending.
- End times are greater than start times.
- The first and last aligned segments are plausible relative to the video.
- A short generated review report lists the lowest-confidence segments for manual inspection.

### 8. Build Static Index JSON

Completeness:

- `rebuild-index` writes:
  - `episodes.json`
  - `videos.json`
  - `segments/epNNN.json`
  - `index/lemma-buckets/*.json`
  - `index/surface-buckets/*.json`
  - `index/surface-to-lemmas.json`
  - `build-report.json`
- Buckets cover the full expected hash range, or the chosen sparse-bucket strategy is documented.

Correctness:

- Every segment ID referenced by an index resolves to an existing segment.
- Every token's lemma appears in the lemma index.
- Every token's surface appears in the surface index.
- `surface-to-lemmas` includes every observed surface form that maps to one or more lemmas.
- Rebuilding from unchanged alignments produces stable output.
- Very common terms are allowed to produce large result sets, but the output remains valid and deterministic.

### 9. Add A Tiny CLI Search To Validate The Corpus

Completeness:

- CLI search supports at least:
  - lemma lookup
  - surface lookup
  - result hydration from segment files
  - result limit
- Output includes:
  - sentence text
  - episode title or number
  - timestamp
  - YouTube timestamp URL

Correctness:

- Searching `食べる` returns sentences containing observed conjugated forms such as `食べた` when present.
- Searching an exact surface form uses the surface index.
- Every returned segment ID hydrates successfully.
- YouTube timestamp URLs point to the expected video and second.
- Unknown queries fail gracefully with zero results, not an exception.

### 10. Process Recent 10 Episodes

Completeness:

- The pipeline processes the latest 10 script-covered episodes.
- A build report summarizes each episode's status.
- Global indexes include all 10 processed episodes.

Correctness:

- Confidence metrics are reviewed across all 10 episodes.
- Manually check a sample of timestamps per episode, for example 5 random segments each.
- Compare failure patterns across episodes and document recurring issues.
- `process-latest` does not redo successfully processed unchanged episodes.
- Rebuilding the index after processing the 10 episodes produces valid searchable results across episode boundaries.

### 11. Build The Web App

Completeness:

- The UI includes:
  - search box
  - result list
  - YouTube player
  - click-to-seek behavior
  - episode/timestamp display
  - basic Anki TSV export
- The app loads static JSON from `packages/corpus-data` or copied public assets.
- For the first deployment, static corpus assets use stable paths such as `/data/segments/ep367.json` and `/data/index/lemma-buckets/00.json`, not one large bundled JS payload.
- On Vercel, rely on automatic gzip/Brotli compression and edge caching for those JSON assets, but keep browser caching conservative with revalidating headers such as `Cache-Control: public, max-age=0, must-revalidate` so corpus updates are visible after redeploys.

Correctness:

- Searches match CLI search results for the same query and limit.
- Clicking a result seeks the YouTube player to the segment start time.
- Result hydration loads only needed segment files, not the entire corpus at startup.
- Common-word searches remain usable through limits or pagination.
- Anki export rows include the expected fields and escape tabs/newlines correctly.
- Basic browser validation passes on desktop and mobile widths.

### 12. Backfill All Script-Covered Episodes

Completeness:

- Every script-covered episode is either:
  - processed
  - marked missing required source
  - marked failed
  - marked low-confidence and needing review
- `build-report.json` summarizes corpus-wide totals:
  - discovered videos
  - discovered scripts
  - processed alignments
  - missing scripts
  - missing captions
  - ASR fallback used
  - failures
  - low-confidence episodes
- Static indexes are regenerated over the full processed corpus.

Correctness:

- No index references missing segment files.
- No segment file references missing episode metadata.
- Random timestamp QA covers old, middle, and recent episodes.
- Low-confidence episodes are reviewed or excluded from default search results according to documented policy.
- The full rebuild is reproducible on a clean checkout with documented external tools installed.
- Corpus-level counts are plausible relative to the known source probes in the search plan.

## Important Principle

Never make one episode's alignment depend on another episode's processing state.

Per-episode files are durable artifacts. Global files are regenerated views over those artifacts.
