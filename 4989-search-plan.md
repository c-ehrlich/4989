# 4989 American Life Search Prototype Plan

## Goal

Build a repeatable local pipeline that turns 4989 American Life YouTube videos plus official website scripts into searchable timestamped sentence clips.

The target product is similar to YouGlish / ImmersionKit / asbplayer:

- Search for a Japanese word or lemma.
- See every matching sentence from the podcast.
- Play the corresponding YouTube video at the sentence timestamp.
- Export sentence cards to Anki.

The app should not need to host copied video. It can store text, alignment metadata, and optionally local working files used to generate alignments.

## Feasibility Findings

### Script Source

- Script index: `https://www.4989americanlife.com/blog`
- Direct sitemap: `https://www.4989americanlife.com/blog-posts-sitemap.xml`
- `robots.txt` allows crawling except for specific unrelated paths.
- Current sitemap probe found:
  - `279` blog post URLs
  - `277` unique episode numbers
  - script range: roughly `ep.89` through `ep.367`
  - missing scripts in that range: `ep.279`, `ep.314`
  - duplicate episode numbers: `ep.134`, `ep.278`

Script pages are Wix pages, but the server-rendered HTML contains extractable visible text and JSON-LD metadata.

### YouTube Source

- Channel videos: `https://www.youtube.com/@Utaco-wr4dx/videos`
- `yt-dlp` can enumerate videos.
- Current probe found:
  - `365` channel videos
  - `358` parsed podcast episode videos
  - range: `ep.1` through `ep.367`
- Sampled old and recent videos expose `ja-orig` Japanese automatic captions in `json3`, `vtt`, `srt`, etc.
- No sampled videos had creator-uploaded subtitles.

### Podcast RSS Source

- RSS feed: `https://feed.podbean.com/americanlife4989/feed.xml`
- Current feed only exposes latest `100` items, `ep.268` through `ep.367`.
- It contains direct MP3 enclosures.
- Useful as a fallback or comparison source, but YouTube video timing should be treated as canonical for the final player.

## Recommended Alignment Strategy

Use YouTube automatic captions as the primary timing lattice, then align the official script text onto those timestamps.

Why:

- YouTube captions match the YouTube video timing directly.
- Captions are available for sampled recent and old episodes.
- Caption text is noisy, but timestamps are usable.
- Official script text remains the displayed/searchable truth.
- This is much lighter and more repeatable than full ASR for every episode.

Pipeline:

1. Download video metadata and `ja-orig` auto captions.
2. Scrape official script text.
3. Normalize captions and script text.
4. Split official script into sentence-like units.
5. Run monotonic fuzzy alignment from script units to caption text.
6. Convert matched caption character ranges into start/end timestamps.
7. Emit alignment JSON.

### Fallback Alignment

Use `faster-whisper` or WhisperX-style ASR when YouTube captions are missing or unusable.

Probe result:

- `faster-whisper tiny` processed a 90 second Japanese segment on CPU in about 16 seconds after setup.
- `faster-whisper base` processed the same segment in about 26 seconds and gave better segment boundaries.
- ASR text should not replace the official script text; it should be used for timing anchors only.

### Aeneas

Aeneas should not be the default.

Probe result:

- It installed only after disabling native C extension builds.
- It needed older `numpy/scipy` pins to run.
- It aligned a 90 second segment, but it was sensitive to text/audio mismatch at the beginning of the segment.
- It may still be useful as an experimental fallback, but it should be containerized and pinned if used.

## Deconjugation / Lemmatization

Use SudachiPy for Japanese tokenization and dictionary forms.

Probe result:

- `食べた` -> `食べる`
- `食べない` -> `食べる`
- `食べられる` -> `食べる`
- `食べさせられた` -> `食べる`
- `行った` -> `行く`
- `良かった` -> `良い`

Index both:

- surface forms, for exact displayed text
- dictionary forms, for lemma search

For a query like `食べる`, tokenize the query and search lemma fields. Results can surface original sentences containing `食べた`, `食べて`, `食べない`, etc.

## Corpus and Index Data Structure

The deployable corpus should be static generated JSON, not a hosted database.

This should be practical for the current corpus size:

