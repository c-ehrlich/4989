# Sudachi Tokenization Runtime

`process-episode` requires Python with SudachiPy and a Sudachi dictionary.

Recommended local setup from the repo root:

```bash
python3.13 -m venv .work/4989/sudachi-venv
.work/4989/sudachi-venv/bin/python -m pip install --upgrade pip
.work/4989/sudachi-venv/bin/python -m pip install -r packages/corpus-pipeline/python/requirements-sudachi.txt
```

Run the pipeline with:

```bash
pnpm --filter @4989/corpus-pipeline process-episode -- --episode 367 --python .work/4989/sudachi-venv/bin/python
```

Run the optional tokenizer integration test with:

```bash
SUDACHI_PYTHON="$(pwd)/.work/4989/sudachi-venv/bin/python" pnpm --filter @4989/corpus-pipeline test
```

The default `python3` on some machines may be newer than SudachiPy's binary wheel support. Use a Python version with a published wheel, such as Python 3.13, unless the pinned SudachiPy release has been updated.
