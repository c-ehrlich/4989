# 4989単語調べ

Live at 4989.c-ehrlich.dev

## Adding New Videos to the Corpus

When new 4989 episodes are available, update the corpus from the repo root:

```bash
pnpm corpus:update
```

This checks the 4989 YouTube channel and official blog scripts, matches episodes by episode number, processes new episodes that have both a video and script, then rebuilds the static corpus files used by `apps/web`.

By default, the update considers the latest 10 script-covered episodes. If there is a larger backlog, pass a higher count:

```bash
pnpm corpus:update -- --count 25
```

Prerequisites:

- `yt-dlp` must be available on `PATH`, or passed with `--yt-dlp`.
- The Japanese tokenizer needs a Python environment with SudachiPy and a Sudachi dictionary. Pass it with `--python` if `python3` is not the right environment.
- Captionless episodes need a faster-whisper environment passed with `--asr-python`.

Example with explicit Python environments:

```bash
pnpm corpus:update -- --python .venv/bin/python --asr-python .venv-asr/bin/python
```

Generated corpus data is written under `packages/corpus-data/data`, including `manifest.json`, `alignments/`, `reports/`, `episodes.json`, `segments/`, and `index/`.

For source overrides, debugging commands, and common options such as `--force`, `--retry-failed`, and `--no-refresh-sources`, see [packages/corpus-pipeline/README.md](packages/corpus-pipeline/README.md).
