import { normalizeForAlignment } from "./normalizeText.js";

const MIN_NORMALIZED_UNIT_LENGTH = 12;

export type ScriptUnit = {
  index: number;
  text: string;
  normalizedText: string;
};

export function splitScriptSentences(scriptText: string): ScriptUnit[] {
  const rawUnits = scriptText
    .split(/\n+/)
    .flatMap((line) => {
      const trimmedLine = line.trim();
      return isStructuralLine(trimmedLine) ? [] : splitLineIntoUnits(trimmedLine);
    })
    .map((text) => text.trim())
    .filter((text) => text.length > 0 && !isStructuralLine(text));

  return combineShortUnits(rawUnits)
    .map((text) => ({
      text,
      normalizedText: normalizeForAlignment(text)
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
    /^【.+】$/u.test(text)
  );
}

function combineShortUnits(units: string[]): string[] {
  const combined: string[] = [];

  for (const unit of units) {
    const normalizedLength = normalizeForAlignment(unit).length;
    const previous = combined[combined.length - 1];

    if (
      previous !== undefined &&
      (normalizedLength < MIN_NORMALIZED_UNIT_LENGTH ||
        normalizeForAlignment(previous).length < MIN_NORMALIZED_UNIT_LENGTH)
    ) {
      combined[combined.length - 1] = `${previous}${unit}`;
      continue;
    }

    combined.push(unit);
  }

  return combined;
}
