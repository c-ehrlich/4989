import { makeSegmentId, makeSegmentKey, type CorpusSegment } from "@4989/corpus-types";

import type { CaptionLattice } from "./parseJson3Captions.js";
import type { ScriptUnit } from "./splitScriptSentences.js";

export type AlignmentIssue = {
  scriptIndex: number;
  text: string;
  normalizedText: string;
  reason: "empty-caption-lattice" | "no-candidate" | "below-threshold";
  confidence?: number;
};

export type CaptionAlignmentResult = {
  segments: CorpusSegment[];
  issues: AlignmentIssue[];
};

type Candidate = {
  start: number;
  end: number;
  confidence: number;
  score: number;
  lattice: CaptionLattice;
  matchKind: "surface" | "reading";
};

type DraftSegment = {
  scriptIndex: number;
  text: string;
  start: number;
  end: number;
  confidence: number;
  timingSource: "youtube-caption-lattice" | "interpolated-between-caption-matches";
};

const MIN_CONFIDENCE = 0.58;
const LOW_CONFIDENCE = 0.68;
const INTERPOLATED_CONFIDENCE = 0.25;
const MIN_INTERPOLATED_SEGMENT_SECONDS = 0.25;
const MAX_INTERPOLATED_SECONDS_PER_CHARACTER = 0.55;
const SEARCH_WINDOW_CHARACTERS = 2600;
const MAX_CANDIDATE_OCCURRENCES = 40;
const CONTEXT_WEIGHT = 0.45;
const PREVIOUS_CONTEXT_WEIGHT = 0.08;
const DISTANCE_PENALTY_WEIGHT = 0.18;
const SAME_BLOCK_JUMP_SECONDS = 75;
const SAME_BLOCK_JUMP_PENALTY = 0.2;

export function alignCaptionLattice(input: {
  episode: number;
  youtubeId: string;
  scriptUnits: ScriptUnit[];
  lattice: CaptionLattice;
  readingLattice?: CaptionLattice;
  lowConfidenceThreshold?: number;
}): CaptionAlignmentResult {
  const issues: AlignmentIssue[] = [];
  const directMatches: DraftSegment[] = [];

  for (const scriptUnit of input.scriptUnits) {
    if (input.lattice.text.length === 0) {
      issues.push({
        scriptIndex: scriptUnit.index,
        text: scriptUnit.text,
        normalizedText: scriptUnit.normalizedText,
        reason: "empty-caption-lattice"
      });
      continue;
    }

    const previousMatch = directMatches[directMatches.length - 1];
    const previousEnd = previousMatch?.end ?? 0;
    const previousScriptUnit = input.scriptUnits[scriptUnit.index - 1];
    const nextScriptUnits = collectNextContextUnits(input.scriptUnits, scriptUnit);
    const surfaceCursor = characterIndexAtOrAfterTime(input.lattice, Math.max(0, previousEnd - 1.5));
    const surfaceCandidate = findBestCandidate({
      needle: scriptUnit.normalizedText,
      lattice: input.lattice,
      cursor: surfaceCursor,
      previousEnd,
      blockIndex: scriptUnit.blockIndex,
      previousContext:
        previousScriptUnit?.blockIndex === scriptUnit.blockIndex
          ? previousScriptUnit.normalizedText
          : undefined,
      nextContext: nextScriptUnits.map((unit) => unit.normalizedText).join("")
    });
    const readingCursor = input.readingLattice
      ? characterIndexAtOrAfterTime(input.readingLattice, Math.max(0, previousEnd - 1.5))
      : 0;
    const readingCandidate =
      input.readingLattice && scriptUnit.normalizedReadingText
        ? findBestCandidate({
            needle: scriptUnit.normalizedReadingText,
            lattice: input.readingLattice,
            cursor: readingCursor,
            previousEnd,
            blockIndex: scriptUnit.blockIndex,
            previousContext:
              previousScriptUnit?.blockIndex === scriptUnit.blockIndex
                ? previousScriptUnit.normalizedReadingText
                : undefined,
            nextContext: nextScriptUnits
              .flatMap((unit) => unit.normalizedReadingText ?? [])
              .join("")
          })
        : undefined;
    const candidate = chooseCandidate(surfaceCandidate, readingCandidate);
    if (!candidate) {
      issues.push({
        scriptIndex: scriptUnit.index,
        text: scriptUnit.text,
        normalizedText: scriptUnit.normalizedText,
        reason: "no-candidate"
      });
      continue;
    }

    if (!isAcceptedCandidate(candidate)) {
      issues.push({
        scriptIndex: scriptUnit.index,
        text: scriptUnit.text,
        normalizedText: scriptUnit.normalizedText,
        reason: "below-threshold",
        confidence: candidate.confidence
      });
      continue;
    }

    const emittedStartIndex = candidate.start;
    if (emittedStartIndex >= candidate.end) {
      issues.push({
        scriptIndex: scriptUnit.index,
        text: scriptUnit.text,
        normalizedText: scriptUnit.normalizedText,
        reason: "no-candidate"
      });
      continue;
    }

    const startCharacter = candidate.lattice.characters[emittedStartIndex];
    const endCharacter = candidate.lattice.characters[Math.max(candidate.end - 1, emittedStartIndex)];
    if (!startCharacter || !endCharacter) {
      issues.push({
        scriptIndex: scriptUnit.index,
        text: scriptUnit.text,
        normalizedText: scriptUnit.normalizedText,
        reason: "no-candidate"
      });
      continue;
    }

    const start = roundSeconds(Math.max(startCharacter.start, previousEnd));
    const end = roundSeconds(Math.max(endCharacter.end, start + 0.25));

    directMatches.push({
      scriptIndex: scriptUnit.index,
      start,
      end,
      text: scriptUnit.text,
      confidence: roundConfidence(candidate.confidence),
      timingSource: "youtube-caption-lattice"
    });
  }

  const { drafts, remainingIssues } = interpolateBoundedIssues({
    directMatches,
    issues
  });
  const monotonicDrafts = enforceMonotonicDrafts(drafts);

  return {
    segments: monotonicDrafts.map((draft, localIndex): CorpusSegment => ({
      id: makeSegmentId(input.episode, localIndex),
      segmentKey: makeSegmentKey(input.episode, localIndex),
      episode: input.episode,
      localIndex,
      youtubeId: input.youtubeId,
      start: draft.start,
      end: draft.end,
      text: draft.text,
      confidence: draft.confidence,
      timingSource: draft.timingSource,
      tokens: []
    })),
    issues: remainingIssues
  };
}

