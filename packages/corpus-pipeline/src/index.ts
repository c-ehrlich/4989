import type { ManifestEntry } from "@4989/corpus-types";

export { buildStaticIndex, getIndexBucketName } from "./index/buildStaticIndex.js";
export { searchCorpus } from "./search/searchCorpus.js";
export type {
  SearchCorpusOptions,
  SearchCorpusResult,
  SearchHit,
  SearchMode
} from "./search/searchCorpus.js";

export const pipelinePackageName = "@4989/corpus-pipeline";

export function isProcessableEpisode(entry: ManifestEntry): boolean {
  return Boolean(entry.youtubeId && entry.hasScript && entry.status !== "ambiguous");
}
