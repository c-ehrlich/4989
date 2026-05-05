import { spawn } from "node:child_process";

import type { CorpusToken } from "@4989/corpus-types";

export type TokenizeJapaneseOptions = {
  pythonPath?: string;
};

const PYTHON_TOKENIZER = String.raw`
import json
import sys

try:
    from sudachipy import dictionary
    from sudachipy import tokenizer
except Exception as error:
    raise SystemExit(f"SudachiPy is required for tokenization: {error}")

texts = json.load(sys.stdin)
tokenizer_obj = dictionary.Dictionary().create()
mode = tokenizer.Tokenizer.SplitMode.C
output = []

for text in texts:
    tokens = []
    for morph in tokenizer_obj.tokenize(text, mode):
        surface = morph.surface()
        if not surface or not surface.strip():
            continue
        lemma = morph.dictionary_form()
        if not lemma or lemma == "*":
            lemma = surface
        pos = [part for part in morph.part_of_speech() if part and part != "*"]
        if not pos:
            pos = ["unknown"]
        token = {
            "surface": surface,
            "lemma": lemma,
            "pos": pos,
        }
        reading = morph.reading_form()
        if reading and reading != "*":
            token["reading"] = reading
        tokens.append(token)
    output.append(tokens)

json.dump(output, sys.stdout, ensure_ascii=False)
`;

export async function tokenizeJapaneseTexts(
  texts: string[],
  options: TokenizeJapaneseOptions = {}
): Promise<CorpusToken[][]> {
  if (texts.length === 0) {
    return [];
  }

  const pythonPath = options.pythonPath ?? process.env.SUDACHI_PYTHON ?? "python3";
  const stdout = await runPythonTokenizer(pythonPath, texts);
  const parsed = JSON.parse(stdout) as unknown;

  if (!Array.isArray(parsed) || parsed.length !== texts.length) {
    throw new Error("Sudachi tokenizer returned an invalid token array");
  }

  return parsed.map((tokens) => {
    if (!Array.isArray(tokens)) {
      throw new Error("Sudachi tokenizer returned an invalid token entry");
    }

    return tokens.map((token) => normalizeToken(token));
  });
}

function runPythonTokenizer(pythonPath: string, texts: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, ["-c", PYTHON_TOKENIZER], {
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(
        new Error(
          `Sudachi tokenizer failed with exit code ${code ?? "unknown"}${stderr ? `: ${stderr.trim()}` : ""}`
        )
      );
    });

    child.stdin.end(JSON.stringify(texts));
  });
}

function normalizeToken(value: unknown): CorpusToken {
  if (!isRecord(value)) {
    throw new Error("Sudachi tokenizer returned a non-object token");
  }

  const surface = readString(value.surface, "surface");
  const lemma = readString(value.lemma, "lemma");
  const pos = Array.isArray(value.pos)
    ? value.pos.map((part) => readString(part, "pos"))
    : undefined;

  if (!pos || pos.length === 0) {
    throw new Error("Sudachi tokenizer returned a token without part-of-speech data");
  }

  const token: CorpusToken = {
    surface,
    lemma,
    pos
  };

  if (typeof value.reading === "string" && value.reading.length > 0) {
    token.reading = value.reading;
  }

  return token;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Sudachi tokenizer returned an invalid ${field}`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