function enforceMonotonicDrafts(drafts: DraftSegment[]): DraftSegment[] {
  let previousEnd = 0;

  return drafts.map((draft) => {
    const start = roundSeconds(Math.max(draft.start, previousEnd));
    const end = roundSeconds(Math.max(draft.end, start + MIN_INTERPOLATED_SEGMENT_SECONDS));
    previousEnd = end;

    return {
      ...draft,
      start,
      end
    };
  });
}

function interpolateBoundedIssues(input: {
  directMatches: DraftSegment[];
  issues: AlignmentIssue[];
}): {
  drafts: DraftSegment[];
  remainingIssues: AlignmentIssue[];
} {
  if (input.directMatches.length === 0) {
    return {
      drafts: [],
      remainingIssues: input.issues
    };
  }

  const issuesByScriptIndex = new Map(input.issues.map((issue) => [issue.scriptIndex, issue]));
  const remainingIssues = new Set(input.issues.map((issue) => issue.scriptIndex));
  const drafts: DraftSegment[] = [];

  for (let index = 0; index < input.directMatches.length; index += 1) {
    const currentMatch = input.directMatches[index] as DraftSegment;
    const nextMatch = input.directMatches[index + 1];

    if (!nextMatch) {
      drafts.push(currentMatch);
      continue;
    }

    const boundedIssues: AlignmentIssue[] = [];
    for (
      let scriptIndex = currentMatch.scriptIndex + 1;
      scriptIndex < nextMatch.scriptIndex;
      scriptIndex += 1
    ) {
      const issue = issuesByScriptIndex.get(scriptIndex);
      if (issue) {
        boundedIssues.push(issue);
      }
    }

    if (boundedIssues.length === 0) {
      drafts.push(currentMatch);
      continue;
    }

    const interpolated = interpolateIssueBlock({
      issues: boundedIssues,
      gapStart: currentMatch.end,
      gapEnd: nextMatch.start
    });
    const previousMatch = input.directMatches[index - 1];
    const borrowedInterpolated =
      interpolated.length === 0 && previousMatch
        ? interpolateBorrowedIssueBlock({
            currentMatch,
            issues: boundedIssues,
            gapStart: previousMatch.end,
            gapEnd: nextMatch.start
          })
        : [];

    if (borrowedInterpolated.length > 0) {
      drafts.push(...borrowedInterpolated);
      for (const draft of borrowedInterpolated) {
        remainingIssues.delete(draft.scriptIndex);
      }
      continue;
    }

    drafts.push(currentMatch);

    for (const draft of interpolated) {
      drafts.push(draft);
      remainingIssues.delete(draft.scriptIndex);
    }
  }

  const lastMatch = input.directMatches[input.directMatches.length - 1];
  if (lastMatch) {
    const trailingIssues = input.issues.filter((issue) => issue.scriptIndex > lastMatch.scriptIndex);
    if (trailingIssues.length > 0 && trailingIssues.length <= 3) {
      const interpolated = interpolateTrailingIssueBlock({
        issues: trailingIssues,
        gapStart: lastMatch.end
      });
      drafts.push(...interpolated);
      for (const draft of interpolated) {
        remainingIssues.delete(draft.scriptIndex);
      }
    }
  }

  return {
    drafts,
    remainingIssues: input.issues.filter((issue) => remainingIssues.has(issue.scriptIndex))
  };
}

