import { z } from "zod";

export const SEGMENTS_PER_EPISODE = 100000;

const nonEmptyStringSchema = z.string().min(1);
const sourceHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const episodeNumberSchema = z.number().int().positive();
const localSegmentIndexSchema = z
  .number()
  .int()
  .min(0)
  .max(SEGMENTS_PER_EPISODE - 1);
const segmentIdSchema = z.number().int().positive();
const secondsSchema = z.number().finite().nonnegative();
const optionalUrlSchema = z.string().url().optional();
const optionalDateStringSchema = z.string().date().optional();
const optionalDateTimeStringSchema = z.string().datetime({ offset: true }).optional();

function assertEpisodeNumber(episode: number): void {
  if (!episodeNumberSchema.safeParse(episode).success) {
    throw new RangeError(`Episode must be a positive integer: ${episode}`);
  }
}

function assertLocalSegmentIndex(localIndex: number): void {
  if (!localSegmentIndexSchema.safeParse(localIndex).success) {
    throw new RangeError(
      `Local segment index must be an integer from 0 to ${SEGMENTS_PER_EPISODE - 1}: ${localIndex}`
    );
  }
}

export function makeEpisodeKey(episode: number): string {
  assertEpisodeNumber(episode);
  return `ep${episode}`;
}

export function makeSegmentId(episode: number, localIndex: number): number {
  assertEpisodeNumber(episode);
  assertLocalSegmentIndex(localIndex);
  return episode * SEGMENTS_PER_EPISODE + localIndex;
}

export function parseSegmentId(segmentId: number): {
  episode: number;
  localIndex: number;
} {
  if (!segmentIdSchema.safeParse(segmentId).success || segmentId < SEGMENTS_PER_EPISODE) {
    throw new RangeError(`Segment ID must be a positive generated segment ID: ${segmentId}`);
  }

  const episode = Math.floor(segmentId / SEGMENTS_PER_EPISODE);
  const localIndex = segmentId % SEGMENTS_PER_EPISODE;

  assertEpisodeNumber(episode);
  assertLocalSegmentIndex(localIndex);

  return { episode, localIndex };
}

const generatedSegmentIdSchema = segmentIdSchema.refine(
  (segmentId) => {
    try {
      parseSegmentId(segmentId);
      return true;
    } catch {
      return false;
    }
  },
  { message: "Segment ID must be generated from episode * 100000 + localIndex" }
);

export function makeSegmentKey(episode: number, localIndex: number): string {
  assertEpisodeNumber(episode);
  assertLocalSegmentIndex(localIndex);
  return `${makeEpisodeKey(episode)}-s${localIndex.toString().padStart(5, "0")}`;
}

export const EpisodeStatusSchema = z.enum([
  "discovered",
  "missing-video",
  "missing-script",
  "missing-caption",
  "duplicate",
  "ambiguous",
  "processed",
  "low-confidence",
  "failed"
]);

export const ProcessingStatusSchema = z.enum([
  "processed",
  "missing-video",
  "missing-script",
  "missing-caption",
  "low-confidence",
  "failed",
  "skipped"
]);

export const CorpusTokenSchema = z
  .object({
    surface: nonEmptyStringSchema,
    lemma: nonEmptyStringSchema,
    pos: z.array(nonEmptyStringSchema).min(1),
    reading: nonEmptyStringSchema.optional()
  })
  .strict();

export const CorpusSegmentSchema = z
  .object({
    id: generatedSegmentIdSchema,
    segmentKey: nonEmptyStringSchema,
    episode: episodeNumberSchema,
    localIndex: localSegmentIndexSchema,
    youtubeId: nonEmptyStringSchema,
    start: secondsSchema,
    end: secondsSchema,
    text: nonEmptyStringSchema,
    confidence: z.number().finite().min(0).max(1).optional(),
    timingSource: z
      .enum(["youtube-caption-lattice", "interpolated-between-caption-matches"])
      .optional(),
    tokens: z.array(CorpusTokenSchema)
  })
  .strict()
  .superRefine((segment, context) => {
    if (segment.end <= segment.start) {
      context.addIssue({
        code: "custom",
        message: "Segment end must be greater than start",
        path: ["end"]
      });
    }

    if (segment.id !== makeSegmentId(segment.episode, segment.localIndex)) {
      context.addIssue({
        code: "custom",
        message: "Segment ID must equal episode * 100000 + localIndex",
        path: ["id"]
      });
    }

    if (segment.segmentKey !== makeSegmentKey(segment.episode, segment.localIndex)) {
      context.addIssue({
        code: "custom",
        message: "Segment key must match episode and localIndex",
        path: ["segmentKey"]
      });
    }
  });

