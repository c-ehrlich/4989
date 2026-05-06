import { normalizeForAlignment } from "./normalizeText.js";

const MIN_NORMALIZED_UNIT_LENGTH = 12;

export type ScriptUnit = {
  index: number;
  blockIndex: number;
  text: string;
  normalizedText: string;
  normalizedReadingText?: string;
};

type RawScriptUnit = {
  blockIndex: number;
  text: string;
};

export function splitScriptSentences(scriptText: string): ScriptUnit[] {
  const rawUnits = scriptText
    .split(/\n+/)
    .flatMap((line, blockIndex): RawScriptUnit[] => {
      const trimmedLine = line.trim();
      return isStructuralLine(trimmedLine)
        ? []
        : splitLineIntoUnits(trimmedLine).map((text) => ({ blockIndex, text }));
    })
    .map((unit) => ({ ...unit, text: unit.text.trim() }))
    .filter((unit) => unit.text.length > 0 && !isStructuralLine(unit.text));

  return combineShortUnits(rawUnits)
    .map((unit) => ({
      ...unit,
      normalizedText: normalizeForAlignment(unit.text)
    }))
    .filter((unit) => unit.normalizedText.length > 0)
    .map((unit, index) => ({
      index,
      ...unit
    }));
}

function splitLineIntoUnits(line: string): string[] {
  const trimmedLine = line.trim();
  if (!trimmedLine) {
    return [];
  }

  const matches = trimmedLine.match(/[^。！？!?]+[。！？!?]+|[^。！？!?]+$/gu);
  return matches ?? [trimmedLine];
}

function isStructuralLine(text: string): boolean {
  return (
    /^[\-=ー―\s]+$/u.test(text) ||
    /^★/u.test(text) ||
    /^【.+】$/u.test(text) ||
    text === "What I miss about Japan"
  );
}

function combineShortUnits(units: RawScriptUnit[]): RawScriptUnit[] {
  const combined: RawScriptUnit[] = [];

  for (const unit of units) {
    const normalizedLength = normalizeForAlignment(unit.text).length;
    const previous = combined[combined.length - 1];

    if (
      previous !== undefined &&
      (normalizedLength < MIN_NORMALIZED_UNIT_LENGTH ||
        normalizeForAlignment(previous.text).length < MIN_NORMALIZED_UNIT_LENGTH)
    ) {
      combined[combined.length - 1] = {
        blockIndex: previous.blockIndex,
        text: `${previous.text}${unit.text}`
      };
      continue;
    }

    combined.push(unit);
  }

  return combined;
}