function interpolateIssueBlock(input: {
  issues: AlignmentIssue[];
  gapStart: number;
  gapEnd: number;
}): DraftSegment[] {
  const gap = input.gapEnd - input.gapStart;
  const totalCharacters = input.issues.reduce(
    (sum, issue) => sum + Math.max(1, issue.normalizedText.length),
    0
  );

  if (
    gap < MIN_INTERPOLATED_SEGMENT_SECONDS * input.issues.length ||
    gap > Math.max(12, totalCharacters * MAX_INTERPOLATED_SECONDS_PER_CHARACTER)
  ) {
    return [];
  }

  const drafts: DraftSegment[] = [];
  let cursor = input.gapStart;

  for (const [index, issue] of input.issues.entries()) {
    const remainingIssues = input.issues.length - index;
    const remainingCharacters = input.issues
      .slice(index)
      .reduce((sum, remainingIssue) => sum + Math.max(1, remainingIssue.normalizedText.length), 0);
    const availableGap = input.gapEnd - cursor;
    const duration =
      index === input.issues.length - 1
        ? availableGap
        : Math.max(
            MIN_INTERPOLATED_SEGMENT_SECONDS,
            availableGap * (Math.max(1, issue.normalizedText.length) / remainingCharacters)
          );
    const start = roundSeconds(cursor);
    const end = roundSeconds(
      Math.min(
        input.gapEnd - MIN_INTERPOLATED_SEGMENT_SECONDS * (remainingIssues - 1),
        cursor + duration
      )
    );

    drafts.push({
      scriptIndex: issue.scriptIndex,
      text: issue.text,
      start,
      end: Math.max(roundSeconds(start + MIN_INTERPOLATED_SEGMENT_SECONDS), end),
      confidence: INTERPOLATED_CONFIDENCE,
      timingSource: "interpolated-between-caption-matches"
    });

    cursor = drafts[drafts.length - 1]?.end ?? cursor;
  }

  return drafts;
}

function interpolateBorrowedIssueBlock(input: {
  currentMatch: DraftSegment;
  issues: AlignmentIssue[];
  gapStart: number;
  gapEnd: number;
}): DraftSegment[] {
  const allIssues: AlignmentIssue[] = [
    {
      scriptIndex: input.currentMatch.scriptIndex,
      text: input.currentMatch.text,
      normalizedText: input.currentMatch.text,
      reason: "below-threshold",
      confidence: input.currentMatch.confidence
    },
    ...input.issues
  ];
  const gap = input.gapEnd - input.gapStart;
  const totalCharacters = allIssues.reduce(
    (sum, issue) => sum + Math.max(1, issue.normalizedText.length),
    0
  );

  if (
    input.issues.length > 12 ||
    gap < MIN_INTERPOLATED_SEGMENT_SECONDS * allIssues.length ||
    gap > Math.max(18, totalCharacters * MAX_INTERPOLATED_SECONDS_PER_CHARACTER)
  ) {
    return [];
  }

  return interpolateIssueBlock({
    issues: allIssues,
    gapStart: input.gapStart,
    gapEnd: input.gapEnd
  });
}

function interpolateTrailingIssueBlock(input: {
  issues: AlignmentIssue[];
  gapStart: number;
}): DraftSegment[] {
  const totalCharacters = input.issues.reduce(
    (sum, issue) => sum + Math.max(1, issue.normalizedText.length),
    0
  );
  const duration = Math.min(10, Math.max(input.issues.length, totalCharacters * 0.08));

  return interpolateIssueBlock({
    issues: input.issues,
    gapStart: input.gapStart,
    gapEnd: input.gapStart + duration
  });
}

