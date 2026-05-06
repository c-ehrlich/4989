import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { makeEpisodeKey } from "@4989/corpus-types";

const execFileAsync = promisify(execFile);
const DEFAULT_ASR_BUFFER_BYTES = 64 * 1024 * 1024;
const DEFAULT_ASR_MODEL = "base";

export type AsrTranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

export type AsrTranscript = {
  engine: "faster-whisper";
  model: string;
  language: string;
  audioPath: string;
  generatedAt: string;
  segments: AsrTranscriptSegment[];
};

export type TranscribeAudioOptions = {
  episode: number;
  audioPath: string;
  workDirectory: string;
  pythonPath: string;
  model?: string;
  force?: boolean;
};

export async function transcribeAudioWithFasterWhisper(
  options: TranscribeAudioOptions
): Promise<{ transcript: AsrTranscript; transcriptPath: string; transcriptText: string }> {
  const model = options.model ?? DEFAULT_ASR_MODEL;
  const episodeKey = makeEpisodeKey(options.episode);
  const asrDirectory = resolve(options.workDirectory, "asr");
  const transcriptPath = resolve(
    asrDirectory,
    `${episodeKey}.faster-whisper-${sanitizePathPart(model)}.json`
  );

  await mkdir(asrDirectory, { recursive: true });

  if (!options.force && (await fileExists(transcriptPath))) {
    const transcriptText = await readFile(transcriptPath, "utf8");
    return {
      transcript: parseAsrTranscriptText(transcriptText, transcriptPath),
      transcriptPath,
      transcriptText
    };
  }

  const transcript = await runFasterWhisper({
    audioPath: options.audioPath,
    pythonPath: options.pythonPath,
    model
  });
  const transcriptText = `${JSON.stringify(transcript, null, 2)}\n`;
  await writeFile(transcriptPath, transcriptText, "utf8");

  return {
    transcript,
    transcriptPath,
    transcriptText
  };
}

async function runFasterWhisper(input: {
  audioPath: string;
  pythonPath: string;
  model: string;
}): Promise<AsrTranscript> {
  const { stdout } = await execFileAsync(
    input.pythonPath,
    [
      "-c",
      `
import json
import sys
from datetime import datetime, timezone
from faster_whisper import WhisperModel

audio_path = sys.argv[1]
model_name = sys.argv[2]
model = WhisperModel(model_name, device="cpu", compute_type="int8")
segments, info = model.transcribe(audio_path, language="ja", vad_filter=True)
payload = {
    "engine": "faster-whisper",
    "model": model_name,
    "language": getattr(info, "language", "ja") or "ja",
    "audioPath": audio_path,
    "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "segments": [
        {"start": float(segment.start), "end": float(segment.end), "text": segment.text.strip()}
        for segment in segments
        if segment.text and segment.text.strip()
    ],
}
print(json.dumps(payload, ensure_ascii=False))
      `.trim(),
      input.audioPath,
      input.model
    ],
    {
      encoding: "utf8",
      maxBuffer: DEFAULT_ASR_BUFFER_BYTES
    }
  );

  return parseAsrTranscriptText(stdout, "faster-whisper stdout");
}

export function parseAsrTranscriptText(text: string, source: string): AsrTranscript {
  const value = JSON.parse(extractJsonObject(text, source)) as unknown;
  if (!isRecord(value)) {
    throw new Error(`ASR transcript must be an object: ${source}`);
  }

  const segments = Array.isArray(value.segments) ? value.segments : [];
  return {
    engine: "faster-whisper",
    model: readString(value.model, "model", source),
    language: readString(value.language, "language", source),
    audioPath: readString(value.audioPath, "audioPath", source),
    generatedAt: readString(value.generatedAt, "generatedAt", source),
    segments: segments.flatMap((segment, index) => parseAsrSegment(segment, index, source))
  };
}

function extractJsonObject(text: string, source: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line && line.startsWith("{") && line.endsWith("}")) {
      return line;
    }
  }

  throw new Error(`ASR transcript did not contain a JSON payload: ${source}`);
}

function parseAsrSegment(
  value: unknown,
  index: number,
  source: string
): AsrTranscriptSegment[] {
  if (!isRecord(value)) {
    return [];
  }

  const start = readFiniteNumber(value.start);
  const end = readFiniteNumber(value.end);
  const text = typeof value.text === "string" ? value.text.trim() : "";
  if (start === undefined || end === undefined || end <= start || text.length === 0) {
    throw new Error(`Invalid ASR segment ${index} in ${source}`);
  }

  return [{ start, end, text }];
}

function readString(value: unknown, field: string, source: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`ASR transcript missing ${field}: ${source}`);
  }

  return value;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