- about `358` parsed podcast videos
- about `185` hours of video
- about `277` script-covered episode numbers currently
- likely tens of thousands of aligned sentence segments, not millions

Do not deploy raw working files:

- videos
- Python virtual environments
- raw HTML
- raw YouTube caption JSON
- extracted WAV/MP3 files

Deploy only processed metadata, aligned sentence data, and lookup indexes.

### Static JSON Layout

```text
data/
  manifest.json
  episodes.json
  videos.json
  segments/
    ep367.json
    ep366.json
  index/
    lemma-buckets/
      00.json
      01.json
      ...
    surface-buckets/
      00.json
      01.json
      ...
    surface-to-lemmas.json
```

`episodes.json` stores episode-level metadata:

```ts
type Episode = {
  episode: number
  title: string
  youtubeId: string
  scriptUrl?: string
  videoUrl: string
  publishedAt?: string
  duration?: number
  hasScript: boolean
  hasAlignment: boolean
}
```

Each per-episode segment file stores the display payload:

```ts
type EpisodeSegments = {
  episode: number
  youtubeId: string
  title: string
  segments: Segment[]
}

type Segment = {
  id: number
  segmentKey: string
  episode: number
  youtubeId: string
  start: number
  end: number
  text: string
  confidence?: number
  tokens: Token[]
}

type Token = {
  surface: string
  lemma: string
  pos: string
  reading?: string
}
```

The segment `id` should be globally stable and compact. A simple scheme is:

```text
segment id = episode * 100000 + local segment index
```

Example:

```text
ep367 segment 42 => 36700042
```

This makes inverted indexes small because they only need to store numbers.

### Lemma Buckets

The main search path should use a precomputed inverted index from lemma to segment IDs.

```ts
type LemmaBucket = {
  [lemma: string]: number[]
}
```

Example:

```json
{
  "食べる": [36700112, 36700158, 36500044],
  "行く": [36700031, 36600092]
}
```

Bucket the files by a stable hash of the lemma:

```text
index/lemma-buckets/00.json
index/lemma-buckets/01.json
...
index/lemma-buckets/ff.json
```

Query flow:

1. Normalize/tokenize the query.
2. Resolve query tokens to lemmas.
3. Hash the lemma to choose a bucket file.
4. Load that bucket JSON.
5. Read the matching segment IDs.
6. Fetch only the relevant episode segment files.
7. Render matching sentences.

This avoids loading all transcripts at app startup.

### Surface Buckets

Also build a surface-form index:

```ts
type SurfaceBucket = {
  [surface: string]: number[]
}
```

This supports exact visible-form lookup and helps when the query should match a written form exactly.

### Query Lemma Lookup

For a no-database first version, query-side deconjugation can avoid shipping a full Japanese tokenizer to the browser.

Generate:

```ts
type SurfaceToLemmas = {
  [surface: string]: string[]
}
```

Example:

```json
{
  "食べた": ["食べる"],
  "食べ": ["食べる"],
  "行っ": ["行く"],
  "良かっ": ["良い"]
}
```

Query flow for `食べた`:

1. Normalize the raw query.
2. Check `surface-to-lemmas.json`.
3. Resolve `食べた` to `食べる`.
4. Search the lemma bucket for `食べる`.

Query flow for `食べる`:

1. Check if `食べる` is already a lemma key.
2. Search the lemma bucket directly.

If the query is unknown:

- fall back to surface lookup
- optionally fall back to substring search over currently loaded episode files
- later, add a server-side tokenizer endpoint or generated tokenizer artifact

The generated `surface-to-lemmas.json` only needs to know forms that actually appear in the corpus. That is acceptable for this app because search results only exist for observed corpus forms anyway.

### Result Hydration

The index should not duplicate sentence text.

The lookup index returns segment IDs. The app then hydrates those IDs from per-episode segment files.

Example:

```ts
type SearchHit = {
  segmentId: number
  episode: number
  localIndex: number
}
```

Given `36700112`:

```text
episode = Math.floor(36700112 / 100000) => 367
localIndex = 36700112 % 100000 => 112
```

Then load:

```text
data/segments/ep367.json
```

This keeps the common search path compact:

