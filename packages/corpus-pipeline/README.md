# 4989 Corpus Pipeline

Use this package when new 4989 episodes appear and need to be added to the web app corpus.

## One-command update

From the repo root:

```bash
pnpm corpus:update
```

That command:

1. Checks the 4989 YouTube channel video list.
2. Checks the official 4989 blog sitemap and transcript pages.
3. Builds a manifest matching episodes by episode number.
4. Processes the latest episodes that have both a YouTube video and an official script.
5. Rebuilds `manifest.json` after any new alignments are written.
6. Rebuilds the static app corpus files used by `apps/web`.

By default it considers the latest 10 script-covered episodes. If there is a larger backlog:

```bash
pnpm corpus:update -- --count 25
```

## Prerequisites

- `yt-dlp` must be available on `PATH`, or passed with `--yt-dlp`.
- The Japanese tokenizer requires a Python environment with SudachiPy and a Sudachi dictionary installed. Pass it with `--python` if the default `python3` is not the right environment.
- Captionless episodes require a faster-whisper environment passed with `--asr-python`. Episodes listed in `config/source-overrides.json` under `preferredAsrEpisodes` automatically use ASR when `--asr-python` is available.

Example with explicit tools:

```bash
pnpm corpus:update -- --python .venv/bin/python --asr-python .venv-asr/bin/python
```

## Output files

The update command writes generated corpus data under `packages/corpus-data/data`:

- `videos.json`: normalized YouTube metadata.
- `scripts.json`: official script metadata and text.
- `manifest.json`: matched episode source status.
- `alignments/epNNN.json`: canonical per-episode alignments.
- `reports/epNNN.json`: review report for each processed episode.
- `episodes.json`, `segments/`, and `index/`: static files consumed by the web app.

`apps/web` exposes those files from `/data/...`. During local dev, `pnpm --filter @4989/web dev` symlinks them into `apps/web/public/data`. During app build, the same assets are copied.

## Source overrides

Known source mismatches and duplicate source choices live in:

```text
packages/corpus-pipeline/config/source-overrides.json
```

Use that file when:

- A YouTube title does not parse to the intended episode number.
- A blog script URL is parsed as the wrong episode.
- Multiple scripts exist for the same episode and one should be preferred.
- An episode should prefer ASR timing over YouTube captions.

After changing overrides, run:

```bash
pnpm corpus:update -- --force
```

Use `--force-script-refresh` too if the blog page cache itself needs to be refetched.

## Debugging commands

The one-command update is just the normal composition of these smaller steps:

```bash
pnpm --filter @4989/corpus-pipeline list-videos
pnpm --filter @4989/corpus-pipeline discover-scripts
pnpm --filter @4989/corpus-pipeline build-manifest
pnpm --filter @4989/corpus-pipeline process-latest
pnpm --filter @4989/corpus-pipeline build-manifest
pnpm --filter @4989/corpus-pipeline rebuild-index
```

Useful checks:

- `video-enumeration-report.json`: unparsed videos, duplicate episode numbers, missing episode numbers in the YouTube range.
- `script-discovery-report.json`: unparsed blog pages, duplicate scripts, URL/title episode mismatches.
- `manifest.json`: whether an episode is `discovered`, `missing-video`, `missing-script`, `ambiguous`, `processed`, or `failed`.
- `reports/epNNN.json`: low-confidence and unmatched alignment details for manual review.

## Common options

```bash
pnpm corpus:update -- --retry-failed
pnpm corpus:update -- --force
pnpm corpus:update -- --force-script-refresh
pnpm corpus:update -- --prefer-asr --asr-python .venv-asr/bin/python
pnpm corpus:update -- --no-refresh-sources
```

- `--retry-failed`: include manifest entries currently marked failed.
- `--force`: redownload per-episode sources and regenerate alignments.
- `--force-script-refresh`: refetch blog pages instead of using cached HTML.
- `--prefer-asr`: use ASR timing even when YouTube captions exist.
- `--no-refresh-sources`: process from the existing manifest without checking YouTube or the blog again.