export const VideoSchema = z
  .object({
    youtubeId: nonEmptyStringSchema,
    title: nonEmptyStringSchema,
    url: z.string().url(),
    episode: episodeNumberSchema.optional(),
    publishedAt: optionalDateTimeStringSchema,
    durationSeconds: secondsSchema.optional()
  })
  .strict();

export const VideosSchema = z.array(VideoSchema);

export const ScriptSchema = z
  .object({
    episode: episodeNumberSchema,
    title: nonEmptyStringSchema,
    url: z.string().url(),
    publishedAt: optionalDateTimeStringSchema,
    modifiedAt: optionalDateTimeStringSchema,
    lastmod: optionalDateStringSchema,
    text: nonEmptyStringSchema,
    htmlPath: nonEmptyStringSchema,
    textPath: nonEmptyStringSchema
  })
  .strict();

export const ScriptsSchema = z.array(ScriptSchema);

export const EpisodeSchema = z
  .object({
    episode: episodeNumberSchema,
    title: nonEmptyStringSchema.optional(),
    youtubeId: nonEmptyStringSchema.optional(),
    videoUrl: optionalUrlSchema,
    scriptUrl: optionalUrlSchema,
    publishedDate: optionalDateStringSchema,
    durationSeconds: secondsSchema.optional(),
    segmentPath: nonEmptyStringSchema.optional()
  })
  .strict();

export const EpisodesSchema = z.array(EpisodeSchema);

export const ManifestEntrySchema = z
  .object({
    episode: episodeNumberSchema,
    youtubeId: nonEmptyStringSchema.optional(),
    videoUrl: optionalUrlSchema,
    scriptUrl: optionalUrlSchema,
    hasScript: z.boolean(),
    hasCaption: z.boolean(),
    status: EpisodeStatusSchema,
    alignmentPath: nonEmptyStringSchema.optional(),
    notes: nonEmptyStringSchema.optional()
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.hasScript && !entry.scriptUrl) {
      context.addIssue({
        code: "custom",
        message: "Manifest entries with scripts must include scriptUrl",
        path: ["scriptUrl"]
      });
    }

    if (entry.hasCaption && !entry.youtubeId) {
      context.addIssue({
        code: "custom",
        message: "Manifest entries with captions must include youtubeId",
        path: ["youtubeId"]
      });
    }

    if (entry.status === "processed") {
      if (!entry.youtubeId) {
        context.addIssue({
          code: "custom",
          message: "Processed manifest entries must include youtubeId",
          path: ["youtubeId"]
        });
      }

      if (!entry.videoUrl) {
        context.addIssue({
          code: "custom",
          message: "Processed manifest entries must include videoUrl",
          path: ["videoUrl"]
        });
      }

      if (!entry.scriptUrl) {
        context.addIssue({
          code: "custom",
          message: "Processed manifest entries must include scriptUrl",
          path: ["scriptUrl"]
        });
      }

      if (!entry.alignmentPath) {
        context.addIssue({
          code: "custom",
          message: "Processed manifest entries must include alignmentPath",
          path: ["alignmentPath"]
        });
      }

      if (!entry.hasScript || !entry.hasCaption) {
        context.addIssue({
          code: "custom",
          message: "Processed manifest entries must have script and caption sources"
        });
      }
    }
  });

export const ManifestSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    episodes: z.array(ManifestEntrySchema)
  })
  .strict()
  .superRefine((manifest, context) => {
    const seen = new Set<number>();

    manifest.episodes.forEach((entry, index) => {
      if (seen.has(entry.episode) && entry.status !== "duplicate") {
        context.addIssue({
          code: "custom",
          message: "Duplicate episode numbers must be represented with duplicate status",
          path: ["episodes", index, "episode"]
        });
      }

      seen.add(entry.episode);
    });
  });