- load one small index bucket
- load only episode files needed for visible results
- paginate or cap large result sets

### Static JSON Pros and Cons

Pros:

- No hosted database.
- Easy to deploy with the repo.
- CDN-cacheable.
- Fully reproducible from source scripts/captions.
- Fast enough for exact lemma and surface lookup.
- Simple failure mode: generated files can be inspected in git.

Cons:

- Ranking, pagination, and query behavior must be implemented explicitly.
- Fuzzy/full-text search is not automatic.
- Browser-side query lemmatization is limited unless using generated lookup tables.
- Very common words can return large hit lists, so the UI needs caps/pagination.

### Alternatives

SQLite remains a good later escape hatch.

Pros:

- Cleaner joins between `episodes`, `segments`, and `tokens`.
- Good for local analysis and admin tooling.
- Can still be generated from the same canonical JSON.

Cons:

- Read-only SQLite in a deployed TanStack Start app is more operationally awkward than static JSON.
- SQLite FTS does not solve Japanese lemmatization by itself.
- Browser-side SQLite WASM adds complexity.

MiniSearch/FlexSearch can be added later for fuzzy/full-text search, but they should not replace the lemma index. Japanese conjugation still needs preprocessing.

Hosted search services such as Meilisearch, Typesense, Algolia, Postgres, or hosted SQLite are unnecessary for the initial corpus size.

## Proposed Directory Layout

```text
data/
  manifest.json
  episodes.json
  videos.json
  scripts/
    ep367.json
  captions/
    ep367.ja-orig.json3
  alignments/
    ep367.json
  segments/
    ep367.json
  index/
    lemma-buckets/
      00.json
    surface-buckets/
      00.json
    surface-to-lemmas.json

downloads/
  ep367.mp4

scripts/
  process_episode.ts
  rebuild_index.ts
  scrape_scripts.ts
  list_youtube_videos.ts
  align_caption_lattice.ts
  tokenize_japanese.ts
  build_static_index.ts

web/
  ...
```

For the first prototype, this can all live outside the current monorepo, for example under a new standalone directory.

## Alignment JSON Shape

```json
{
  "episode": 367,
  "youtubeId": "nNRz_Jh_wZI",
  "title": "ep.367/アメリカの道路が凸凹すぎる件",
  "scriptUrl": "https://www.4989americanlife.com/post/...",
  "videoUrl": "https://www.youtube.com/watch?v=nNRz_Jh_wZI",
  "source": {
    "captionTrack": "ja-orig",
    "alignmentMethod": "youtube-caption-lattice",
    "generatedAt": "2026-05-05T00:00:00Z"
  },
  "segments": [
    {
      "id": "ep367-s0001",
      "start": 49.36,
      "end": 55.0,
      "text": "4月ももう終わりますね。",
      "tokens": [
        {
          "surface": "終わり",
          "lemma": "終わる",
          "pos": "動詞"
        }
      ]
    }
  ]
}
```

## Repeatable Commands

The desired workflow can be:

```bash
pnpm build-manifest
pnpm process-episode --episode 367
pnpm rebuild-index
```

Or:

```bash
pnpm process-latest
pnpm build-manifest
pnpm rebuild-index
```

### `build-manifest`

Responsibilities:

1. Read discovered video and script source metadata.
2. Apply known source overrides:
   - script URL `ep-278-アパート探しスタート` maps to episode 279
   - duplicate script episode 134 uses the newer `ep.134/ メール対応にイライラ` page
3. Write `data/manifest.json` with one entry per episode in the union of video and script sources.
4. Mark missing source sides as `missing-video` or `missing-script`.
5. Mark entries as `processed` when a validated alignment file already exists.
6. Treat unresolved duplicate scripts/videos as `ambiguous` until an override selects the intended source.
7. Treat an alignment as valid for the manifest only when its `episode` and `youtubeId` match the selected episode/video.

TODO: `hasCaption` should be treated as provisional until caption discovery/download writes durable caption metadata. For now, `build-manifest` should only infer captions from validated alignments; after caption download is implemented, update this step to read caption availability from the caption metadata instead.

### `process-episode`

Responsibilities:

1. Resolve episode number to:
   - YouTube ID
   - script URL
