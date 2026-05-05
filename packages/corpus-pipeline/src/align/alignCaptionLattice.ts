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
  scriptIndex: number;
  blockIndex: number;
  start: number;
  end: number;
  startTime: number;
  endTime: number;
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
const MAX_CANDIDATE_OCCURRENCES = 80;
const MAX_CANDIDATES_PER_UNIT = 12;
const MAX_GLOBAL_STATES = 120;
const GLOBAL_CANDIDATE_MIN_CONFIDENCE = 0.2;
const MATCH_REWARD = 0.15;
const SKIP_PENALTY = 0.45;
const CONTEXT_WEIGHT = 0.18;
const PREVIOUS_CONTEXT_WEIGHT = 0.05;
const DISTANCE_PENALTY_WEIGHT = 0.18;
const SAME_BLOCK_JUMP_SECONDS = 75;
const SAME_BLOCK_JUMP_PENALTY = 0.2;
const LONG_JUMP_SECONDS = 120;
const LONG_JUMP_PENALTY = 0.25;
const MONOTONIC_TOLERANCE_SECONDS = 0.01;

type AlignmentState = {
  score: number;
  lastEndTime: number;
  lastBlockIndex?: number;
  path: Array<DraftSegment | undefined>;
};

export function alignCaptionLattice(input: {
  episode: number;
  youtubeId: string;
  scriptUnits: ScriptUnit[];
  lattice: CaptionLattice;
  readingLattice?: CaptionLattice;
  lowConfidenceThreshold?: number;
}): CaptionAlignmentResult {
  const candidateGroups = input.scriptUnits.map((scriptUnit) => {
    if (input.lattice.text.length === 0) {
      return [];
    }

    const previousScriptUnit = input.scriptUnits[scriptUnit.index - 1];
    const nextScriptUnits = collectNextContextUnits(input.scriptUnits, scriptUnit);
    const surfaceCandidates = collectCandidates({
      scriptIndex: scriptUnit.index,
      blockIndex: scriptUnit.blockIndex,
      needle: scriptUnit.normalizedText,
      lattice: input.lattice,
      previousContext:
        previousScriptUnit?.blockIndex === scriptUnit.blockIndex
          ? previousScriptUnit.normalizedText
          : undefined,
      nextContext: nextScriptUnits.map((unit) => unit.normalizedText).join("")
    });
    const readingCandidates =
      input.readingLattice && scriptUnit.normalizedReadingText
        ? collectCandidates({
            scriptIndex: scriptUnit.index,
            blockIndex: scriptUnit.blockIndex,
            needle: scriptUnit.normalizedReadingText,
            lattice: input.readingLattice,
            previousContext:
              previousScriptUnit?.blockIndex === scriptUnit.blockIndex
                ? previousScriptUnit.normalizedReadingText
                : undefined,
            nextContext: nextScriptUnits
              .flatMap((unit) => unit.normalizedReadingText ?? [])
              .join("")
          })
        : [];

    return mergeCandidates([...surfaceCandidates, ...readingCandidates]);
  });
  const localMatches = selectLocalPath(input.scriptUnits, candidateGroups);
  const directMatches = rescueUnmatchedWindows(input.scriptUnits, candidateGroups, localMatches);
  const issues = buildAlignmentIssues({
    scriptUnits: input.scriptUnits,
    candidateGroups,
    directMatches,
    emptyLattice: input.lattice.text.length === 0
  });


  const { drafts, remainingIssues } = interpolateBoundedIssues({
    directMatches,
    issues
  });

  return {
    segments: drafts.map((draft, localIndex): CorpusSegment => ({
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

function selectGlobalPath(
  scriptUnits: ScriptUnit[],
  candidateGroups: Candidate[][],
  options: {
    initialEndTime?: number;
    maxEndTime?: number;
  } = {}
): DraftSegment[] {
  let states: AlignmentState[] = [
    {
      score: 0,
      lastEndTime: options.initialEndTime ?? 0,
      path: []
    }
  ];

  for (const scriptUnit of scriptUnits) {
    const candidates = candidateGroups[scriptUnit.index] ?? [];
    const nextStates: AlignmentState[] = [];

    for (const state of states) {
      nextStates.push({
        score: state.score - SKIP_PENALTY,
        lastEndTime: state.lastEndTime,
        lastBlockIndex: state.lastBlockIndex,
        path: [...state.path, undefined]
      });

      for (const candidate of candidates) {
        if (candidate.startTime < state.lastEndTime - MONOTONIC_TOLERANCE_SECONDS) {
          continue;
        }
        if (options.maxEndTime !== undefined && candidate.endTime > options.maxEndTime + 0.25) {
          continue;
        }

        const start = roundSeconds(Math.max(candidate.startTime, state.lastEndTime));
        const end = roundSeconds(Math.max(candidate.endTime, start + 0.25));
        const jumpPenalty = transitionJumpPenalty(state, candidate);
        nextStates.push({
          score: state.score + candidate.score + MATCH_REWARD - jumpPenalty,
          lastEndTime: end,
          lastBlockIndex: candidate.blockIndex,
          path: [
            ...state.path,
            {
              scriptIndex: scriptUnit.index,
              start,
              end,
              text: scriptUnit.text,
              confidence: roundConfidence(candidate.confidence),
              timingSource: "youtube-caption-lattice"
            }
          ]
        });
      }
    }

    states = pruneStates(nextStates);
  }

  const bestState = states.sort((left, right) => right.score - left.score)[0];
  return (bestState?.path ?? []).flatMap((draft) => (draft ? [draft] : []));
}

function selectLocalPath(scriptUnits: ScriptUnit[], candidateGroups: Candidate[][]): DraftSegment[] {
  const drafts: DraftSegment[] = [];

  for (const scriptUnit of scriptUnits) {
    const previousEnd = drafts[drafts.length - 1]?.end ?? 0;
    const candidate = (candidateGroups[scriptUnit.index] ?? [])
      .filter((candidate) => candidate.startTime >= previousEnd - MONOTONIC_TOLERANCE_SECONDS)
      .map((candidate) => ({
        candidate,
        transitionScore:
          candidate.score -
          transitionJumpPenalty(
            {
              score: 0,
              lastEndTime: previousEnd,
              lastBlockIndex: drafts[drafts.length - 1]?.scriptIndex === scriptUnit.index - 1
                ? scriptUnit.blockIndex
                : undefined,
              path: []
            },
            candidate
          )
      }))
      .sort(
        (left, right) =>
          right.transitionScore - left.transitionScore ||
          right.candidate.confidence - left.candidate.confidence
      )[0]?.candidate;

    if (!candidate || !isAcceptedLocalCandidate(candidate)) {
      continue;
    }

    const start = roundSeconds(Math.max(candidate.startTime, previousEnd));
    const end = roundSeconds(Math.max(candidate.endTime, start + 0.25));
    drafts.push({
      scriptIndex: scriptUnit.index,
      start,
      end,
      text: scriptUnit.text,
      confidence: roundConfidence(candidate.confidence),
      timingSource: "youtube-caption-lattice"
    });
  }

  return drafts;
}

function rescueUnmatchedWindows(
  scriptUnits: ScriptUnit[],
  candidateGroups: Candidate[][],
  localMatches: DraftSegment[]
): DraftSegment[] {
  let matches = localMatches;
  const unmatchedGroups = collectUnmatchedGroups(scriptUnits, matches);

  for (const group of unmatchedGroups) {
    const windowStart = Math.max(0, group.start - 1);
    const windowEnd = Math.min(scriptUnits.length - 1, group.end + 1);
    const anchorBefore = [...matches].reverse().find((match) => match.scriptIndex < windowStart);
    const anchorAfter = matches.find((match) => match.scriptIndex > windowEnd);
    const currentWindowMatches = matches.filter(
      (match) => match.scriptIndex >= windowStart && match.scriptIndex <= windowEnd
    );
    const windowUnits = scriptUnits.slice(windowStart, windowEnd + 1);
    const rescuedWindowMatches = selectGlobalPath(windowUnits, candidateGroups, {
      initialEndTime: anchorBefore?.end ?? 0,
      maxEndTime: anchorAfter?.start
    });

    if (rescuedWindowMatches.length <= currentWindowMatches.length) {
      continue;
    }

    matches = [
      ...matches.filter(
        (match) => match.scriptIndex < windowStart || match.scriptIndex > windowEnd
      ),
      ...rescuedWindowMatches
    ].sort((left, right) => left.scriptIndex - right.scriptIndex);
  }

  return matches;
}

function collectUnmatchedGroups(
  scriptUnits: ScriptUnit[],
  matches: DraftSegment[]
): Array<{ start: number; end: number }> {
  const matchedIndexes = new Set(matches.map((match) => match.scriptIndex));
  const groups: Array<{ start: number; end: number }> = [];
  let current: { start: number; end: number } | undefined;

  for (const scriptUnit of scriptUnits) {
    if (matchedIndexes.has(scriptUnit.index)) {
      if (current) {
        groups.push(current);
        current = undefined;
      }
      continue;
    }

    if (!current) {
      current = { start: scriptUnit.index, end: scriptUnit.index };
    } else {
      current.end = scriptUnit.index;
    }
  }

  if (current) {
    groups.push(current);
  }

  return groups;
}

function transitionJumpPenalty(state: AlignmentState, candidate: Candidate): number {
  if (state.lastBlockIndex === undefined) {
    return 0;
  }

  const jumpSeconds = Math.max(0, candidate.startTime - state.lastEndTime);
  const sameBlockPenalty =
    state.lastBlockIndex === candidate.blockIndex && jumpSeconds > SAME_BLOCK_JUMP_SECONDS
      ? SAME_BLOCK_JUMP_PENALTY
      : 0;
  const longJumpPenalty =
    jumpSeconds > LONG_JUMP_SECONDS
      ? Math.min(0.6, (jumpSeconds / LONG_JUMP_SECONDS) * LONG_JUMP_PENALTY)
      : 0;

  return sameBlockPenalty + longJumpPenalty;
}

function isAcceptedLocalCandidate(candidate: Candidate): boolean {
  return candidate.confidence >= MIN_CONFIDENCE || candidate.score >= MIN_CONFIDENCE + 0.05;
}

function pruneStates(states: AlignmentState[]): AlignmentState[] {
  const bestByTime = new Map<string, AlignmentState>();

  for (const state of states) {
    const timeBucket = Math.floor(state.lastEndTime / 8);
    const key = `${state.lastBlockIndex ?? "none"}:${timeBucket}`;
    const previous = bestByTime.get(key);
    if (!previous || state.score > previous.score) {
      bestByTime.set(key, state);
    }
  }

  return [...bestByTime.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_GLOBAL_STATES);
}

function buildAlignmentIssues(input: {
  scriptUnits: ScriptUnit[];
  candidateGroups: Candidate[][];
  directMatches: DraftSegment[];
  emptyLattice: boolean;
}): AlignmentIssue[] {
  const matchedIndexes = new Set(input.directMatches.map((match) => match.scriptIndex));

  return input.scriptUnits.flatMap((scriptUnit) => {
    if (matchedIndexes.has(scriptUnit.index)) {
      return [];
    }

    const candidates = input.candidateGroups[scriptUnit.index] ?? [];
    const bestCandidate = candidates.sort((left, right) => right.confidence - left.confidence)[0];

    return [
      {
        scriptIndex: scriptUnit.index,
        text: scriptUnit.text,
        normalizedText: scriptUnit.normalizedText,
        reason: input.emptyLattice
          ? "empty-caption-lattice"
          : bestCandidate
            ? "below-threshold"
            : "no-candidate",
        ...(bestCandidate ? { confidence: roundConfidence(bestCandidate.confidence) } : {})
      } satisfies AlignmentIssue
    ];
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
    drafts.push(currentMatch);

    if (!nextMatch) {
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
      continue;
    }

    const interpolated = interpolateIssueBlock({
      issues: boundedIssues,
      gapStart: currentMatch.end,
      gapEnd: nextMatch.start
    });

    for (const draft of interpolated) {
      drafts.push(draft);
      remainingIssues.delete(draft.scriptIndex);
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

function collectCandidates(input: {
  scriptIndex: number;
  blockIndex: number;
  needle: string;
  lattice: CaptionLattice;
  previousContext?: string;
  nextContext?: string;
}): Candidate[] {
  const { needle, lattice } = input;
  const haystack = lattice.text;
  if (!needle || !haystack) {
    return [];
  }

  const searchStart = 0;
  const searchEnd = haystack.length;
  const candidateStarts = collectCandidateStarts(needle, haystack, searchStart, searchEnd);
  const candidates: Candidate[] = [];

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
      if (confidence < GLOBAL_CANDIDATE_MIN_CONFIDENCE) {
        continue;
      }
      const score = scoreCandidate({
        lattice,
        start,
        end,
        confidence,
        previousContext: input.previousContext,
        nextContext: input.nextContext
      });
      const startCharacter = lattice.characters[start];
      const endCharacter = lattice.characters[Math.max(end - 1, start)];
      if (!startCharacter || !endCharacter) {
        continue;
      }

      candidates.push({
          scriptIndex: input.scriptIndex,
          blockIndex: input.blockIndex,
          start,
          end,
          startTime: startCharacter.start,
          endTime: Math.max(endCharacter.end, startCharacter.start + 0.25),
          confidence,
          score,
          lattice,
          matchKind: "surface"
        });
    }
  }

  return mergeCandidates(candidates).slice(0, MAX_CANDIDATES_PER_UNIT);
}

function mergeCandidates(candidates: Candidate[]): Candidate[] {
  const bestByTime = new Map<string, Candidate>();

  for (const candidate of candidates) {
    const key = `${Math.round(candidate.startTime * 4)}:${Math.round(candidate.endTime * 4)}`;
    const previous = bestByTime.get(key);
    if (!previous || candidate.score > previous.score) {
      bestByTime.set(key, candidate);
    }
  }

  return [...bestByTime.values()]
    .sort((left, right) => right.score - left.score || left.startTime - right.startTime);
}

function scoreCandidate(input: {
  lattice: CaptionLattice;
  start: number;
  end: number;
  confidence: number;
  previousContext?: string;
  nextContext?: string;
}): number {
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
    CONTEXT_WEIGHT * nextContextScore
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