function findBestCandidate(input: {
  needle: string;
  lattice: CaptionLattice;
  cursor: number;
  previousEnd: number;
  blockIndex: number;
  previousContext?: string;
  nextContext?: string;
}): Candidate | undefined {
  const { needle, lattice, cursor } = input;
  const haystack = lattice.text;
  if (!needle || !haystack) {
    return undefined;
  }

  const searchStart = Math.max(0, cursor - 25);
  const searchEnd = Math.min(haystack.length, searchStart + SEARCH_WINDOW_CHARACTERS + needle.length);
  const candidateStarts = collectCandidateStarts(needle, haystack, searchStart, searchEnd);
  let best: Candidate | undefined;

  for (const start of candidateStarts) {
    const minLength = Math.max(3, Math.floor(needle.length * 0.55));
    const maxLength = Math.min(
      haystack.length - start,
      Math.ceil(needle.length * 1.75) + 18
    );

    for (const length of candidateLengths(minLength, maxLength, needle.length)) {
      const end = start + length;
      const candidateText = haystack.slice(start, end);
      const confidence = similarity(needle, candidateText);
      const score = scoreCandidate({
        lattice,
        start,
        end,
        cursor,
        confidence,
        previousEnd: input.previousEnd,
        previousContext: input.previousContext,
        nextContext: input.nextContext
      });
      if (!best || score > best.score) {
        best = {
          start,
          end,
          confidence,
          score,
          lattice,
          matchKind: "surface"
        };
      }
    }
  }

  return best;
}

function chooseCandidate(
  surfaceCandidate: Candidate | undefined,
  readingCandidate: Candidate | undefined
): Candidate | undefined {
  if (surfaceCandidate && readingCandidate) {
    readingCandidate.matchKind = "reading";
    return readingCandidate.score > surfaceCandidate.score ? readingCandidate : surfaceCandidate;
  }

  if (readingCandidate) {
    readingCandidate.matchKind = "reading";
  }

  return surfaceCandidate ?? readingCandidate;
}

function isAcceptedCandidate(candidate: Candidate): boolean {
  return candidate.confidence >= MIN_CONFIDENCE || candidate.score >= MIN_CONFIDENCE + 0.05;
}

function scoreCandidate(input: {
  lattice: CaptionLattice;
  start: number;
  end: number;
  cursor: number;
  confidence: number;
  previousEnd: number;
  previousContext?: string;
  nextContext?: string;
}): number {
  const distance = Math.max(0, input.start - input.cursor);
  const distancePenalty =
    (Math.min(distance, SEARCH_WINDOW_CHARACTERS) / SEARCH_WINDOW_CHARACTERS) *
    DISTANCE_PENALTY_WEIGHT;
  const startTime = input.lattice.characters[input.start]?.start ?? input.previousEnd;
  const jumpSeconds = Math.max(0, startTime - input.previousEnd);
  const sameBlockJumpPenalty = jumpSeconds > SAME_BLOCK_JUMP_SECONDS ? SAME_BLOCK_JUMP_PENALTY : 0;
  const previousContextScore = contextSimilarity({
    haystack: input.lattice.text,
    context: input.previousContext,
    start: Math.max(0, input.start - contextWindowLength(input.previousContext)),
    end: input.start
  });
  const nextContextScore = contextSimilarity({
    haystack: input.lattice.text,
    context: input.nextContext,
    start: input.end,
    end: Math.min(input.lattice.text.length, input.end + contextWindowLength(input.nextContext))
  });

  return (
    input.confidence +
    PREVIOUS_CONTEXT_WEIGHT * previousContextScore +
    CONTEXT_WEIGHT * nextContextScore -
    distancePenalty -
    sameBlockJumpPenalty
  );
}

function contextSimilarity(input: {
  haystack: string;
  context: string | undefined;
  start: number;
  end: number;
}): number {
  if (!input.context || input.context.length < 6 || input.start >= input.end) {
    return 0;
  }

  return similarity(
    input.context.slice(0, Math.min(input.context.length, 120)),
    input.haystack.slice(input.start, input.end)
  );
}

function contextWindowLength(context: string | undefined): number {
  return Math.max(30, Math.min(220, Math.ceil((context?.length ?? 0) * 1.8) + 24));
}

function characterIndexAtOrAfterTime(lattice: CaptionLattice, time: number): number {
  const index = lattice.characters.findIndex((character) => character.end >= time);
  return index < 0 ? Math.max(0, lattice.characters.length - 1) : index;
}

