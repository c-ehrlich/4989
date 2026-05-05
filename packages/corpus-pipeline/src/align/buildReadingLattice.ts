import type { CaptionLattice } from "./parseJson3Captions.js";
import { normalizeForAlignment } from "./normalizeText.js";

export function buildReadingCaptionLattice(
  lattice: CaptionLattice,
  cueReadings: string[]
): CaptionLattice {
  const characters: CaptionLattice["characters"] = [];
  const cues: CaptionLattice["cues"] = [];

  lattice.cues.forEach((cue, index) => {
    const normalizedReading = normalizeForAlignment(cueReadings[index] ?? "");
    if (normalizedReading.length === 0) {
      return;
    }

    cues.push({
      text: normalizedReading,
      start: cue.start,
      end: cue.end
    });

    const safeEnd = Math.max(cue.end, cue.start + 0.05);
    const characterDuration = (safeEnd - cue.start) / normalizedReading.length;
    Array.from(normalizedReading).forEach((character, characterIndex) => {
      characters.push({
        value: character,
        start: cue.start + characterDuration * characterIndex,
        end: cue.start + characterDuration * (characterIndex + 1)
      });
    });
  });

  return {
    text: characters.map((character) => character.value).join(""),
    characters,
    cues
  };
}
