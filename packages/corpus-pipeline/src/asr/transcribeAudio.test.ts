import { describe, expect, it } from "vitest";

import { parseAsrTranscriptCaptions } from "../align/parseAsrTranscript.js";
import { parseAsrTranscriptText } from "./transcribeAudio.js";

describe("parseAsrTranscriptText", () => {
  it("extracts the transcript JSON from noisy faster-whisper stdout", () => {
    const transcript = parseAsrTranscriptText(
      [
        "Downloading model files...",
        JSON.stringify({
          engine: "faster-whisper",
          model: "base",
          language: "ja",
          audioPath: "/tmp/ep344.m4a",
          generatedAt: "2026-05-06T00:00:00.000Z",
          segments: [
            { start: 1, end: 2.5, text: "漢字です。" },
            { start: 3, end: 4, text: "次です。" }
          ]
        })
      ].join("\n"),
      "test stdout"
    );

    expect(transcript.model).toBe("base");
    expect(transcript.segments).toHaveLength(2);

    const lattice = parseAsrTranscriptCaptions(transcript);
    expect(lattice.cues).toEqual([
      { text: "漢字です。", start: 1, end: 2.5 },
      { text: "次です。", start: 3, end: 4 }
    ]);
    expect(lattice.text).toContain("漢字です");
    expect(lattice.characters[0]).toMatchObject({ value: "漢", start: 1 });
  });
});