export const AlignmentSourceSchema = z
  .object({
    captionTrack: nonEmptyStringSchema,
    alignmentMethod: nonEmptyStringSchema,
    scriptHash: sourceHashSchema,
    captionHash: sourceHashSchema,
    videoMetadataHash: sourceHashSchema,
    pipelineVersion: z.number().int().positive(),
    generatedAt: z.string().datetime({ offset: true })
  })
  .strict();

export const AlignmentSummarySchema = z
  .object({
    scriptUnitCount: z.number().int().nonnegative().optional(),
    segmentCount: z.number().int().nonnegative(),
    matchedCount: z.number().int().nonnegative(),
    unmatchedCount: z.number().int().nonnegative(),
    inferredCount: z.number().int().nonnegative().optional(),
    averageConfidence: z.number().finite().min(0).max(1).optional(),
    lowConfidenceCount: z.number().int().nonnegative()
  })
  .strict();

export const AlignmentSchema = z
  .object({
    episode: episodeNumberSchema,
    youtubeId: nonEmptyStringSchema,
    source: AlignmentSourceSchema,
    summary: AlignmentSummarySchema,
    segments: z.array(CorpusSegmentSchema)
  })
  .strict()
  .superRefine((alignment, context) => {
    if (alignment.summary.segmentCount !== alignment.segments.length) {
      context.addIssue({
        code: "custom",
        message: "Alignment summary segmentCount must match segments length",
        path: ["summary", "segmentCount"]
      });
    }

    const expectedUnitCount = alignment.summary.scriptUnitCount ?? alignment.summary.segmentCount;
    if (alignment.summary.matchedCount + alignment.summary.unmatchedCount !== expectedUnitCount) {
      context.addIssue({
        code: "custom",
        message:
          "Alignment matchedCount plus unmatchedCount must equal scriptUnitCount when present, otherwise segmentCount",
        path: ["summary"]
      });
    }

    if (alignment.summary.lowConfidenceCount > alignment.summary.segmentCount) {
      context.addIssue({
        code: "custom",
        message: "Alignment lowConfidenceCount cannot exceed segmentCount",
        path: ["summary", "lowConfidenceCount"]
      });
    }

    if (
      alignment.summary.inferredCount !== undefined &&
      alignment.summary.inferredCount > alignment.summary.segmentCount
    ) {
      context.addIssue({
        code: "custom",
        message: "Alignment inferredCount cannot exceed segmentCount",
        path: ["summary", "inferredCount"]
      });
    }

    const seenIds = new Set<number>();
    const seenLocalIndexes = new Set<number>();
    const seenSegmentKeys = new Set<string>();

    alignment.segments.forEach((segment, index) => {
      if (segment.episode !== alignment.episode) {
        context.addIssue({
          code: "custom",
          message: "Segment episode must match alignment episode",
          path: ["segments", index, "episode"]
        });
      }

      if (segment.youtubeId !== alignment.youtubeId) {
        context.addIssue({
          code: "custom",
          message: "Segment youtubeId must match alignment youtubeId",
          path: ["segments", index, "youtubeId"]
        });
      }

      if (seenIds.has(segment.id)) {
        context.addIssue({
          code: "custom",
          message: "Alignment segment IDs must be unique",
          path: ["segments", index, "id"]
        });
      }

      if (seenLocalIndexes.has(segment.localIndex)) {
        context.addIssue({
          code: "custom",
          message: "Alignment local segment indexes must be unique",
          path: ["segments", index, "localIndex"]
        });
      }

      if (seenSegmentKeys.has(segment.segmentKey)) {
        context.addIssue({
          code: "custom",
          message: "Alignment segment keys must be unique",
          path: ["segments", index, "segmentKey"]
        });
      }

      seenIds.add(segment.id);
      seenLocalIndexes.add(segment.localIndex);
      seenSegmentKeys.add(segment.segmentKey);

      const previousSegment = alignment.segments[index - 1];
      if (previousSegment && segment.start < previousSegment.start) {
        context.addIssue({
          code: "custom",
          message: "Alignment segments must be sorted by start time",
          path: ["segments", index, "start"]
        });
      }
    });
  });