function collectNextContextUnits(scriptUnits: ScriptUnit[], scriptUnit: ScriptUnit): ScriptUnit[] {
  const units: ScriptUnit[] = [];
  for (let index = scriptUnit.index + 1; index < scriptUnits.length; index += 1) {
    const candidate = scriptUnits[index];
    if (!candidate || candidate.blockIndex !== scriptUnit.blockIndex) {
      break;
    }

    units.push(candidate);
    if (units.reduce((sum, unit) => sum + unit.normalizedText.length, 0) >= 80) {
      break;
    }
  }

  return units;
}

function collectCandidateStarts(
  needle: string,
  haystack: string,
  searchStart: number,
  searchEnd: number
): number[] {
  const starts = new Set<number>();
  const anchors = buildAnchors(needle);

  for (const anchor of anchors) {
    let occurrence = haystack.indexOf(anchor.text, searchStart);
    let count = 0;
    while (occurrence >= 0 && occurrence < searchEnd && count < MAX_CANDIDATE_OCCURRENCES) {
      starts.add(Math.max(0, occurrence - anchor.offset));
      occurrence = haystack.indexOf(anchor.text, occurrence + 1);
      count += 1;
    }
  }

  if (starts.size === 0) {
    const stride = Math.max(1, Math.floor(needle.length / 3));
    for (let start = searchStart; start < searchEnd; start += stride) {
      starts.add(start);
    }
  }

  return [...starts].sort((left, right) => left - right);
}

function buildAnchors(needle: string): { text: string; offset: number }[] {
  const anchorLength = Math.min(8, Math.max(3, Math.floor(needle.length / 3)));
  const offsets = Array.from(
    new Set([
      0,
      Math.max(0, Math.floor((needle.length - anchorLength) / 2)),
      Math.max(0, needle.length - anchorLength)
    ])
  );

  return offsets
    .map((offset) => ({
      text: needle.slice(offset, offset + anchorLength),
      offset
    }))
    .filter((anchor) => anchor.text.length >= 3);
}

function lengthStep(needleLength: number): number {
  if (needleLength < 18) {
    return 1;
  }

  if (needleLength < 50) {
    return 2;
  }

  return 4;
}

function candidateLengths(minLength: number, maxLength: number, targetLength: number): number[] {
  const lengths = new Set<number>();
  const step = lengthStep(targetLength);

  for (let length = minLength; length <= maxLength; length += step) {
    lengths.add(length);
  }

  if (targetLength >= minLength && targetLength <= maxLength) {
    lengths.add(targetLength);
  }

  return [...lengths].sort((left, right) => left - right);
}

function similarity(left: string, right: string): number {
  if (left === right) {
    return 1;
  }

  return 0.65 * lcsSimilarity(left, right) + 0.35 * diceSimilarity(left, right);
}

function lcsSimilarity(left: string, right: string): number {
  if (!left || !right) {
    return 0;
  }

  const previous = new Array<number>(right.length + 1).fill(0);
  const current = new Array<number>(right.length + 1).fill(0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] =
        left[leftIndex - 1] === right[rightIndex - 1]
          ? (previous[rightIndex - 1] as number) + 1
          : Math.max(previous[rightIndex] as number, current[rightIndex - 1] as number);
    }

    for (let index = 0; index < current.length; index += 1) {
      previous[index] = current[index] as number;
      current[index] = 0;
    }
  }

  const lcsLength = previous[right.length] as number;
  return (2 * lcsLength) / (left.length + right.length);
}

function diceSimilarity(left: string, right: string): number {
  const leftBigrams = countBigrams(left);
  const rightBigrams = countBigrams(right);
  let intersection = 0;
  let leftCount = 0;
  let rightCount = 0;

  for (const count of leftBigrams.values()) {
    leftCount += count;
  }

  for (const [bigram, count] of rightBigrams.entries()) {
    rightCount += count;
    intersection += Math.min(leftBigrams.get(bigram) ?? 0, count);
  }

  if (leftCount === 0 || rightCount === 0) {
    return left === right ? 1 : 0;
  }

  return (2 * intersection) / (leftCount + rightCount);
}

function countBigrams(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  if (value.length < 2) {
    counts.set(value, 1);
    return counts;
  }

  for (let index = 0; index < value.length - 1; index += 1) {
    const bigram = value.slice(index, index + 2);
    counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
  }

  return counts;
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundConfidence(value: number): number {
  return Math.round(value * 1000) / 1000;
}
