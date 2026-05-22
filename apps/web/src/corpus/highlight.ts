import type { CorpusSegment, CorpusToken } from "@4989/corpus-types";

import type { SearchMode } from "./search";

export type SearchHighlightInput = {
  query: string;
  mode: SearchMode;
  matchedTerms: string[];
};

export type HighlightTextPart = {
  text: string;
  highlighted: boolean;
};

type TokenSpan = {
  token: CorpusToken;
  start: number;
  end: number;
};

type TextRange = {
  start: number;
  end: number;
};

export function getSearchHighlightParts(
  segment: CorpusSegment,
  search: SearchHighlightInput
): HighlightTextPart[] {
  const ranges = getSearchHighlightRanges(segment, search);
  if (ranges.length === 0) {
    return [{ text: segment.text, highlighted: false }];
  }

  const parts: HighlightTextPart[] = [];
  let cursor = 0;

  for (const range of ranges) {
    if (cursor < range.start) {
      parts.push({
        text: segment.text.slice(cursor, range.start),
        highlighted: false
      });
    }

    parts.push({
      text: segment.text.slice(range.start, range.end),
      highlighted: true
    });
    cursor = range.end;
  }

  if (cursor < segment.text.length) {
    parts.push({
      text: segment.text.slice(cursor),
      highlighted: false
    });
  }

  return parts;
}

export function getSearchHighlightRanges(
  segment: CorpusSegment,
  search: SearchHighlightInput
): TextRange[] {
  const matchedTerms = new Set(search.matchedTerms);
  const tokenSpans = getTokenSpans(segment);
  const tokenRanges = tokenSpans.flatMap((span, index) => {
    if (!isMatchedToken(span.token, search, matchedTerms)) {
      return [];
    }

    return [extendInflectedTokenRange(tokenSpans, index)];
  });

  if (tokenRanges.length > 0) {
    return mergeRanges(tokenRanges);
  }

  return mergeRanges(findExactTextRanges(segment.text, search.query));
}

function getTokenSpans(segment: CorpusSegment): TokenSpan[] {
  let cursor = 0;
  const spans: TokenSpan[] = [];

  for (const token of segment.tokens) {
    const start = segment.text.indexOf(token.surface, cursor);
    if (start === -1) {
      continue;
    }

    const end = start + token.surface.length;
    spans.push({ token, start, end });
    cursor = end;
  }

  return spans;
}

function isMatchedToken(
  token: CorpusToken,
  search: SearchHighlightInput,
  matchedTerms: Set<string>
) {
  if (search.mode === "exact") {
    return token.surface === search.query;
  }

  return matchedTerms.has(token.lemma) || matchedTerms.has(token.surface);
}

function extendInflectedTokenRange(tokenSpans: TokenSpan[], index: number): TextRange {
  const startSpan = tokenSpans[index];
  let end = startSpan.end;

  if (!isInflectableToken(startSpan.token)) {
    return { start: startSpan.start, end };
  }

  let previous = startSpan;
  for (let nextIndex = index + 1; nextIndex < tokenSpans.length; nextIndex += 1) {
    const next = tokenSpans[nextIndex];
    if (next.start !== previous.end || !isInflectionContinuation(next.token, previous.token)) {
      break;
    }

    end = next.end;
    previous = next;
  }

  return { start: startSpan.start, end };
}

function isInflectableToken(token: CorpusToken) {
  return ["動詞", "形容詞", "助動詞"].includes(token.pos[0] ?? "");
}

function isInflectionContinuation(token: CorpusToken, previousToken: CorpusToken) {
  if (token.pos[0] === "助動詞") {
    return true;
  }

  if (["て", "で"].includes(token.surface) && token.pos[0] === "助詞") {
    return true;
  }

  return (
    ["て", "で"].includes(previousToken.surface) &&
    token.pos[0] === "動詞" &&
    token.pos.includes("非自立可能")
  );
}

function findExactTextRanges(text: string, query: string): TextRange[] {
  if (!query) {
    return [];
  }

  const ranges: TextRange[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf(query, cursor);
    if (start === -1) {
      break;
    }

    const end = start + query.length;
    ranges.push({ start, end });
    cursor = end;
  }

  return ranges;
}

function mergeRanges(ranges: TextRange[]): TextRange[] {
  const sortedRanges = ranges
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  return sortedRanges.reduce<TextRange[]>((mergedRanges, range) => {
    const previousRange = mergedRanges.at(-1);
    if (!previousRange || range.start > previousRange.end) {
      mergedRanges.push({ ...range });
      return mergedRanges;
    }

    previousRange.end = Math.max(previousRange.end, range.end);
    return mergedRanges;
  }, []);
}
