/*
 * Japanese deinflection for corpus search.
 *
 * Adapted from Yomichan's GPL-3.0 deinflector implementation:
 * https://github.com/FooSoft/yomichan/blob/master/ext/js/language/deinflector.js
 *
 * Rule data is vendored from:
 * https://github.com/FooSoft/yomichan/blob/master/ext/data/deinflect.json
 */

import deinflectReasons from "./yomichan-deinflect-rules.json";

export type JapaneseDeinflection = {
  term: string;
  reasons: string[];
};

type RuleType = "v1" | "v5" | "vs" | "vk" | "vz" | "adj-i" | "iru";

type DeinflectRule = {
  kanaIn: string;
  kanaOut: string;
  rulesIn: RuleType[];
  rulesOut: RuleType[];
};

type NormalizedVariant = [
  kanaIn: string,
  kanaOut: string,
  rulesIn: number,
  rulesOut: number
];

type DeinflectionCandidate = {
  term: string;
  rules: number;
  reasons: string[];
};

const RULE_TYPE_FLAGS = new Map<RuleType, number>([
  ["v1", 0b00000001],
  ["v5", 0b00000010],
  ["vs", 0b00000100],
  ["vk", 0b00001000],
  ["vz", 0b00010000],
  ["adj-i", 0b00100000],
  ["iru", 0b01000000]
]);

const NORMALIZED_REASONS = normalizeReasons(
  deinflectReasons as Record<string, DeinflectRule[]>
);

export function deinflectJapanese(source: string): JapaneseDeinflection[] {
  const candidates: DeinflectionCandidate[] = [
    {
      term: source,
      rules: 0,
      reasons: []
    }
  ];

  for (let index = 0; index < candidates.length; index += 1) {
    const { rules, term, reasons } = candidates[index];

    for (const [reason, variants] of NORMALIZED_REASONS) {
      for (const [kanaIn, kanaOut, rulesIn, rulesOut] of variants) {
        if (
          (rules !== 0 && (rules & rulesIn) === 0) ||
          !term.endsWith(kanaIn) ||
          term.length - kanaIn.length + kanaOut.length <= 0
        ) {
          continue;
        }

        candidates.push({
          term: `${term.slice(0, -kanaIn.length)}${kanaOut}`,
          rules: rulesOut,
          reasons: [reason, ...reasons]
        });
      }
    }
  }

  const seenTerms = new Set<string>();
  const deinflections: JapaneseDeinflection[] = [];

  for (const candidate of candidates) {
    if (seenTerms.has(candidate.term)) {
      continue;
    }

    seenTerms.add(candidate.term);
    deinflections.push({
      term: candidate.term,
      reasons: candidate.reasons
    });
  }

  return deinflections;
}

function normalizeReasons(
  reasons: Record<string, DeinflectRule[]>
): Array<[string, NormalizedVariant[]]> {
  return Object.entries(reasons).map(([reason, variants]) => [
    reason,
    variants.map(({ kanaIn, kanaOut, rulesIn, rulesOut }) => [
      kanaIn,
      kanaOut,
      rulesToRuleFlags(rulesIn),
      rulesToRuleFlags(rulesOut)
    ])
  ]);
}

function rulesToRuleFlags(rules: RuleType[]) {
  return rules.reduce((flags, rule) => flags | (RULE_TYPE_FLAGS.get(rule) ?? 0), 0);
}