export const EpisodeSegmentsSchema = z
  .object({
    episode: episodeNumberSchema,
    youtubeId: nonEmptyStringSchema,
    title: nonEmptyStringSchema,
    segments: z.array(CorpusSegmentSchema)
  })
  .strict()
  .superRefine((episodeSegments, context) => {
    const seenIds = new Set<number>();
    const seenLocalIndexes = new Set<number>();
    const seenSegmentKeys = new Set<string>();

    episodeSegments.segments.forEach((segment, index) => {
      if (segment.episode !== episodeSegments.episode) {
        context.addIssue({
          code: "custom",
          message: "Segment episode must match segment file episode",
          path: ["segments", index, "episode"]
        });
      }

      if (segment.youtubeId !== episodeSegments.youtubeId) {
        context.addIssue({
          code: "custom",
          message: "Segment youtubeId must match segment file youtubeId",
          path: ["segments", index, "youtubeId"]
        });
      }

      if (seenIds.has(segment.id)) {
        context.addIssue({
          code: "custom",
          message: "Segment file IDs must be unique",
          path: ["segments", index, "id"]
        });
      }

      if (seenLocalIndexes.has(segment.localIndex)) {
        context.addIssue({
          code: "custom",
          message: "Segment file local indexes must be unique",
          path: ["segments", index, "localIndex"]
        });
      }

      if (seenSegmentKeys.has(segment.segmentKey)) {
        context.addIssue({
          code: "custom",
          message: "Segment file keys must be unique",
          path: ["segments", index, "segmentKey"]
        });
      }

      seenIds.add(segment.id);
      seenLocalIndexes.add(segment.localIndex);
      seenSegmentKeys.add(segment.segmentKey);
    });
  });

export const LemmaBucketSchema = z.record(nonEmptyStringSchema, z.array(generatedSegmentIdSchema));
export const SurfaceBucketSchema = z.record(nonEmptyStringSchema, z.array(generatedSegmentIdSchema));
export const SurfaceToLemmasSchema = z.record(
  nonEmptyStringSchema,
  z.array(nonEmptyStringSchema).min(1)
);

export const BuildReportEntrySchema = z
  .object({
    status: ProcessingStatusSchema,
    segments: z.number().int().nonnegative().optional(),
    matchedCount: z.number().int().nonnegative().optional(),
    unmatchedCount: z.number().int().nonnegative().optional(),
    inferredCount: z.number().int().nonnegative().optional(),
    averageConfidence: z.number().finite().min(0).max(1).optional(),
    lowConfidenceCount: z.number().int().nonnegative().optional(),
    message: nonEmptyStringSchema.optional()
  })
  .strict();

export const BuildReportSchema = z.record(z.string().regex(/^ep\d+$/), BuildReportEntrySchema);

export type EpisodeStatus = z.infer<typeof EpisodeStatusSchema>;
export type ProcessingStatus = z.infer<typeof ProcessingStatusSchema>;
export type CorpusToken = z.infer<typeof CorpusTokenSchema>;
export type CorpusSegment = z.infer<typeof CorpusSegmentSchema>;
export type Video = z.infer<typeof VideoSchema>;
export type Videos = z.infer<typeof VideosSchema>;
export type Script = z.infer<typeof ScriptSchema>;
export type Scripts = z.infer<typeof ScriptsSchema>;
export type Episode = z.infer<typeof EpisodeSchema>;
export type Episodes = z.infer<typeof EpisodesSchema>;
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
export type AlignmentSource = z.infer<typeof AlignmentSourceSchema>;
export type AlignmentSummary = z.infer<typeof AlignmentSummarySchema>;
export type Alignment = z.infer<typeof AlignmentSchema>;
export type EpisodeSegments = z.infer<typeof EpisodeSegmentsSchema>;
export type LemmaBucket = z.infer<typeof LemmaBucketSchema>;
export type SurfaceBucket = z.infer<typeof SurfaceBucketSchema>;
export type SurfaceToLemmas = z.infer<typeof SurfaceToLemmasSchema>;
export type BuildReportEntry = z.infer<typeof BuildReportEntrySchema>;
export type BuildReport = z.infer<typeof BuildReportSchema>;
