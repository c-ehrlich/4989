import { normalizeAlignmentCharacter } from "./normalizeText.js";

export type CaptionCharacter = {
  value: string;
  start: number;
  end: number;
};

export type CaptionCue = {
  text: string;
  start: number;
  end: number;
};

export type CaptionLattice = {
  text: string;
  characters: CaptionCharacter[];
  cues: CaptionCue[];
};

type Json3Caption = {
  events?: unknown;
};

type Json3Event = {
  tStartMs?: unknown;
  dDurationMs?: unknown;
  segs?: unknown;
};

type Json3Segment = {
  utf8?: unknown;
  tOffsetMs?: unknown;
};

export function parseJson3Captions(value: unknown): CaptionLattice {
  if (!isRecord(value)) {
    throw new Error("Caption JSON must be an object");
  }

  const events = Array.isArray((value as Json3Caption).events)
    ? ((value as Json3Caption).events as unknown[])
    : [];
  const cues: CaptionCue[] = [];
  const characters: CaptionCharacter[] = [];

  for (const [eventIndex, rawEvent] of events.entries()) {
    if (!isRecord(rawEvent) || !Array.isArray((rawEvent as Json3Event).segs)) {
      continue;
    }

    const startMs = readFiniteNumber((rawEvent as Json3Event).tStartMs);
    if (startMs === undefined) {
      continue;
    }

    const durationMs = readFiniteNumber((rawEvent as Json3Event).dDurationMs);
    const nextEventStartMs = findNextEventStartMs(events, eventIndex);
    const fallbackEndMs = nextEventStartMs ?? startMs + 3000;
    const endMs = durationMs !== undefined ? startMs + durationMs : fallbackEndMs;
    const eventStart = startMs / 1000;
    const eventEnd = Math.max(endMs / 1000, eventStart + 0.1);
    const segments = ((rawEvent as Json3Event).segs as unknown[]).filter(isRecord);
    const cueText = segments
      .map((segment) => (typeof (segment as Json3Segment).utf8 === "string" ? (segment as Json3Segment).utf8 : ""))
      .join("")
      .replace(/\n/g, "");

    if (cueText.trim().length === 0) {
      continue;
    }

    cues.push({
      text: cueText,
      start: eventStart,
      end: eventEnd
    });

    for (const [segmentIndex, segment] of segments.entries()) {
      const segmentText = (segment as Json3Segment).utf8;
      const rawText = typeof segmentText === "string" ? segmentText : "";
      if (!rawText || rawText === "\n") {
        continue;
      }

      const segmentStartMs =
        startMs + (readFiniteNumber((segment as Json3Segment).tOffsetMs) ?? 0);
      const nextSegment = segments[segmentIndex + 1] as Json3Segment | undefined;
      const nextOffsetMs = readFiniteNumber(nextSegment?.tOffsetMs);
      const segmentEndMs =
        nextOffsetMs !== undefined ? startMs + nextOffsetMs : endMs;
      appendCaptionCharacters(characters, rawText, segmentStartMs / 1000, segmentEndMs / 1000);
    }
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

function findNextEventStartMs(events: unknown[], eventIndex: number): number | undefined {
  for (let index = eventIndex + 1; index < events.length; index += 1) {
    const event = events[index];
    if (!isRecord(event)) {
      continue;
    }

    const startMs = readFiniteNumber((event as Json3Event).tStartMs);
    if (startMs !== undefined) {
      return startMs;
    }
  }

  return undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
