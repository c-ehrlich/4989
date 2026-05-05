import { resolve } from "node:path";

import { makeEpisodeKey } from "@4989/corpus-types";

import { validateAlignmentFile } from "../episode/validateAlignment.js";
import { defaultCorpusDataDirectory } from "./paths.js";

type ValidateAlignmentCliOptions = {
  episode?: number;
  alignmentPath?: string;
  dataDirectory?: string;
  reportPath?: string;
  requireReviewReport: boolean;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options === "help") {
    printHelp();
    return;
  }

  const dataDirectory = resolve(options.dataDirectory ?? (await defaultCorpusDataDirectory()));
  const alignmentPath = resolveAlignmentPath(options, dataDirectory);
  const result = await validateAlignmentFile({
    alignmentPath,
    dataDirectory,
    reportPath: options.reportPath,
    requireReviewReport: options.requireReviewReport
  });

  console.log(`Validated ${result.alignmentPath}`);
  console.log(
    `Segments: ${result.alignment.summary.segmentCount}; script units: ${result.alignment.summary.scriptUnitCount ?? result.alignment.summary.segmentCount}; low confidence: ${result.alignment.summary.lowConfidenceCount}; unmatched: ${result.alignment.summary.unmatchedCount}; inferred: ${result.alignment.summary.inferredCount ?? 0}`
  );
  if (result.alignment.summary.averageConfidence !== undefined) {
    console.log(`Average confidence: ${result.alignment.summary.averageConfidence.toFixed(3)}`);
  }
  if (result.durationSeconds !== undefined) {
    console.log(`Video duration: ${result.durationSeconds}s`);
  }
  if (result.firstSegment) {
    console.log(
      `First segment: ${formatSegmentTiming(result.firstSegment.start, result.firstSegment.end)} ${result.firstSegment.segmentKey} ${result.firstSegment.text.slice(0, 80)}`
    );
  }
  if (result.lastSegment) {
    console.log(
      `Last segment: ${formatSegmentTiming(result.lastSegment.start, result.lastSegment.end)} ${result.lastSegment.segmentKey} ${result.lastSegment.text.slice(0, 80)}`
    );
  }
  if (result.lowConfidenceReviewCount !== undefined) {
    console.log(`Review report low-confidence entries: ${result.lowConfidenceReviewCount}`);
  }
  if (result.inferredReviewCount !== undefined) {
    console.log(`Review report interpolated entries: ${result.inferredReviewCount}`);
  }
  for (const warning of result.warnings) {
    console.warn(`Warning: ${warning}`);
  }
}

function parseArgs(args: string[]): ValidateAlignmentCliOptions | "help" {
  const options: ValidateAlignmentCliOptions = {
    requireReviewReport: true
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      return "help";
    }

    if (arg === "--episode") {
      options.episode = readPositiveIntegerArg(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--alignment") {
      options.alignmentPath = readValueArg(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--data-dir") {
      options.dataDirectory = readValueArg(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--report") {
      options.reportPath = readValueArg(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--no-report") {
      options.requireReviewReport = false;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.episode === undefined && !options.alignmentPath) {
    throw new Error("Either --episode or --alignment is required");
  }

  return options;
}

function resolveAlignmentPath(options: ValidateAlignmentCliOptions, dataDirectory: string): string {
  if (options.alignmentPath) {
    return resolve(options.alignmentPath);
  }

  if (options.episode === undefined) {
    throw new Error("Either --episode or --alignment is required");
  }

  return resolve(dataDirectory, "alignments", `${makeEpisodeKey(options.episode)}.json`);
}

function readValueArg(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value`);
  }

  return value;
}

function readPositiveIntegerArg(args: string[], index: number, name: string): number {
  const value = Number.parseInt(readValueArg(args, index, name), 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} requires a positive integer`);
  }

  return value;
}

function formatSegmentTiming(start: number, end: number): string {
  return `${start.toFixed(2)}-${end.toFixed(2)}s`;
}

function printHelp(): void {
  console.log(`Usage: pnpm --filter @4989/corpus-pipeline validate-alignment -- --episode 367 [options]

Options:
  --episode <n>       Episode number to validate.
  --alignment <path>  Alignment JSON path. Overrides --episode path resolution.
  --data-dir <path>   Corpus data directory. Defaults to packages/corpus-data/data.
  --report <path>     Review report path. Defaults to data/reports/epNNN.json.
  --no-report         Do not require a review report.
  -h, --help          Show this help.
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`validate-alignment failed: ${message}`);
  process.exitCode = 1;
});
