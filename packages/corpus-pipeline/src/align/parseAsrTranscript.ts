import type { AsrTranscript } from "../asr/transcribeAudio.js";
import { normalizeAlignmentCharacter } from "./normalizeText.js";
import type { CaptionCharacter, CaptionCue, CaptionLattice } from "./parseJson3Captions.js";

export function parseAsrTranscriptCaptions(transcript: AsrTranscript): CaptionLattice {
  const cues: CaptionCue[] = [];
  const characters: CaptionCharacter[] = [];

  for (const segment of transcript.segments) {
    cues.push({
      text: segment.text,
      start: segment.start,
      end: segment.end
    });
    appendCaptionCharacters(characters, segment.text, segment.start, segment.end);
  }

  return {
    text: characters.map((character) => character.value).join(""),
    characters,
    cues
  };
}

function appendCaptionCharacters(
  output: CaptionCharacter[],
  rawText: string,
  start: number,
  end: number
): void {
  const normalizedCharacters = Array.from(rawText)
    .flatMap((character) => Array.from(normalizeAlignmentCharacter(character)))
    .filter((character) => character.length > 0);

  if (normalizedCharacters.length === 0) {
    return;
  }

  const safeEnd = Math.max(end, start + 0.05);
  const characterDuration = (safeEnd - start) / normalizedCharacters.length;

  normalizedCharacters.forEach((character, index) => {
    output.push({
      value: character.toLowerCase(),
      start: start + characterDuration * index,
      end: start + characterDuration * (index + 1)
    });
  });
}