2. Download/update:
   - video or audio working file
   - YouTube caption JSON
   - script HTML/text
3. Generate alignment:
   - primary: caption-lattice alignment
   - fallback: faster-whisper timing anchors
4. Tokenize and lemmatize each aligned segment.
5. Write `data/alignments/epNNN.json`.

The command should be idempotent:

- Skip existing downloads unless `--force`.
- Regenerate alignment when script/caption/video metadata changes.
- Preserve prior generated files with content hashes or metadata timestamps.

### `rebuild-index`

Responsibilities:

1. Read all `data/alignments/*.json`.
2. Build deployable static JSON segment files and lookup indexes.
3. Store enough data for:
   - surface search
   - lemma search
   - episode filters
   - Anki export
   - YouTube timestamp links

The default output should be static JSON:

- `data/episodes.json`
- `data/segments/epNNN.json`
- `data/index/lemma-buckets/*.json`
- `data/index/surface-buckets/*.json`
- `data/index/surface-to-lemmas.json`

SQLite can be generated later from the same canonical alignment JSON if ad hoc analysis or server-side querying becomes useful.

## Web Prototype

Minimum UI:

- Search box
- Results list
- Embedded YouTube player
- Click result to seek video
- Show:
  - sentence
  - episode title
  - timestamp
  - matched token(s)
- Anki export button

Anki export fields:

- expression / target word
- sentence
- episode title
- YouTube URL with timestamp
- optional screenshot later
- optional audio later, only if permitted / personal use

## Main Risks

### Script/Text Mismatch

The official script may not include every spoken filler, intro phrase, correction, or ad-lib.

Mitigation:

- Use monotonic fuzzy matching.
- Align larger units first, then refine.
- Keep confidence scores.
- Flag low-confidence segments for review.

### YouTube Caption Noise

Auto-caption text can contain recognition errors.

Mitigation:

- Use captions for timing, not display text.
- Normalize aggressively:
  - Unicode NFKC
  - kana normalization where useful
  - strip punctuation and spaces
  - normalize numerals
- Fall back to ASR anchors when caption matching confidence is low.

### Episode Mapping

Some scripts are missing, duplicated, or not cleanly matched to video titles.

Mitigation:

- Build an explicit episode manifest.
- Auto-match by episode number first.
- Keep manual overrides for duplicates and edge cases.

### Dependency Repeatability

Python audio/NLP packages can be fragile.

Mitigation:

- Prefer a small Python toolchain:
  - `faster-whisper`
  - `sudachipy`
  - `sudachidict_core`
- Pin versions.
- Consider Docker for the alignment/tokenization worker.
- Avoid aeneas unless needed.

## Prototype Milestones

### Milestone 1: Single Episode

- Process `ep.367`.
- Generate `alignment/ep367.json`.
- Confirm 20 random sentence timestamps manually in YouTube.
- Add Sudachi token/lemma data.
- Build a tiny CLI search over the JSON.

### Milestone 2: Recent 10 Episodes

- Process `ep.358` through `ep.367`.
- Evaluate alignment confidence distribution.
- Identify common mismatch patterns.
- Add manual override file if needed.

### Milestone 3: Local Web UI

- Search by lemma.
- Display results.
- Embed YouTube and seek to selected result.
- Export basic Anki TSV.

### Milestone 4: Backfill Archive

- Process all script-covered episodes.
- Produce missing/duplicate report.
- Add fallback ASR path for low-confidence episodes.

### Milestone 5: Update Workflow

- Implement `process-latest`.
- Rebuild index incrementally.
- Add a simple status report:
  - new videos
  - new scripts
  - processed
  - failed
  - low-confidence alignment

## Immediate Next Step

Create a standalone prototype repository or folder and implement Milestone 1 with the caption-lattice strategy.

Recommended initial stack:

- TypeScript for orchestration and web UI.
- Python for Japanese tokenization and optional ASR.
- Static generated JSON for deployable corpus and lookup indexes.
- `yt-dlp` and `ffmpeg` as external tools.
- `sudachipy` + `sudachidict_core` for Japanese tokenization.
- `faster-whisper` as fallback timing anchor generator.
