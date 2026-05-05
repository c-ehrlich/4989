export function normalizeForAlignment(value: string): string {
  return Array.from(value.normalize("NFKC"))
    .map((character) => normalizeAlignmentCharacter(character))
    .filter((character) => character.length > 0)
    .join("")
    .toLowerCase();
}

export function normalizeAlignmentCharacter(character: string): string {
  const normalized = character.normalize("NFKC");
  if (!normalized.trim()) {
    return "";
  }

  return Array.from(normalized)
    .filter((normalizedCharacter) => /[\p{Letter}\p{Number}ー]/u.test(normalizedCharacter))
    .join("");
}

